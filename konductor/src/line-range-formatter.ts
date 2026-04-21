/**
 * Line Range Formatter
 *
 * Display and serialization functions for line range data.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4
 */

import type { LineRange, FileChange } from "./types.js";

/**
 * Format a single line range for display.
 * - Single line: "line 10"
 * - Multi-line: "lines 10-25"
 */
export function formatLineRange(range: LineRange): string {
  if (range.startLine === range.endLine) {
    return `line ${range.startLine}`;
  }
  return `lines ${range.startLine}-${range.endLine}`;
}

/**
 * Format multiple line ranges for display.
 * Example: "lines 10-25, 40-50"
 */
export function formatLineRanges(ranges: LineRange[]): string {
  if (ranges.length === 0) {
    return "";
  }
  if (ranges.length === 1) {
    return formatLineRange(ranges[0]);
  }
  const parts = ranges.map((r) =>
    r.startLine === r.endLine ? `${r.startLine}` : `${r.startLine}-${r.endLine}`,
  );
  return `lines ${parts.join(", ")}`;
}

/**
 * Serialize FileChange[] to JSON string (round-trip safe).
 */
export function serializeFileChanges(changes: FileChange[]): string {
  return JSON.stringify(changes);
}

/**
 * Deserialize FileChange[] from JSON string with validation.
 * Throws if the JSON is invalid or doesn't match the expected shape.
 */
export function deserializeFileChanges(json: string): FileChange[] {
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new Error("Expected an array of FileChange objects");
  }
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) {
      throw new Error("Each FileChange must be an object");
    }
    if (typeof item.path !== "string" || item.path.length === 0) {
      throw new Error("Each FileChange must have a non-empty 'path' string");
    }
    if (item.lineRanges !== undefined) {
      if (!Array.isArray(item.lineRanges)) {
        throw new Error("lineRanges must be an array");
      }
      for (const lr of item.lineRanges) {
        if (
          typeof lr !== "object" ||
          lr === null ||
          typeof lr.startLine !== "number" ||
          typeof lr.endLine !== "number"
        ) {
          throw new Error("Each LineRange must have numeric startLine and endLine");
        }
        if (lr.startLine < 1 || lr.endLine < 1) {
          throw new Error("Line numbers must be >= 1");
        }
        if (lr.startLine > lr.endLine) {
          throw new Error("startLine must be <= endLine");
        }
      }
    }
  }
  return parsed as FileChange[];
}
