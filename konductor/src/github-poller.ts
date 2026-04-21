/**
 * GitHubPoller — polls the GitHub API for open pull requests and converts
 * them into passive work sessions for collision detection.
 *
 * Creates PR-based passive sessions that participate in collision evaluation
 * alongside active sessions. Handles the full PR lifecycle: create on open,
 * update on file changes, remove on close/merge.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 5.3
 */

import type { GitHubConfig, GitHubRepoConfig, WorkSession } from "./types.js";
import type { SessionManager } from "./session-manager.js";
import type { KonductorLogger } from "./logger.js";
import type { BatonEventEmitter } from "./baton-event-emitter.js";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// GitHub API response types
// ---------------------------------------------------------------------------

export interface GitHubPullRequest {
  number: number;
  html_url: string;
  state: string;
  draft: boolean;
  user: { login: string } | null;
  head: { ref: string };
  base: { ref: string };
}

export interface GitHubPullRequestFile {
  filename: string;
}

export interface GitHubReview {
  state: string; // "APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED"
  user: { login: string } | null;
}

// ---------------------------------------------------------------------------
// Rate limit tracking
// ---------------------------------------------------------------------------

interface RateLimitState {
  remaining: number;
  resetAt: number; // Unix epoch ms
}

// ---------------------------------------------------------------------------
// Internal PR session tracking
// ---------------------------------------------------------------------------

export interface TrackedPR {
  prNumber: number;
  sessionId: string;
  repo: string;
  author: string;
  headBranch: string;
  targetBranch: string;
  draft: boolean;
  approved: boolean;
  files: string[];
  prUrl: string;
}

// ---------------------------------------------------------------------------
// Fetch abstraction for testability
// ---------------------------------------------------------------------------

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

// ---------------------------------------------------------------------------
// GitHubPoller
// ---------------------------------------------------------------------------

export class GitHubPoller {
  private config: GitHubConfig;
  private readonly sessionManager: SessionManager;
  private readonly logger?: KonductorLogger;
  private readonly batonEventEmitter?: BatonEventEmitter;
  private fetchFn: FetchFn;

  private timer: ReturnType<typeof setInterval> | null = null;
  private trackedPRs: Map<string, TrackedPR> = new Map(); // key: "owner/repo#number"
  private rateLimit: RateLimitState = { remaining: 5000, resetAt: 0 };
  private polling = false;

