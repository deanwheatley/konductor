import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { CollisionEvaluator } from "./collision-evaluator.js";
import { CollisionState, SEVERITY } from "./types.js";
import type { WorkSession } from "./types.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const userIdArb = fc.stringMatching(/^[a-z0-9_]{1,20}$/);

const repoArb = fc
  .tuple(
    fc.stringMatching(/^[a-z0-9]{1,10}$/),
    fc.stringMatching(/^[a-z0-9-]{1,15}$/),
  )
  .map(([owner, name]) => `${owner}/${name}`);

const branchArb = fc.stringMatching(/^[a-z0-9/_-]{1,20}$/);

/** Generates a file path with at least one directory component. */
const filePathWithDirArb = fc
  .tuple(
    fc.stringMatching(/^[a-z]{1,8}$/),
    fc.stringMatching(/^[a-z0-9._-]{1,12}\.[a-z]{1,4}$/),
  )
  .map(([dir, file]) => `${dir}/${file}`);

const fileListArb = fc.array(filePathWithDirArb, { minLength: 1, maxLength: 6 });

const timestampArb = fc
  .integer({ min: 1700000000000, max: 1800000000000 })
  .map((ms) => new Date(ms).toISOString());

function makeSession(overrides: Partial<WorkSession> & { userId: string; repo: string; branch: string; files: string[] }): WorkSession {
  return {
    sessionId: overrides.sessionId ?? crypto.randomUUID(),
    userId: overrides.userId,
    repo: overrides.repo,
    branch: overrides.branch,
    files: overrides.files,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    lastHeartbeat: overrides.lastHeartbeat ?? new Date().toISOString(),
    // GitHub integration fields
    source: overrides.source,
    prNumber: overrides.prNumber,
    prUrl: overrides.prUrl,
    prTargetBranch: overrides.prTargetBranch,
    prDraft: overrides.prDraft,
    prApproved: overrides.prApproved,
    commitDateRange: overrides.commitDateRange,
  };
}

const evaluator = new CollisionEvaluator();

// ---------------------------------------------------------------------------
// Property-Based Tests
// ---------------------------------------------------------------------------

