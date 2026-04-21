/**
 * Unit tests for QueryEngine with mixed active + passive (GitHub) session data.
 *
 * Validates Requirements 6.1–6.6 from the konductor-github spec:
 *   6.1 who_overlaps includes source type and metadata per overlap
 *   6.2 repo_hotspots includes passive session files with source attribution
 *   6.3 coordination_advice distinguishes "review their PR" vs "talk to them" vs "check their commits"
 *   6.4 risk_assessment factors in PR review status and source diversity
 *   6.5 who_is_active includes passive session users with source field
 *   6.6 active_branches includes branches with PR/commit activity
 */

import { describe, it, expect } from "vitest";
import { QueryEngine } from "./query-engine.js";
import { CollisionEvaluator } from "./collision-evaluator.js";
import { CollisionState } from "./types.js";
import type { WorkSession, ISessionManager } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createStubSessionManager(sessions: WorkSession[]): ISessionManager {
  return {
    async register() { throw new Error("not implemented"); },
    async update() { throw new Error("not implemented"); },
    async deregister() { throw new Error("not implemented"); },
    async heartbeat() { throw new Error("not implemented"); },
    async getActiveSessions(repo: string) {
      return sessions.filter((s) => s.repo === repo);
    },
    async getAllActiveSessions() {
      return [...sessions];
    },
    async cleanupStale() { return 0; },
  };
}

const now = new Date().toISOString();

function makeSession(overrides: Partial<WorkSession> & { userId: string; repo: string; branch: string; files: string[] }): WorkSession {
  return {
    sessionId: crypto.randomUUID(),
    createdAt: now,
    lastHeartbeat: now,
    ...overrides,
  };
}

const collisionEvaluator = new CollisionEvaluator();

// ---------------------------------------------------------------------------
// Shared fixture: mixed active + PR + commit sessions in "org/app"
// ---------------------------------------------------------------------------

const REPO = "org/app";

const aliceActive = makeSession({
  userId: "alice",
  repo: REPO,
  branch: "feature-a",
  files: ["src/index.ts", "src/utils.ts"],
  source: "active",
});

const bobPr = makeSession({
  userId: "bob",
  repo: REPO,
  branch: "feature-b",
  files: ["src/index.ts", "src/api.ts"],
  source: "github_pr",
  prNumber: 42,
  prUrl: "https://github.com/org/app/pull/42",
  prTargetBranch: "main",
  prDraft: false,
  prApproved: false,
});

const carolApprovedPr = makeSession({
  userId: "carol",
  repo: REPO,
  branch: "feature-c",
  files: ["src/utils.ts", "src/config.ts"],
  source: "github_pr",
  prNumber: 99,
  prUrl: "https://github.com/org/app/pull/99",
  prTargetBranch: "feature-a",
  prDraft: false,
  prApproved: true,
});

const daveDraftPr = makeSession({
  userId: "dave",
  repo: REPO,
  branch: "feature-d",
  files: ["src/logger.ts"],
  source: "github_pr",
  prNumber: 55,
  prUrl: "https://github.com/org/app/pull/55",
  prTargetBranch: "main",
  prDraft: true,
  prApproved: false,
});

const eveCommit = makeSession({
  userId: "eve",
  repo: REPO,
  branch: "main",
  files: ["src/index.ts", "src/db.ts"],
  source: "github_commit",
  commitDateRange: { earliest: "2026-04-15T00:00:00Z", latest: "2026-04-16T12:00:00Z" },
});

const mixedSessions = [aliceActive, bobPr, carolApprovedPr, daveDraftPr, eveCommit];

// ---------------------------------------------------------------------------
// 6.5 who_is_active includes passive session users with source field
// ---------------------------------------------------------------------------

