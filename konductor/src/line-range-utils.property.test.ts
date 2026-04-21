/**
 * Property-Based Tests for Line Range Utilities
 *
 * Uses fast-check to verify correctness properties from the design document.
 *
 * Requirements: 3.1, 5.1, 5.2, 6.1, 6.2, 6.4
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  rangesOverlap,
  anyRangeOverlap,
  countOverlappingLines,
  computeOverlapSeverity,
  totalLinesInRanges,
} from "./line-range-utils.js";
import {
  formatLineRange,
  serializeFileChanges,
  deserializeFileChanges,
} from "./line-range-formatter.js";
import type { LineRange, FileChange } from "./types.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** A valid LineRange with startLine <= endLine, both >= 1. */
const lineRangeArb: fc.Arbitrary<LineRange> = fc
  .tuple(fc.integer({ min: 1, max: 1000 }), fc.integer({ min: 0, max: 200 }))
  .map(([start, extra]) => ({ startLine: start, endLine: start + extra }));

/** An array of 1-5 line ranges. */
const lineRangesArb: fc.Arbitrary<LineRange[]> = fc.array(lineRangeArb, { minLength: 1, maxLength: 5 });

/** A valid file path string. */
const filePathArb = fc.stringMatching(/^[a-zA-Z0-9/_.-]{1,50}$/);

/** A valid FileChange object. */
const fileChangeArb: fc.Arbitrary<FileChange> = fc.record({
  path: filePathArb,
  lineRanges: fc.option(fc.array(lineRangeArb, { minLength: 0, maxLength: 5 }), { nil: undefined }),
});

// ---------------------------------------------------------------------------
// Property 1: Line range overlap detection is symmetric
// **Feature: konductor-line-level-collision, Property 1: Line range overlap detection is symmetric**
// **Validates: Requirement 3.1**
// ---------------------------------------------------------------------------

