/**
 * CollisionEvaluator — pure function that computes collision state.
 *
 * Compares a querying user's work session against all other active sessions
 * in the same repository. Returns the highest applicable CollisionState
 * along with details about overlapping sessions, shared files, and shared
 * directories.
 *
 * Source-agnostic: file overlap detection is identical regardless of session
 * source (active, github_pr, github_commit). Source only affects severity
 * weighting and message formatting.
 *
 * Severity weighting (Requirements 3.4, 3.5):
 *   - Approved PR → escalate one level
 *   - Draft PR → de-escalate one level
 *   - PR targeting user's current branch → escalate one level
 *   - Adjustments never skip more than one level and are clamped to valid range
 */

import {
  CollisionState,
  SEVERITY,
  type ICollisionEvaluator,
  type WorkSession,
  type CollisionResult,
  type OverlappingSessionDetail,
  type SessionSource,
  type LineOverlapDetail,
  type OverlapSeverity,
  type FileChange,
} from "./types.js";
import {
  anyRangeOverlap,
  countOverlappingLines,
  totalLinesInRanges,
  computeOverlapSeverity,
} from "./line-range-utils.js";

/**
 * Extract the directory portion of a file path.
 * "src/utils/helpers.ts" → "src/utils"
 * "README.md" → ""  (root directory)
 */
function getDirectory(filePath: string): string {
  const lastSlash = filePath.lastIndexOf("/");
  return lastSlash === -1 ? "" : filePath.substring(0, lastSlash);
}

/** Ordered severity levels for clamping adjustments. */
const SEVERITY_ORDER: CollisionState[] = [
  CollisionState.Solo,
  CollisionState.Neighbors,
  CollisionState.Crossroads,
  CollisionState.Proximity,
  CollisionState.CollisionCourse,
  CollisionState.MergeHell,
];

/**
 * Adjust a collision severity level by a signed delta.
 * Clamps to valid range [Solo..MergeHell]. Never skips more than one level.
 */
function adjustSeverity(base: CollisionState, delta: number): CollisionState {
  const clamped = Math.max(-1, Math.min(1, delta));
  const idx = SEVERITY_ORDER.indexOf(base);
  const newIdx = Math.max(0, Math.min(SEVERITY_ORDER.length - 1, idx + clamped));
  return SEVERITY_ORDER[newIdx];
}

/**
 * Look up the FileChange entry for a given path in a session's fileChanges.
 * Returns undefined if the session has no fileChanges or no entry for that path.
 */
function getFileChange(session: WorkSession, path: string): FileChange | undefined {
  if (!session.fileChanges) return undefined;
  return session.fileChanges.find((fc) => fc.path === path);
}

/**
 * Compute the highest OverlapSeverity from a list of LineOverlapDetails.
 * Returns undefined if no details have a severity.
 */
function aggregateOverlapSeverity(details: LineOverlapDetail[]): OverlapSeverity | undefined {
  const order: Record<OverlapSeverity, number> = { minimal: 1, moderate: 2, severe: 3 };
  let highest: OverlapSeverity | undefined;
  for (const d of details) {
    if (d.overlapSeverity) {
      if (!highest || order[d.overlapSeverity] > order[highest]) {
        highest = d.overlapSeverity;
      }
    }
  }
  return highest;
}