  constructor(
    config: GitHubConfig,
    sessionManager: SessionManager,
    logger?: KonductorLogger,
    fetchFn?: FetchFn,
    batonEventEmitter?: BatonEventEmitter,
  ) {
    this.config = config;
    this.sessionManager = sessionManager;
    this.logger = logger;
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
    this.batonEventEmitter = batonEventEmitter;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  /** Start polling on the configured interval. */
  start(): void {
    if (this.timer) return;
    const intervalMs = this.config.pollIntervalSeconds * 1000;
    this.timer = setInterval(() => {
      this.pollAll().catch(() => {});
    }, intervalMs);
    // Run immediately on start
    this.pollAll().catch(() => {});
  }

  /** Stop polling and clear the interval timer. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Update config (e.g. on hot-reload). Restarts polling if interval changed. */
  updateConfig(config: GitHubConfig): void {
    const intervalChanged = this.config.pollIntervalSeconds !== config.pollIntervalSeconds;
    this.config = config;
    if (intervalChanged && this.timer) {
      this.stop();
      this.start();
    }
  }

  /** Get the current set of tracked PRs (for testing/inspection). */
  getTrackedPRs(): Map<string, TrackedPR> {
    return new Map(this.trackedPRs);
  }

  // ── Polling ───────────────────────────────────────────────────────

  /** Poll all configured repositories. */
  async pollAll(): Promise<void> {
    if (this.polling) return; // prevent overlapping polls
    this.polling = true;
    try {
      for (const repoConfig of this.config.repositories) {
        try {
          await this.pollPRs(repoConfig);
        } catch (err) {
          // Requirement 5.3: log error and continue — don't disrupt active sessions
          if (this.logger) {
            this.logger.logGitHubPoll(repoConfig.repo, 0, 0);
          }
        }
      }
    } finally {
      this.polling = false;
    }
  }

  /**
   * Poll open PRs for a single repository.
   * Fetches open PRs, their changed files, and review status.
   * Creates/updates/removes passive sessions accordingly.
   *
   * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
   */
  async pollPRs(repoConfig: GitHubRepoConfig): Promise<void> {
    const repo = repoConfig.repo;
    const token = this.resolveToken();
    if (!token) return;

    // Check rate limit before making requests
    if (!this.canMakeRequest()) {
      return;
    }

    // Fetch open PRs
    const prs = await this.fetchOpenPRs(repo, token);

    // Get active session userIds for self-collision suppression (Req 1.7)
    const activeSessions = await this.sessionManager.getActiveSessions(repo);
    const activeUserIds = new Set(
      activeSessions
        .filter((s) => !s.source || s.source === "active")
        .map((s) => s.userId),
    );

    // Track which PRs are still open
    const openPRKeys = new Set<string>();

    for (const pr of prs) {
      const prKey = `${repo}#${pr.number}`;
      openPRKeys.add(prKey);

      const author = pr.user?.login ?? "unknown";

      // Self-collision suppression: skip if author has active session in same repo
      if (activeUserIds.has(author)) {
        // If we were tracking this PR, remove the session
        const existing = this.trackedPRs.get(prKey);
        if (existing) {
          await this.removeTrackedPR(prKey, "self-collision suppression");
        }
        continue;
      }

      // Skip drafts if configured
      if (pr.draft && !this.config.includeDrafts) {
        continue;
      }

      // Fetch changed files for this PR
      const files = await this.fetchPRFiles(repo, pr.number, token);

      // Fetch review status
      const approved = await this.checkPRApproved(repo, pr.number, token);

      const existing = this.trackedPRs.get(prKey);

      if (existing) {
        // Update existing PR session if files or status changed
        const filesChanged = !arraysEqual(existing.files, files);
        const statusChanged = existing.draft !== pr.draft || existing.approved !== approved;

        if (filesChanged || statusChanged) {
          await this.updateTrackedPR(prKey, {
            files,
            draft: pr.draft,
            approved,
            headBranch: pr.head.ref,
            targetBranch: pr.base.ref,
          });
        }
      } else {
        // Create new PR session
        await this.createTrackedPR({
          prNumber: pr.number,
          repo,
          author,
          headBranch: pr.head.ref,
          targetBranch: pr.base.ref,
          draft: pr.draft,
          approved,
          files,
          prUrl: pr.html_url,
        });
      }
    }

    // Remove sessions for PRs that are no longer open (closed/merged) — Req 1.3
    for (const [prKey, tracked] of this.trackedPRs) {
      if (tracked.repo === repo && !openPRKeys.has(prKey)) {
        await this.removeTrackedPR(prKey, "closed/merged");
      }
    }

    if (this.logger) {
      this.logger.logGitHubPoll(repo, prs.length, 0);
    }
  }

  // ── PR Session Lifecycle ────────────────────────────────────────────

  private async createTrackedPR(params: Omit<TrackedPR, "sessionId">): Promise<void> {
    const sessionId = randomUUID();
    const now = new Date().toISOString();

    const session: WorkSession = {
      sessionId,
      userId: params.author,
      repo: params.repo,
      branch: params.headBranch,
      files: params.files,
      createdAt: now,
      lastHeartbeat: now,
      source: "github_pr",
      prNumber: params.prNumber,
      prUrl: params.prUrl,
      prTargetBranch: params.targetBranch,
      prDraft: params.draft,
      prApproved: params.approved,
    };

    // Register directly into session manager as a passive session
    await this.sessionManager.registerPassive(session);

    const tracked: TrackedPR = { ...params, sessionId };
    this.trackedPRs.set(`${params.repo}#${params.prNumber}`, tracked);

    if (this.logger) {
      this.logger.logPrSessionCreated(
        params.author,
        params.prNumber,
        params.headBranch,
        params.targetBranch,
        params.files.length,
      );
    }

    // Emit SSE event for Baton dashboard (Req 7.3)
    if (this.batonEventEmitter) {
      this.batonEventEmitter.emit({
        type: "github_pr_change",
        repo: params.repo,
        data: { action: "opened", prNumber: params.prNumber },
      });
    }
  }

  private async updateTrackedPR(
    prKey: string,
    updates: { files: string[]; draft: boolean; approved: boolean; headBranch: string; targetBranch: string },
  ): Promise<void> {
    const tracked = this.trackedPRs.get(prKey);
    if (!tracked) return;

    tracked.files = updates.files;
    tracked.draft = updates.draft;
    tracked.approved = updates.approved;
    tracked.headBranch = updates.headBranch;
    tracked.targetBranch = updates.targetBranch;

    const now = new Date().toISOString();
    const session: WorkSession = {
      sessionId: tracked.sessionId,
      userId: tracked.author,
      repo: tracked.repo,
      branch: tracked.headBranch,
      files: tracked.files,
      createdAt: now,
      lastHeartbeat: now,
      source: "github_pr",
      prNumber: tracked.prNumber,
      prUrl: tracked.prUrl,
      prTargetBranch: tracked.targetBranch,
      prDraft: tracked.draft,
      prApproved: tracked.approved,
    };

    await this.sessionManager.registerPassive(session);

    // Emit SSE event for Baton dashboard (Req 7.3)
    if (this.batonEventEmitter) {
      this.batonEventEmitter.emit({
        type: "github_pr_change",
        repo: tracked.repo,
        data: { action: "updated", prNumber: tracked.prNumber },
      });
    }
  }

  private async removeTrackedPR(prKey: string, reason: string): Promise<void> {
    const tracked = this.trackedPRs.get(prKey);
    if (!tracked) return;

    await this.sessionManager.deregister(tracked.sessionId);
    this.trackedPRs.delete(prKey);

    if (this.logger) {
      this.logger.logPrSessionRemoved(tracked.prNumber, reason);
    }

    // Emit SSE event for Baton dashboard (Req 7.3)
    if (this.batonEventEmitter) {
      this.batonEventEmitter.emit({
        type: "github_pr_change",
        repo: tracked.repo,
        data: { action: "closed", prNumber: tracked.prNumber },
      });
    }
  }

  // ── GitHub API Calls ───────────────────────────────────────────────

  private resolveToken(): string | null {
    const envVar = this.config.tokenEnv || "GITHUB_TOKEN";
    return process.env[envVar] ?? null;
  }

  /**
   * Check rate limit state. Returns true if we can make requests.
   * Backs off when remaining requests are low (< 100).
   * Requirement 5.3
   */
  private canMakeRequest(): boolean {
    if (this.rateLimit.remaining < 100) {
      const now = Date.now();
      if (now < this.rateLimit.resetAt) {
        return false; // Back off until reset
      }
      // Reset window has passed, allow requests
      this.rateLimit.remaining = 5000;
    }
    return true;
  }

  /** Update rate limit state from response headers. */
  private updateRateLimit(response: Response): void {
    const remaining = response.headers.get("x-ratelimit-remaining");
    const reset = response.headers.get("x-ratelimit-reset");
    if (remaining !== null) {
      this.rateLimit.remaining = parseInt(remaining, 10);
    }
    if (reset !== null) {
      this.rateLimit.resetAt = parseInt(reset, 10) * 1000; // Convert to ms
    }
  }

  private async fetchOpenPRs(repo: string, token: string): Promise<GitHubPullRequest[]> {
    const url = `https://api.github.com/repos/${repo}/pulls?state=open&per_page=100`;
    const response = await this.fetchFn(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "konductor",
      },
    });

