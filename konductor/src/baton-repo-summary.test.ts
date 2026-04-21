import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { CollisionState } from "./types.js";
import type { WorkSession, CollisionResult } from "./types.js";
import { CollisionEvaluator } from "./collision-evaluator.js";
import { buildRepoSummary } from "./baton-repo-summary.js";
import type { ISessionManager } from "./types.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Simple alphanumeric identifier (1–12 chars). */
const identifierArb = fc.stringMatching(/^[a-z0-9]{1,12}$/);

/** Repo in "owner/repo" format. */
const repoArb = fc
  .tuple(
    fc.stringMatching(/^[a-z0-9]{1,10}$/),
    fc.stringMatching(/^[a-z0-9]{1,10}$/),
  )
  .map(([o, r]) => `${o}/${r}`);

/** Branch name (simple). */
const branchArb = fc.stringMatching(/^[a-z0-9]{1,15}$/);

/** File path (e.g. "src/foo.ts"). */
const filePathArb = fc.stringMatching(/^[a-z]{1,8}\/[a-z]{1,8}\.[a-z]{1,4}$/);

/** A WorkSession bound to a given repo. */
function sessionArb(repo: string): fc.Arbitrary<WorkSession> {
  return fc.record({
    sessionId: fc.uuid(),
    userId: identifierArb,
    repo: fc.constant(repo),
    branch: branchArb,
    files: fc.array(filePathArb, { minLength: 1, maxLength: 5 }),
    createdAt: fc.constant(new Date().toISOString()),
    lastHeartbeat: fc.constant(new Date().toISOString()),
  });
}

/** Generate 0–5 sessions all for the same repo. */
const repoWithSessionsArb = repoArb.chain((repo) =>
  fc.tuple(
    fc.constant(repo),
    fc.array(sessionArb(repo), { minLength: 0, maxLength: 5 }),
  ),
);

// ---------------------------------------------------------------------------
// Stub SessionManager
// ---------------------------------------------------------------------------

function stubSessionManager(sessions: WorkSession[]): ISessionManager {
  return {
    async register() { throw new Error("not implemented"); },
    async update() { throw new Error("not implemented"); },
    async deregister() { return false; },
    async heartbeat() { throw new Error("not implemented"); },
    async getActiveSessions(_repo: string) { return sessions; },
    async getAllActiveSessions() { return sessions; },
    async cleanupStale() { return 0; },
  };
}

// ---------------------------------------------------------------------------
// Property-Based Tests
// ---------------------------------------------------------------------------

describe("buildRepoSummary — Property Tests", () => {
  /**
   * **Feature: konductor-baton, Property 2: Repo summary contains repo name, GitHub link, and all active branches**
   * **Validates: Requirements 2.1, 2.2**
   *
   * For any repository with a set of active sessions, the repo summary should
   * include the repository name, a link to https://github.com/<owner>/<repo>,
   * and every unique branch from the active sessions should appear with a link
   * to https://github.com/<owner>/<repo>/tree/<branch>.
   */
  it("Property 2: Repo summary contains repo name, GitHub link, and all active branches", async () => {
    await fc.assert(
      fc.asyncProperty(repoWithSessionsArb, async ([repo, sessions]) => {
        const sm = stubSessionManager(sessions);
        const ce = new CollisionEvaluator();
        const summary = await buildRepoSummary(sm, ce, repo);

        const [owner, repoName] = repo.split("/");

        // Repo name
        expect(summary.repo).toBe(repo);

        // GitHub link
        expect(summary.githubUrl).toBe(`https://github.com/${owner}/${repoName}`);

        // All unique branches from sessions must be present
        const expectedBranches = new Set(sessions.map((s) => s.branch));
        const actualBranchNames = new Set(summary.branches.map((b) => b.name));
        for (const branch of expectedBranches) {
          expect(actualBranchNames).toContain(branch);
        }

        // Each branch has correct GitHub URL
        for (const branch of summary.branches) {
          expect(branch.githubUrl).toBe(
            `https://github.com/${owner}/${repoName}/tree/${branch.name}`,
          );
        }

        // No extra branches beyond what sessions provide
        expect(summary.branches.length).toBe(expectedBranches.size);

        // User and session counts
        const expectedUsers = new Set(sessions.map((s) => s.userId));
        expect(summary.userCount).toBe(expectedUsers.size);
        expect(summary.sessionCount).toBe(sessions.length);
      }),
      { numRuns: 100 },
    );
  });
});