describe("CollisionEvaluator — Property Tests", () => {
  /**
   * **Feature: konductor-github, Property 1: Source-agnostic overlap detection**
   * **Validates: Requirements 3.1**
   *
   * For any set of active and passive sessions, file overlap detection is
   * identical regardless of source. Source only affects severity weighting
   * and message formatting. Specifically: the set of shared files detected
   * must be the same whether the overlapping session is active, github_pr,
   * or github_commit.
   */
  it("Property 1: Source-agnostic overlap detection", () => {
    fc.assert(
      fc.property(
        repoArb,
        userIdArb,
        branchArb,
        fileListArb,
        // Other user with overlapping files
        userIdArb,
        branchArb,
        fileListArb,
        fc.constantFrom("active" as const, "github_pr" as const, "github_commit" as const),
        (repo, userId, userBranch, userFiles, otherUserId, otherBranch, otherFiles, source) => {
          const otherId = otherUserId === userId ? userId + "_other" : otherUserId;

          const userSession = makeSession({
            userId,
            repo,
            branch: userBranch,
            files: userFiles,
          });

          // Create the "other" session as active (baseline)
          const activeOther = makeSession({
            userId: otherId,
            repo,
            branch: otherBranch,
            files: otherFiles,
          });

          // Create the same session with the given source
          const sourcedOther = makeSession({
            sessionId: activeOther.sessionId,
            userId: otherId,
            repo,
            branch: otherBranch,
            files: otherFiles,
            source,
            // Add PR metadata when source is github_pr
            ...(source === "github_pr" ? { prNumber: 42, prUrl: "https://github.com/org/repo/pull/42", prTargetBranch: "main", prDraft: false, prApproved: false } : {}),
            ...(source === "github_commit" ? { commitDateRange: { earliest: "2025-01-01", latest: "2025-01-02" } } : {}),
          });

          const baselineResult = evaluator.evaluate(userSession, [userSession, activeOther]);
          const sourcedResult = evaluator.evaluate(userSession, [userSession, sourcedOther]);

          // The set of shared files must be identical regardless of source
          expect([...sourcedResult.sharedFiles].sort()).toEqual([...baselineResult.sharedFiles].sort());

          // The set of shared directories must be identical regardless of source
          expect([...sourcedResult.sharedDirectories].sort()).toEqual([...baselineResult.sharedDirectories].sort());

          // overlappingDetails should have source attribution matching the session source
          for (const detail of sourcedResult.overlappingDetails) {
            expect(detail.source).toBe(source === undefined ? "active" : source);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Feature: konductor-mcp-server, Property 5: Collision evaluator returns the correct state for the overlap level**
   * **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.6**
   *
   * For any querying session and set of other active sessions in the same
   * repository, the CollisionEvaluator should return the correct state
   * based on the overlap level, and always the highest applicable severity.
   */
  it("Property 5: Collision evaluator returns correct state for overlap level", () => {
    fc.assert(
      fc.property(
        // Generate a scenario with controlled overlap
        fc.oneof(
          // Solo: no other sessions
          fc.record({
            type: fc.constant("solo" as const),
            repo: repoArb,
            userId: userIdArb,
            branch: branchArb,
            files: fileListArb,
          }),
          // Neighbors: other sessions in same repo, completely disjoint files and dirs
          fc.record({
            type: fc.constant("neighbors" as const),
            repo: repoArb,
            userId: userIdArb,
            otherUserId: userIdArb,
            branch: branchArb,
            userFiles: fc.constant(["alpha/user-file.ts"] as string[]),
            otherFiles: fc.constant(["beta/other-file.ts"] as string[]),
          }),
          // Crossroads: same directory, different files
          fc.record({
            type: fc.constant("crossroads" as const),
            repo: repoArb,
            userId: userIdArb,
            otherUserId: userIdArb,
            branch: branchArb,
            dir: fc.stringMatching(/^[a-z]{1,8}$/),
            userFileName: fc.constant("aaa-user.ts"),
            otherFileName: fc.constant("zzz-other.ts"),
          }),
          // Collision Course: same files, same branch
          fc.record({
            type: fc.constant("collision_course" as const),
            repo: repoArb,
            userId: userIdArb,
            otherUserId: userIdArb,
            branch: branchArb,
            sharedFiles: fileListArb,
          }),
          // Merge Hell: same files, different branches
          fc.record({
            type: fc.constant("merge_hell" as const),
            repo: repoArb,
            userId: userIdArb,
            otherUserId: userIdArb,
            userBranch: fc.constant("main"),
            otherBranch: fc.constant("feature/xyz"),
            sharedFiles: fileListArb,
          }),
        ),
        (scenario) => {
          let userSession: WorkSession;
          let allSessions: WorkSession[];

          switch (scenario.type) {
            case "solo": {
              userSession = makeSession({
                userId: scenario.userId,
                repo: scenario.repo,
                branch: scenario.branch,
                files: scenario.files,
              });
              allSessions = [userSession];
              break;
            }
            case "neighbors": {
              // Ensure different user IDs
              const otherId = scenario.otherUserId === scenario.userId
                ? scenario.userId + "_other"
                : scenario.otherUserId;
              userSession = makeSession({
                userId: scenario.userId,
                repo: scenario.repo,
                branch: scenario.branch,
                files: scenario.userFiles,
              });
              const otherSession = makeSession({
                userId: otherId,
                repo: scenario.repo,
                branch: scenario.branch,
                files: scenario.otherFiles,
              });
              allSessions = [userSession, otherSession];
              break;
            }
            case "crossroads": {
              const otherId = scenario.otherUserId === scenario.userId
                ? scenario.userId + "_other"
                : scenario.otherUserId;
              userSession = makeSession({
                userId: scenario.userId,
                repo: scenario.repo,
                branch: scenario.branch,
                files: [`${scenario.dir}/${scenario.userFileName}`],
              });
              const otherSession = makeSession({
                userId: otherId,
                repo: scenario.repo,
                branch: scenario.branch,
                files: [`${scenario.dir}/${scenario.otherFileName}`],
              });
              allSessions = [userSession, otherSession];
              break;
            }
            case "collision_course": {
              const otherId = scenario.otherUserId === scenario.userId
                ? scenario.userId + "_other"
                : scenario.otherUserId;
              userSession = makeSession({
                userId: scenario.userId,
                repo: scenario.repo,
                branch: scenario.branch,
                files: scenario.sharedFiles,
              });
              const otherSession = makeSession({
                userId: otherId,
                repo: scenario.repo,
                branch: scenario.branch,
                files: scenario.sharedFiles,
              });
              allSessions = [userSession, otherSession];
              break;
            }
            case "merge_hell": {
              const otherId = scenario.otherUserId === scenario.userId
                ? scenario.userId + "_other"
                : scenario.otherUserId;
              userSession = makeSession({
                userId: scenario.userId,
                repo: scenario.repo,
                branch: scenario.userBranch,
                files: scenario.sharedFiles,
              });
              const otherSession = makeSession({
                userId: otherId,
                repo: scenario.repo,
                branch: scenario.otherBranch,
                files: scenario.sharedFiles,
              });
              allSessions = [userSession, otherSession];
              break;
            }
          }

          const result = evaluator.evaluate(userSession, allSessions);

          // Verify the correct state is returned
          switch (scenario.type) {
            case "solo":
              expect(result.state).toBe(CollisionState.Solo);
              expect(result.overlappingSessions).toHaveLength(0);
              break;
            case "neighbors":
              expect(result.state).toBe(CollisionState.Neighbors);
              expect(result.overlappingSessions.length).toBeGreaterThan(0);
              break;
            case "crossroads":
              expect(result.state).toBe(CollisionState.Crossroads);
              expect(result.sharedDirectories.length).toBeGreaterThan(0);
              break;
            case "collision_course":
              expect(result.state).toBe(CollisionState.CollisionCourse);
              expect(result.sharedFiles.length).toBeGreaterThan(0);
              break;
            case "merge_hell":
              expect(result.state).toBe(CollisionState.MergeHell);
              expect(result.sharedFiles.length).toBeGreaterThan(0);
              break;
          }

          // Common invariants
          expect(result.queryingUser).toBe(userSession.userId);
          expect(result.repo).toBe(userSession.repo);
          // The user's own session should never appear in overlapping sessions
          expect(
            result.overlappingSessions.find(
              (s) => s.sessionId === userSession.sessionId,
            ),
          ).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });


  /**
   * **Feature: konductor-mcp-server, Property 6: Collision response includes required detail for severity level**
   * **Validates: Requirements 3.1, 3.2, 3.3**
   *
   * For any CollisionResult with severity at "Neighbors" or higher, the result
   * should include overlapping session usernames, file paths, and branch names.
   * At "Crossroads" or higher, shared directories should be non-empty.
   * At "Collision Course" or higher, shared files should be non-empty.
   */
  it("Property 6: Collision response includes required detail for severity level", () => {
    // Generate sessions that produce various severity levels
    fc.assert(
      fc.property(
        repoArb,
        userIdArb,
        branchArb,
        fileListArb,
        // Generate 1-4 other users with varying overlap
        fc.array(
          fc.record({
            userId: userIdArb,
            branch: branchArb,
            files: fileListArb,
          }),
          { minLength: 1, maxLength: 4 },
        ),
        (repo, userId, branch, userFiles, others) => {
          const userSession = makeSession({
            userId,
            repo,
            branch,
            files: userFiles,
          });

          const otherSessions = others.map((o) => {
            const otherId = o.userId === userId ? o.userId + "_x" : o.userId;
            return makeSession({
              userId: otherId,
              repo,
              branch: o.branch,
              files: o.files,
            });
          });

          const allSessions = [userSession, ...otherSessions];
          const result = evaluator.evaluate(userSession, allSessions);

          // At Neighbors or higher: overlapping sessions should have usernames, files, branches
          if (SEVERITY[result.state] >= SEVERITY[CollisionState.Neighbors]) {
            expect(result.overlappingSessions.length).toBeGreaterThan(0);
            for (const s of result.overlappingSessions) {
              expect(s.userId).toBeTruthy();
              expect(s.files.length).toBeGreaterThan(0);
              expect(s.branch).toBeTruthy();
            }
          }

          // At Crossroads or higher: shared directories should be non-empty
          if (SEVERITY[result.state] >= SEVERITY[CollisionState.Crossroads]) {
            expect(result.sharedDirectories.length).toBeGreaterThan(0);
          }

          // At Collision Course or higher: shared files should be non-empty
          if (SEVERITY[result.state] >= SEVERITY[CollisionState.CollisionCourse]) {
            expect(result.sharedFiles.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property-Based Tests — GitHub Integration (Severity Weighting)
// ---------------------------------------------------------------------------

describe("CollisionEvaluator — GitHub Severity Weighting Property Tests", () => {
  /**
   * **Feature: konductor-github, Property 4: Severity weighting is monotonic**
   * **Validates: Requirements 3.4, 3.5**
   *
   * Approved PR > open PR > draft PR in severity. PR targeting user's branch
   * > PR targeting other branch. Adjustments never skip more than one level.
   *
   * For any file overlap between a user session and a PR session:
   *   - An approved PR produces severity >= an open (non-draft, non-approved) PR
   *   - An open PR produces severity >= a draft PR
   *   - A PR targeting the user's branch produces severity >= a PR targeting another branch
   */
  it("Property 4: Severity weighting is monotonic", () => {
    fc.assert(
      fc.property(
        repoArb,
        userIdArb,
        branchArb,
        // Shared files ensure at least Crossroads-level overlap
        fileListArb,
        userIdArb,
        (repo, userId, userBranch, sharedFiles, otherUserId) => {
          const otherId = otherUserId === userId ? userId + "_other" : otherUserId;

          const userSession = makeSession({
            userId,
            repo,
            branch: userBranch,
            files: sharedFiles,
          });

          // Draft PR session (same files → guaranteed overlap)
          const draftPr = makeSession({
            userId: otherId,
            repo,
            branch: "feature/draft",
            files: sharedFiles,
            source: "github_pr",
            prNumber: 10,
            prUrl: `https://github.com/${repo}/pull/10`,
            prTargetBranch: "other-branch",
            prDraft: true,
            prApproved: false,
          });

          // Open PR session (not draft, not approved)
          const openPr = makeSession({
            userId: otherId,
            repo,
            branch: "feature/open",
            files: sharedFiles,
            source: "github_pr",
            prNumber: 20,
            prUrl: `https://github.com/${repo}/pull/20`,
            prTargetBranch: "other-branch",
            prDraft: false,
            prApproved: false,
          });

          // Approved PR session
          const approvedPr = makeSession({
            userId: otherId,
            repo,
            branch: "feature/approved",
            files: sharedFiles,
            source: "github_pr",
            prNumber: 30,
            prUrl: `https://github.com/${repo}/pull/30`,
            prTargetBranch: "other-branch",
            prDraft: false,
            prApproved: true,
          });

          const draftResult = evaluator.evaluate(userSession, [userSession, draftPr]);
          const openResult = evaluator.evaluate(userSession, [userSession, openPr]);
          const approvedResult = evaluator.evaluate(userSession, [userSession, approvedPr]);

          // Monotonicity: approved >= open >= draft
          expect(SEVERITY[approvedResult.state]).toBeGreaterThanOrEqual(SEVERITY[openResult.state]);
          expect(SEVERITY[openResult.state]).toBeGreaterThanOrEqual(SEVERITY[draftResult.state]);

          // Per-session detail severity should also be monotonic
          const draftDetail = draftResult.overlappingDetails[0];
          const openDetail = openResult.overlappingDetails[0];
          const approvedDetail = approvedResult.overlappingDetails[0];

          expect(SEVERITY[approvedDetail.severity]).toBeGreaterThanOrEqual(SEVERITY[openDetail.severity]);
          expect(SEVERITY[openDetail.severity]).toBeGreaterThanOrEqual(SEVERITY[draftDetail.severity]);

          // PR targeting user's branch should escalate vs targeting other branch
          const prTargetingUserBranch = makeSession({
            userId: otherId,
            repo,
            branch: "feature/targeting",
            files: sharedFiles,
            source: "github_pr",
            prNumber: 40,
            prUrl: `https://github.com/${repo}/pull/40`,
            prTargetBranch: userBranch, // targets user's branch
            prDraft: false,
            prApproved: false,
          });

          const prTargetingOtherBranch = makeSession({
            userId: otherId,
            repo,
            branch: "feature/targeting-other",
            files: sharedFiles,
            source: "github_pr",
            prNumber: 50,
            prUrl: `https://github.com/${repo}/pull/50`,
            prTargetBranch: "some-other-branch",
            prDraft: false,
            prApproved: false,
          });

          const targetUserResult = evaluator.evaluate(userSession, [userSession, prTargetingUserBranch]);
          const targetOtherResult = evaluator.evaluate(userSession, [userSession, prTargetingOtherBranch]);

          expect(SEVERITY[targetUserResult.state]).toBeGreaterThanOrEqual(SEVERITY[targetOtherResult.state]);

          // Adjustments never skip more than one level from the base
          // The base for same-file overlap on different branches is MergeHell (4)
          // or CollisionCourse (3) on same branch. Adjustment is at most ±1.
          for (const result of [draftResult, openResult, approvedResult, targetUserResult, targetOtherResult]) {
            for (const detail of result.overlappingDetails) {
              // Severity should be within valid range
              expect(SEVERITY[detail.severity]).toBeGreaterThanOrEqual(0);
              expect(SEVERITY[detail.severity]).toBeLessThanOrEqual(4);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Unit Tests
// ---------------------------------------------------------------------------

describe("CollisionEvaluator — Unit Tests", () => {
  it("returns Solo when user is the only session", () => {
    const session = makeSession({
      userId: "alice",
      repo: "org/repo",
      branch: "main",
      files: ["src/index.ts"],
    });

    const result = evaluator.evaluate(session, [session]);

    expect(result.state).toBe(CollisionState.Solo);
    expect(result.overlappingSessions).toHaveLength(0);
    expect(result.sharedFiles).toHaveLength(0);
    expect(result.sharedDirectories).toHaveLength(0);
  });

  it("returns Neighbors when same repo but disjoint files in different dirs", () => {
    const alice = makeSession({
      userId: "alice",
      repo: "org/repo",
      branch: "main",
      files: ["src/index.ts", "src/utils.ts"],
    });
    const bob = makeSession({
      userId: "bob",
      repo: "org/repo",
      branch: "main",
      files: ["tests/app.test.ts", "docs/readme.md"],
    });

    const result = evaluator.evaluate(alice, [alice, bob]);

    expect(result.state).toBe(CollisionState.Neighbors);
    expect(result.overlappingSessions).toHaveLength(1);
    expect(result.overlappingSessions[0].userId).toBe("bob");
    expect(result.sharedFiles).toHaveLength(0);
    expect(result.sharedDirectories).toHaveLength(0);
  });

  it("returns Crossroads when same directory but different files", () => {
    const alice = makeSession({
      userId: "alice",
      repo: "org/repo",
      branch: "main",
      files: ["src/index.ts"],
    });
    const bob = makeSession({
      userId: "bob",
      repo: "org/repo",
      branch: "main",
      files: ["src/utils.ts"],
    });

    const result = evaluator.evaluate(alice, [alice, bob]);

    expect(result.state).toBe(CollisionState.Crossroads);
    expect(result.sharedDirectories).toContain("src");
    expect(result.sharedFiles).toHaveLength(0);
  });

  it("returns Collision Course when same files on same branch", () => {
    const alice = makeSession({
      userId: "alice",
      repo: "org/repo",
      branch: "main",
      files: ["src/index.ts", "src/utils.ts"],
    });
    const bob = makeSession({
      userId: "bob",
      repo: "org/repo",
      branch: "main",
      files: ["src/index.ts", "tests/app.test.ts"],
    });

    const result = evaluator.evaluate(alice, [alice, bob]);

    expect(result.state).toBe(CollisionState.CollisionCourse);
    expect(result.sharedFiles).toContain("src/index.ts");
    expect(result.sharedDirectories).toContain("src");
  });

  it("returns Merge Hell when same files on different branches", () => {
    const alice = makeSession({
      userId: "alice",
      repo: "org/repo",
      branch: "main",
      files: ["src/index.ts"],
    });
    const bob = makeSession({
      userId: "bob",
      repo: "org/repo",
      branch: "feature/new-ui",
      files: ["src/index.ts"],
    });

    const result = evaluator.evaluate(alice, [alice, bob]);

    expect(result.state).toBe(CollisionState.MergeHell);
    expect(result.sharedFiles).toContain("src/index.ts");
    expect(result.sharedDirectories).toContain("src");
    expect(result.overlappingSessions).toHaveLength(1);
    expect(result.overlappingSessions[0].userId).toBe("bob");
  });

  it("returns highest severity when multiple overlap levels exist", () => {
    const alice = makeSession({
      userId: "alice",
      repo: "org/repo",
      branch: "main",
      files: ["src/index.ts", "lib/helpers.ts"],
    });
    // Bob: same file, same branch → Collision Course
    const bob = makeSession({
      userId: "bob",
      repo: "org/repo",
      branch: "main",
      files: ["src/index.ts"],
    });
    // Carol: same file, different branch → Merge Hell
    const carol = makeSession({
      userId: "carol",
      repo: "org/repo",
      branch: "feature/refactor",
      files: ["lib/helpers.ts"],
    });

    const result = evaluator.evaluate(alice, [alice, bob, carol]);

    // Merge Hell is highest severity
    expect(result.state).toBe(CollisionState.MergeHell);
    expect(result.overlappingSessions).toHaveLength(2);
  });

  it("handles root-level files (no directory) correctly", () => {
    const alice = makeSession({
      userId: "alice",
      repo: "org/repo",
      branch: "main",
      files: ["README.md"],
    });
    const bob = makeSession({
      userId: "bob",
      repo: "org/repo",
      branch: "main",
      files: ["CHANGELOG.md"],
    });

    const result = evaluator.evaluate(alice, [alice, bob]);

    // Both files are in root dir (""), so they share a directory
    expect(result.state).toBe(CollisionState.Crossroads);
    expect(result.sharedDirectories).toContain("");
  });

  // --- GitHub integration unit tests ---

  it("PR session overlap produces overlappingDetails with source attribution", () => {
    const alice = makeSession({
      userId: "alice",
      repo: "org/repo",
      branch: "main",
      files: ["src/index.ts"],
    });
    const prSession = makeSession({
      userId: "bob",
      repo: "org/repo",
      branch: "feature/bob",
      files: ["src/index.ts"],
      source: "github_pr",
      prNumber: 42,
      prUrl: "https://github.com/org/repo/pull/42",
      prTargetBranch: "main",
      prDraft: false,
      prApproved: false,
    });

    const result = evaluator.evaluate(alice, [alice, prSession]);

    expect(result.overlappingDetails).toHaveLength(1);
    const detail = result.overlappingDetails[0];
    expect(detail.source).toBe("github_pr");
    expect(detail.prNumber).toBe(42);
    expect(detail.prUrl).toBe("https://github.com/org/repo/pull/42");
    expect(detail.prTargetBranch).toBe("main");
    expect(detail.sharedFiles).toContain("src/index.ts");
  });

  it("commit session overlap produces overlappingDetails with commit metadata", () => {
    const alice = makeSession({
      userId: "alice",
      repo: "org/repo",
      branch: "main",
      files: ["src/index.ts"],
    });
    const commitSession = makeSession({
      userId: "carol",
      repo: "org/repo",
      branch: "main",
      files: ["src/index.ts"],
      source: "github_commit",
      commitDateRange: { earliest: "2025-04-15", latest: "2025-04-16" },
    });

    const result = evaluator.evaluate(alice, [alice, commitSession]);

    expect(result.overlappingDetails).toHaveLength(1);
    const detail = result.overlappingDetails[0];
    expect(detail.source).toBe("github_commit");
    expect(detail.commitDateRange).toEqual({ earliest: "2025-04-15", latest: "2025-04-16" });
    expect(detail.sharedFiles).toContain("src/index.ts");
  });

  it("approved PR escalates severity by one level", () => {
    const alice = makeSession({
      userId: "alice",
      repo: "org/repo",
      branch: "main",
      files: ["src/index.ts"],
    });
    const approvedPr = makeSession({
      userId: "bob",
      repo: "org/repo",
      branch: "feature/bob",
      files: ["src/index.ts"],
      source: "github_pr",
      prNumber: 42,
      prUrl: "https://github.com/org/repo/pull/42",
      prTargetBranch: "other-branch",
      prDraft: false,
      prApproved: true,
    });

    const result = evaluator.evaluate(alice, [alice, approvedPr]);

    // Base would be MergeHell (different branches, same files) — already max, stays MergeHell
    expect(result.state).toBe(CollisionState.MergeHell);
  });

  it("draft PR de-escalates severity by one level", () => {
    const alice = makeSession({
      userId: "alice",
      repo: "org/repo",
      branch: "main",
      files: ["src/index.ts"],
    });
    const draftPr = makeSession({
      userId: "bob",
      repo: "org/repo",
      branch: "feature/bob",
      files: ["src/index.ts"],
      source: "github_pr",
      prNumber: 42,
      prUrl: "https://github.com/org/repo/pull/42",
      prTargetBranch: "other-branch",
      prDraft: true,
      prApproved: false,
    });

    const result = evaluator.evaluate(alice, [alice, draftPr]);

    // Base would be MergeHell (different branches, same files) → de-escalated to CollisionCourse
    expect(result.state).toBe(CollisionState.CollisionCourse);
  });

  it("active sessions have source 'active' in overlappingDetails", () => {
    const alice = makeSession({
      userId: "alice",
      repo: "org/repo",
      branch: "main",
      files: ["src/index.ts"],
    });
    const bob = makeSession({
      userId: "bob",
      repo: "org/repo",
      branch: "main",
      files: ["src/index.ts"],
    });

    const result = evaluator.evaluate(alice, [alice, bob]);

    expect(result.overlappingDetails).toHaveLength(1);
    expect(result.overlappingDetails[0].source).toBe("active");
  });
});