export class CollisionEvaluator implements ICollisionEvaluator {
  /**
   * Evaluate the collision state for a user session against all other
   * sessions (active + passive). The evaluator checks overlap levels from
   * most severe to least and returns the highest applicable state.
   *
   * Source-agnostic: file overlap detection is identical regardless of
   * session source. Source only affects severity weighting.
   *
   * @param userSession  The querying user's session
   * @param allSessions  All sessions in the same repo (including the user's own)
   * @returns            CollisionResult with state, overlapping sessions, shared files/dirs
   */
  evaluate(
    userSession: WorkSession,
    allSessions: WorkSession[],
  ): CollisionResult {
    // Filter out the querying user's own session
    const otherSessions = allSessions.filter(
      (s) => s.sessionId !== userSession.sessionId,
    );

    // Base result for Solo state
    if (otherSessions.length === 0) {
      return {
        state: CollisionState.Solo,
        queryingUser: userSession.userId,
        repo: userSession.repo,
        overlappingSessions: [],
        overlappingDetails: [],
        sharedFiles: [],
        sharedDirectories: [],
        actions: [],
      };
    }

    const userFiles = new Set(userSession.files);
    const userDirs = new Set(userSession.files.map(getDirectory));

    let highestState = CollisionState.Neighbors;
    const overlappingSessions: WorkSession[] = [];
    const overlappingDetails: OverlappingSessionDetail[] = [];
    const sharedFilesSet = new Set<string>();
    const sharedDirsSet = new Set<string>();

    for (const other of otherSessions) {
      // --- Source-agnostic file overlap detection (Requirement 3.1) ---
      let baseOverlap = CollisionState.Neighbors;
      let sessionLineOverlapDetails: LineOverlapDetail[] | undefined;
      let sessionOverlapSeverity: OverlapSeverity | undefined;

      // Check file-level overlap
      const commonFiles: string[] = [];
      for (const file of other.files) {
        if (userFiles.has(file)) {
          commonFiles.push(file);
        }
      }

      if (commonFiles.length > 0) {
        for (const f of commonFiles) {
          sharedFilesSet.add(f);
        }

        // --- Line-level overlap detection (Requirements 3.1, 3.2, 3.3) ---
        const lineOverlapDetails: LineOverlapDetail[] = [];
        let allFilesHaveNonOverlappingRanges = true;

        for (const file of commonFiles) {
          const userFileChange = getFileChange(userSession, file);
          const otherFileChange = getFileChange(other, file);

          const userRanges = userFileChange?.lineRanges;
          const otherRanges = otherFileChange?.lineRanges;

          if (userRanges && userRanges.length > 0 && otherRanges && otherRanges.length > 0) {
            // Both have line ranges — check for overlap
            const hasOverlap = anyRangeOverlap(userRanges, otherRanges);
            if (hasOverlap) {
              allFilesHaveNonOverlappingRanges = false;
              const overlappingLines = countOverlappingLines(userRanges, otherRanges);
              const userTotal = totalLinesInRanges(userRanges);
              const otherTotal = totalLinesInRanges(otherRanges);
              const severity = computeOverlapSeverity(overlappingLines, userTotal, otherTotal);
              lineOverlapDetails.push({
                file,
                lineOverlap: true,
                userRanges,
                otherRanges,
                overlappingLines,
                overlapSeverity: severity,
              });
            } else {
              // Same file, different sections — no line overlap
              lineOverlapDetails.push({
                file,
                lineOverlap: false,
                userRanges,
                otherRanges,
                overlappingLines: 0,
                overlapSeverity: null,
              });
            }
          } else {
            // One or both lack line ranges — fallback (Req 3.3)
            allFilesHaveNonOverlappingRanges = false;
            lineOverlapDetails.push({
              file,
              lineOverlap: null,
              userRanges: userRanges ?? [],
              otherRanges: otherRanges ?? [],
              overlappingLines: 0,
              overlapSeverity: null,
            });
          }
        }

        // Determine base overlap state based on line-level analysis
        if (allFilesHaveNonOverlappingRanges && lineOverlapDetails.length > 0) {
          // All shared files have line ranges and none overlap → Proximity (Req 3.2)
          baseOverlap = CollisionState.Proximity;
        } else if (other.branch !== userSession.branch) {
          baseOverlap = CollisionState.MergeHell;
        } else {
          baseOverlap = CollisionState.CollisionCourse;
        }

        // Store line overlap details and aggregate severity for later attachment
        sessionLineOverlapDetails = lineOverlapDetails;
        sessionOverlapSeverity = aggregateOverlapSeverity(lineOverlapDetails);
      } else {
        // Check directory-level overlap
        const otherDirs = new Set(other.files.map(getDirectory));
        const commonDirs: string[] = [];
        for (const dir of otherDirs) {
          if (userDirs.has(dir)) {
            commonDirs.push(dir);
          }
        }

        if (commonDirs.length > 0) {
          baseOverlap = CollisionState.Crossroads;
          for (const d of commonDirs) {
            sharedDirsSet.add(d);
          }
        }
      }

      // --- Severity weighting for passive sessions (Requirements 3.4, 3.5) ---
      let adjustedOverlap: CollisionState = baseOverlap;

      if (other.source === "github_pr" && SEVERITY[baseOverlap] >= SEVERITY[CollisionState.Crossroads]) {
        if (other.prApproved) {
          // Approved PR → escalate one level (imminent merge)
          adjustedOverlap = adjustSeverity(baseOverlap, +1);
        } else if (other.prDraft) {
          // Draft PR → de-escalate one level (lower risk)
          adjustedOverlap = adjustSeverity(baseOverlap, -1);
        }

        // PR targeting user's current branch → escalate one level
        if (other.prTargetBranch === userSession.branch) {
          adjustedOverlap = adjustSeverity(adjustedOverlap, +1);
        }
      }

      // Track this session
      overlappingSessions.push(other);

      // Build source-attributed detail (Requirement 3.2, 3.3)
      const source: SessionSource = other.source ?? "active";
      const detail: OverlappingSessionDetail = {
        session: other,
        source,
        sharedFiles: commonFiles,
        severity: adjustedOverlap,
      };

      if (source === "github_pr") {
        detail.prNumber = other.prNumber;
        detail.prUrl = other.prUrl;
        detail.prTargetBranch = other.prTargetBranch;
        detail.prDraft = other.prDraft;
        detail.prApproved = other.prApproved;
      } else if (source === "github_commit") {
        detail.commitDateRange = other.commitDateRange;
      }

      // Attach line-level overlap details when available
      if (sessionLineOverlapDetails && sessionLineOverlapDetails.length > 0) {
        detail.lineOverlapDetails = sessionLineOverlapDetails;
        detail.overlapSeverity = sessionOverlapSeverity;
      }

      overlappingDetails.push(detail);

      // Update highest state using the adjusted overlap
      if (SEVERITY[adjustedOverlap] > SEVERITY[highestState]) {
        highestState = adjustedOverlap;
      }
    }

    // For Crossroads+, also populate shared directories from file-level overlaps
    if (
      SEVERITY[highestState] >= SEVERITY[CollisionState.Crossroads] &&
      sharedFilesSet.size > 0
    ) {
      for (const file of sharedFilesSet) {
        sharedDirsSet.add(getDirectory(file));
      }
    }

    // Compute aggregate overlapSeverity across all overlapping sessions
    const allLineDetails = overlappingDetails.flatMap(
      (d) => d.lineOverlapDetails ?? [],
    );
    const resultOverlapSeverity = aggregateOverlapSeverity(allLineDetails);

    return {
      state: highestState,
      queryingUser: userSession.userId,
      repo: userSession.repo,
      overlappingSessions,
      overlappingDetails,
      sharedFiles: [...sharedFilesSet],
      sharedDirectories: [...sharedDirsSet],
      actions: [],
      overlapSeverity: resultOverlapSeverity,
    };
  }
}
