/**
 * CollisionEvaluator — pure function that computes collision state.
 *
 * Compares a querying user's work session against all other active sessions
 * in the same repository. Returns the highest applicable CollisionState
 * along with details about overlapping sessions, shared files, and shared
 * directories.
 */

import {
  CollisionState,
  SEVERITY,
  type ICollisionEvaluator,
  type WorkSession,
  type CollisionResult,
} from "./types.js";

/**
 * Extract the directory portion of a file path.
 * "src/utils/helpers.ts" → "src/utils"
 * "README.md" → ""  (root directory)
 */
function getDirectory(filePath: string): string {
  const lastSlash = filePath.lastIndexOf("/");
  return lastSlash === -1 ? "" : filePath.substring(0, lastSlash);
}

export class CollisionEvaluator implements ICollisionEvaluator {
  /**
   * Evaluate the collision state for a user session against all other
   * active sessions. The evaluator checks overlap levels from most severe
   * to least and returns the highest applicable state.
   *
   * @param userSession  The querying user's session
   * @param allSessions  All active sessions in the same repo (including the user's own)
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
        sharedFiles: [],
        sharedDirectories: [],
        actions: [],
      };
    }

    const userFiles = new Set(userSession.files);
    const userDirs = new Set(userSession.files.map(getDirectory));

    let highestState = CollisionState.Neighbors;
    const overlappingSessions: WorkSession[] = [];
    const sharedFilesSet = new Set<string>();
    const sharedDirsSet = new Set<string>();

    for (const other of otherSessions) {
      let sessionOverlap = CollisionState.Neighbors;

      // Check file-level overlap
      const commonFiles: string[] = [];
      for (const file of other.files) {
        if (userFiles.has(file)) {
          commonFiles.push(file);
        }
      }

      if (commonFiles.length > 0) {
        // Same files — check branch to distinguish Collision Course vs Merge Hell
        for (const f of commonFiles) {
          sharedFilesSet.add(f);
        }

        if (other.branch !== userSession.branch) {
          sessionOverlap = CollisionState.MergeHell;
        } else {
          sessionOverlap = CollisionState.CollisionCourse;
        }
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
          sessionOverlap = CollisionState.Crossroads;
          for (const d of commonDirs) {
            sharedDirsSet.add(d);
          }
        }
      }

      // Track this session if it contributes any overlap
      overlappingSessions.push(other);

      // Update highest state
      if (SEVERITY[sessionOverlap] > SEVERITY[highestState]) {
        highestState = sessionOverlap;
      }
    }

    // For Crossroads+, also populate shared directories from file-level overlaps
    if (
      SEVERITY[highestState] >= SEVERITY[CollisionState.CollisionCourse] &&
      sharedFilesSet.size > 0
    ) {
      for (const file of sharedFilesSet) {
        sharedDirsSet.add(getDirectory(file));
      }
    }

    return {
      state: highestState,
      queryingUser: userSession.userId,
      repo: userSession.repo,
      overlappingSessions,
      sharedFiles: [...sharedFilesSet],
      sharedDirectories: [...sharedDirsSet],
      actions: [],
    };
  }
}
