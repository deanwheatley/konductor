/**
 * QueryEngine — read-only query layer for Konductor's enhanced chat tools.
 *
 * Composes SessionManager, CollisionEvaluator, and ConfigManager to answer
 * natural language questions about repo activity, collision risk, and
 * coordination. All methods are pure reads — they never mutate session state.
 *
 * Requirements: 1.1, 1.2, 2.1, 2.2, 2.4, 3.1, 3.2, 3.3, 4.1, 4.2,
 *               5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 7.1, 7.2, 7.3
 */

import { CollisionState, SEVERITY } from "./types.js";
import type { ISessionManager, ICollisionEvaluator, WorkSession } from "./types.js";
import type {
  IQueryEngine,
  ActiveUsersResult,
  ActiveUserInfo,
  OverlapResult,
  OverlapInfo,
  UserActivityResult,
  UserSessionInfo,
  RiskResult,
  HotspotsResult,
  HotspotInfo,
  BranchesResult,
  BranchInfo,
  CoordinationResult,
  CoordinationTarget,
} from "./query-engine.types.js";

/**
 * Extract the directory portion of a file path.
 * "src/utils/helpers.ts" → "src/utils"
 * "README.md" → ""  (root directory)
 */
function getDirectory(filePath: string): string {
  const lastSlash = filePath.lastIndexOf("/");
  return lastSlash === -1 ? "" : filePath.substring(0, lastSlash);
}

export class QueryEngine implements IQueryEngine {
  private readonly sessionManager: ISessionManager;
  private readonly collisionEvaluator: ICollisionEvaluator;

  constructor(
    sessionManager: ISessionManager,
    collisionEvaluator: ICollisionEvaluator,
  ) {
    this.sessionManager = sessionManager;
    this.collisionEvaluator = collisionEvaluator;
  }

  /**
   * List all active users in a repo with their branch, files, and session duration.
   * Requirements: 1.1, 1.2
   */
  async whoIsActive(repo: string): Promise<ActiveUsersResult> {
    const sessions = await this.sessionManager.getActiveSessions(repo);
    const now = Date.now();

    const users: ActiveUserInfo[] = sessions.map((s) => ({
      userId: s.userId,
      branch: s.branch,
      files: [...s.files],
      sessionDurationMinutes: Math.max(
        0,
        Math.floor((now - new Date(s.createdAt).getTime()) / 60000),
      ),
    }));

    return {
      repo,
      users,
      totalUsers: users.length,
    };
  }

  /**
   * Find users whose files overlap with a specific user's session.
   * Requirements: 2.1, 2.2, 2.4
   */
  async whoOverlaps(userId: string, repo: string): Promise<OverlapResult> {
    const sessions = await this.sessionManager.getActiveSessions(repo);
    const userSession = sessions.find((s) => s.userId === userId);

    if (!userSession) {
      return { userId, repo, overlaps: [], isAlone: true };
    }

    const userFiles = new Set(userSession.files);
    const overlaps: OverlapInfo[] = [];

    for (const other of sessions) {
      if (other.sessionId === userSession.sessionId) continue;

      const sharedFiles = other.files.filter((f) => userFiles.has(f));
      if (sharedFiles.length === 0) continue;

      // Determine collision state for this specific overlap
      const collisionState =
        other.branch !== userSession.branch
          ? CollisionState.MergeHell
          : CollisionState.CollisionCourse;

      overlaps.push({
        userId: other.userId,
        branch: other.branch,
        sharedFiles,
        collisionState,
      });
    }

    return {
      userId,
      repo,
      overlaps,
      isAlone: overlaps.length === 0,
    };
  }

  /**
   * Show all active sessions for a user across all repos.
   * Requirements: 3.1, 3.2, 3.3
   */
  async userActivity(userId: string): Promise<UserActivityResult> {
    const allSessions = await this.getAllSessions();
    const userSessions = allSessions.filter((s) => s.userId === userId);

    const sessions: UserSessionInfo[] = userSessions.map((s) => ({
      repo: s.repo,
      branch: s.branch,
      files: [...s.files],
      sessionStartedAt: s.createdAt,
      lastHeartbeat: s.lastHeartbeat,
    }));

    return {
      userId,
      sessions,
      isActive: sessions.length > 0,
    };
  }

  /**
   * Compute collision risk score for a user in a repo.
   * Requirements: 4.1, 4.2
   */
  async riskAssessment(userId: string, repo: string): Promise<RiskResult> {
    const sessions = await this.sessionManager.getActiveSessions(repo);
    const userSession = sessions.find((s) => s.userId === userId);

    if (!userSession) {
      return {
        userId,
        repo,
        collisionState: CollisionState.Solo,
        severity: SEVERITY[CollisionState.Solo],
        overlappingUserCount: 0,
        sharedFileCount: 0,
        hasCrossBranchOverlap: false,
        riskSummary: "No active session — you're not registered in this repo.",
      };
    }

    const result = this.collisionEvaluator.evaluate(userSession, sessions);
    const severity = SEVERITY[result.state];

    const userFiles = new Set(userSession.files);
    const sharedFilesSet = new Set<string>();
    let hasCrossBranch = false;
    const overlappingUserIds = new Set<string>();

    for (const other of sessions) {
      if (other.sessionId === userSession.sessionId) continue;
      const shared = other.files.filter((f) => userFiles.has(f));
      if (shared.length > 0) {
        overlappingUserIds.add(other.userId);
        for (const f of shared) sharedFilesSet.add(f);
        if (other.branch !== userSession.branch) hasCrossBranch = true;
      }
    }

    const overlappingUserCount = overlappingUserIds.size;
    const sharedFileCount = sharedFilesSet.size;

    let riskSummary: string;
    if (severity === 0) {
      riskSummary = "No risk — you're the only one here.";
    } else if (severity <= 1) {
      riskSummary = `Low risk — ${sessions.length} user(s) in repo, no file overlap.`;
    } else if (severity <= 2) {
      riskSummary = `Moderate risk — ${overlappingUserCount} user(s) in the same directories.`;
    } else if (severity <= 3) {
      riskSummary = `High risk — ${overlappingUserCount} user(s) editing ${sharedFileCount} shared file(s) on the same branch.`;
    } else {
      riskSummary = `Critical risk — ${overlappingUserCount} user(s) editing ${sharedFileCount} shared file(s) on different branches.`;
    }

    return {
      userId,
      repo,
      collisionState: result.state,
      severity,
      overlappingUserCount,
      sharedFileCount,
      hasCrossBranchOverlap: hasCrossBranch,
      riskSummary,
    };
  }

