/**
 * Shared types for the Konductor MCP Server.
 *
 * These interfaces and enums define the core data model used across
 * all components: SessionManager, CollisionEvaluator, SummaryFormatter,
 * ConfigManager, and PersistenceStore.
 */

// ---------------------------------------------------------------------------
// Collision State
// ---------------------------------------------------------------------------

export enum CollisionState {
  Solo = "solo",
  Neighbors = "neighbors",
  Crossroads = "crossroads",
  CollisionCourse = "collision_course",
  MergeHell = "merge_hell",
}

/** Numeric severity for ordering / comparison. */
export const SEVERITY: Record<CollisionState, number> = {
  [CollisionState.Solo]: 0,
  [CollisionState.Neighbors]: 1,
  [CollisionState.Crossroads]: 2,
  [CollisionState.CollisionCourse]: 3,
  [CollisionState.MergeHell]: 4,
};

// ---------------------------------------------------------------------------
// Work Session
// ---------------------------------------------------------------------------

export interface WorkSession {
  sessionId: string; // UUID v4
  userId: string;
  repo: string; // "owner/repo" format
  branch: string;
  files: string[]; // Relative paths, forward slashes
  createdAt: string; // ISO 8601
  lastHeartbeat: string; // ISO 8601
}

// ---------------------------------------------------------------------------
// Collision Result
// ---------------------------------------------------------------------------

export interface CollisionResult {
  state: CollisionState;
  queryingUser: string;
  repo: string;
  overlappingSessions: WorkSession[];
  sharedFiles: string[];
  sharedDirectories: string[];
  actions: Action[];
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
