/**
 * SummaryFormatter — produces deterministic human-readable summaries
 * from CollisionResult data, with round-trip parseability.
 *
 * Format:
 *   [STATE] repo:owner/repo | user:alice | overlaps:bob,carol | files:src/index.ts,src/utils.ts | dirs:src/
 *
 * For Solo state, overlaps/files/dirs segments are omitted.
 */

import {
  CollisionState,
  SEVERITY,
  type ISummaryFormatter,
  type CollisionResult,
  type WorkSession,
} from "./types.js";

/** Display labels for collision states. */
const STATE_LABELS: Record<CollisionState, string> = {
  [CollisionState.Solo]: "SOLO",
  [CollisionState.Neighbors]: "NEIGHBORS",
  [CollisionState.Crossroads]: "CROSSROADS",
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

    return parts.join(" | ");
  }

  /**
   * Parse a summary string back into a CollisionResult.
   * Reconstructs the structured data from the deterministic format.
   *
   * Throws an Error if the summary string is malformed.
   */
  parse(summary: string): CollisionResult {
    const segments = summary.split(" | ").map((s) => s.trim());

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
      sharedFiles,
      sharedDirectories,
      actions: [],
    };
  }
}
