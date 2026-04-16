import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { QueryEngine } from "./query-engine.js";
import { CollisionEvaluator } from "./collision-evaluator.js";
import { CollisionState, SEVERITY } from "./types.js";
import type { WorkSession, ISessionManager, ICollisionEvaluator } from "./types.js";

// ---------------------------------------------------------------------------
// Shared Generators
// ---------------------------------------------------------------------------

const arbUserId = fc.stringMatching(/^[a-z0-9_]{1,20}$/);

const arbRepo = fc
  .tuple(
    fc.stringMatching(/^[a-z0-9]{1,10}$/),
    fc.stringMatching(/^[a-z0-9-]{1,15}$/),
  )
  .map(([owner, name]) => `${owner}/${name}`);

const arbBranch = fc.stringMatching(/^[a-z0-9/_-]{1,20}$/);

const arbFilePath = fc
  .tuple(
    fc.stringMatching(/^[a-z]{1,8}$/),
    fc.stringMatching(/^[a-z0-9._-]{1,12}\.[a-z]{1,4}$/),
  )
  .map(([dir, file]) => `${dir}/${file}`);

const arbFileList = fc.array(arbFilePath, { minLength: 1, maxLength: 6 });

function arbWorkSession(repoOverride?: string): fc.Arbitrary<WorkSession> {
  return fc
    .record({
      userId: arbUserId,
      repo: repoOverride ? fc.constant(repoOverride) : arbRepo,
      branch: arbBranch,
      files: arbFileList,
      createdMinutesAgo: fc.integer({ min: 0, max: 600 }),
    })
    .map(({ userId, repo, branch, files, createdMinutesAgo }) => {
      const now = Date.now();
      const createdAt = new Date(now - createdMinutesAgo * 60000).toISOString();
      return {
        sessionId: crypto.randomUUID(),
        userId,
        repo,
        branch,
        files,
        createdAt,
        lastHeartbeat: new Date(now).toISOString(),
      };
    });
}

/**
 * Generate a set of 0-10 sessions for a given repo, ensuring unique userIds.
 */
function arbSessionSet(repo: string): fc.Arbitrary<WorkSession[]> {
  return fc
    .array(arbWorkSession(repo), { minLength: 0, maxLength: 10 })
    .map((sessions) => {
      // Deduplicate by userId — keep first occurrence
      const seen = new Set<string>();
      return sessions.filter((s) => {
        if (seen.has(s.userId)) return false;
        seen.add(s.userId);
        return true;
      });
    });
}

// ---------------------------------------------------------------------------
// Stub SessionManager for testing
// ---------------------------------------------------------------------------

/**
 * A minimal in-memory SessionManager that returns pre-loaded sessions.
 * Used to test QueryEngine in isolation without persistence.
 */
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

/**
 * Stub that also supports getAllActiveSessions for cross-repo queries.
 * (Now identical to createStubSessionManager since getAllActiveSessions is on the interface.)
 */
function createStubSessionManagerWithAll(sessions: WorkSession[]): ISessionManager {
  return createStubSessionManager(sessions);
}

const collisionEvaluator = new CollisionEvaluator();

// ---------------------------------------------------------------------------
// Property-Based Tests
// ---------------------------------------------------------------------------

