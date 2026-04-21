import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { DeduplicationFilter } from "./deduplication-filter.js";
import type { WorkSession, SessionSource } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let idCounter = 0;

function makeSession(overrides: Partial<WorkSession> & {
  userId: string;
  repo: string;
  branch: string;
  files: string[];
}): WorkSession {
  idCounter++;
  return {
    sessionId: overrides.sessionId ?? `session-${idCounter}-${Date.now()}`,
    userId: overrides.userId,
    repo: overrides.repo,
    branch: overrides.branch,
    files: overrides.files,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    lastHeartbeat: overrides.lastHeartbeat ?? new Date().toISOString(),
    source: overrides.source,
    prNumber: overrides.prNumber,
    prUrl: overrides.prUrl,
    prTargetBranch: overrides.prTargetBranch,
    prDraft: overrides.prDraft,
    prApproved: overrides.prApproved,
    commitDateRange: overrides.commitDateRange,
  };
}

const filter = new DeduplicationFilter();

// ---------------------------------------------------------------------------
// Unit Tests
// ---------------------------------------------------------------------------

describe("DeduplicationFilter — Unit Tests", () => {
  describe("Rule 1 & 3: Self-collision / Active supersedes passive", () => {
    it("suppresses PR session when author has active session in same repo", () => {
      const active = makeSession({
        userId: "alice",
        repo: "org/app",
        branch: "main",
        files: ["src/index.ts"],
        source: "active",
      });
      const prSession = makeSession({
        userId: "alice",
        repo: "org/app",
        branch: "feature-x",
        files: ["src/index.ts", "src/utils.ts"],
        source: "github_pr",
        prNumber: 42,
        prUrl: "https://github.com/org/app/pull/42",
        prTargetBranch: "main",
      });

      const result = filter.filter([active, prSession]);

      expect(result).toHaveLength(1);
      expect(result[0].sessionId).toBe(active.sessionId);
    });

    it("suppresses commit session when author has active session in same repo", () => {
      const active = makeSession({
        userId: "bob",
        repo: "org/app",
        branch: "main",
        files: ["src/api.ts"],
      });
      const commitSession = makeSession({
        userId: "bob",
        repo: "org/app",
        branch: "develop",
        files: ["src/api.ts"],
        source: "github_commit",
        commitDateRange: { earliest: "2026-04-15T00:00:00Z", latest: "2026-04-16T00:00:00Z" },
      });

      const result = filter.filter([active, commitSession]);

      expect(result).toHaveLength(1);
      expect(result[0].sessionId).toBe(active.sessionId);
    });

    it("does NOT suppress passive session when author has active session in DIFFERENT repo", () => {
      const active = makeSession({
        userId: "alice",
        repo: "org/app-a",
        branch: "main",
        files: ["src/index.ts"],
      });
      const prSession = makeSession({
        userId: "alice",
        repo: "org/app-b",
        branch: "feature-x",
        files: ["src/index.ts"],
        source: "github_pr",
        prNumber: 10,
        prUrl: "https://github.com/org/app-b/pull/10",
        prTargetBranch: "main",
      });

      const result = filter.filter([active, prSession]);

      expect(result).toHaveLength(2);
    });

    it("does NOT suppress passive session from a different user", () => {
      const active = makeSession({
        userId: "alice",
        repo: "org/app",
        branch: "main",
        files: ["src/index.ts"],
      });
      const prSession = makeSession({
        userId: "bob",
        repo: "org/app",
        branch: "feature-x",
        files: ["src/index.ts"],
        source: "github_pr",
        prNumber: 5,
        prUrl: "https://github.com/org/app/pull/5",
        prTargetBranch: "main",
      });

      const result = filter.filter([active, prSession]);

      expect(result).toHaveLength(2);
    });
  });

  describe("Rule 2: PR supersedes commits", () => {
    it("suppresses commit session when PR covers all the same files", () => {
      const prSession = makeSession({
        userId: "carol",
        repo: "org/app",
        branch: "feature-y",
        files: ["src/a.ts", "src/b.ts", "src/c.ts"],
        source: "github_pr",
        prNumber: 99,
        prUrl: "https://github.com/org/app/pull/99",
        prTargetBranch: "main",
      });
      const commitSession = makeSession({
        userId: "carol",
        repo: "org/app",
        branch: "main",
        files: ["src/a.ts", "src/b.ts"],
        source: "github_commit",
        commitDateRange: { earliest: "2026-04-15T00:00:00Z", latest: "2026-04-16T00:00:00Z" },
      });

      const result = filter.filter([prSession, commitSession]);

      expect(result).toHaveLength(1);
      expect(result[0].source).toBe("github_pr");
    });

    it("keeps commit session when PR does NOT cover all commit files", () => {
      const prSession = makeSession({
        userId: "carol",
        repo: "org/app",
        branch: "feature-y",
        files: ["src/a.ts"],
        source: "github_pr",
        prNumber: 99,
        prUrl: "https://github.com/org/app/pull/99",
        prTargetBranch: "main",
      });
      const commitSession = makeSession({
        userId: "carol",
        repo: "org/app",
        branch: "main",
        files: ["src/a.ts", "src/d.ts"],
        source: "github_commit",
        commitDateRange: { earliest: "2026-04-15T00:00:00Z", latest: "2026-04-16T00:00:00Z" },
      });

      const result = filter.filter([prSession, commitSession]);

      expect(result).toHaveLength(2);
    });

    it("does NOT suppress commit session from a different user", () => {
      const prSession = makeSession({
        userId: "carol",
        repo: "org/app",
        branch: "feature-y",
        files: ["src/a.ts", "src/b.ts"],
        source: "github_pr",
        prNumber: 99,
        prUrl: "https://github.com/org/app/pull/99",
        prTargetBranch: "main",
      });
      const commitSession = makeSession({
        userId: "dave",
        repo: "org/app",
        branch: "main",
        files: ["src/a.ts"],
        source: "github_commit",
        commitDateRange: { earliest: "2026-04-15T00:00:00Z", latest: "2026-04-16T00:00:00Z" },
      });

      const result = filter.filter([prSession, commitSession]);

      expect(result).toHaveLength(2);
    });
  });

  describe("Combined rules", () => {
    it("active sessions are always preserved", () => {
      const active1 = makeSession({
        userId: "alice",
        repo: "org/app",
        branch: "main",
        files: ["src/index.ts"],
      });
      const active2 = makeSession({
        userId: "bob",
        repo: "org/app",
        branch: "feature",
        files: ["src/utils.ts"],
      });

      const result = filter.filter([active1, active2]);

      expect(result).toHaveLength(2);
    });

    it("handles mixed scenario: active suppresses own passive, PR suppresses own commits, other user's sessions kept", () => {
      const aliceActive = makeSession({
        userId: "alice",
        repo: "org/app",
        branch: "main",
        files: ["src/index.ts"],
      });
      // Alice's own PR — should be suppressed (active supersedes passive)
      const alicePR = makeSession({
        userId: "alice",
        repo: "org/app",
        branch: "feature-a",
        files: ["src/index.ts"],
        source: "github_pr",
        prNumber: 1,
        prUrl: "https://github.com/org/app/pull/1",
        prTargetBranch: "main",
      });
      // Bob's PR — should be kept
      const bobPR = makeSession({
        userId: "bob",
        repo: "org/app",
        branch: "feature-b",
        files: ["src/api.ts", "src/utils.ts"],
        source: "github_pr",
        prNumber: 2,
        prUrl: "https://github.com/org/app/pull/2",
        prTargetBranch: "main",
      });
      // Bob's commits covering subset of PR files — should be suppressed (PR supersedes)
      const bobCommits = makeSession({
        userId: "bob",
        repo: "org/app",
        branch: "main",
        files: ["src/api.ts"],
        source: "github_commit",
        commitDateRange: { earliest: "2026-04-15T00:00:00Z", latest: "2026-04-16T00:00:00Z" },
      });

      const result = filter.filter([aliceActive, alicePR, bobPR, bobCommits]);

      const ids = result.map((s) => s.sessionId);
      expect(ids).toContain(aliceActive.sessionId);
      expect(ids).not.toContain(alicePR.sessionId);
      expect(ids).toContain(bobPR.sessionId);
      expect(ids).not.toContain(bobCommits.sessionId);
      expect(result).toHaveLength(2);
    });

    it("returns empty when given empty input", () => {
      expect(filter.filter([])).toHaveLength(0);
    });
  });
});


