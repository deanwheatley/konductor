/**
 * Property-Based Tests for Query Engine — Line-Level Context
 *
 * Tests that the query engine correctly propagates line-level overlap
 * information through risk_assessment, who_overlaps, and repo_hotspots.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { QueryEngine } from "./query-engine.js";
import { CollisionEvaluator } from "./collision-evaluator.js";
import { CollisionState } from "./types.js";
import type { WorkSession, ISessionManager, LineRange, FileChange } from "./types.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const arbLineRange: fc.Arbitrary<LineRange> = fc
  .record({
    startLine: fc.integer({ min: 1, max: 500 }),
    span: fc.integer({ min: 0, max: 100 }),
  })
  .map(({ startLine, span }) => ({
    startLine,
    endLine: startLine + span,
  }));

const arbLineRanges: fc.Arbitrary<LineRange[]> = fc.array(arbLineRange, {
  minLength: 1,
  maxLength: 4,
});

const arbFilePath = fc
  .tuple(
    fc.stringMatching(/^[a-z]{1,8}$/),
    fc.stringMatching(/^[a-z0-9._-]{1,12}\.[a-z]{1,4}$/),
  )
  .map(([dir, file]) => `${dir}/${file}`);

function createSession(
  userId: string,
  repo: string,
  branch: string,
  files: string[],
  fileChanges?: FileChange[],
): WorkSession {
  const now = new Date().toISOString();
  return {
    sessionId: crypto.randomUUID(),
    userId,
    repo,
    branch,
    files,
    fileChanges,
    createdAt: now,
    lastHeartbeat: now,
  };
}

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

const collisionEvaluator = new CollisionEvaluator();

// ---------------------------------------------------------------------------
// Property 11: Merge severity is included in risk_assessment
// ---------------------------------------------------------------------------

describe("QueryEngine — Line-Level Property Tests", () => {
  /**
   * **Feature: konductor-line-level-collision, Property 11: Merge severity is included in risk_assessment**
   * **Validates: Requirement 5.5**
   *
   * For any risk_assessment query where line overlap exists between sessions,
   * the response SHALL include an overlapSeverity field with a valid value
   * (minimal, moderate, or severe).
   */
  it("Property 11: Merge severity is included in risk_assessment when line overlap exists", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbFilePath,
        arbLineRanges,
        arbLineRanges,
        async (sharedFile, userRanges, otherRanges) => {
          const repo = "test/repo";
          const branch = "main";

          // Import to check overlap
          const { anyRangeOverlap } = await import("./line-range-utils.js");
          const hasOverlap = anyRangeOverlap(userRanges, otherRanges);

          // Only test cases where there IS line overlap
          if (!hasOverlap) return;

          const userSession = createSession("alice", repo, branch, [sharedFile], [
            { path: sharedFile, lineRanges: userRanges },
          ]);
          const otherSession = createSession("bob", repo, branch, [sharedFile], [
            { path: sharedFile, lineRanges: otherRanges },
          ]);

          const sm = createStubSessionManager([userSession, otherSession]);
          const qe = new QueryEngine(sm, collisionEvaluator);

          const result = await qe.riskAssessment("alice", repo);

          // When line overlap exists, overlapSeverity MUST be present and valid
          expect(result.overlapSeverity).toBeDefined();
          expect(["minimal", "moderate", "severe"]).toContain(result.overlapSeverity);
        },
      ),
      { numRuns: 100 },
    );
  });
});
