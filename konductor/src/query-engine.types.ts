/**
 * Types for the QueryEngine — the read-only query layer that powers
 * Konductor's enhanced chat tools (who_is_active, who_overlaps, etc.).
 *
 * Requirements: 1.1, 1.2, 2.1, 2.2, 3.1, 3.2, 4.1, 4.2, 5.1, 5.3, 6.1, 6.2, 7.1, 7.3
 */

import { CollisionState } from "./types.js";

// ---------------------------------------------------------------------------
// who_is_active
// ---------------------------------------------------------------------------

export interface ActiveUserInfo {
  userId: string;
  branch: string;
  files: string[];
  sessionDurationMinutes: number;
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
}

// ---------------------------------------------------------------------------
// repo_hotspots
// ---------------------------------------------------------------------------

export interface HotspotInfo {
  file: string;
  editors: Array<{ userId: string; branch: string }>;
  collisionState: CollisionState;
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