  /**
   * Rank files by collision risk (number of concurrent editors).
   * Requirements: 5.1, 5.2, 5.3, 5.4
   */
  async repoHotspots(repo: string): Promise<HotspotsResult> {
    const sessions = await this.sessionManager.getActiveSessions(repo);

    // Build file → editors map
    const fileEditors = new Map<string, Array<{ userId: string; branch: string }>>();
    for (const s of sessions) {
      for (const file of s.files) {
        if (!fileEditors.has(file)) fileEditors.set(file, []);
        fileEditors.get(file)!.push({ userId: s.userId, branch: s.branch });
      }
    }

    // Only files with multiple editors are hotspots
    const hotspots: HotspotInfo[] = [];
    for (const [file, editors] of fileEditors) {
      if (editors.length < 2) continue;

      const branches = new Set(editors.map((e) => e.branch));
      const collisionState =
        branches.size > 1
          ? CollisionState.MergeHell
          : CollisionState.CollisionCourse;

      hotspots.push({ file, editors, collisionState });
    }

    // Sort descending by editor count
    hotspots.sort((a, b) => b.editors.length - a.editors.length);

    return {
      repo,
      hotspots,
      isClear: hotspots.length === 0,
    };
  }

  /**
   * List all branches with active sessions and flag cross-branch file overlap.
   * Requirements: 6.1, 6.2, 6.3
   */
  async activeBranches(repo: string): Promise<BranchesResult> {
    const sessions = await this.sessionManager.getActiveSessions(repo);

    // Group by branch
    const branchMap = new Map<string, { users: Set<string>; files: Set<string> }>();
    for (const s of sessions) {
      if (!branchMap.has(s.branch)) {
        branchMap.set(s.branch, { users: new Set(), files: new Set() });
      }
      const entry = branchMap.get(s.branch)!;
      entry.users.add(s.userId);
      for (const f of s.files) entry.files.add(f);
    }

    // Compute cross-branch overlap flags
    const branchEntries = [...branchMap.entries()];
    const branches: BranchInfo[] = branchEntries.map(([branch, data]) => {
      let hasOverlap = false;
      for (const [otherBranch, otherData] of branchEntries) {
        if (otherBranch === branch) continue;
        for (const file of data.files) {
          if (otherData.files.has(file)) {
            hasOverlap = true;
            break;
          }
        }
        if (hasOverlap) break;
      }

      return {
        branch,
        users: [...data.users],
        files: [...data.files],
        hasOverlapWithOtherBranches: hasOverlap,
      };
    });

    return { repo, branches };
  }

  /**
   * Suggest who to coordinate with, ranked by urgency.
   * Requirements: 7.1, 7.2, 7.3
   */
  async coordinationAdvice(userId: string, repo: string): Promise<CoordinationResult> {
    const sessions = await this.sessionManager.getActiveSessions(repo);
    const userSession = sessions.find((s) => s.userId === userId);

    if (!userSession) {
      return { userId, repo, targets: [], hasUrgentTargets: false };
    }

    const userFiles = new Set(userSession.files);
    const userDirs = new Set(userSession.files.map(getDirectory));
    const targets: CoordinationTarget[] = [];

    for (const other of sessions) {
      if (other.sessionId === userSession.sessionId) continue;

      const sharedFiles = other.files.filter((f) => userFiles.has(f));

      if (sharedFiles.length > 0) {
        // File-level overlap
        if (other.branch !== userSession.branch) {
          targets.push({
            userId: other.userId,
            branch: other.branch,
            sharedFiles,
            urgency: "high",
            suggestedAction: "Merge before pushing — you're editing the same files on different branches.",
          });
        } else {
          targets.push({
            userId: other.userId,
            branch: other.branch,
            sharedFiles,
            urgency: "medium",
            suggestedAction: "Sync on file ownership — you're both editing the same files.",
          });
        }
      } else {
        // Check directory-level overlap
        const otherDirs = new Set(other.files.map(getDirectory));
        const sharedDirs: string[] = [];
        for (const dir of otherDirs) {
          if (userDirs.has(dir)) sharedDirs.push(dir);
        }
        if (sharedDirs.length > 0) {
          targets.push({
            userId: other.userId,
            branch: other.branch,
            sharedFiles: sharedDirs,
            urgency: "low",
            suggestedAction: "Keep an eye on directory — you're working in the same area.",
          });
        }
      }
    }

    // Sort by urgency: high > medium > low
    const urgencyOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
    targets.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);

    return {
      userId,
      repo,
      targets,
      hasUrgentTargets: targets.some((t) => t.urgency === "high"),
    };
  }

  /**
   * Get all non-stale sessions across all repos.
   * Delegates to SessionManager.getAllActiveSessions().
   */
  private async getAllSessions(): Promise<WorkSession[]> {
    return this.sessionManager.getAllActiveSessions();
  }
}
