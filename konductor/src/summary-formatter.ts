/**
 * SummaryFormatter — produces deterministic human-readable summaries
 * from CollisionResult data, with round-trip parseability.
 *
 * Machine-readable format (first line):
 *   [STATE] repo:owner/repo | user:alice | overlaps:bob,carol | files:src/index.ts,src/utils.ts | dirs:src/
 *
 * Source-attributed context lines (appended when overlappingDetails present):
 *   🟠 bob is actively editing src/index.ts on feature-y (live session)
 *   🟠 carol's PR #42 (github.com/org/app/pull/42) modifies src/index.ts, targeting main
 *
 * For Solo state, overlaps/files/dirs segments and context lines are omitted.
 */

import {
  CollisionState,
  SEVERITY,
  type ISummaryFormatter,
  type CollisionResult,
  type OverlappingSessionDetail,
  type WorkSession,
  type OverlapSeverity,
} from "./types.js";
import { formatLineRanges } from "./line-range-formatter.js";

/** Display labels for collision states. */
const STATE_LABELS: Record<CollisionState, string> = {
  [CollisionState.Solo]: "SOLO",
  [CollisionState.Neighbors]: "NEIGHBORS",
  [CollisionState.Crossroads]: "CROSSROADS",
  [CollisionState.Proximity]: "PROXIMITY",
  [CollisionState.CollisionCourse]: "COLLISION_COURSE",
  [CollisionState.MergeHell]: "MERGE_HELL",
};

/** Reverse lookup from label to CollisionState. */
const LABEL_TO_STATE: Record<string, CollisionState> = Object.fromEntries(
  Object.entries(STATE_LABELS).map(([state, label]) => [label, state as CollisionState]),
) as Record<string, CollisionState>;

export class SummaryFormatter implements ISummaryFormatter {
  /**
   * Format a CollisionResult into a deterministic summary string.
   * Segments are always emitted in the same order. Lists are sorted
   * alphabetically to ensure determinism.
   *
   * When overlappingDetails are present, source-attributed context lines
   * are appended after the machine-readable header line.
   */
  format(result: CollisionResult): string {
    const parts: string[] = [];

    // State tag
    parts.push(`[${STATE_LABELS[result.state]}]`);

    // Repo
    parts.push(`repo:${result.repo}`);

    // Querying user
    parts.push(`user:${result.queryingUser}`);

    // Overlapping users (sorted, deduplicated)
    if (result.overlappingSessions.length > 0) {
      const users = [...new Set(result.overlappingSessions.map((s) => s.userId))].sort();
      parts.push(`overlaps:${users.join(",")}`);
    }

    // Shared files (sorted)
    if (result.sharedFiles.length > 0) {
      const files = [...result.sharedFiles].sort();
      parts.push(`files:${files.join(",")}`);
    }

    // Shared directories (sorted)
    if (result.sharedDirectories.length > 0) {
      const dirs = [...result.sharedDirectories].sort();
      parts.push(`dirs:${dirs.join(",")}`);
    }

    let output = parts.join(" | ");

    // Append source-attributed context lines when details are available
    if (result.overlappingDetails.length > 0) {
      // Sort details by userId for determinism
      const sortedDetails = [...result.overlappingDetails].sort((a, b) =>
        a.session.userId.localeCompare(b.session.userId),
      );

      for (const detail of sortedDetails) {
        output += "\n  " + this.formatDetailLine(detail, result.state);
      }
    }

    return output;
  }

  /**
   * Format a single overlapping session detail into a source-attributed
   * context line per Requirements 4.1–4.7.
   *
   * When lineOverlapDetails are present, appends line-level context:
   * - lineOverlap: true → "same lines" context with ranges (Req 4.1)
   * - lineOverlap: false → "different sections" context (Req 4.2)
   * - lineOverlap: null or no data → existing message unchanged (Req 4.3)
   */
  formatDetailLine(detail: OverlappingSessionDetail, overallState: CollisionState): string {
    const user = detail.session.userId;
    const files = detail.sharedFiles.length > 0
      ? detail.sharedFiles.sort().join(", ")
      : detail.session.files.sort().join(", ");

    let baseLine: string;

    switch (detail.source) {
      case "github_pr": {
        if (detail.prApproved) {
          // Requirement 4.3: approved PR
          baseLine = `🔴 Critical — ${user}'s PR #${detail.prNumber} is approved and targets ${detail.prTargetBranch}. Merge is imminent.`;
          break;
        }
        if (detail.prDraft) {
          // Requirement 4.4: draft PR
          baseLine = `🟡 Heads up — ${user} has a draft PR #${detail.prNumber} touching ${files}. Low risk but worth tracking.`;
          break;
        }
        // Requirement 4.2: open PR
        baseLine = `🟠 Warning — ${user}'s PR #${detail.prNumber} (${detail.prUrl}) modifies ${files}, targeting ${detail.prTargetBranch}.`;
        break;
      }

      case "github_commit": {
        // Requirement 4.5: commits
        const dateRange = detail.commitDateRange
          ? `${detail.commitDateRange.earliest}–${detail.commitDateRange.latest}`
          : "recent";
        baseLine = `🟠 Warning — ${user} pushed commits to ${detail.session.branch} (${dateRange}) modifying ${files}.`;
        break;
      }

      default: {
        // Requirement 4.1: active session
        baseLine = `🟠 Warning — ${user} is actively editing ${files} on ${detail.session.branch}.`;
        break;
      }
    }

    // Append line-level context when available
    const lineContext = this.formatLineContext(detail);
    if (lineContext) {
      baseLine += ` ${lineContext}`;
    }

    // Append severity recommendation
    const severityRec = this.formatSeverityRecommendation(detail.overlapSeverity);
    if (severityRec) {
      baseLine += ` ${severityRec}`;
    }

    return baseLine;
  }

