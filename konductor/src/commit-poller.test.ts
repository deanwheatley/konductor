import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CommitPoller, type FetchFn, type GitHubCommit } from "./commit-poller.js";
import { SessionManager } from "./session-manager.js";
import { PersistenceStore } from "./persistence-store.js";
import type { GitHubConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<GitHubConfig>): GitHubConfig {
  return {
    tokenEnv: "GITHUB_TOKEN",
    pollIntervalSeconds: 60,
    includeDrafts: true,
    commitLookbackHours: 24,
    repositories: [{ repo: "org/repo", commitBranches: ["main"] }],
    ...overrides,
  };
}

function makeCommit(opts?: { sha?: string; login?: string; date?: string; files?: string[] }): GitHubCommit {
  const login = opts?.login ?? "alice";
  const date = opts?.date ?? new Date().toISOString();
  const files = opts?.files ?? ["src/index.ts"];
  return {
    sha: opts?.sha ?? `sha-${Math.random().toString(36).slice(2, 10)}`,
    commit: {
      author: { name: login, date },
      message: "some commit",
    },
    author: { login },
    files: files.map((f) => ({ filename: f })),
  };
}

const defaultHeaders = () =>
  new Headers({
    "x-ratelimit-remaining": "5000",
    "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
  });

/**
 * Build a mock fetch that routes by URL pattern.
 * - /commits?sha=... returns the commits list
 * - /commits/:sha returns the individual commit with files
 */
function buildMockFetch(handlers: {
  commits?: GitHubCommit[];
  failOn?: string;
  rateLimitRemaining?: number;
}): FetchFn {
  const { commits = [], failOn, rateLimitRemaining = 5000 } = handlers;

  const headers = new Headers({
    "x-ratelimit-remaining": String(rateLimitRemaining),
    "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
  });

  return async (url: string) => {
    if (failOn && url.includes(failOn)) {
      return { ok: false, status: 500, statusText: "Internal Server Error", headers, json: async () => ({}) } as Response;
    }

    // Route: /commits?sha=...&since=... (list commits)
    if (url.includes("/commits?sha=")) {
      // Strip files from the list response (GitHub list endpoint doesn't include files)
      const listCommits = commits.map(({ files, ...rest }) => rest);
      return { ok: true, status: 200, headers, json: async () => listCommits } as Response;
    }

    // Route: /commits/:sha (single commit detail with files)
    const shaMatch = url.match(/\/commits\/([a-z0-9-]+)$/);
    if (shaMatch) {
      const sha = shaMatch[1];
      const commit = commits.find((c) => c.sha === sha);
      if (commit) {
        return { ok: true, status: 200, headers, json: async () => commit } as Response;
      }
      return { ok: false, status: 404, statusText: "Not Found", headers, json: async () => ({}) } as Response;
    }

    return { ok: true, status: 200, headers, json: async () => [] } as Response;
  };
}

async function createSessionManager(): Promise<SessionManager> {
  const store = new PersistenceStore("/tmp/test-commit-sessions-" + Date.now() + "-" + Math.random().toString(36).slice(2) + ".json");
  const sm = new SessionManager(store, () => 300_000);
  await sm.init();
  return sm;
}

// ---------------------------------------------------------------------------
// Unit Tests
// ---------------------------------------------------------------------------

