/**
 * Unit Tests for Line-Level Collision Evaluation
 *
 * Tests specific collision scenarios with line range data.
 * Requirements: 3.1, 3.2, 3.3, 5.1, 5.2
 */

import { describe, it, expect } from "vitest";
import { CollisionEvaluator } from "./collision-evaluator.js";
import { CollisionState } from "./types.js";
import type { WorkSession } from "./types.js";

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

describe("CollisionEvaluator — Line-Level Unit Tests", () => {
  it("same file, overlapping lines → Collision Course with line overlap detail", () => {
    const alice = makeSession({
      userId: "alice",
      repo: "org/repo",
      branch: "main",
      files: ["src/index.ts"],
      fileChanges: [
        { path: "src/index.ts", lineRanges: [{ startLine: 10, endLine: 25 }] },
      ],
    });
    const bob = makeSession({
      userId: "bob",
      repo: "org/repo",
      branch: "main",
      files: ["src/index.ts"],
      fileChanges: [
        { path: "src/index.ts", lineRanges: [{ startLine: 15, endLine: 30 }] },
      ],
    });

    const result = evaluator.evaluate(alice, [alice, bob]);

    expect(result.state).toBe(CollisionState.CollisionCourse);
    expect(result.sharedFiles).toContain("src/index.ts");

    const detail = result.overlappingDetails[0];
    expect(detail.lineOverlapDetails).toBeDefined();
    expect(detail.lineOverlapDetails![0].lineOverlap).toBe(true);
    expect(detail.lineOverlapDetails![0].overlappingLines).toBe(11); // lines 15-25
    expect(detail.lineOverlapDetails![0].overlapSeverity).toBe("severe"); // >50% of each user's 16 lines
  });

  it("same file, non-overlapping lines → Proximity with section context", () => {
    const alice = makeSession({
      userId: "alice",
      repo: "org/repo",
      branch: "main",
      files: ["src/index.ts"],
      fileChanges: [
        { path: "src/index.ts", lineRanges: [{ startLine: 10, endLine: 25 }] },
      ],
    });
    const bob = makeSession({
      userId: "bob",
      repo: "org/repo",
      branch: "main",
      files: ["src/index.ts"],
      fileChanges: [
        {
          path: "src/index.ts",
          lineRanges: [{ startLine: 100, endLine: 120 }],
        },
      ],
    });

    const result = evaluator.evaluate(alice, [alice, bob]);

    expect(result.state).toBe(CollisionState.Proximity);

    const detail = result.overlappingDetails[0];
    expect(detail.lineOverlapDetails).toBeDefined();
    expect(detail.lineOverlapDetails![0].lineOverlap).toBe(false);
    expect(detail.lineOverlapDetails![0].overlappingLines).toBe(0);
    expect(detail.lineOverlapDetails![0].userRanges).toEqual([
      { startLine: 10, endLine: 25 },
    ]);
    expect(detail.lineOverlapDetails![0].otherRanges).toEqual([
      { startLine: 100, endLine: 120 },
    ]);
  });

  it("same file, one user has line data, other doesn't → Collision Course fallback", () => {
    const alice = makeSession({
      userId: "alice",
      repo: "org/repo",
      branch: "main",
      files: ["src/index.ts"],
      fileChanges: [
        { path: "src/index.ts", lineRanges: [{ startLine: 10, endLine: 25 }] },
      ],
    });
    const bob = makeSession({
      userId: "bob",
      repo: "org/repo",
      branch: "main",
      files: ["src/index.ts"],
      // No fileChanges — old client
    });

    const result = evaluator.evaluate(alice, [alice, bob]);

    expect(result.state).toBe(CollisionState.CollisionCourse);

    const detail = result.overlappingDetails[0];
    expect(detail.lineOverlapDetails).toBeDefined();
    expect(detail.lineOverlapDetails![0].lineOverlap).toBeNull();
  });

  it("same file, neither has line data → Collision Course (current behavior)", () => {
    const alice = makeSession({
      userId: "alice",
      repo: "org/repo",
      branch: "main",
      files: ["src/index.ts"],
      // No fileChanges
    });
    const bob = makeSession({
      userId: "bob",
      repo: "org/repo",
      branch: "main",
      files: ["src/index.ts"],
      // No fileChanges
    });

    const result = evaluator.evaluate(alice, [alice, bob]);

    expect(result.state).toBe(CollisionState.CollisionCourse);
    // No line overlap details when neither has data
    const detail = result.overlappingDetails[0];
    expect(detail.lineOverlapDetails).toBeDefined();
    expect(detail.lineOverlapDetails![0].lineOverlap).toBeNull();
  });

  it("cross-branch with line overlap → Merge Hell with severity", () => {
    const alice = makeSession({
      userId: "alice",
      repo: "org/repo",
      branch: "main",
      files: ["src/index.ts"],
      fileChanges: [
        { path: "src/index.ts", lineRanges: [{ startLine: 1, endLine: 50 }] },
      ],
    });
    const bob = makeSession({
      userId: "bob",
      repo: "org/repo",
      branch: "feature/new-ui",
      files: ["src/index.ts"],
      fileChanges: [
        { path: "src/index.ts", lineRanges: [{ startLine: 20, endLine: 60 }] },
      ],
    });

    const result = evaluator.evaluate(alice, [alice, bob]);

    expect(result.state).toBe(CollisionState.MergeHell);

    const detail = result.overlappingDetails[0];
    expect(detail.lineOverlapDetails).toBeDefined();
    expect(detail.lineOverlapDetails![0].lineOverlap).toBe(true);
    expect(detail.lineOverlapDetails![0].overlappingLines).toBe(31); // lines 20-50
    expect(detail.lineOverlapDetails![0].overlapSeverity).toBe("severe");
    expect(detail.overlapSeverity).toBe("severe");
    expect(result.overlapSeverity).toBe("severe");
  });

  it("cross-branch without line overlap → Proximity (not Merge Hell)", () => {
    const alice = makeSession({
      userId: "alice",
      repo: "org/repo",
      branch: "main",
      files: ["src/index.ts"],
      fileChanges: [
        { path: "src/index.ts", lineRanges: [{ startLine: 1, endLine: 10 }] },
      ],
    });
    const bob = makeSession({
      userId: "bob",
      repo: "org/repo",
      branch: "feature/new-ui",
      files: ["src/index.ts"],
      fileChanges: [
        {
          path: "src/index.ts",
          lineRanges: [{ startLine: 200, endLine: 250 }],
        },
      ],
    });

    const result = evaluator.evaluate(alice, [alice, bob]);

    // Even though different branches, non-overlapping lines → Proximity
    expect(result.state).toBe(CollisionState.Proximity);
    expect(result.overlapSeverity).toBeUndefined();
  });

  it("multiple shared files, mixed overlap → highest severity wins", () => {
    const alice = makeSession({
      userId: "alice",
      repo: "org/repo",
      branch: "main",
      files: ["src/index.ts", "src/utils.ts"],
      fileChanges: [
        { path: "src/index.ts", lineRanges: [{ startLine: 1, endLine: 10 }] },
        { path: "src/utils.ts", lineRanges: [{ startLine: 50, endLine: 80 }] },
      ],
    });
    const bob = makeSession({
      userId: "bob",
      repo: "org/repo",
      branch: "main",
      files: ["src/index.ts", "src/utils.ts"],
      fileChanges: [
        // Non-overlapping on index.ts
        {
          path: "src/index.ts",
          lineRanges: [{ startLine: 100, endLine: 120 }],
        },
        // Overlapping on utils.ts (lines 60-90 overlaps with 50-80)
        { path: "src/utils.ts", lineRanges: [{ startLine: 60, endLine: 90 }] },
      ],
    });

    const result = evaluator.evaluate(alice, [alice, bob]);

    // One file overlaps → CollisionCourse (not Proximity)
    expect(result.state).toBe(CollisionState.CollisionCourse);

    const detail = result.overlappingDetails[0];
    expect(detail.lineOverlapDetails).toHaveLength(2);

    // index.ts: no overlap
    const indexDetail = detail.lineOverlapDetails!.find(
      (d) => d.file === "src/index.ts",
    )!;
    expect(indexDetail.lineOverlap).toBe(false);

    // utils.ts: overlap
    const utilsDetail = detail.lineOverlapDetails!.find(
      (d) => d.file === "src/utils.ts",
    )!;
    expect(utilsDetail.lineOverlap).toBe(true);
    expect(utilsDetail.overlappingLines).toBe(21); // lines 60-80
    expect(utilsDetail.overlapSeverity).toBe("severe");

    // Aggregate severity should be severe
    expect(detail.overlapSeverity).toBe("severe");
    expect(result.overlapSeverity).toBe("severe");
  });
});