describe("QueryEngine — Property Tests", () => {
  /**
   * **Feature: konductor-enhanced-chat, Property 1: who_is_active returns all active users with complete data**
   * **Validates: Requirements 1.1, 1.2**
   *
   * For any set of registered sessions in a repository, calling whoIsActive
   * should return exactly the set of active users, and each entry should
   * contain the correct userId, branch, files, and a non-negative
   * sessionDurationMinutes.
   */
  it("Property 1: who_is_active returns all active users with complete data", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbRepo,
        arbSessionSet("__REPO__"),
        async (repo, templateSessions) => {
          // Stamp all sessions with the generated repo
          const sessions = templateSessions.map((s) => ({ ...s, repo }));
          const sm = createStubSessionManager(sessions);
          const qe = new QueryEngine(sm, collisionEvaluator);

          const result = await qe.whoIsActive(repo);

          // Should return exactly the same number of users
          expect(result.totalUsers).toBe(sessions.length);
          expect(result.users.length).toBe(sessions.length);
          expect(result.repo).toBe(repo);

          // Every session should appear in the result
          const resultUserIds = new Set(result.users.map((u) => u.userId));
          for (const s of sessions) {
            expect(resultUserIds.has(s.userId)).toBe(true);
          }

          // Each user entry should have complete data
          for (const user of result.users) {
            expect(user.userId).toBeTruthy();
            expect(user.branch).toBeTruthy();
            expect(user.files.length).toBeGreaterThan(0);
            expect(user.sessionDurationMinutes).toBeGreaterThanOrEqual(0);

            // Verify data matches the source session
            const source = sessions.find((s) => s.userId === user.userId)!;
            expect(user.branch).toBe(source.branch);
            expect(user.files).toEqual(source.files);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Feature: konductor-enhanced-chat, Property 2: who_overlaps returns exactly the overlapping users with complete data**
   * **Validates: Requirements 2.1, 2.2, 2.4**
   *
   * For any user with an active session and any set of other sessions in the
   * same repo, calling whoOverlaps should return exactly the users whose files
   * overlap with the querying user. Each overlap entry should include the
   * correct userId, branch, sharedFiles, and collisionState. When no overlaps
   * exist, isAlone should be true and the overlaps list should be empty.
   */
  it("Property 2: who_overlaps returns exactly the overlapping users with complete data", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbRepo,
        arbSessionSet("__REPO__"),
        async (repo, templateSessions) => {
          const sessions = templateSessions.map((s) => ({ ...s, repo }));
          if (sessions.length === 0) return; // Need at least one user to query

          const sm = createStubSessionManager(sessions);
          const qe = new QueryEngine(sm, collisionEvaluator);

          // Pick the first user as the querying user
          const queryUser = sessions[0];
          const result = await qe.whoOverlaps(queryUser.userId, repo);

          expect(result.userId).toBe(queryUser.userId);
          expect(result.repo).toBe(repo);

          // Compute expected overlaps manually
          const queryFiles = new Set(queryUser.files);
          const expectedOverlapUserIds = new Set<string>();
          for (const other of sessions) {
            if (other.sessionId === queryUser.sessionId) continue;
            const shared = other.files.filter((f) => queryFiles.has(f));
            if (shared.length > 0) expectedOverlapUserIds.add(other.userId);
          }

          const resultOverlapUserIds = new Set(result.overlaps.map((o) => o.userId));
          expect(resultOverlapUserIds).toEqual(expectedOverlapUserIds);

          // isAlone should be true iff no overlaps
          expect(result.isAlone).toBe(result.overlaps.length === 0);

          // Each overlap entry should have complete and correct data
          for (const overlap of result.overlaps) {
            expect(overlap.userId).toBeTruthy();
            expect(overlap.branch).toBeTruthy();
            expect(overlap.sharedFiles.length).toBeGreaterThan(0);

            // All shared files should actually be in the querying user's file set
            for (const f of overlap.sharedFiles) {
              expect(queryFiles.has(f)).toBe(true);
            }

            // Collision state should match branch comparison
            const otherSession = sessions.find((s) => s.userId === overlap.userId)!;
            if (otherSession.branch !== queryUser.branch) {
              expect(overlap.collisionState).toBe(CollisionState.MergeHell);
            } else {
              expect(overlap.collisionState).toBe(CollisionState.CollisionCourse);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Feature: konductor-enhanced-chat, Property 3: user_activity returns all sessions across repos with complete data**
   * **Validates: Requirements 3.1, 3.2, 3.3**
   *
   * For any user with active sessions across one or more repositories,
   * calling userActivity should return all of those sessions. Each entry
   * should include repo, branch, files, sessionStartedAt, and lastHeartbeat.
   * When the user has no sessions, isActive should be false and the sessions
   * list should be empty.
   */
  it("Property 3: user_activity returns all sessions across repos with complete data", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUserId,
        // Generate sessions across 1-3 repos, some belonging to the target user
        fc.array(arbWorkSession(), { minLength: 0, maxLength: 15 }),
        async (targetUserId, allSessions) => {
          // Ensure unique sessionIds
          const seen = new Set<string>();
          const sessions = allSessions.filter((s) => {
            if (seen.has(s.sessionId)) return false;
            seen.add(s.sessionId);
            return true;
          });

          const sm = createStubSessionManagerWithAll(sessions);
          const qe = new QueryEngine(sm, collisionEvaluator);

          const result = await qe.userActivity(targetUserId);

          expect(result.userId).toBe(targetUserId);

          // Expected: all sessions belonging to targetUserId
          const expectedSessions = sessions.filter((s) => s.userId === targetUserId);
          expect(result.sessions.length).toBe(expectedSessions.length);
          expect(result.isActive).toBe(expectedSessions.length > 0);

          // Each returned session should have complete data matching source
          for (const rs of result.sessions) {
            expect(rs.repo).toBeTruthy();
            expect(rs.branch).toBeTruthy();
            expect(rs.files.length).toBeGreaterThan(0);
            expect(rs.sessionStartedAt).toBeTruthy();
            expect(rs.lastHeartbeat).toBeTruthy();

            // Find matching source session
            const source = expectedSessions.find(
              (s) => s.repo === rs.repo && s.branch === rs.branch,
            );
            expect(source).toBeDefined();
            if (source) {
              expect(rs.files).toEqual(source.files);
              expect(rs.sessionStartedAt).toBe(source.createdAt);
              expect(rs.lastHeartbeat).toBe(source.lastHeartbeat);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Feature: konductor-enhanced-chat, Property 4: risk_assessment returns internally consistent risk data**
   * **Validates: Requirements 4.1, 4.2**
   *
   * For any user with an active session and any set of other sessions in the
   * same repo, calling riskAssessment should return a result where: severity
   * matches the numeric value of collisionState, overlappingUserCount equals
   * the number of users with overlapping files, sharedFileCount equals the
   * number of shared files, and hasCrossBranchOverlap is true if and only if
   * at least one overlapping user is on a different branch.
   */
  it("Property 4: risk_assessment returns internally consistent risk data", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbRepo,
        arbSessionSet("__REPO__"),
        async (repo, templateSessions) => {
          const sessions = templateSessions.map((s) => ({ ...s, repo }));
          if (sessions.length === 0) return;

          const sm = createStubSessionManager(sessions);
          const qe = new QueryEngine(sm, collisionEvaluator);

          const queryUser = sessions[0];
          const result = await qe.riskAssessment(queryUser.userId, repo);

          expect(result.userId).toBe(queryUser.userId);
          expect(result.repo).toBe(repo);

          // Severity must match collision state
          expect(result.severity).toBe(SEVERITY[result.collisionState]);

          // Compute expected values manually
          const queryFiles = new Set(queryUser.files);
          const expectedOverlapUsers = new Set<string>();
          const expectedSharedFiles = new Set<string>();
          let expectedCrossBranch = false;

          for (const other of sessions) {
            if (other.sessionId === queryUser.sessionId) continue;
            const shared = other.files.filter((f) => queryFiles.has(f));
            if (shared.length > 0) {
              expectedOverlapUsers.add(other.userId);
              for (const f of shared) expectedSharedFiles.add(f);
              if (other.branch !== queryUser.branch) expectedCrossBranch = true;
            }
          }

          expect(result.overlappingUserCount).toBe(expectedOverlapUsers.size);
          expect(result.sharedFileCount).toBe(expectedSharedFiles.size);
          expect(result.hasCrossBranchOverlap).toBe(expectedCrossBranch);

          // Risk summary should be a non-empty string
          expect(result.riskSummary.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Feature: konductor-enhanced-chat, Property 5: repo_hotspots are ranked by editor count with complete data**
   * **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
   *
   * For any set of sessions in a repository, calling repoHotspots should
   * return hotspot entries sorted in descending order by number of editors.
   * Each entry should include the file, the list of editors (with userId and
   * branch), and the correct collisionState. When no files have multiple
   * editors, isClear should be true.
   */
  it("Property 5: repo_hotspots are ranked by editor count with complete data", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbRepo,
        arbSessionSet("__REPO__"),
        async (repo, templateSessions) => {
          const sessions = templateSessions.map((s) => ({ ...s, repo }));
          const sm = createStubSessionManager(sessions);
          const qe = new QueryEngine(sm, collisionEvaluator);

          const result = await qe.repoHotspots(repo);

          expect(result.repo).toBe(repo);

          // Compute expected hotspots manually
          const fileEditors = new Map<string, Array<{ userId: string; branch: string }>>();
          for (const s of sessions) {
            for (const file of s.files) {
              if (!fileEditors.has(file)) fileEditors.set(file, []);
              fileEditors.get(file)!.push({ userId: s.userId, branch: s.branch });
            }
          }
          const expectedHotspotFiles = new Set<string>();
          for (const [file, editors] of fileEditors) {
            if (editors.length >= 2) expectedHotspotFiles.add(file);
          }

          // isClear should be true iff no hotspots
          expect(result.isClear).toBe(expectedHotspotFiles.size === 0);
          expect(result.hotspots.length).toBe(expectedHotspotFiles.size);

          // Hotspots should be sorted descending by editor count
          for (let i = 1; i < result.hotspots.length; i++) {
            expect(result.hotspots[i - 1].editors.length).toBeGreaterThanOrEqual(
              result.hotspots[i].editors.length,
            );
          }

          // Each hotspot should have correct data
          for (const hotspot of result.hotspots) {
            expect(hotspot.file).toBeTruthy();
            expect(hotspot.editors.length).toBeGreaterThanOrEqual(2);
            expect(expectedHotspotFiles.has(hotspot.file)).toBe(true);

            // Collision state: MergeHell if editors on different branches, else CollisionCourse
            const branches = new Set(hotspot.editors.map((e) => e.branch));
            if (branches.size > 1) {
              expect(hotspot.collisionState).toBe(CollisionState.MergeHell);
            } else {
              expect(hotspot.collisionState).toBe(CollisionState.CollisionCourse);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Feature: konductor-enhanced-chat, Property 6: active_branches returns all distinct branches with correct overlap flags**
   * **Validates: Requirements 6.1, 6.2, 6.3**
   *
   * For any set of sessions in a repository, calling activeBranches should
   * return exactly the set of distinct branches. Each entry should include
   * the branch name, the users on it, and the files being edited. The
   * hasOverlapWithOtherBranches flag should be true if and only if at least
   * one file on that branch is also being edited on a different branch.
   */
  it("Property 6: active_branches returns all distinct branches with correct overlap flags", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbRepo,
        arbSessionSet("__REPO__"),
        async (repo, templateSessions) => {
          const sessions = templateSessions.map((s) => ({ ...s, repo }));
          const sm = createStubSessionManager(sessions);
          const qe = new QueryEngine(sm, collisionEvaluator);

          const result = await qe.activeBranches(repo);

          expect(result.repo).toBe(repo);

          // Compute expected branches manually
          const branchMap = new Map<string, { users: Set<string>; files: Set<string> }>();
          for (const s of sessions) {
            if (!branchMap.has(s.branch)) {
              branchMap.set(s.branch, { users: new Set(), files: new Set() });
            }
            const entry = branchMap.get(s.branch)!;
            entry.users.add(s.userId);
            for (const f of s.files) entry.files.add(f);
          }

          // Should return exactly the distinct branches
          expect(result.branches.length).toBe(branchMap.size);
          const resultBranchNames = new Set(result.branches.map((b) => b.branch));
          for (const branch of branchMap.keys()) {
            expect(resultBranchNames.has(branch)).toBe(true);
          }

          // Each branch entry should have correct data
          for (const branchInfo of result.branches) {
            const expected = branchMap.get(branchInfo.branch)!;
            expect(new Set(branchInfo.users)).toEqual(expected.users);
            expect(new Set(branchInfo.files)).toEqual(expected.files);

            // Compute expected overlap flag
            let expectedOverlap = false;
            for (const [otherBranch, otherData] of branchMap) {
              if (otherBranch === branchInfo.branch) continue;
              for (const file of expected.files) {
                if (otherData.files.has(file)) {
                  expectedOverlap = true;
                  break;
                }
              }
              if (expectedOverlap) break;
            }
            expect(branchInfo.hasOverlapWithOtherBranches).toBe(expectedOverlap);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Feature: konductor-enhanced-chat, Property 7: coordination_advice targets are ranked by urgency with complete data**
   * **Validates: Requirements 7.1, 7.2, 7.3**
   *
   * For any user with an active session and any set of other sessions in the
   * same repo, calling coordinationAdvice should return targets sorted by
   * urgency: "high" (merge hell — different branch, same files) before
   * "medium" (collision course — same branch, same files) before "low"
   * (crossroads — same directories). Each target should include userId,
   * branch, sharedFiles, and a non-empty suggestedAction.
   */
  it("Property 7: coordination_advice targets are ranked by urgency with complete data", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbRepo,
        arbSessionSet("__REPO__"),
        async (repo, templateSessions) => {
          const sessions = templateSessions.map((s) => ({ ...s, repo }));
          if (sessions.length === 0) return;

          const sm = createStubSessionManager(sessions);
          const qe = new QueryEngine(sm, collisionEvaluator);

          const queryUser = sessions[0];
          const result = await qe.coordinationAdvice(queryUser.userId, repo);

          expect(result.userId).toBe(queryUser.userId);
          expect(result.repo).toBe(repo);

          // Targets should be sorted by urgency: high < medium < low
          const urgencyOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
          for (let i = 1; i < result.targets.length; i++) {
            expect(urgencyOrder[result.targets[i - 1].urgency]).toBeLessThanOrEqual(
              urgencyOrder[result.targets[i].urgency],
            );
          }

          // hasUrgentTargets should be true iff any target is "high"
          expect(result.hasUrgentTargets).toBe(
            result.targets.some((t) => t.urgency === "high"),
          );

          // Each target should have complete data
          for (const target of result.targets) {
            expect(target.userId).toBeTruthy();
            expect(target.branch).toBeTruthy();
            expect(target.sharedFiles.length).toBeGreaterThan(0);
            expect(target.suggestedAction.length).toBeGreaterThan(0);

            // Verify urgency classification
            const otherSession = sessions.find((s) => s.userId === target.userId)!;
            const queryFiles = new Set(queryUser.files);
            const sharedFiles = otherSession.files.filter((f) => queryFiles.has(f));

            if (sharedFiles.length > 0) {
              // File-level overlap
              if (otherSession.branch !== queryUser.branch) {
                expect(target.urgency).toBe("high");
              } else {
                expect(target.urgency).toBe("medium");
              }
            } else {
              // Directory-level overlap only
              expect(target.urgency).toBe("low");
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
