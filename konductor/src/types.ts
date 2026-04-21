/**
 * Shared types for the Konductor MCP Server.
 *
 * These interfaces and enums define the core data model used across
 * all components: SessionManager, CollisionEvaluator, SummaryFormatter,
 * ConfigManager, and PersistenceStore.
 */

// ---------------------------------------------------------------------------
// Line-Level Types
// ---------------------------------------------------------------------------

/** A contiguous range of lines (1-indexed, inclusive). */
export interface LineRange {
  startLine: number;
  endLine: number;
}

/** A file change with optional line-level detail. */
export interface FileChange {
  path: string;
  lineRanges?: LineRange[];
}

/** Merge severity based on overlap extent. */
export type OverlapSeverity = "minimal" | "moderate" | "severe";

/** Line-level overlap detail between two users on a shared file. */
export interface LineOverlapDetail {
  file: string;
  /** True if line ranges overlap, false if same file but different sections, null if no line data. */
  lineOverlap: boolean | null;
  userRanges: LineRange[];
  otherRanges: LineRange[];
  overlappingLines: number;
  overlapSeverity: OverlapSeverity | null;
}

// ---------------------------------------------------------------------------
// Collision State
// ---------------------------------------------------------------------------

export enum CollisionState {
  Solo = "solo",
  Neighbors = "neighbors",
  Crossroads = "crossroads",
  Proximity = "proximity",
  CollisionCourse = "collision_course",
  MergeHell = "merge_hell",
}

/** Numeric severity for ordering / comparison. */
export const SEVERITY: Record<CollisionState, number> = {
  [CollisionState.Solo]: 0,
  [CollisionState.Neighbors]: 1,
  [CollisionState.Crossroads]: 2,
  [CollisionState.Proximity]: 2.5,
  [CollisionState.CollisionCourse]: 3,
  [CollisionState.MergeHell]: 4,
};

// ---------------------------------------------------------------------------
// Work Session
// ---------------------------------------------------------------------------

export type SessionSource = "active" | "github_pr" | "github_commit";

export interface WorkSession {
  sessionId: string; // UUID v4
  userId: string;
  repo: string; // "owner/repo" format
  branch: string;
  files: string[]; // Relative paths, forward slashes
  createdAt: string; // ISO 8601
  lastHeartbeat: string; // ISO 8601
  // Line-level change data per file. When present, enables line-level collision detection.
  fileChanges?: FileChange[];
  // GitHub integration — optional passive session fields
  source?: SessionSource;
  prNumber?: number;
  prUrl?: string;
  prTargetBranch?: string;
  prDraft?: boolean;
  prApproved?: boolean;
  commitDateRange?: { earliest: string; latest: string };
}

// ---------------------------------------------------------------------------
// Collision Result
// ---------------------------------------------------------------------------

/**
 * Source-attributed detail for an overlapping session.
 * Extends the base WorkSession with collision-specific metadata.
 */
export interface OverlappingSessionDetail {
  session: WorkSession;
  /** Source type of the overlapping session */
  source: SessionSource;
  /** Files shared between the querying user and this session */
  sharedFiles: string[];
  /** Per-session collision severity (before aggregation) */
  severity: CollisionState;
  /** Line-level overlap details for shared files */
  lineOverlapDetails?: LineOverlapDetail[];
  /** Aggregate merge severity across all shared files */
  overlapSeverity?: OverlapSeverity;
  /** PR number (when source is github_pr) */
  prNumber?: number;
  /** PR URL (when source is github_pr) */
  prUrl?: string;
  /** PR target branch (when source is github_pr) */
  prTargetBranch?: string;
  /** Whether the PR is a draft (when source is github_pr) */
  prDraft?: boolean;
  /** Whether the PR is approved (when source is github_pr) */
  prApproved?: boolean;
  /** Commit date range (when source is github_commit) */
  commitDateRange?: { earliest: string; latest: string };
}

export interface CollisionResult {
  state: CollisionState;
  queryingUser: string;
  repo: string;
  overlappingSessions: WorkSession[];
  /** Source-attributed details for each overlapping session */
  overlappingDetails: OverlappingSessionDetail[];
  sharedFiles: string[];
  sharedDirectories: string[];
  actions: Action[];
  /** Aggregate merge severity across all overlapping sessions */
  overlapSeverity?: OverlapSeverity;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export interface Action {
  type: "warn" | "block" | "suggest_rebase";
  message: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface StateConfig {
  message: string;
  blockSubmissions?: boolean;
}

export interface KonductorConfig {
  heartbeatTimeoutSeconds: number; // Default: 300
  states: Record<CollisionState, StateConfig>;
  github?: GitHubConfig; // Optional GitHub integration config
}

// ---------------------------------------------------------------------------
// GitHub Configuration
// ---------------------------------------------------------------------------

export interface GitHubRepoConfig {
  repo: string; // "owner/repo" format
  commitBranches?: string[]; // Branches to poll for commits (default: all)
}

export interface GitHubConfig {
  tokenEnv: string; // Env var name holding the PAT (default: "GITHUB_TOKEN")
  pollIntervalSeconds: number; // Polling interval in seconds (default: 60)
  includeDrafts: boolean; // Whether to create sessions for draft PRs (default: true)
  commitLookbackHours: number; // How far back to look for commits (default: 24)
  repositories: GitHubRepoConfig[]; // Repos to monitor
}

// ---------------------------------------------------------------------------
// Component Interfaces
// ---------------------------------------------------------------------------

export interface ISessionManager {
  register(
    userId: string,
    repo: string,
    branch: string,
    files: string[],
    fileChanges?: FileChange[],
  ): Promise<WorkSession>;
  update(sessionId: string, files: string[]): Promise<WorkSession>;
  deregister(sessionId: string): Promise<boolean>;
  heartbeat(sessionId: string): Promise<WorkSession>;
  getActiveSessions(repo: string): Promise<WorkSession[]>;
  getAllActiveSessions(): Promise<WorkSession[]>;
  cleanupStale(): Promise<number>;
}

export interface ICollisionEvaluator {
  evaluate(
    userSession: WorkSession,
    allSessions: WorkSession[],
  ): CollisionResult;
}

export interface ISummaryFormatter {
  format(result: CollisionResult): string;
  parse(summary: string): CollisionResult;
}

export interface IConfigManager {
  load(configPath: string): Promise<KonductorConfig>;
  reload(): Promise<KonductorConfig>;
  getTimeout(): number;
  getStateActions(state: CollisionState): Action[];
  onConfigChange(callback: (config: KonductorConfig) => void): void;
}

export interface IPersistenceStore {
  save(sessions: WorkSession[]): Promise<void>;
  load(): Promise<WorkSession[]>;
}
