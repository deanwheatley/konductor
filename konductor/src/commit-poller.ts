/**
 * CommitPoller — polls the GitHub API for recent commits on configured
 * branches and converts them into passive work sessions for collision detection.
 *
 * Creates commit-based passive sessions that participate in collision evaluation
 * alongside active and PR sessions. Groups commits by author and aggregates
 * changed files within the lookback window.
 *
 * Requirements: 2.1, 2.2, 2.3
 */

import type { GitHubConfig, GitHubRepoConfig, WorkSession } from "./types.js";
import type { SessionManager } from "./session-manager.js";
import type { KonductorLogger } from "./logger.js";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// GitHub API response types
// ---------------------------------------------------------------------------

export interface GitHubCommit {
  sha: string;
  commit: {
    author: { name: string; date: string } | null;
    message: string;
  };
  author: { login: string } | null;
  files?: GitHubCommitFile[];
}

export interface GitHubCommitFile {
  filename: string;
}

// ---------------------------------------------------------------------------
// Internal commit session tracking
// ---------------------------------------------------------------------------

export interface TrackedCommitSession {
  sessionId: string;
  repo: string;
  branch: string;
  author: string;
  files: string[];
  earliest: string; // ISO 8601
  latest: string;   // ISO 8601
  commitCount: number;
}

// ---------------------------------------------------------------------------
// Fetch abstraction for testability
// ---------------------------------------------------------------------------

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

// ---------------------------------------------------------------------------
// Rate limit tracking
// ---------------------------------------------------------------------------

interface RateLimitState {
  remaining: number;
  resetAt: number; // Unix epoch ms
}

// ---------------------------------------------------------------------------
// CommitPoller
// ---------------------------------------------------------------------------

export class CommitPoller {
  private config: GitHubConfig;
  private readonly sessionManager: SessionManager;
  private readonly logger?: KonductorLogger;
  private fetchFn: FetchFn;

  private timer: ReturnType<typeof setInterval> | null = null;
  private trackedSessions: Map<string, TrackedCommitSession> = new Map(); // key: "repo#branch#author"
  private rateLimit: RateLimitState = { remaining: 5000, resetAt: 0 };
  private polling = false;

