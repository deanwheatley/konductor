/**
 * Line Range Utility Functions
 *
 * Core helpers for line-level collision detection: overlap checking,
 * line counting, and severity computation.
 *
 * Requirements: 3.1, 5.1, 5.2
 */

import type { LineRange, OverlapSeverity } from "./types.js";

/**
 * Check if two line ranges overlap (non-empty intersection).
 * Both ranges are 1-indexed, inclusive.
 */
export function rangesOverlap(a: LineRange, b: LineRange): boolean {
  return a.startLine <= b.endLine && b.startLine <= a.endLine;
}

/**
 * Check if any range in set A overlaps with any range in set B.
 */
export function anyRangeOverlap(rangesA: LineRange[], rangesB: LineRange[]): boolean {
  for (const a of rangesA) {
    for (const b of rangesB) {
      if (rangesOverlap(a, b)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Count the number of distinct overlapping line numbers between two range sets.
 */
export function countOverlappingLines(rangesA: LineRange[], rangesB: LineRange[]): number {
  const linesA = new Set<number>();
  for (const r of rangesA) {
    for (let i = r.startLine; i <= r.endLine; i++) {
      linesA.add(i);
    }
  }
  const linesB = new Set<number>();
  for (const r of rangesB) {
    for (let i = r.startLine; i <= r.endLine; i++) {
      linesB.add(i);
    }
  }
  let count = 0;
  for (const line of linesB) {
    if (linesA.has(line)) {
      count++;
    }
  }
  return count;
}

/**
 * Sum the total number of lines across all ranges.
 */
export function totalLinesInRanges(ranges: LineRange[]): number {
  let total = 0;
  for (const r of ranges) {
    total += r.endLine - r.startLine + 1;
  }
  return total;
}

/**
 * Compute overlap severity from line counts and percentages.
 *
 * Thresholds (Requirement 5.2):
 * - minimal: 1–5 overlapping lines
 * - moderate: 6–20 overlapping lines
 * - severe: 21+ overlapping lines OR >50% of either user's changes
 */
export function computeOverlapSeverity(
  overlappingLines: number,
  userTotalLines: number,
  otherTotalLines: number,
): OverlapSeverity {
  if (overlappingLines <= 0) {
    return "minimal";
  }

  // Check percentage threshold first — >50% of either user's changes → severe
  const userPct = userTotalLines > 0 ? overlappingLines / userTotalLines : 0;
  const otherPct = otherTotalLines > 0 ? overlappingLines / otherTotalLines : 0;
  if (userPct > 0.5 || otherPct > 0.5) {
    return "severe";
  }

  if (overlappingLines >= 21) {
    return "severe";
  }
  if (overlappingLines >= 6) {
    return "moderate";
  }
  return "minimal";
}
