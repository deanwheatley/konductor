/**
 * Types for the QueryEngine — the read-only query layer that powers
 * Konductor's enhanced chat tools (who_is_active, who_overlaps, etc.).
 *
 * Requirements: 1.1, 1.2, 2.1, 2.2, 3.1, 3.2, 4.1, 4.2, 5.1, 5.3, 6.1, 6.2, 7.1, 7.3
 * GitHub Integration Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 */

import { CollisionState } from "./types.js";
import type { SessionSource, OverlapSeverity } from "./types.js";

// ---------------------------------------------------------------------------
// who_is_active
// ---------------------------------------------------------------------------

export interface ActiveUserInfo {
  userId: string;
  branch: string;
  files: string[];
  sessionDurationMinutes: number;
  /** Session source: "active", "github_pr", or "github_commit". Requirement 6.5 */
  source: SessionSource;
  /** PR number when source is github_pr */
  prNumber?: number;
  /** PR URL when source is github_pr */
  prUrl?: string;
  /** Whether the PR is a draft */
  prDraft?: boolean;
  /** Whether the PR is approved */
  prApproved?: boolean;
  /** Commit date range when source is github_commit */
  commitDateRange?: { earliest: string; latest: string };
}

export interface ActiveUsersResult {
  repo: string;
  users: ActiveUserInfo[];
  totalUsers: number;
}

// ---------------------------------------------------------------------------
// who_overlaps
// ---------------------------------------------------------------------------

export interface OverlapInfo {
  userId: string;
  branch: string;
  sharedFiles: string[];
  collisionState: CollisionState;
  /** Session source type. Requirement 6.1 */
  source: SessionSource;
  /** PR number when source is github_pr */
  prNumber?: number;
  /** PR URL when source is github_pr */
  prUrl?: string;
  /** PR target branch when source is github_pr */
  prTargetBranch?: string;
  /** Whether the PR is a draft */
  prDraft?: boolean;
  /** Whether the PR is approved */
  prApproved?: boolean;
  /** Commit date range when source is github_commit */
  commitDateRange?: { earliest: string; latest: string };
  /** Whether line ranges overlap on shared files. Requirement 4.1 */
  lineOverlap?: boolean | null;
  /** Aggregate merge severity when line data is available. Requirement 7.5 */
  overlapSeverity?: OverlapSeverity;
}

export interface OverlapResult {
  userId: string;
  repo: string;
  overlaps: OverlapInfo[];
  isAlone: boolean;
}

// ---------------------------------------------------------------------------
// user_activity
// ---------------------------------------------------------------------------

export interface UserSessionInfo {
  repo: string;
  branch: string;
  files: string[];
  sessionStartedAt: string;
  lastHeartbeat: string;
  /** Session source type */
  source: SessionSource;
  /** PR number when source is github_pr */
  prNumber?: number;
  /** PR URL when source is github_pr */
  prUrl?: string;
  /** Commit date range when source is github_commit */
  commitDateRange?: { earliest: string; latest: string };
}

export interface UserActivityResult {
  userId: string;
  sessions: UserSessionInfo[];
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// risk_assessment
// ---------------------------------------------------------------------------

export interface RiskResult {
  userId: string;
  repo: string;
  collisionState: CollisionState;
  severity: number; // 0–4
  overlappingUserCount: number;
  sharedFileCount: number;
  hasCrossBranchOverlap: boolean;
  riskSummary: string;
  /** Whether overlaps include PR sessions with approved status. Requirement 6.4 */
  hasApprovedPrOverlap: boolean;
  /** Number of distinct source types among overlapping sessions. Requirement 6.4 */
  sourceDiversity: number;
  /** Aggregate merge severity when line overlap data is available. Requirement 5.5 */
  overlapSeverity?: OverlapSeverity;
}

// ---------------------------------------------------------------------------
// repo_hotspots
// ---------------------------------------------------------------------------

export interface HotspotInfo {
  file: string;
  editors: Array<{ userId: string; branch: string; source: SessionSource }>;
  collisionState: CollisionState;
  /** Line ranges per editor when available. Requirement 4.5 */
  lineRanges?: Array<{ userId: string; ranges: Array<{ startLine: number; endLine: number }> }>;
}

export interface HotspotsResult {
  repo: string;
  hotspots: HotspotInfo[];
  isClear: boolean;
}

// ---------------------------------------------------------------------------
// active_branches
// ---------------------------------------------------------------------------

export interface BranchInfo {
  branch: string;
  users: string[];
  files: string[];
  hasOverlapWithOtherBranches: boolean;
  /** Source types present on this branch. Requirement 6.6 */
  sources: SessionSource[];
}

export interface BranchesResult {
  repo: string;
  branches: BranchInfo[];
}

// ---------------------------------------------------------------------------
// coordination_advice
// ---------------------------------------------------------------------------

export interface CoordinationTarget {
  userId: string;
  branch: string;
  sharedFiles: string[];
  urgency: "high" | "medium" | "low";
  suggestedAction: string;
  /** Source type of the overlapping session. Requirement 6.3 */
  source: SessionSource;
  /** PR number when source is github_pr */
  prNumber?: number;
  /** PR URL when source is github_pr */
  prUrl?: string;
}

export interface CoordinationResult {
  userId: string;
  repo: string;
  targets: CoordinationTarget[];
  hasUrgentTargets: boolean;
}

// ---------------------------------------------------------------------------
// QueryEngine interface
// ---------------------------------------------------------------------------

export interface IQueryEngine {
  whoIsActive(repo: string): Promise<ActiveUsersResult>;
  whoOverlaps(userId: string, repo: string): Promise<OverlapResult>;
  userActivity(userId: string): Promise<UserActivityResult>;
  riskAssessment(userId: string, repo: string): Promise<RiskResult>;
  repoHotspots(repo: string): Promise<HotspotsResult>;
  activeBranches(repo: string): Promise<BranchesResult>;
  coordinationAdvice(userId: string, repo: string): Promise<CoordinationResult>;
}