    this.updateRateLimit(response);

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as GitHubPullRequest[];
  }

  private async fetchPRFiles(repo: string, prNumber: number, token: string): Promise<string[]> {
    const url = `https://api.github.com/repos/${repo}/pulls/${prNumber}/files?per_page=300`;
    const response = await this.fetchFn(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "konductor",
      },
    });

    this.updateRateLimit(response);

    if (!response.ok) {
      return [];
    }

    const files = (await response.json()) as GitHubPullRequestFile[];
    return files.map((f) => f.filename);
  }

  private async checkPRApproved(repo: string, prNumber: number, token: string): Promise<boolean> {
    const url = `https://api.github.com/repos/${repo}/pulls/${prNumber}/reviews?per_page=100`;
    const response = await this.fetchFn(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "konductor",
      },
    });

    this.updateRateLimit(response);

    if (!response.ok) {
      return false;
    }

    const reviews = (await response.json()) as GitHubReview[];
    // A PR is approved if any review has state "APPROVED" and no subsequent "CHANGES_REQUESTED"
    let approved = false;
    for (const review of reviews) {
      if (review.state === "APPROVED") approved = true;
      if (review.state === "CHANGES_REQUESTED") approved = false;
    }
    return approved;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sorted_a = [...a].sort();
  const sorted_b = [...b].sort();
  return sorted_a.every((v, i) => v === sorted_b[i]);
}