describe("CommitPoller — Unit Tests", () => {
  let sm: SessionManager;

  beforeEach(async () => {
    process.env.GITHUB_TOKEN = "ghp_test_token";
    sm = await createSessionManager();
  });

  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
  });

  it("creates a commit session when recent commits are detected", async () => {
    const now = new Date().toISOString();
    const mockFetch = buildMockFetch({
      commits: [
        makeCommit({ sha: "abc123", login: "alice", date: now, files: ["src/index.ts", "src/utils.ts"] }),
      ],
    });

    const poller = new CommitPoller(makeConfig(), sm, undefined, mockFetch);
    await poller.pollAll();

    const sessions = await sm.getActiveSessions("org/repo");
    const commitSessions = sessions.filter((s) => s.source === "github_commit");
    expect(commitSessions).toHaveLength(1);
    expect(commitSessions[0].userId).toBe("alice");
    expect(commitSessions[0].branch).toBe("main");
    expect(commitSessions[0].files).toEqual(["src/index.ts", "src/utils.ts"]);
    expect(commitSessions[0].commitDateRange).toBeDefined();
  });

  it("groups commits by author and aggregates files", async () => {
    const now = new Date().toISOString();
    const mockFetch = buildMockFetch({
      commits: [
        makeCommit({ sha: "aaa111", login: "alice", date: now, files: ["src/a.ts"] }),
        makeCommit({ sha: "aaa222", login: "alice", date: now, files: ["src/b.ts"] }),
        makeCommit({ sha: "bbb111", login: "bob", date: now, files: ["src/c.ts"] }),
      ],
    });

    const poller = new CommitPoller(makeConfig(), sm, undefined, mockFetch);
    await poller.pollAll();

    const sessions = await sm.getActiveSessions("org/repo");
    const commitSessions = sessions.filter((s) => s.source === "github_commit");
    expect(commitSessions).toHaveLength(2);

    const aliceSession = commitSessions.find((s) => s.userId === "alice");
    const bobSession = commitSessions.find((s) => s.userId === "bob");

    expect(aliceSession).toBeDefined();
    expect(aliceSession!.files).toEqual(["src/a.ts", "src/b.ts"]);

    expect(bobSession).toBeDefined();
    expect(bobSession!.files).toEqual(["src/c.ts"]);
  });

  it("removes commit session when lookback window expires", async () => {
    // Create a commit session with an old date (beyond lookback)
    const oldDate = new Date(Date.now() - 48 * 3600_000).toISOString(); // 48 hours ago
    const mockFetch1 = buildMockFetch({
      commits: [makeCommit({ sha: "old111", login: "alice", date: oldDate, files: ["src/old.ts"] })],
    });

    const config = makeConfig({ commitLookbackHours: 24 });
    const poller = new CommitPoller(config, sm, undefined, mockFetch1);
    await poller.pollAll();

    // The commit is outside the lookback window, so the session should be created
    // during pollCommits (since the API returned it), but then removed by removeExpiredSessions
    // Actually, the API would filter by `since`, but our mock returns it anyway.
    // The session gets created, then removeExpiredSessions removes it.
    const sessions = await sm.getActiveSessions("org/repo");
    const commitSessions = sessions.filter((s) => s.source === "github_commit");
    expect(commitSessions).toHaveLength(0);
  });

  it("removes commit session when author no longer has commits in lookback", async () => {
    const now = new Date().toISOString();
    // First poll: alice has commits
    const mockFetch1 = buildMockFetch({
      commits: [makeCommit({ sha: "first1", login: "alice", date: now, files: ["src/a.ts"] })],
    });
    const poller = new CommitPoller(makeConfig(), sm, undefined, mockFetch1);
    await poller.pollAll();

    let sessions = await sm.getActiveSessions("org/repo");
    expect(sessions.filter((s) => s.source === "github_commit")).toHaveLength(1);

    // Second poll: no commits (alice's commits gone from lookback)
    const mockFetch2 = buildMockFetch({ commits: [] });
    (poller as any).fetchFn = mockFetch2;
    await poller.pollAll();

    sessions = await sm.getActiveSessions("org/repo");
    expect(sessions.filter((s) => s.source === "github_commit")).toHaveLength(0);
  });

  it("self-collision suppression: skips commit session when author has active session", async () => {
    await sm.register("alice", "org/repo", "main", ["src/index.ts"]);

    const now = new Date().toISOString();
    const mockFetch = buildMockFetch({
      commits: [makeCommit({ sha: "self1", login: "alice", date: now, files: ["src/a.ts"] })],
    });

    const poller = new CommitPoller(makeConfig(), sm, undefined, mockFetch);
    await poller.pollAll();

    const sessions = await sm.getActiveSessions("org/repo");
    const commitSessions = sessions.filter((s) => s.source === "github_commit");
    expect(commitSessions).toHaveLength(0);
  });

  it("does not suppress commit session when author differs from active user", async () => {
    await sm.register("bob", "org/repo", "main", ["src/index.ts"]);

    const now = new Date().toISOString();
    const mockFetch = buildMockFetch({
      commits: [makeCommit({ sha: "diff1", login: "alice", date: now, files: ["src/a.ts"] })],
    });

    const poller = new CommitPoller(makeConfig(), sm, undefined, mockFetch);
    await poller.pollAll();

    const sessions = await sm.getActiveSessions("org/repo");
    const commitSessions = sessions.filter((s) => s.source === "github_commit");
    expect(commitSessions).toHaveLength(1);
    expect(commitSessions[0].userId).toBe("alice");
  });

  it("skips repos without commitBranches configured", async () => {
    const config = makeConfig({
      repositories: [{ repo: "org/repo" }], // no commitBranches
    });

    let fetchCalled = false;
    const mockFetch: FetchFn = async () => {
      fetchCalled = true;
      return { ok: true, status: 200, headers: defaultHeaders(), json: async () => [] } as Response;
    };

    const poller = new CommitPoller(config, sm, undefined, mockFetch);
    await poller.pollAll();

    expect(fetchCalled).toBe(false);
  });

  it("handles API errors gracefully without disrupting existing sessions", async () => {
    await sm.register("bob", "org/repo", "main", ["src/index.ts"]);

    const mockFetch = buildMockFetch({ failOn: "/commits?" });
    const poller = new CommitPoller(makeConfig(), sm, undefined, mockFetch);
    await poller.pollAll();

    // Active session should still be there
    const sessions = await sm.getActiveSessions("org/repo");
    const activeSessions = sessions.filter((s) => !s.source || s.source === "active");
    expect(activeSessions).toHaveLength(1);
    expect(activeSessions[0].userId).toBe("bob");
  });

  it("updates commit session when files change between polls", async () => {
    const now = new Date().toISOString();
    const mockFetch1 = buildMockFetch({
      commits: [makeCommit({ sha: "upd1", login: "alice", date: now, files: ["src/a.ts"] })],
    });
    const poller = new CommitPoller(makeConfig(), sm, undefined, mockFetch1);
    await poller.pollAll();

    let sessions = await sm.getActiveSessions("org/repo");
    let commitSession = sessions.find((s) => s.source === "github_commit");
    expect(commitSession!.files).toEqual(["src/a.ts"]);

    // Second poll: new commit adds more files
    const mockFetch2 = buildMockFetch({
      commits: [
        makeCommit({ sha: "upd1", login: "alice", date: now, files: ["src/a.ts"] }),
        makeCommit({ sha: "upd2", login: "alice", date: now, files: ["src/b.ts"] }),
      ],
    });
    (poller as any).fetchFn = mockFetch2;
    await poller.pollAll();

    sessions = await sm.getActiveSessions("org/repo");
    commitSession = sessions.find((s) => s.source === "github_commit");
    expect(commitSession!.files).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("polls multiple branches for a single repo", async () => {
    const config = makeConfig({
      repositories: [{ repo: "org/repo", commitBranches: ["main", "develop"] }],
    });

    const now = new Date().toISOString();
    const calledBranches: string[] = [];
    const mockFetch: FetchFn = async (url: string) => {
      const headers = defaultHeaders();
      if (url.includes("/commits?sha=")) {
        const branchMatch = url.match(/sha=([^&]+)/);
        if (branchMatch) calledBranches.push(decodeURIComponent(branchMatch[1]));
        return { ok: true, status: 200, headers, json: async () => [] } as Response;
      }
      return { ok: true, status: 200, headers, json: async () => [] } as Response;
    };

    const poller = new CommitPoller(config, sm, undefined, mockFetch);
    await poller.pollAll();

    expect(calledBranches).toContain("main");
    expect(calledBranches).toContain("develop");
  });

  it("start/stop controls the polling interval", async () => {
    vi.useFakeTimers();
    const mockFetch = buildMockFetch({ commits: [] });
    const config = makeConfig({ pollIntervalSeconds: 10 });
    const poller = new CommitPoller(config, sm, undefined, mockFetch);

    poller.start();
    await vi.advanceTimersByTimeAsync(0);

    poller.stop();
    vi.useRealTimers();
  });

  it("skips commits without a GitHub user login", async () => {
    const now = new Date().toISOString();
    const commitNoUser: GitHubCommit = {
      sha: "nouser1",
      commit: { author: { name: "unknown", date: now }, message: "msg" },
      author: null, // no GitHub user
      files: [{ filename: "src/x.ts" }],
    };

    const mockFetch = buildMockFetch({ commits: [commitNoUser] });
    const poller = new CommitPoller(makeConfig(), sm, undefined, mockFetch);
    await poller.pollAll();

    const sessions = await sm.getActiveSessions("org/repo");
    const commitSessions = sessions.filter((s) => s.source === "github_commit");
    expect(commitSessions).toHaveLength(0);
  });
});
