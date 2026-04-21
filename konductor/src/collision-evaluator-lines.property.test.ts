/**
 * Property-Based Tests for Line-Level Collision Evaluation
 *
 * Tests the collision evaluator's line-level detection logic using fast-check.
 * Each test validates a specific correctness property from the design document.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { CollisionEvaluator } from "./collision-evaluator.js";
import { CollisionState, SEVERITY } from "./types.js";
import type { WorkSession, LineRange, FileChange } from "./types.js";
import { normalizeFilesInput } from "./index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(
  overrides: Partial<WorkSession> & {
    userId: string;
    repo: string;
    branch: string;
    files: string[];
  },
): WorkSession {
  return {
    sessionId: overrides.sessionId ?? crypto.randomUUID(),
    userId: overrides.userId,
    repo: overrides.repo,
    branch: overrides.branch,
    files: overrides.files,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    lastHeartbeat: overrides.lastHeartbeat ?? new Date().toISOString(),
    fileChanges: overrides.fileChanges,
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
// Generators
// ---------------------------------------------------------------------------

/** Generate a valid line range (startLine <= endLine, 1-indexed). */
const lineRangeArb: fc.Arbitrary<LineRange> = fc
  .tuple(fc.integer({ min: 1, max: 500 }), fc.integer({ min: 0, max: 200 }))
  .map(([start, offset]) => ({ startLine: start, endLine: start + offset }));

/** Generate a non-empty array of line ranges. */
const lineRangesArb: fc.Arbitrary<LineRange[]> = fc.array(lineRangeArb, {
  minLength: 1,
  maxLength: 4,
});

/**
 * Generate two sets of line ranges that are guaranteed NOT to overlap.
 * Strategy: place rangesA in [1, boundary] and rangesB in [boundary+gap, ...].
 */
const nonOverlappingRangePairArb: fc.Arbitrary<[LineRange[], LineRange[]]> = fc
  .tuple(
    fc.integer({ min: 1, max: 100 }),
    fc.integer({ min: 1, max: 50 }),
    fc.integer({ min: 1, max: 100 }),
    fc.integer({ min: 1, max: 50 }),
  )
  .map(([startA, sizeA, gap, sizeB]) => {
    const endA = startA + sizeA - 1;
    const startB = endA + gap + 1; // guaranteed gap
    const endB = startB + sizeB - 1;
    return [
      [{ startLine: startA, endLine: endA }],
      [{ startLine: startB, endLine: endB }],
    ] as [LineRange[], LineRange[]];
  });

const filePathArb = fc
  .tuple(
    fc.stringMatching(/^[a-z]{1,8}$/),
    fc.stringMatching(/^[a-z0-9._-]{1,12}\.[a-z]{1,4}$/),
  )
  .map(([dir, file]) => `${dir}/${file}`);

const repoArb = fc
  .tuple(
    fc.stringMatching(/^[a-z0-9]{1,10}$/),
    fc.stringMatching(/^[a-z0-9-]{1,15}$/),
  )
  .map(([owner, name]) => `${owner}/${name}`);

