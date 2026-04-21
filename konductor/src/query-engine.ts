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
import type { ISessionManager, ICollisionEvaluator, WorkSession, OverlapSeverity } from "./types.js";
import type { SessionSource } from "./types.js";
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
   * Includes passive session users with source attribution.
   * Requirements: 1.1, 1.2, 6.5
   */
  async whoIsActive(repo: string): Promise<ActiveUsersResult> {
    const sessions = await this.sessionManager.getActiveSessions(repo);
    const now = Date.now();

    const users: ActiveUserInfo[] = sessions.map((s) => {
      const source: SessionSource = s.source ?? "active";
      const info: ActiveUserInfo = {
        userId: s.userId,
        branch: s.branch,
        files: [...s.files],
        sessionDurationMinutes: Math.max(
          0,
          Math.floor((now - new Date(s.createdAt).getTime()) / 60000),
        ),
        source,
      };
      if (source === "github_pr") {
        info.prNumber = s.prNumber;
        info.prUrl = s.prUrl;
        info.prDraft = s.prDraft;
        info.prApproved = s.prApproved;
      } else if (source === "github_commit") {
        info.commitDateRange = s.commitDateRange;
      }
      return info;
    });

    return {
      repo,
      users,
      totalUsers: users.length,
    };
  }

  /**
   * Find users whose files overlap with a specific user's session.
   * Includes source type and metadata per overlap.
   * Includes line-level overlap context when available.
   * Requirements: 2.1, 2.2, 2.4, 4.1, 6.1, 7.5
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

      // Compute line-level overlap context when both sessions have fileChanges
      let lineOverlap: boolean | null | undefined;
      let overlapSeverity: OverlapSeverity | undefined;

      if (userSession.fileChanges && other.fileChanges) {
        const { anyRangeOverlap, countOverlappingLines, totalLinesInRanges, computeOverlapSeverity } = await import("./line-range-utils.js");

        let hasAnyLineOverlap = false;
        let allHaveRanges = true;
        let maxSeverity: OverlapSeverity | undefined;
        const severityOrder: Record<OverlapSeverity, number> = { minimal: 1, moderate: 2, severe: 3 };

        for (const file of sharedFiles) {
          const userFC = userSession.fileChanges.find((fc) => fc.path === file);
          const otherFC = other.fileChanges.find((fc) => fc.path === file);
          const userRanges = userFC?.lineRanges;
          const otherRanges = otherFC?.lineRanges;

          if (userRanges && userRanges.length > 0 && otherRanges && otherRanges.length > 0) {
            if (anyRangeOverlap(userRanges, otherRanges)) {
              hasAnyLineOverlap = true;
              const overlappingLines = countOverlappingLines(userRanges, otherRanges);
              const userTotal = totalLinesInRanges(userRanges);
              const otherTotal = totalLinesInRanges(otherRanges);
              const sev = computeOverlapSeverity(overlappingLines, userTotal, otherTotal);
              if (!maxSeverity || severityOrder[sev] > severityOrder[maxSeverity]) {
                maxSeverity = sev;
              }
            }
          } else {
            allHaveRanges = false;
          }
        }

        if (!allHaveRanges) {
          lineOverlap = null; // Some files lack line data
        } else {
          lineOverlap = hasAnyLineOverlap;
        }
        overlapSeverity = maxSeverity;
      }

      const source: SessionSource = other.source ?? "active";
      const overlap: OverlapInfo = {
        userId: other.userId,
        branch: other.branch,
        sharedFiles,
        collisionState,
        source,
      };

      // Only include line-level fields when line data is available (Req 7.5)
      if (lineOverlap !== undefined) {
        overlap.lineOverlap = lineOverlap;
      }
      if (overlapSeverity !== undefined) {
        overlap.overlapSeverity = overlapSeverity;
      }

      if (source === "github_pr") {
        overlap.prNumber = other.prNumber;
        overlap.prUrl = other.prUrl;
        overlap.prTargetBranch = other.prTargetBranch;
        overlap.prDraft = other.prDraft;
        overlap.prApproved = other.prApproved;
      } else if (source === "github_commit") {
        overlap.commitDateRange = other.commitDateRange;
      }

      overlaps.push(overlap);
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
   * Includes passive sessions (PR and commit) with source attribution.
   * Requirements: 3.1, 3.2, 3.3
   */
  async userActivity(userId: string): Promise<UserActivityResult> {
    const allSessions = await this.getAllSessions();
    const userSessions = allSessions.filter((s) => s.userId === userId);

    const sessions: UserSessionInfo[] = userSessions.map((s) => {
      const source: SessionSource = s.source ?? "active";
      const info: UserSessionInfo = {
        repo: s.repo,
        branch: s.branch,
        files: [...s.files],
        sessionStartedAt: s.createdAt,
        lastHeartbeat: s.lastHeartbeat,
        source,
      };
      if (source === "github_pr") {
        info.prNumber = s.prNumber;
        info.prUrl = s.prUrl;
      } else if (source === "github_commit") {
        info.commitDateRange = s.commitDateRange;
      }
      return info;
    });

    return {
      userId,
      sessions,
      isActive: sessions.length > 0,
    };
  }

  /**
   * Compute collision risk score for a user in a repo.
   * Factors in PR review status and source diversity.
   * Requirements: 4.1, 4.2, 6.4
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
        hasApprovedPrOverlap: false,
        sourceDiversity: 0,
      };
    }

    const result = this.collisionEvaluator.evaluate(userSession, sessions);
    const severity = SEVERITY[result.state];

    const userFiles = new Set(userSession.files);
    const sharedFilesSet = new Set<string>();
    let hasCrossBranch = false;
    let hasApprovedPr = false;
    const overlappingUserIds = new Set<string>();
    const sourceTypes = new Set<SessionSource>();

    for (const other of sessions) {
      if (other.sessionId === userSession.sessionId) continue;
      const shared = other.files.filter((f) => userFiles.has(f));
      if (shared.length > 0) {
        overlappingUserIds.add(other.userId);
        for (const f of shared) sharedFilesSet.add(f);
        if (other.branch !== userSession.branch) hasCrossBranch = true;
        const source: SessionSource = other.source ?? "active";
        sourceTypes.add(source);
        if (source === "github_pr" && other.prApproved) hasApprovedPr = true;
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

    if (hasApprovedPr) {
      riskSummary += " An approved PR is pending merge.";
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
      hasApprovedPrOverlap: hasApprovedPr,
      sourceDiversity: sourceTypes.size,
      overlapSeverity: result.overlapSeverity,
    };
  }

  /**
   * Rank files by collision risk (number of concurrent editors).
   * Includes passive session files with source attribution.
   * Includes line range info per editor when available.
   * Requirements: 5.1, 5.2, 5.3, 5.4, 4.5, 6.2
   */
  async repoHotspots(repo: string): Promise<HotspotsResult> {
    const sessions = await this.sessionManager.getActiveSessions(repo);

    // Build file → editors map (with source)
    const fileEditors = new Map<string, Array<{ userId: string; branch: string; source: SessionSource }>>();
    // Build file → line ranges per editor
    const fileLineRanges = new Map<string, Array<{ userId: string; ranges: Array<{ startLine: number; endLine: number }> }>>();

    for (const s of sessions) {
      const source: SessionSource = s.source ?? "active";
      for (const file of s.files) {
        if (!fileEditors.has(file)) fileEditors.set(file, []);
        fileEditors.get(file)!.push({ userId: s.userId, branch: s.branch, source });

        // Collect line ranges when available
        if (s.fileChanges) {
          const fc = s.fileChanges.find((c) => c.path === file);
          if (fc?.lineRanges && fc.lineRanges.length > 0) {
            if (!fileLineRanges.has(file)) fileLineRanges.set(file, []);
            fileLineRanges.get(file)!.push({ userId: s.userId, ranges: fc.lineRanges });
          }
        }
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

      const hotspot: HotspotInfo = { file, editors, collisionState };

      // Include line ranges when available (Req 4.5)
      const ranges = fileLineRanges.get(file);
      if (ranges && ranges.length > 0) {
        hotspot.lineRanges = ranges;
      }

      hotspots.push(hotspot);
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
   * Includes branches with PR/commit activity even if no active session exists.
   * Requirements: 6.1, 6.2, 6.3, 6.6
   */
  async activeBranches(repo: string): Promise<BranchesResult> {
    const sessions = await this.sessionManager.getActiveSessions(repo);

    // Group by branch
    const branchMap = new Map<string, { users: Set<string>; files: Set<string>; sources: Set<SessionSource> }>();
    for (const s of sessions) {
      if (!branchMap.has(s.branch)) {
        branchMap.set(s.branch, { users: new Set(), files: new Set(), sources: new Set() });
      }
      const entry = branchMap.get(s.branch)!;
      entry.users.add(s.userId);
      entry.sources.add(s.source ?? "active");
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
        sources: [...data.sources],
      };
    });

    return { repo, branches };
  }

  /**
   * Suggest who to coordinate with, ranked by urgency.
   * Distinguishes "review their PR" vs "talk to them" vs "check their commits".
   * Requirements: 7.1, 7.2, 7.3, 6.3
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
      const source: SessionSource = other.source ?? "active";

      if (sharedFiles.length > 0) {
        // File-level overlap
        const suggestedAction = this.getCoordinationAction(source, other, userSession);
        if (other.branch !== userSession.branch) {
          const target: CoordinationTarget = {
            userId: other.userId,
            branch: other.branch,
            sharedFiles,
            urgency: "high",
            suggestedAction,
            source,
          };
          if (source === "github_pr") {
            target.prNumber = other.prNumber;
            target.prUrl = other.prUrl;
          }
          targets.push(target);
        } else {
          const target: CoordinationTarget = {
            userId: other.userId,
            branch: other.branch,
            sharedFiles,
            urgency: "medium",
            suggestedAction,
            source,
          };
          if (source === "github_pr") {
            target.prNumber = other.prNumber;
            target.prUrl = other.prUrl;
          }
          targets.push(target);
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
            source,
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
   * Generate source-aware coordination action text.
   * Requirement 6.3: "review their PR" vs "talk to them" vs "check their commits"
   */
  private getCoordinationAction(
    source: SessionSource,
    other: WorkSession,
    userSession: WorkSession,
  ): string {
    const crossBranch = other.branch !== userSession.branch;
    if (source === "github_pr") {
      const prRef = other.prNumber ? ` PR #${other.prNumber}` : " their PR";
      if (other.prApproved) {
        return `Review${prRef} urgently — it's approved and merge is imminent.`;
      }
      return `Review${prRef} — it modifies files you're working on.`;
    }
    if (source === "github_commit") {
      return `Check their recent commits — they pushed changes to files you're editing.`;
    }
    // Active session
    if (crossBranch) {
      return "Merge before pushing — you're editing the same files on different branches.";
    }
    return "Sync on file ownership — you're both editing the same files.";
  }

  /**
   * Get all non-stale sessions across all repos.
   * Delegates to SessionManager.getAllActiveSessions().
   */
  private async getAllSessions(): Promise<WorkSession[]> {
    return this.sessionManager.getAllActiveSessions();
  }
}