  /**
   * Format line-level context from lineOverlapDetails.
   * Returns empty string when no line data is available.
   *
   * Requirements: 4.1, 4.2, 4.3
   */
  private formatLineContext(detail: OverlappingSessionDetail): string {
    if (!detail.lineOverlapDetails || detail.lineOverlapDetails.length === 0) {
      return "";
    }

    const parts: string[] = [];
    for (const lod of detail.lineOverlapDetails) {
      if (lod.lineOverlap === true) {
        // Same lines — include range context
        const userRangesStr = formatLineRanges(lod.userRanges);
        const otherRangesStr = formatLineRanges(lod.otherRanges);
        parts.push(`[${lod.file}: same lines — your ${userRangesStr} ↔ their ${otherRangesStr}]`);
      } else if (lod.lineOverlap === false) {
        // Different sections
        const userRangesStr = formatLineRanges(lod.userRanges);
        const otherRangesStr = formatLineRanges(lod.otherRanges);
        parts.push(`[${lod.file}: different sections — your ${userRangesStr}, their ${otherRangesStr}]`);
      }
      // lineOverlap === null → no line data, no context appended
    }

    return parts.join(" ");
  }

  /**
   * Format severity recommendation text.
   *
   * Requirements: 5.3, 5.4
   */
  private formatSeverityRecommendation(severity: OverlapSeverity | undefined | null): string {
    if (!severity) return "";
    if (severity === "severe") return "High merge conflict risk. Coordinate immediately.";
    if (severity === "minimal") return "Minor overlap — likely a quick merge resolution.";
    return "";
  }

  /**
   * Format a Merge Hell result with cross-branch source explanation.
   * Used when the overall state is MergeHell and mixed sources are involved.
   * Requirement 4.7.
   */
  formatMergeHellContext(result: CollisionResult): string {
    if (result.state !== CollisionState.MergeHell) {
      return this.format(result);
    }

    let output = this.format(result);

    // Collect unique branches from overlapping sessions
    const branches = new Set<string>();
    branches.add(
      result.overlappingSessions.find((s) => s.userId === result.queryingUser)?.branch ??
      "unknown",
    );
    for (const detail of result.overlappingDetails) {
      branches.add(detail.session.branch);
      if (detail.source === "github_pr" && detail.prTargetBranch) {
        branches.add(detail.prTargetBranch);
      }
    }

    // Check if mixed sources are involved
    const sources = new Set(result.overlappingDetails.map((d) => d.source));
    if (sources.size > 1 || (sources.has("github_pr") || sources.has("github_commit"))) {
      const branchList = [...branches].sort().join(", ");
      output += `\n  ⚠️ Cross-branch conflict across ${branchList} — changes from live sessions, PRs, and/or commits overlap on shared files.`;
    }

    return output;
  }

  /**
   * Parse a summary string back into a CollisionResult.
   * Reconstructs the structured data from the deterministic format.
   * Handles both single-line (legacy) and multi-line (source-attributed) formats.
   *
   * Throws an Error if the summary string is malformed.
   */
  parse(summary: string): CollisionResult {
    // Split into header line and context lines
    const lines = summary.split("\n");
    const headerLine = lines[0];
    const segments = headerLine.split(" | ").map((s) => s.trim());

    if (segments.length < 3) {
      throw new Error(`Malformed summary: expected at least 3 segments, got ${segments.length}`);
    }

    // Parse state from [STATE] tag
    const stateMatch = segments[0].match(/^\[([A-Z_]+)\]$/);
    if (!stateMatch) {
      throw new Error(`Malformed summary: invalid state tag "${segments[0]}"`);
    }
    const stateLabel = stateMatch[1];
    const state = LABEL_TO_STATE[stateLabel];
    if (state === undefined) {
      throw new Error(`Malformed summary: unknown state "${stateLabel}"`);
    }

    // Build a map of key:value from remaining segments
    const kvMap = new Map<string, string>();
    for (let i = 1; i < segments.length; i++) {
      const colonIdx = segments[i].indexOf(":");
      if (colonIdx === -1) {
        throw new Error(`Malformed summary: segment "${segments[i]}" has no key:value format`);
      }
      const key = segments[i].substring(0, colonIdx);
      const value = segments[i].substring(colonIdx + 1);
      kvMap.set(key, value);
    }

    const repo = kvMap.get("repo");
    if (!repo) {
      throw new Error("Malformed summary: missing repo segment");
    }

    const queryingUser = kvMap.get("user");
    if (!queryingUser) {
      throw new Error("Malformed summary: missing user segment");
    }

    // Parse optional segments
    const overlapsStr = kvMap.get("overlaps") ?? "";
    const overlappingUserIds = overlapsStr ? overlapsStr.split(",") : [];

    const filesStr = kvMap.get("files") ?? "";
    const sharedFiles = filesStr ? filesStr.split(",") : [];

    const dirsStr = kvMap.get("dirs") ?? "";
    const sharedDirectories = dirsStr ? dirsStr.split(",") : [];

    // Reconstruct minimal WorkSession stubs for overlapping sessions
    const overlappingSessions: WorkSession[] = overlappingUserIds.map((userId) => ({
      sessionId: "",
      userId,
      repo,
      branch: "",
      files: [],
      createdAt: "",
      lastHeartbeat: "",
    }));

    return {
      state,
      queryingUser,
      repo,
      overlappingSessions,
      overlappingDetails: [],
      sharedFiles,
      sharedDirectories,
      actions: [],
    };
  }
}