const branchArb = fc.stringMatching(/^[a-z0-9/_-]{1,20}$/);
const userIdArb = fc.stringMatching(/^[a-z0-9_]{1,20}$/);

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe("CollisionEvaluator — Line-Level Property Tests", () => {
  /**
   * **Feature: konductor-line-level-collision, Property 2: Non-overlapping ranges produce Proximity**
   * **Validates: Requirement 3.2**
   *
   * For any two sessions editing the same file where both have line ranges
   * and no range in session A overlaps with any range in session B, the
   * evaluator SHALL return Proximity (not Collision Course).
   */
  it("Property 2: Non-overlapping ranges produce Proximity", () => {
    fc.assert(
      fc.property(
        repoArb,
        userIdArb,
        userIdArb,
        branchArb,
        filePathArb,
        nonOverlappingRangePairArb,
        (repo, userId, otherUserId, branch, sharedFile, [rangesA, rangesB]) => {
          const otherId =
            otherUserId === userId ? userId + "_other" : otherUserId;

          const userSession = makeSession({
            userId,
            repo,
            branch,
            files: [sharedFile],
            fileChanges: [{ path: sharedFile, lineRanges: rangesA }],
          });

          const otherSession = makeSession({
            userId: otherId,
            repo,
            branch, // same branch
            files: [sharedFile],
            fileChanges: [{ path: sharedFile, lineRanges: rangesB }],
          });

          const result = evaluator.evaluate(userSession, [
            userSession,
            otherSession,
          ]);

          // Should be Proximity, not Collision Course
          expect(result.state).toBe(CollisionState.Proximity);

          // Should have line overlap details with lineOverlap: false
          const detail = result.overlappingDetails[0];
          expect(detail.lineOverlapDetails).toBeDefined();
          expect(detail.lineOverlapDetails![0].lineOverlap).toBe(false);
          expect(detail.lineOverlapDetails![0].overlappingLines).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Feature: konductor-line-level-collision, Property 3: Missing line data falls back to Collision Course**
   * **Validates: Requirement 3.3**
   *
   * For any two sessions editing the same file where one or both sessions
   * lack line range data for that file, the evaluator SHALL return Collision
   * Course (or Merge Hell for cross-branch), never Proximity.
   */
  it("Property 3: Missing line data falls back to Collision Course", () => {
    fc.assert(
      fc.property(
        repoArb,
        userIdArb,
        userIdArb,
        branchArb,
        filePathArb,
        lineRangesArb,
        fc.constantFrom("no_user_ranges", "no_other_ranges", "no_ranges_at_all"),
        (repo, userId, otherUserId, branch, sharedFile, someRanges, missingCase) => {
          const otherId =
            otherUserId === userId ? userId + "_other" : otherUserId;

          let userFileChanges: FileChange[] | undefined;
          let otherFileChanges: FileChange[] | undefined;

          switch (missingCase) {
            case "no_user_ranges":
              // User has no fileChanges, other has ranges
              userFileChanges = undefined;
              otherFileChanges = [{ path: sharedFile, lineRanges: someRanges }];
              break;
            case "no_other_ranges":
              // User has ranges, other has no fileChanges
              userFileChanges = [{ path: sharedFile, lineRanges: someRanges }];
              otherFileChanges = undefined;
              break;
            case "no_ranges_at_all":
              // Neither has fileChanges
              userFileChanges = undefined;
              otherFileChanges = undefined;
              break;
          }

          const userSession = makeSession({
            userId,
            repo,
            branch,
            files: [sharedFile],
            fileChanges: userFileChanges,
          });

          const otherSession = makeSession({
            userId: otherId,
            repo,
            branch, // same branch → should be CollisionCourse
            files: [sharedFile],
            fileChanges: otherFileChanges,
          });

          const result = evaluator.evaluate(userSession, [
            userSession,
            otherSession,
          ]);

          // Should NEVER be Proximity when line data is missing
          expect(result.state).not.toBe(CollisionState.Proximity);
          // Should be CollisionCourse (same branch)
          expect(result.state).toBe(CollisionState.CollisionCourse);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Feature: konductor-line-level-collision, Property 8: Backward compatibility — string files produce identical results**
   * **Validates: Requirements 7.1, 7.2, 7.3, 7.4**
   *
   * For any set of sessions registered with files: string[] (no line ranges),
   * the evaluator SHALL produce the same collision state as the current
   * implementation (no Proximity state possible without line data).
   */
  it("Property 8: Backward compatibility — string files produce identical results", () => {
    fc.assert(
      fc.property(
        repoArb,
        userIdArb,
        userIdArb,
        branchArb,
        branchArb,
        fc.array(filePathArb, { minLength: 1, maxLength: 5 }),
        fc.array(filePathArb, { minLength: 1, maxLength: 5 }),
        (repo, userId, otherUserId, userBranch, otherBranch, userFiles, otherFiles) => {
          const otherId =
            otherUserId === userId ? userId + "_other" : otherUserId;

          // Sessions with NO fileChanges (backward-compatible string[] format)
          const userSession = makeSession({
            userId,
            repo,
            branch: userBranch,
            files: userFiles,
            // No fileChanges — simulates old client
          });

          const otherSession = makeSession({
            userId: otherId,
            repo,
            branch: otherBranch,
            files: otherFiles,
            // No fileChanges — simulates old client
          });

          const result = evaluator.evaluate(userSession, [
            userSession,
            otherSession,
          ]);

          // Without line data, Proximity should NEVER appear
          expect(result.state).not.toBe(CollisionState.Proximity);

          // The valid states without line data are: Solo, Neighbors, Crossroads,
          // CollisionCourse, MergeHell
          expect([
            CollisionState.Neighbors,
            CollisionState.Crossroads,
            CollisionState.CollisionCourse,
            CollisionState.MergeHell,
          ]).toContain(result.state);

          // If files overlap and same branch → CollisionCourse
          const commonFiles = userFiles.filter((f) => otherFiles.includes(f));
          if (commonFiles.length > 0 && userBranch === otherBranch) {
            expect(result.state).toBe(CollisionState.CollisionCourse);
          }
          // If files overlap and different branch → MergeHell
          if (commonFiles.length > 0 && userBranch !== otherBranch) {
            expect(result.state).toBe(CollisionState.MergeHell);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Feature: konductor-line-level-collision, Property 10: Proximity state does not pause the agent**
   * **Validates: Requirement 3.4**
   *
   * For any collision result with state Proximity, the actions array SHALL
   * NOT contain any action with type: "block".
   */
  it("Property 10: Proximity state does not pause the agent", () => {
    fc.assert(
      fc.property(
        repoArb,
        userIdArb,
        userIdArb,
        branchArb,
        filePathArb,
        nonOverlappingRangePairArb,
        (repo, userId, otherUserId, branch, sharedFile, [rangesA, rangesB]) => {
          const otherId =
            otherUserId === userId ? userId + "_other" : otherUserId;

          const userSession = makeSession({
            userId,
            repo,
            branch,
            files: [sharedFile],
            fileChanges: [{ path: sharedFile, lineRanges: rangesA }],
          });

          const otherSession = makeSession({
            userId: otherId,
            repo,
            branch,
            files: [sharedFile],
            fileChanges: [{ path: sharedFile, lineRanges: rangesB }],
          });

          const result = evaluator.evaluate(userSession, [
            userSession,
            otherSession,
          ]);

          // Confirm we're in Proximity state
          expect(result.state).toBe(CollisionState.Proximity);

          // Actions should NOT contain any "block" action
          const blockActions = result.actions.filter(
            (a) => a.type === "block",
          );
          expect(blockActions).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 9: Mixed file format normalization
// ---------------------------------------------------------------------------

describe("normalizeFilesInput — Property Tests", () => {
  /**
   * **Feature: konductor-line-level-collision, Property 9: Mixed file format normalization**
   * **Validates: Requirement 2.4**
   *
   * For any files array containing a mix of strings and FileChange objects,
   * the server SHALL normalize all entries to FileChange objects and the
   * resulting session.files array SHALL contain exactly the paths from both formats.
   */
  it("Property 9: Mixed file format normalization", () => {
    const fileChangeObjArb: fc.Arbitrary<{ path: string; lineRanges?: LineRange[] }> = fc
      .tuple(filePathArb, fc.option(lineRangesArb, { nil: undefined }))
      .map(([path, lineRanges]) => lineRanges ? { path, lineRanges } : { path });

    const mixedItemArb = fc.oneof(
      filePathArb.map((p) => p as string | { path: string; lineRanges?: LineRange[] }),
      fileChangeObjArb.map((fc) => fc as string | { path: string; lineRanges?: LineRange[] }),
    );

    fc.assert(
      fc.property(
        fc.array(mixedItemArb, { minLength: 1, maxLength: 10 }),
        (mixedInput) => {
          const { files, fileChanges } = normalizeFilesInput(mixedInput);

          // files array should contain exactly the paths from all items
          expect(files.length).toBe(mixedInput.length);
          expect(fileChanges.length).toBe(mixedInput.length);

          for (let i = 0; i < mixedInput.length; i++) {
            const item = mixedInput[i];
            const expectedPath = typeof item === "string" ? item : item.path;
            expect(files[i]).toBe(expectedPath);
            expect(fileChanges[i].path).toBe(expectedPath);
          }

          // String items should produce FileChange without lineRanges
          for (let i = 0; i < mixedInput.length; i++) {
            const item = mixedInput[i];
            if (typeof item === "string") {
              expect(fileChanges[i].lineRanges).toBeUndefined();
            }
          }

          // Object items with lineRanges should preserve them
          for (let i = 0; i < mixedInput.length; i++) {
            const item = mixedInput[i];
            if (typeof item === "object" && item.lineRanges && item.lineRanges.length > 0) {
              expect(fileChanges[i].lineRanges).toBeDefined();
              expect(fileChanges[i].lineRanges!.length).toBe(item.lineRanges.length);
              for (let j = 0; j < item.lineRanges.length; j++) {
                expect(fileChanges[i].lineRanges![j].startLine).toBe(item.lineRanges[j].startLine);
                expect(fileChanges[i].lineRanges![j].endLine).toBe(item.lineRanges[j].endLine);
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
