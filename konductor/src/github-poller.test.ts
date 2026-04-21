import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import fc from "fast-check";
import { GitHubPoller, type FetchFn, type GitHubPullRequest, type GitHubPullRequestFile, type GitHubReview } from "./github-poller.js";
import { SessionManager } from "./session-manager.js";
import { PersistenceStore } from "./persistence-store.js";
import type { GitHubConfig, WorkSession } from "./types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<GitHubConfig>): GitHubConfig {
  return {
    tokenEnv: "GITHUB_TOKEN",
    pollIntervalSeconds: 60,
    includeDrafts: true,
    commitLookbackHours: 24,
    repositories: [{ repo: "org/repo" }],
    ...overrides,
  };
}

function makePR(overrides?: Partial<GitHubPullRequest>): GitHubPullRequest {
  return {
    number: 1,
    html_url: "https://github.com/org/repo/pull/1",
    state: "open",
    draft: false,
    user: { login: "bob" },
    head: { ref: "feature-x" },
    base: { ref: "main" },
    ...overrides,
  };
}

/** Build a mock fetch that routes by URL pattern. */
function buildMockFetch(handlers: {
  prs?: GitHubPullRequest[];
  files?: Record<number, string[]>;
  reviews?: Record<number, GitHubReview[]>;
  rateLimitRemaining?: number;
  failOn?: string;
}): FetchFn {
  const { prs = [], files = {}, reviews = {}, rateLimitRemaining = 5000, failOn } = handlers;

  return async (url: string) => {
    if (failOn && url.includes(failOn)) {
      return {
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        headers: new Headers({
          "x-ratelimit-remaining": String(rateLimitRemaining),
          "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
        }),
        json: async () => ({ message: "error" }),
      } as Response;
    }

    const headers = new Headers({
      "x-ratelimit-remaining": String(rateLimitRemaining),
      "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
    });

    // Route: /pulls?state=open
    if (url.includes("/pulls?state=open")) {
      return { ok: true, status: 200, headers, json: async () => prs } as Response;
    }

    // Route: /pulls/:number/files
    const filesMatch = url.match(/\/pulls\/(\d+)\/files/);
    if (filesMatch) {
      const prNum = parseInt(filesMatch[1], 10);
      const prFiles: GitHubPullRequestFile[] = (files[prNum] ?? []).map((f) => ({ filename: f }));
      return { ok: true, status: 200, headers, json: async () => prFiles } as Response;
    }

    // Route: /pulls/:number/reviews
    const reviewsMatch = url.match(/\/pulls\/(\d+)\/reviews/);
    if (reviewsMatch) {
      const prNum = parseInt(reviewsMatch[1], 10);
      return { ok: true, status: 200, headers, json: async () => reviews[prNum] ?? [] } as Response;
    }

    return { ok: true, status: 200, headers, json: async () => [] } as Response;
  };
}

async function createSessionManager(): Promise<SessionManager> {
  const store = new PersistenceStore("/tmp/test-sessions-" + Date.now() + ".json");
  const sm = new SessionManager(store, () => 300_000);
  await sm.init();
  return sm;
}

// ---------------------------------------------------------------------------
// Unit Tests
// ---------------------------------------------------------------------------