describe("Line Range Overlap Symmetry — Property Tests", () => {
  /**
   * **Feature: konductor-line-level-collision, Property 1: Line range overlap detection is symmetric**
   * **Validates: Requirement 3.1**
   *
   * For any two sets of line ranges A and B, anyRangeOverlap(A, B) SHALL
   * return the same result as anyRangeOverlap(B, A).
   */
  it("Property 1: anyRangeOverlap(A, B) === anyRangeOverlap(B, A)", () => {
    fc.assert(
      fc.property(lineRangesArb, lineRangesArb, (rangesA, rangesB) => {
        expect(anyRangeOverlap(rangesA, rangesB)).toBe(anyRangeOverlap(rangesB, rangesA));
      }),
      { numRuns: 100 },
    );
  });

  it("Property 1 (cont.): rangesOverlap(a, b) === rangesOverlap(b, a) for single ranges", () => {
    fc.assert(
      fc.property(lineRangeArb, lineRangeArb, (a, b) => {
        expect(rangesOverlap(a, b)).toBe(rangesOverlap(b, a));
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: Overlapping line count is correct
// **Feature: konductor-line-level-collision, Property 4: Overlapping line count is correct**
// **Validates: Requirement 5.1**
// ---------------------------------------------------------------------------

describe("Overlapping Line Count Correctness — Property Tests", () => {
  /**
   * **Feature: konductor-line-level-collision, Property 4: Overlapping line count is correct**
   * **Validates: Requirement 5.1**
   *
   * For any two sets of line ranges, countOverlappingLines(A, B) SHALL equal
   * the cardinality of the set intersection of line numbers covered by A and B.
   */
  it("Property 4: countOverlappingLines equals set intersection cardinality", () => {
    fc.assert(
      fc.property(lineRangesArb, lineRangesArb, (rangesA, rangesB) => {
        const linesA = new Set<number>();
        for (const r of rangesA) {
          for (let i = r.startLine; i <= r.endLine; i++) linesA.add(i);
        }
        const linesB = new Set<number>();
        for (const r of rangesB) {
          for (let i = r.startLine; i <= r.endLine; i++) linesB.add(i);
        }
        const intersection = [...linesA].filter((l) => linesB.has(l));
        expect(countOverlappingLines(rangesA, rangesB)).toBe(intersection.length);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 4 (cont.): countOverlappingLines is symmetric", () => {
    fc.assert(
      fc.property(lineRangesArb, lineRangesArb, (rangesA, rangesB) => {
        expect(countOverlappingLines(rangesA, rangesB)).toBe(
          countOverlappingLines(rangesB, rangesA),
        );
      }),
      { numRuns: 100 },
    );
  });
});


// ---------------------------------------------------------------------------
// Property 5: Overlap severity thresholds are correctly applied
// **Feature: konductor-line-level-collision, Property 5: Overlap severity thresholds are correctly applied**
// **Validates: Requirement 5.2**
// ---------------------------------------------------------------------------

describe("Overlap Severity Thresholds — Property Tests", () => {
  /**
   * **Feature: konductor-line-level-collision, Property 5: Overlap severity thresholds are correctly applied**
   * **Validates: Requirement 5.2**
   *
   * For any overlap count N:
   * - N in [1,5] → minimal
   * - N in [6,20] → moderate
   * - N >= 21 → severe
   * Additionally, if overlap > 50% of either user's total → severe regardless.
   */
  it("Property 5: severity thresholds match specification", () => {
    const severityInputArb = fc.tuple(
      fc.integer({ min: 1, max: 200 }), // overlappingLines
      fc.integer({ min: 1, max: 500 }), // userTotalLines
      fc.integer({ min: 1, max: 500 }), // otherTotalLines
    );

    fc.assert(
      fc.property(severityInputArb, ([overlapping, userTotal, otherTotal]) => {
        const result = computeOverlapSeverity(overlapping, userTotal, otherTotal);

        const userPct = overlapping / userTotal;
        const otherPct = overlapping / otherTotal;

        if (userPct > 0.5 || otherPct > 0.5) {
          expect(result).toBe("severe");
        } else if (overlapping >= 21) {
          expect(result).toBe("severe");
        } else if (overlapping >= 6) {
          expect(result).toBe("moderate");
        } else {
          expect(result).toBe("minimal");
        }
      }),
      { numRuns: 100 },
    );
  });

  it("Property 5 (cont.): zero overlapping lines returns minimal", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500 }),
        fc.integer({ min: 1, max: 500 }),
        (userTotal, otherTotal) => {
          expect(computeOverlapSeverity(0, userTotal, otherTotal)).toBe("minimal");
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 6: FileChange serialization round-trip
// **Feature: konductor-line-level-collision, Property 6: FileChange serialization round-trip**
// **Validates: Requirements 6.1, 6.2**
// ---------------------------------------------------------------------------

describe("FileChange Serialization Round-Trip — Property Tests", () => {
  /**
   * **Feature: konductor-line-level-collision, Property 6: FileChange serialization round-trip**
   * **Validates: Requirements 6.1, 6.2**
   *
   * For any valid FileChange[], serializing to JSON and deserializing back
   * SHALL produce an equivalent array.
   */
  it("Property 6: serialize then deserialize produces equivalent FileChange[]", () => {
    fc.assert(
      fc.property(fc.array(fileChangeArb, { minLength: 1, maxLength: 5 }), (changes) => {
        const serialized = serializeFileChanges(changes);
        const deserialized = deserializeFileChanges(serialized);
        expect(deserialized).toEqual(changes);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: Single-line range formatting
// **Feature: konductor-line-level-collision, Property 7: Single-line range formatting**
// **Validates: Requirement 6.4**
// ---------------------------------------------------------------------------

describe("Single-Line Range Formatting — Property Tests", () => {
  /**
   * **Feature: konductor-line-level-collision, Property 7: Single-line range formatting**
   * **Validates: Requirement 6.4**
   *
   * For any LineRange where startLine === endLine, formatLineRange() SHALL
   * return "line N" (singular). For startLine < endLine, it SHALL return
   * "lines N-M" (plural).
   */
  it("Property 7: single-line ranges use singular, multi-line use plural", () => {
    fc.assert(
      fc.property(lineRangeArb, (range) => {
        const result = formatLineRange(range);
        if (range.startLine === range.endLine) {
          expect(result).toBe(`line ${range.startLine}`);
        } else {
          expect(result).toBe(`lines ${range.startLine}-${range.endLine}`);
        }
      }),
      { numRuns: 100 },
    );
  });
});
