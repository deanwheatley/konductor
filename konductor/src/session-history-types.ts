/**
 * Session History Types — Long-Term Memory
 *
 * Defines the interfaces for persistent session history, user records,
 * and the ISessionHistoryStore interface that both in-memory and future
 * database implementations satisfy.
 *
 * Requirements: 1.2, 8.3, 8.5
 */

// ---------------------------------------------------------------------------
// Historical Session
// ---------------------------------------------------------------------------

export interface HistoricalSession {
  sessionId: string;
  userId: string;
  repo: string;
  branch: string;
  files: string[];
  status: "active" | "expired" | "committed";
  createdAt: string;      // ISO 8601
  expiredAt?: string;     // ISO 8601
  committedAt?: string;   // ISO 8601
  source?: string;        // "active" | "github_pr" | "github_commit"
}

// ---------------------------------------------------------------------------
// User Record
// ---------------------------------------------------------------------------

export interface RepoAccess {
  repo: string;
  lastAccessed: string; // ISO 8601
}

export interface UserRecord {
  userId: string;
  firstSeen: string;            // ISO 8601
  lastSeen: string;             // ISO 8601
  reposAccessed: RepoAccess[];
  admin: boolean;
  installerChannel: string | null;
  settings: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Stale Overlap
// ---------------------------------------------------------------------------

export interface StaleOverlap {
  userId: string;
  branch: string;
  files: string[];
  expiredAt: string;
  timeSinceExpiry: string;
}

// ---------------------------------------------------------------------------
// History Config
// ---------------------------------------------------------------------------

export interface HistoryConfig {
  sessionRetentionDays: number;  // default: 30
  purgeIntervalHours: number;    // default: 6
}

// ---------------------------------------------------------------------------
// ISessionHistoryStore Interface
// ---------------------------------------------------------------------------

export interface ISessionHistoryStore {
  // Lifecycle
  record(session: HistoricalSession): Promise<void>;
  markExpired(sessionId: string, expiredAt: string): Promise<void>;
  markCommitted(params: { sessionId?: string; userId?: string; repo?: string }): Promise<number>;
  updateFiles(sessionId: string, files: string[]): Promise<void>;

  // Queries
  getStaleOverlaps(repo: string, files: string[]): Promise<HistoricalSession[]>;
  getRecentActivity(repo: string, since: string, until: string): Promise<HistoricalSession[]>;
  getFileHistory(repo: string, filePath: string, since: string, until: string): Promise<HistoricalSession[]>;
  getCollisionTimeline(userId: string, repo: string, since: string, until: string): Promise<HistoricalSession[]>;

  // Maintenance
  purgeOlderThan(cutoffDate: string): Promise<number>;
  exportJson(): Promise<string>;
  importJson(json: string): Promise<number>;

  // User records
  upsertUser(userId: string, repo: string): Promise<void>;
  getUser(userId: string): Promise<UserRecord | null>;
  getAllUsers(): Promise<UserRecord[]>;
  updateUser(userId: string, updates: { installerChannel?: string; admin?: boolean }): Promise<boolean>;

  // Settings (reuse for admin settings store compatibility)
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string, category: string): Promise<void>;
  getAllSettings(category?: string): Promise<Array<{ key: string; value: string; category: string; updatedAt: string }>>;

  // Lifecycle
  close(): Promise<void>;
}