describe("GitHubPoller — Unit Tests", () => {
  let sm: SessionManager;

  beforeEach(async () => {
    process.env.GITHUB_TOKEN = "ghp_test_token";
    sm = await createSessionManager();
  });

  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
  });

  it("creates a PR session when an open PR is detected", async () => {
    const mockFetch = buildMockFetch({
      prs: [makePR({ number: 42, user: { login: "bob" }, head: { ref: "feature-x" }, base: { ref: "main" } })],
      files: { 42: ["src/index.ts", "src/utils.ts"] },
      reviews: { 42: [] },
    });

    const poller = new GitHubPoller(makeConfig(), sm, undefined, mockFetch);
    await poller.pollAll();

    const sessions = await sm.getActiveSessions("org/repo");
    const prSessions = sessions.filter((s) => s.source === "github_pr");
    expect(prSessions).toHaveLength(1);
    expect(prSessions[0].userId).toBe("bob");
    expect(prSessions[0].prNumber).toBe(42);
    expect(prSessions[0].files).toEqual(["src/index.ts", "src/utils.ts"]);
    expect(prSessions[0].branch).toBe("feature-x");
    expect(prSessions[0].prTargetBranch).toBe("main");
  });

  it("removes PR session when PR is closed/merged", async () => {
    // First poll: PR is open
    const mockFetch1 = buildMockFetch({
      prs: [makePR({ number: 10 })],
      files: { 10: ["a.ts"] },
    });
    const poller = new GitHubPoller(makeConfig(), sm, undefined, mockFetch1);
    await poller.pollAll();

    let sessions = await sm.getActiveSessions("org/repo");
    expect(sessions.filter((s) => s.source === "github_pr")).toHaveLength(1);

    // Second poll: PR is gone (closed/merged)
    const mockFetch2 = buildMockFetch({ prs: [] });
    // Replace the fetch function by creating a new poller with same tracked state
    // We need to use the same poller instance to preserve tracked PRs
    (poller as any).fetchFn = mockFetch2;
    await poller.pollAll();

    sessions = await sm.getActiveSessions("org/repo");
    expect(sessions.filter((s) => s.source === "github_pr")).toHaveLength(0);
  });

  it("updates PR session when files change", async () => {
    const mockFetch1 = buildMockFetch({
      prs: [makePR({ number: 5 })],
      files: { 5: ["a.ts"] },
    });
    const poller = new GitHubPoller(makeConfig(), sm, undefined, mockFetch1);
    await poller.pollAll();

    let sessions = await sm.getActiveSessions("org/repo");
    expect(sessions.filter((s) => s.source === "github_pr")[0].files).toEqual(["a.ts"]);

    // Second poll: files changed
    const mockFetch2 = buildMockFetch({
      prs: [makePR({ number: 5 })],
      files: { 5: ["a.ts", "b.ts"] },
    });
    (poller as any).fetchFn = mockFetch2;
    await poller.pollAll();

    sessions = await sm.getActiveSessions("org/repo");
    const prSession = sessions.filter((s) => s.source === "github_pr")[0];
    expect(prSession.files).toEqual(["a.ts", "b.ts"]);
  });

  it("marks draft PRs with prDraft=true", async () => {
    const mockFetch = buildMockFetch({
      prs: [makePR({ number: 7, draft: true })],
      files: { 7: ["x.ts"] },
    });
    const poller = new GitHubPoller(makeConfig(), sm, undefined, mockFetch);
    await poller.pollAll();

    const sessions = await sm.getActiveSessions("org/repo");
    const prSession = sessions.find((s) => s.source === "github_pr");
    expect(prSession?.prDraft).toBe(true);
  });

  it("skips draft PRs when includeDrafts is false", async () => {
    const mockFetch = buildMockFetch({
      prs: [makePR({ number: 7, draft: true })],
      files: { 7: ["x.ts"] },
    });
    const config = makeConfig({ includeDrafts: false });
    const poller = new GitHubPoller(config, sm, undefined, mockFetch);
    await poller.pollAll();

    const sessions = await sm.getActiveSessions("org/repo");
    expect(sessions.filter((s) => s.source === "github_pr")).toHaveLength(0);
  });

  it("marks approved PRs with prApproved=true", async () => {
    const mockFetch = buildMockFetch({
      prs: [makePR({ number: 8 })],
      files: { 8: ["y.ts"] },
      reviews: { 8: [{ state: "APPROVED", user: { login: "reviewer" } }] },
    });
    const poller = new GitHubPoller(makeConfig(), sm, undefined, mockFetch);
    await poller.pollAll();

    const sessions = await sm.getActiveSessions("org/repo");
    const prSession = sessions.find((s) => s.source === "github_pr");
    expect(prSession?.prApproved).toBe(true);
  });

  it("self-collision suppression: skips PR when author has active session", async () => {
    // Register an active session for "bob"
    await sm.register("bob", "org/repo", "main", ["src/index.ts"]);

    const mockFetch = buildMockFetch({
      prs: [makePR({ number: 20, user: { login: "bob" } })],
      files: { 20: ["src/index.ts"] },
    });
    const poller = new GitHubPoller(makeConfig(), sm, undefined, mockFetch);
    await poller.pollAll();

    const sessions = await sm.getActiveSessions("org/repo");
    const prSessions = sessions.filter((s) => s.source === "github_pr");
    expect(prSessions).toHaveLength(0);
  });

  it("does not suppress PR when author differs from active user", async () => {
    await sm.register("alice", "org/repo", "main", ["src/index.ts"]);

    const mockFetch = buildMockFetch({
      prs: [makePR({ number: 21, user: { login: "bob" } })],
      files: { 21: ["src/utils.ts"] },
    });
    const poller = new GitHubPoller(makeConfig(), sm, undefined, mockFetch);
    await poller.pollAll();

    const sessions = await sm.getActiveSessions("org/repo");
    const prSessions = sessions.filter((s) => s.source === "github_pr");
    expect(prSessions).toHaveLength(1);
    expect(prSessions[0].userId).toBe("bob");
  });

  it("backs off when rate limit is low", async () => {
    const mockFetch = buildMockFetch({
      prs: [makePR({ number: 30 })],
      files: { 30: ["z.ts"] },
      rateLimitRemaining: 50, // Below threshold of 100
    });
    const poller = new GitHubPoller(makeConfig(), sm, undefined, mockFetch);

    // First poll succeeds (initial remaining is 5000)
    await poller.pollAll();
    const sessions1 = await sm.getActiveSessions("org/repo");
    expect(sessions1.filter((s) => s.source === "github_pr")).toHaveLength(1);

    // Second poll should back off because remaining dropped to 50
    // Replace fetch to track if it's called
    let fetchCalled = false;
    (poller as any).fetchFn = async () => {
      fetchCalled = true;
      return { ok: true, status: 200, headers: new Headers(), json: async () => [] } as Response;
    };
    await poller.pollAll();
    expect(fetchCalled).toBe(false);
  });

  it("handles API errors gracefully without disrupting existing sessions", async () => {
    // Register an active session first
    await sm.register("alice", "org/repo", "main", ["src/index.ts"]);

    const mockFetch = buildMockFetch({ failOn: "/pulls?" });
    const poller = new GitHubPoller(makeConfig(), sm, undefined, mockFetch);
    await poller.pollAll();

    // Active session should still be there
    const sessions = await sm.getActiveSessions("org/repo");
    const activeSessions = sessions.filter((s) => !s.source || s.source === "active");
    expect(activeSessions).toHaveLength(1);
    expect(activeSessions[0].userId).toBe("alice");
  });

  it("start/stop controls the polling interval", async () => {
    vi.useFakeTimers();
    const mockFetch = buildMockFetch({ prs: [] });
    const config = makeConfig({ pollIntervalSeconds: 10 });
    const poller = new GitHubPoller(config, sm, undefined, mockFetch);

    poller.start();
    // Should have run immediately
    await vi.advanceTimersByTimeAsync(0);

    poller.stop();
    vi.useRealTimers();
  });

  it("handles multiple repos in config", async () => {
    const config = makeConfig({
      repositories: [{ repo: "org/repo-a" }, { repo: "org/repo-b" }],
    });

    let calledRepos: string[] = [];
    const mockFetch: FetchFn = async (url: string) => {
      const headers = new Headers({
        "x-ratelimit-remaining": "5000",
        "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
      });

      if (url.includes("/pulls?state=open")) {
        const repoMatch = url.match(/repos\/([^/]+\/[^/]+)\/pulls/);
        if (repoMatch) calledRepos.push(repoMatch[1]);
        return { ok: true, status: 200, headers, json: async () => [] } as Response;
      }
      return { ok: true, status: 200, headers, json: async () => [] } as Response;
    };

    const poller = new GitHubPoller(config, sm, undefined, mockFetch);
    await poller.pollAll();

    expect(calledRepos).toContain("org/repo-a");
    expect(calledRepos).toContain("org/repo-b");
  });

  it("CHANGES_REQUESTED after APPROVED results in not approved", async () => {
    const mockFetch = buildMockFetch({
      prs: [makePR({ number: 50 })],
      files: { 50: ["a.ts"] },
      reviews: {
        50: [
          { state: "APPROVED", user: { login: "r1" } },
          { state: "CHANGES_REQUESTED", user: { login: "r2" } },
        ],
      },
    });
    const poller = new GitHubPoller(makeConfig(), sm, undefined, mockFetch);
    await poller.pollAll();

    const sessions = await sm.getActiveSessions("org/repo");
    const prSession = sessions.find((s) => s.source === "github_pr");
    expect(prSession?.prApproved).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Property-Based Tests
// ---------------------------------------------------------------------------

describe("GitHubPoller — Property Tests", () => {
  beforeEach(() => {
    process.env.GITHUB_TOKEN = "ghp_test_token";
  });

  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
  });

  /**
   * **Feature: konductor-github, Property 2: PR lifecycle maps to session lifecycle**
   * **Validates: Requirements 1.2, 1.3, 1.4**
   *
   * For any set of open PRs returned by the GitHub API, after polling,
   * the set of PR sessions should match the currently open PRs minus
   * any self-collision suppressions (where the PR author has an active session).
   */
  it("Property 2: PR sessions match currently open PRs minus self-collision suppressions", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate a list of open PRs with unique PR numbers
        fc.array(
          fc.record({
            number: fc.integer({ min: 1, max: 9999 }),
            author: fc.stringMatching(/^[a-z]{2,8}$/),
            headBranch: fc.stringMatching(/^[a-z]{2,10}$/),
            targetBranch: fc.constant("main"),
            draft: fc.boolean(),
            files: fc.array(
              fc.tuple(
                fc.stringMatching(/^[a-z]{1,6}$/),
                fc.stringMatching(/^[a-z]{1,8}\.ts$/),
              ).map(([dir, file]) => `${dir}/${file}`),
              { minLength: 1, maxLength: 4 },
            ),
          }),
          { minLength: 0, maxLength: 5 },
        ).map((prs) => {
          // Ensure unique PR numbers
          const seen = new Set<number>();
          return prs.filter((pr) => {
            if (seen.has(pr.number)) return false;
            seen.add(pr.number);
            return true;
          });
        }),
        // Generate a set of active user IDs (for self-collision suppression)
        fc.array(fc.stringMatching(/^[a-z]{2,8}$/), { minLength: 0, maxLength: 3 }),
        async (prDefs, activeUserIds) => {
          const sessionManager = await createSessionManager();

          // Register active sessions for the active users
          for (const userId of activeUserIds) {
            await sessionManager.register(userId, "org/repo", "main", ["dummy.ts"]);
          }

          const activeUserSet = new Set(activeUserIds);

          // Build mock PRs
          const prs: GitHubPullRequest[] = prDefs.map((def) => ({
            number: def.number,
            html_url: `https://github.com/org/repo/pull/${def.number}`,
            state: "open",
            draft: def.draft,
            user: { login: def.author },
            head: { ref: def.headBranch },
            base: { ref: def.targetBranch },
          }));

          const filesMap: Record<number, string[]> = {};
          for (const def of prDefs) {
            filesMap[def.number] = def.files;
          }

          const mockFetch = buildMockFetch({ prs, files: filesMap });
          const config = makeConfig({ includeDrafts: true });
          const poller = new GitHubPoller(config, sessionManager, undefined, mockFetch);

          await poller.pollAll();

          // Get all PR sessions
          const allSessions = await sessionManager.getActiveSessions("org/repo");
          const prSessions = allSessions.filter((s) => s.source === "github_pr");

          // Expected: open PRs whose author does NOT have an active session
          const expectedPRNumbers = new Set(
            prDefs
              .filter((def) => !activeUserSet.has(def.author))
              .map((def) => def.number),
          );

          const actualPRNumbers = new Set(prSessions.map((s) => s.prNumber));

          // The set of PR sessions should match expected
          expect(actualPRNumbers).toEqual(expectedPRNumbers);

          // Each PR session should have correct metadata
          for (const session of prSessions) {
            const def = prDefs.find((d) => d.number === session.prNumber);
            expect(def).toBeDefined();
            if (def) {
              expect(session.userId).toBe(def.author);
              expect(session.branch).toBe(def.headBranch);
              expect(session.prTargetBranch).toBe(def.targetBranch);
              expect(session.prDraft).toBe(def.draft);
              expect(session.files).toEqual(def.files);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Feature: konductor-github, Property 7: Graceful degradation on API failure**
   * **Validates: Requirements 5.3**
   *
   * For any set of pre-existing active sessions and any GitHub API failure mode,
   * after the poller encounters the failure, all pre-existing active sessions
   * remain intact and unmodified.
   */
  it("Property 7: GitHub API errors never disrupt active session tracking", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate random active sessions
        fc.array(
          fc.record({
            userId: fc.stringMatching(/^[a-z]{2,8}$/),
            branch: fc.stringMatching(/^[a-z]{2,10}$/),
            files: fc.array(
              fc.tuple(
                fc.stringMatching(/^[a-z]{1,6}$/),
                fc.stringMatching(/^[a-z]{1,8}\.ts$/),
              ).map(([dir, file]) => `${dir}/${file}`),
              { minLength: 1, maxLength: 3 },
            ),
          }),
          { minLength: 1, maxLength: 5 },
        ).map((sessions) => {
          // Ensure unique userIds
          const seen = new Set<string>();
          return sessions.filter((s) => {
            if (seen.has(s.userId)) return false;
            seen.add(s.userId);
            return true;
          });
        }),
        // Generate a failure mode: which API endpoint fails
        fc.constantFrom("/pulls?", "/pulls/", "/reviews"),
        async (sessionDefs, failEndpoint) => {
          const sessionManager = await createSessionManager();

          // Register active sessions
          const registeredSessions = [];
          for (const def of sessionDefs) {
            const session = await sessionManager.register(def.userId, "org/repo", def.branch, def.files);
            registeredSessions.push(session);
          }

          // Snapshot active sessions before polling
          const beforeSessions = await sessionManager.getActiveSessions("org/repo");
          const beforeActive = beforeSessions
            .filter((s) => !s.source || s.source === "active")
            .map((s) => ({ sessionId: s.sessionId, userId: s.userId, branch: s.branch, files: [...s.files] }));

          // Create a poller with a failing fetch
          const failingFetch: FetchFn = async (url: string) => {
            if (url.includes(failEndpoint)) {
              throw new Error(`Simulated network failure on ${failEndpoint}`);
            }
            const headers = new Headers({
              "x-ratelimit-remaining": "5000",
              "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
            });
            return { ok: true, status: 200, headers, json: async () => [] } as Response;
          };

          const config = makeConfig();
          const poller = new GitHubPoller(config, sessionManager, undefined, failingFetch);

          // Poll should not throw
          await poller.pollAll();

          // All active sessions must still be intact
          const afterSessions = await sessionManager.getActiveSessions("org/repo");
          const afterActive = afterSessions
            .filter((s) => !s.source || s.source === "active")
            .map((s) => ({ sessionId: s.sessionId, userId: s.userId, branch: s.branch, files: [...s.files] }));

          expect(afterActive).toEqual(beforeActive);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// SSE Event Emission Tests (Requirement 7.3)
// ---------------------------------------------------------------------------

import { BatonEventEmitter } from "./baton-event-emitter.js";
import type { BatonEvent } from "./baton-types.js";

describe("GitHubPoller — SSE event emission", () => {
  let sessionManager: SessionManager;
  let batonEventEmitter: BatonEventEmitter;

  beforeEach(async () => {
    process.env.GITHUB_TOKEN = "ghp_test";
    const store = new PersistenceStore("/tmp/test-sse-sessions-" + Date.now() + ".json");
    sessionManager = new SessionManager(store, () => 300_000);
    await sessionManager.init();
    batonEventEmitter = new BatonEventEmitter();
  });

  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
  });

  it("emits github_pr_change with action 'opened' when a new PR is detected", async () => {
    const events: BatonEvent[] = [];
    batonEventEmitter.subscribe("org/repo", (e) => events.push(e));

    const mockFetch = buildMockFetch({
      prs: [makePR({ number: 10, user: { login: "alice" } })],
      files: { 10: ["a.ts"] },
      reviews: { 10: [] },
    });

    const poller = new GitHubPoller(makeConfig(), sessionManager, undefined, mockFetch, batonEventEmitter);
    await poller.pollAll();

    const prEvents = events.filter((e) => e.type === "github_pr_change");
    expect(prEvents).toHaveLength(1);
    expect(prEvents[0]).toMatchObject({
      type: "github_pr_change",
      repo: "org/repo",
      data: { action: "opened", prNumber: 10 },
    });
  });

  it("emits github_pr_change with action 'closed' when a PR is removed", async () => {
    const events: BatonEvent[] = [];
    batonEventEmitter.subscribe("org/repo", (e) => events.push(e));

    // First poll: create PR
    const mockFetch1 = buildMockFetch({
      prs: [makePR({ number: 20, user: { login: "bob" } })],
      files: { 20: ["b.ts"] },
      reviews: { 20: [] },
    });
    const poller = new GitHubPoller(makeConfig(), sessionManager, undefined, mockFetch1, batonEventEmitter);
    await poller.pollAll();

    // Verify PR was tracked
    expect(poller.getTrackedPRs().size).toBe(1);
    events.length = 0; // clear

    // Second poll: PR is gone (closed/merged)
    (poller as any).fetchFn = buildMockFetch({ prs: [], files: {}, reviews: {} });
    await poller.pollAll();

    // Verify PR was removed from tracking
    expect(poller.getTrackedPRs().size).toBe(0);

    const closeEvents = events.filter((e) => e.type === "github_pr_change" && (e as any).data.action === "closed");
    expect(closeEvents).toHaveLength(1);
    expect(closeEvents[0]).toMatchObject({
      type: "github_pr_change",
      repo: "org/repo",
      data: { action: "closed", prNumber: 20 },
    });
  });

  it("emits github_pr_change with action 'updated' when PR files change", async () => {
    const events: BatonEvent[] = [];
    batonEventEmitter.subscribe("org/repo", (e) => events.push(e));

    // First poll: create PR with file a.ts
    const mockFetch1 = buildMockFetch({
      prs: [makePR({ number: 30, user: { login: "carol" } })],
      files: { 30: ["a.ts"] },
      reviews: { 30: [] },
    });
    const poller = new GitHubPoller(makeConfig(), sessionManager, undefined, mockFetch1, batonEventEmitter);
    await poller.pollAll();
    events.length = 0;

    // Second poll: PR now has different files
    const mockFetch2 = buildMockFetch({
      prs: [makePR({ number: 30, user: { login: "carol" } })],
      files: { 30: ["a.ts", "b.ts"] },
      reviews: { 30: [] },
    });
    (poller as any).fetchFn = mockFetch2;
    await poller.pollAll();

    const updateEvents = events.filter((e) => e.type === "github_pr_change" && (e as any).data.action === "updated");
    expect(updateEvents).toHaveLength(1);
    expect(updateEvents[0]).toMatchObject({
      type: "github_pr_change",
      repo: "org/repo",
      data: { action: "updated", prNumber: 30 },
    });
  });
});