describe("whoIsActive — source attribution (Req 6.5)", () => {
  it("returns source field for each user", async () => {
    const sm = createStubSessionManager(mixedSessions);
    const qe = new QueryEngine(sm, collisionEvaluator);
    const result = await qe.whoIsActive(REPO);

    expect(result.totalUsers).toBe(5);

    const byUser = new Map(result.users.map((u) => [u.userId, u]));

    expect(byUser.get("alice")!.source).toBe("active");
    expect(byUser.get("bob")!.source).toBe("github_pr");
    expect(byUser.get("carol")!.source).toBe("github_pr");
    expect(byUser.get("dave")!.source).toBe("github_pr");
    expect(byUser.get("eve")!.source).toBe("github_commit");
  });

  it("includes PR metadata for PR sessions", async () => {
    const sm = createStubSessionManager(mixedSessions);
    const qe = new QueryEngine(sm, collisionEvaluator);
    const result = await qe.whoIsActive(REPO);

    const bob = result.users.find((u) => u.userId === "bob")!;
    expect(bob.prNumber).toBe(42);
    expect(bob.prUrl).toBe("https://github.com/org/app/pull/42");
    expect(bob.prDraft).toBe(false);
    expect(bob.prApproved).toBe(false);
  });

  it("includes commit date range for commit sessions", async () => {
    const sm = createStubSessionManager(mixedSessions);
    const qe = new QueryEngine(sm, collisionEvaluator);
    const result = await qe.whoIsActive(REPO);

    const eve = result.users.find((u) => u.userId === "eve")!;
    expect(eve.commitDateRange).toEqual({
      earliest: "2026-04-15T00:00:00Z",
      latest: "2026-04-16T12:00:00Z",
    });
  });

  it("does not include PR metadata for active sessions", async () => {
    const sm = createStubSessionManager(mixedSessions);
    const qe = new QueryEngine(sm, collisionEvaluator);
    const result = await qe.whoIsActive(REPO);

    const alice = result.users.find((u) => u.userId === "alice")!;
    expect(alice.prNumber).toBeUndefined();
    expect(alice.prUrl).toBeUndefined();
    expect(alice.commitDateRange).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 6.1 who_overlaps includes source type and metadata per overlap
// ---------------------------------------------------------------------------

describe("whoOverlaps — source attribution (Req 6.1)", () => {
  it("includes source and PR metadata for PR overlaps", async () => {
    const sm = createStubSessionManager(mixedSessions);
    const qe = new QueryEngine(sm, collisionEvaluator);
    const result = await qe.whoOverlaps("alice", REPO);

    // bob overlaps on src/index.ts (PR), carol on src/utils.ts (approved PR), eve on src/index.ts (commit)
    expect(result.isAlone).toBe(false);

    const bobOverlap = result.overlaps.find((o) => o.userId === "bob")!;
    expect(bobOverlap.source).toBe("github_pr");
    expect(bobOverlap.prNumber).toBe(42);
    expect(bobOverlap.prUrl).toBe("https://github.com/org/app/pull/42");
    expect(bobOverlap.prTargetBranch).toBe("main");
    expect(bobOverlap.sharedFiles).toContain("src/index.ts");
  });

  it("includes commit date range for commit overlaps", async () => {
    const sm = createStubSessionManager(mixedSessions);
    const qe = new QueryEngine(sm, collisionEvaluator);
    const result = await qe.whoOverlaps("alice", REPO);

    const eveOverlap = result.overlaps.find((o) => o.userId === "eve")!;
    expect(eveOverlap.source).toBe("github_commit");
    expect(eveOverlap.commitDateRange).toEqual({
      earliest: "2026-04-15T00:00:00Z",
      latest: "2026-04-16T12:00:00Z",
    });
  });

  it("marks active sessions with source 'active'", async () => {
    // Create a scenario where two active sessions overlap
    const a1 = makeSession({ userId: "u1", repo: REPO, branch: "main", files: ["a.ts"], source: "active" });
    const a2 = makeSession({ userId: "u2", repo: REPO, branch: "main", files: ["a.ts"], source: "active" });
    const sm = createStubSessionManager([a1, a2]);
    const qe = new QueryEngine(sm, collisionEvaluator);
    const result = await qe.whoOverlaps("u1", REPO);

    expect(result.overlaps[0].source).toBe("active");
    expect(result.overlaps[0].prNumber).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 6.2 repo_hotspots includes passive session files with source attribution
// ---------------------------------------------------------------------------

describe("repoHotspots — source attribution (Req 6.2)", () => {
  it("includes source in editor entries for hotspot files", async () => {
    const sm = createStubSessionManager(mixedSessions);
    const qe = new QueryEngine(sm, collisionEvaluator);
    const result = await qe.repoHotspots(REPO);

    // src/index.ts is edited by alice (active), bob (github_pr), eve (github_commit) → hotspot
    const indexHotspot = result.hotspots.find((h) => h.file === "src/index.ts")!;
    expect(indexHotspot).toBeDefined();
    expect(indexHotspot.editors.length).toBe(3);

    const sources = indexHotspot.editors.map((e) => e.source);
    expect(sources).toContain("active");
    expect(sources).toContain("github_pr");
    expect(sources).toContain("github_commit");
  });

  it("includes passive-only hotspots when two passive sessions share a file", async () => {
    // bob (PR) and eve (commit) both touch src/index.ts — that's a hotspot even without active
    const sm = createStubSessionManager([bobPr, eveCommit]);
    const qe = new QueryEngine(sm, collisionEvaluator);
    const result = await qe.repoHotspots(REPO);

    const indexHotspot = result.hotspots.find((h) => h.file === "src/index.ts")!;
    expect(indexHotspot).toBeDefined();
    expect(indexHotspot.editors.every((e) => e.source !== "active")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6.3 coordination_advice distinguishes action types by source
// ---------------------------------------------------------------------------

describe("coordinationAdvice — source-aware actions (Req 6.3)", () => {
  it("suggests 'Review their PR' for PR overlaps", async () => {
    const sm = createStubSessionManager(mixedSessions);
    const qe = new QueryEngine(sm, collisionEvaluator);
    const result = await qe.coordinationAdvice("alice", REPO);

    const bobTarget = result.targets.find((t) => t.userId === "bob")!;
    expect(bobTarget.source).toBe("github_pr");
    expect(bobTarget.suggestedAction).toContain("Review");
    expect(bobTarget.prNumber).toBe(42);
  });

  it("suggests urgent review for approved PR overlaps", async () => {
    const sm = createStubSessionManager(mixedSessions);
    const qe = new QueryEngine(sm, collisionEvaluator);
    const result = await qe.coordinationAdvice("alice", REPO);

    const carolTarget = result.targets.find((t) => t.userId === "carol")!;
    expect(carolTarget.source).toBe("github_pr");
    expect(carolTarget.suggestedAction).toContain("urgently");
    expect(carolTarget.suggestedAction).toContain("approved");
  });

  it("suggests 'Check their recent commits' for commit overlaps", async () => {
    const sm = createStubSessionManager(mixedSessions);
    const qe = new QueryEngine(sm, collisionEvaluator);
    const result = await qe.coordinationAdvice("alice", REPO);

    const eveTarget = result.targets.find((t) => t.userId === "eve")!;
    expect(eveTarget.source).toBe("github_commit");
    expect(eveTarget.suggestedAction).toContain("commits");
  });

  it("suggests 'Sync on file ownership' for active session overlaps on same branch", async () => {
    const a1 = makeSession({ userId: "u1", repo: REPO, branch: "main", files: ["a.ts"], source: "active" });
    const a2 = makeSession({ userId: "u2", repo: REPO, branch: "main", files: ["a.ts"], source: "active" });
    const sm = createStubSessionManager([a1, a2]);
    const qe = new QueryEngine(sm, collisionEvaluator);
    const result = await qe.coordinationAdvice("u1", REPO);

    expect(result.targets[0].source).toBe("active");
    expect(result.targets[0].suggestedAction).toContain("Sync on file ownership");
  });
});

// ---------------------------------------------------------------------------
// 6.4 risk_assessment factors in PR review status and source diversity
// ---------------------------------------------------------------------------

describe("riskAssessment — PR review status and source diversity (Req 6.4)", () => {
  it("reports hasApprovedPrOverlap when overlapping with approved PR", async () => {
    const sm = createStubSessionManager(mixedSessions);
    const qe = new QueryEngine(sm, collisionEvaluator);
    const result = await qe.riskAssessment("alice", REPO);

    expect(result.hasApprovedPrOverlap).toBe(true);
    expect(result.riskSummary).toContain("approved PR");
  });

  it("reports sourceDiversity counting distinct source types", async () => {
    const sm = createStubSessionManager(mixedSessions);
    const qe = new QueryEngine(sm, collisionEvaluator);
    const result = await qe.riskAssessment("alice", REPO);

    // alice overlaps with bob (github_pr), carol (github_pr), eve (github_commit) → 2 distinct sources
    expect(result.sourceDiversity).toBe(2);
  });

  it("reports no approved PR overlap when none exists", async () => {
    const a1 = makeSession({ userId: "u1", repo: REPO, branch: "main", files: ["a.ts"], source: "active" });
    const a2 = makeSession({ userId: "u2", repo: REPO, branch: "main", files: ["a.ts"], source: "active" });
    const sm = createStubSessionManager([a1, a2]);
    const qe = new QueryEngine(sm, collisionEvaluator);
    const result = await qe.riskAssessment("u1", REPO);

    expect(result.hasApprovedPrOverlap).toBe(false);
    expect(result.sourceDiversity).toBe(1); // only "active"
  });

  it("reports zero source diversity when solo", async () => {
    const a1 = makeSession({ userId: "u1", repo: REPO, branch: "main", files: ["a.ts"], source: "active" });
    const sm = createStubSessionManager([a1]);
    const qe = new QueryEngine(sm, collisionEvaluator);
    const result = await qe.riskAssessment("u1", REPO);

    expect(result.sourceDiversity).toBe(0);
    expect(result.hasApprovedPrOverlap).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6.6 active_branches includes branches with PR/commit activity
// ---------------------------------------------------------------------------

describe("activeBranches — passive session branches (Req 6.6)", () => {
  it("includes branches from PR and commit sessions", async () => {
    const sm = createStubSessionManager(mixedSessions);
    const qe = new QueryEngine(sm, collisionEvaluator);
    const result = await qe.activeBranches(REPO);

    const branchNames = result.branches.map((b) => b.branch);
    expect(branchNames).toContain("feature-a"); // alice active
    expect(branchNames).toContain("feature-b"); // bob PR
    expect(branchNames).toContain("feature-c"); // carol PR
    expect(branchNames).toContain("feature-d"); // dave draft PR
    expect(branchNames).toContain("main");      // eve commit
  });

  it("includes sources array per branch", async () => {
    const sm = createStubSessionManager(mixedSessions);
    const qe = new QueryEngine(sm, collisionEvaluator);
    const result = await qe.activeBranches(REPO);

    const featureA = result.branches.find((b) => b.branch === "feature-a")!;
    expect(featureA.sources).toContain("active");

    const featureB = result.branches.find((b) => b.branch === "feature-b")!;
    expect(featureB.sources).toContain("github_pr");

    const main = result.branches.find((b) => b.branch === "main")!;
    expect(main.sources).toContain("github_commit");
  });

  it("shows PR-only branches even without active sessions", async () => {
    const sm = createStubSessionManager([bobPr, daveDraftPr]);
    const qe = new QueryEngine(sm, collisionEvaluator);
    const result = await qe.activeBranches(REPO);

    expect(result.branches.length).toBe(2);
    expect(result.branches.every((b) => b.sources.includes("github_pr"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// userActivity — passive sessions across repos
// ---------------------------------------------------------------------------

describe("userActivity — passive sessions across repos", () => {
  it("includes PR sessions in user activity", async () => {
    const sm = createStubSessionManager(mixedSessions);
    const qe = new QueryEngine(sm, collisionEvaluator);
    const result = await qe.userActivity("bob");

    expect(result.isActive).toBe(true);
    expect(result.sessions.length).toBe(1);
    expect(result.sessions[0].source).toBe("github_pr");
    expect(result.sessions[0].prNumber).toBe(42);
    expect(result.sessions[0].prUrl).toBe("https://github.com/org/app/pull/42");
  });

  it("includes commit sessions in user activity", async () => {
    const sm = createStubSessionManager(mixedSessions);
    const qe = new QueryEngine(sm, collisionEvaluator);
    const result = await qe.userActivity("eve");

    expect(result.isActive).toBe(true);
    expect(result.sessions.length).toBe(1);
    expect(result.sessions[0].source).toBe("github_commit");
    expect(result.sessions[0].commitDateRange).toEqual({
      earliest: "2026-04-15T00:00:00Z",
      latest: "2026-04-16T12:00:00Z",
    });
  });

  it("includes active sessions with source 'active'", async () => {
    const sm = createStubSessionManager(mixedSessions);
    const qe = new QueryEngine(sm, collisionEvaluator);
    const result = await qe.userActivity("alice");

    expect(result.sessions[0].source).toBe("active");
    expect(result.sessions[0].prNumber).toBeUndefined();
  });
});