  constructor(
    config: GitHubConfig,
    sessionManager: SessionManager,
    logger?: KonductorLogger,
    fetchFn?: FetchFn,
  ) {
    this.config = config;
    this.sessionManager = sessionManager;
    this.logger = logger;
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
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

  /** Get the current set of tracked commit sessions (for testing/inspection). */
  getTrackedSessions(): Map<string, TrackedCommitSession> {
    return new Map(this.trackedSessions);
  }

  // ── Polling ───────────────────────────────────────────────────────

  /** Poll all configured repositories and branches. */
  async pollAll(): Promise<void> {
    if (this.polling) return; // prevent overlapping polls
    this.polling = true;
    try {
      for (const repoConfig of this.config.repositories) {
        const branches = repoConfig.commitBranches;
        if (!branches || branches.length === 0) continue;

        for (const branch of branches) {
          try {
            await this.pollCommits(repoConfig, branch);
          } catch (err) {
            // Requirement 5.3: log error and continue — don't disrupt active sessions
            if (this.logger) {
              this.logger.logGitHubPoll(repoConfig.repo, 0, 0);
            }
          }
        }
      }

      // Remove expired sessions (lookback window passed with no new activity)
      await this.removeExpiredSessions();
    } finally {
      this.polling = false;
    }
  }

  /**
   * Poll recent commits for a single repo+branch.
   * Fetches commits within the lookback window, groups by author,
   * aggregates changed files, and creates/updates commit sessions.
   *
   * Requirements: 2.1, 2.2
   */
  async pollCommits(repoConfig: GitHubRepoConfig, branch: string): Promise<void> {
    const repo = repoConfig.repo;
    const token = this.resolveToken();
    if (!token) return;

    if (!this.canMakeRequest()) return;

    const since = new Date(Date.now() - this.config.commitLookbackHours * 3600_000).toISOString();
    const commits = await this.fetchCommits(repo, branch, since, token);

    // Group commits by author
    const authorGroups = new Map<string, { files: Set<string>; earliest: string; latest: string; count: number }>();

    for (const commit of commits) {
      const author = commit.author?.login ?? null;
      if (!author) continue; // skip commits without a GitHub user

      const commitDate = commit.commit.author?.date ?? new Date().toISOString();

      let group = authorGroups.get(author);
      if (!group) {
        group = { files: new Set(), earliest: commitDate, latest: commitDate, count: 0 };
        authorGroups.set(author, group);
      }

      group.count++;

      // Update date range
      if (commitDate < group.earliest) group.earliest = commitDate;
      if (commitDate > group.latest) group.latest = commitDate;

      // Fetch files for this commit
      const files = await this.fetchCommitFiles(repo, commit.sha, token);
      for (const f of files) {
        group.files.add(f);
      }
    }

    // Get active session userIds for deduplication (Req 2.4 — handled by DeduplicationFilter later,
    // but we still skip self-collision here: if author has an active session, skip)
    const activeSessions = await this.sessionManager.getActiveSessions(repo);
    const activeUserIds = new Set(
      activeSessions
        .filter((s) => !s.source || s.source === "active")
        .map((s) => s.userId),
    );

    // Create or update commit sessions per author
    for (const [author, group] of authorGroups) {
      const sessionKey = `${repo}#${branch}#${author}`;

      // Self-collision suppression: skip if author has active session
      if (activeUserIds.has(author)) {
        const existing = this.trackedSessions.get(sessionKey);
        if (existing) {
          await this.removeTrackedSession(sessionKey, "self-collision suppression");
        }
        continue;
      }

      const files = [...group.files].sort();
      const existing = this.trackedSessions.get(sessionKey);

      if (existing) {
        // Update existing session
        await this.updateTrackedSession(sessionKey, {
          files,
          earliest: group.earliest,
          latest: group.latest,
          commitCount: group.count,
        });
      } else {
        // Create new commit session
        await this.createTrackedSession({
          repo,
          branch,
          author,
          files,
          earliest: group.earliest,
          latest: group.latest,
          commitCount: group.count,
        });
      }
    }

    // Remove sessions for authors no longer in the lookback window for this repo+branch
    for (const [key, tracked] of this.trackedSessions) {
      if (tracked.repo === repo && tracked.branch === branch && !authorGroups.has(tracked.author)) {
        await this.removeTrackedSession(key, "no recent commits in lookback window");
      }
    }

    if (this.logger) {
      this.logger.logGitHubPoll(repo, 0, commits.length);
    }
  }

  // ── Commit Session Lifecycle ──────────────────────────────────────

  private async createTrackedSession(params: Omit<TrackedCommitSession, "sessionId">): Promise<void> {
    const sessionId = randomUUID();
    const now = new Date().toISOString();

    const dateRange = formatDateRange(params.earliest, params.latest);

    const session: WorkSession = {
      sessionId,
      userId: params.author,
      repo: params.repo,
      branch: params.branch,
      files: params.files,
      createdAt: now,
      lastHeartbeat: now,
      source: "github_commit",
      commitDateRange: { earliest: params.earliest, latest: params.latest },
    };

    await this.sessionManager.registerPassive(session);

    const tracked: TrackedCommitSession = { ...params, sessionId };
    this.trackedSessions.set(`${params.repo}#${params.branch}#${params.author}`, tracked);

    if (this.logger) {
      this.logger.logCommitSessionCreated(
        params.author,
        params.commitCount,
        params.branch,
        dateRange,
      );
    }
  }

  private async updateTrackedSession(
    key: string,
    updates: { files: string[]; earliest: string; latest: string; commitCount: number },
  ): Promise<void> {
    const tracked = this.trackedSessions.get(key);
    if (!tracked) return;

    tracked.files = updates.files;
    tracked.earliest = updates.earliest;
    tracked.latest = updates.latest;
    tracked.commitCount = updates.commitCount;

    const now = new Date().toISOString();
    const session: WorkSession = {
      sessionId: tracked.sessionId,
      userId: tracked.author,
      repo: tracked.repo,
      branch: tracked.branch,
      files: tracked.files,
      createdAt: now,
      lastHeartbeat: now,
      source: "github_commit",
      commitDateRange: { earliest: tracked.earliest, latest: tracked.latest },
    };

    await this.sessionManager.registerPassive(session);
  }

  private async removeTrackedSession(key: string, reason: string): Promise<void> {
    const tracked = this.trackedSessions.get(key);
    if (!tracked) return;

    await this.sessionManager.deregister(tracked.sessionId);
    this.trackedSessions.delete(key);

    if (this.logger) {
      this.logger.logCommitSessionRemoved(tracked.author, tracked.branch, reason);
    }
  }

  /**
   * Remove commit sessions whose latest commit is older than the lookback window.
   * Requirement 2.3: remove when lookback expires.
   */
  private async removeExpiredSessions(): Promise<void> {
    const cutoff = Date.now() - this.config.commitLookbackHours * 3600_000;

    for (const [key, tracked] of this.trackedSessions) {
      const latestTime = new Date(tracked.latest).getTime();
      if (latestTime < cutoff) {
        await this.removeTrackedSession(key, "lookback window expired");
      }
    }
  }

  // ── GitHub API Calls ───────────────────────────────────────────────

  private resolveToken(): string | null {
    const envVar = this.config.tokenEnv || "GITHUB_TOKEN";
    return process.env[envVar] ?? null;
  }

  private canMakeRequest(): boolean {
    if (this.rateLimit.remaining < 100) {
      const now = Date.now();
      if (now < this.rateLimit.resetAt) {
        return false;
      }
      this.rateLimit.remaining = 5000;
    }
    return true;
  }

  private updateRateLimit(response: Response): void {
    const remaining = response.headers.get("x-ratelimit-remaining");
    const reset = response.headers.get("x-ratelimit-reset");
    if (remaining !== null) {
      this.rateLimit.remaining = parseInt(remaining, 10);
    }
    if (reset !== null) {
      this.rateLimit.resetAt = parseInt(reset, 10) * 1000;
    }
  }

  private async fetchCommits(repo: string, branch: string, since: string, token: string): Promise<GitHubCommit[]> {
    const url = `https://api.github.com/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&since=${encodeURIComponent(since)}&per_page=100`;
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

    return (await response.json()) as GitHubCommit[];
  }

  private async fetchCommitFiles(repo: string, sha: string, token: string): Promise<string[]> {
    const url = `https://api.github.com/repos/${repo}/commits/${sha}`;
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

    const commit = (await response.json()) as GitHubCommit;
    return (commit.files ?? []).map((f) => f.filename);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a date range like "Apr 15–16" or "Apr 15" if same day. */
function formatDateRange(earliest: string, latest: string): string {
  const e = new Date(earliest);
  const l = new Date(latest);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const eMonth = months[e.getUTCMonth()];
  const eDay = e.getUTCDate();
  const lMonth = months[l.getUTCMonth()];
  const lDay = l.getUTCDate();

  if (eMonth === lMonth && eDay === lDay) {
    return `${eMonth} ${eDay}`;
  }
  if (eMonth === lMonth) {
    return `${eMonth} ${eDay}–${lDay}`;
  }
  return `${eMonth} ${eDay}–${lMonth} ${lDay}`;
}