// ---------------------------------------------------------------------------
// Generators for property tests
// ---------------------------------------------------------------------------

const userIdArb = fc.stringMatching(/^[a-z0-9_]{2,12}$/);
const repoArb = fc
  .tuple(
    fc.stringMatching(/^[a-z0-9]{1,8}$/),
    fc.stringMatching(/^[a-z0-9-]{1,12}$/),
  )
  .map(([owner, name]) => `${owner}/${name}`);
const branchArb = fc.stringMatching(/^[a-z0-9/_-]{1,16}$/);
const filePathArb = fc
  .tuple(
    fc.stringMatching(/^[a-z]{1,6}$/),
    fc.stringMatching(/^[a-z0-9._-]{1,10}\.[a-z]{1,4}$/),
  )
  .map(([dir, file]) => `${dir}/${file}`);
const fileListArb = fc.array(filePathArb, { minLength: 1, maxLength: 6 });

function makeActiveSession(userId: string, repo: string, branch: string, files: string[]): WorkSession {
  return makeSession({ userId, repo, branch, files, source: "active" });
}

function makePRSession(userId: string, repo: string, branch: string, files: string[], prNumber: number): WorkSession {
  return makeSession({
    userId,
    repo,
    branch,
    files,
    source: "github_pr",
    prNumber,
    prUrl: `https://github.com/${repo}/pull/${prNumber}`,
    prTargetBranch: "main",
  });
}

function makeCommitSession(userId: string, repo: string, branch: string, files: string[]): WorkSession {
  return makeSession({
    userId,
    repo,
    branch,
    files,
    source: "github_commit",
    commitDateRange: { earliest: "2026-04-15T00:00:00Z", latest: "2026-04-16T00:00:00Z" },
  });
}

// ---------------------------------------------------------------------------
// Property-Based Tests
// ---------------------------------------------------------------------------

describe("DeduplicationFilter — Property Tests", () => {
  /**
   * **Feature: konductor-github, Property 3: Self-collision never reported**
   * **Validates: Requirements 1.7, 2.4, 3.6**
   *
   * For any user who has an active session in a repo, the filtered output
   * should never contain a passive session (PR or commit) for that same
   * user in that same repo. A user never sees a warning about colliding
   * with their own PR or commits.
   */
  it("Property 3: Self-collision never reported", () => {
    fc.assert(
      fc.property(
        // Generate a user with an active session
        userIdArb,
        repoArb,
        branchArb,
        fileListArb,
        // Generate passive sessions for the same user in the same repo
        fc.array(
          fc.record({
            type: fc.constantFrom("github_pr" as SessionSource, "github_commit" as SessionSource),
            branch: branchArb,
            files: fileListArb,
            prNumber: fc.integer({ min: 1, max: 9999 }),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        // Generate other users' sessions (should not be affected)
        fc.array(
          fc.record({
            userId: userIdArb,
            type: fc.constantFrom("github_pr" as SessionSource, "github_commit" as SessionSource),
            branch: branchArb,
            files: fileListArb,
            prNumber: fc.integer({ min: 1, max: 9999 }),
          }),
          { minLength: 0, maxLength: 3 },
        ),
        (userId, repo, activeBranch, activeFiles, ownPassive, otherPassive) => {
          const sessions: WorkSession[] = [];

          // The user's active session
          sessions.push(makeActiveSession(userId, repo, activeBranch, activeFiles));

          // The user's own passive sessions (should all be suppressed)
          for (const p of ownPassive) {
            if (p.type === "github_pr") {
              sessions.push(makePRSession(userId, repo, p.branch, p.files, p.prNumber));
            } else {
              sessions.push(makeCommitSession(userId, repo, p.branch, p.files));
            }
          }

          // Other users' passive sessions (should be kept)
          for (const o of otherPassive) {
            const otherId = o.userId === userId ? o.userId + "_other" : o.userId;
            if (o.type === "github_pr") {
              sessions.push(makePRSession(otherId, repo, o.branch, o.files, o.prNumber));
            } else {
              sessions.push(makeCommitSession(otherId, repo, o.branch, o.files));
            }
          }

          const result = filter.filter(sessions);

          // The user's own passive sessions must never appear in the output
          for (const s of result) {
            if (s.userId === userId && s.repo === repo) {
              expect(
                s.source === undefined || s.source === "active",
                `Self-collision: user ${userId} has passive session ${s.source} in filtered output`,
              ).toBe(true);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Feature: konductor-github, Property 6: Deduplication prevents redundant sessions**
   * **Validates: Requirements 1.7, 2.4**
   *
   * PR supersedes commits for same files. Active supersedes passive for same user.
   * For any user with a PR session covering a set of files, a commit session
   * for the same user covering a subset of those files should be suppressed.
   */
  it("Property 6: Deduplication prevents redundant sessions", () => {
    fc.assert(
      fc.property(
        userIdArb,
        repoArb,
        // PR files (superset)
        fileListArb,
        // Commit files (subset of PR files)
        fc.nat({ max: 5 }),
        fc.integer({ min: 1, max: 9999 }),
        (userId, repo, prFiles, subsetSeed, prNumber) => {
          // Ensure commit files are a subset of PR files
          const uniquePrFiles = [...new Set(prFiles)];
          if (uniquePrFiles.length === 0) return; // skip degenerate case

          const subsetSize = (subsetSeed % uniquePrFiles.length) + 1;
          const commitFiles = uniquePrFiles.slice(0, subsetSize);

          const sessions: WorkSession[] = [
            makePRSession(userId, repo, "feature", uniquePrFiles, prNumber),
            makeCommitSession(userId, repo, "main", commitFiles),
          ];

          const result = filter.filter(sessions);

          // The commit session should be suppressed because PR covers all its files
          const commitSessions = result.filter(
            (s) => s.source === "github_commit" && s.userId === userId && s.repo === repo,
          );
          expect(
            commitSessions,
            `Commit session for ${userId} should be suppressed when PR covers all files`,
          ).toHaveLength(0);

          // The PR session should be kept
          const prSessions = result.filter(
            (s) => s.source === "github_pr" && s.userId === userId && s.repo === repo,
          );
          expect(prSessions).toHaveLength(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});
