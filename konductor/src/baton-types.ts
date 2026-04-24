/**
 * Baton Dashboard — Types and Data Models
 *
 * Core types for the per-repo dashboard: health status computation,
 * notifications, query log, repo summaries, events, and freshness scale.
 */

import { CollisionState, SEVERITY } from "./types.js";
import type { CollabRequest } from "./collab-request-store.js";

// ---------------------------------------------------------------------------
// Health Status
// ---------------------------------------------------------------------------

export enum HealthStatus {
  Healthy = "healthy",
  Warning = "warning",
  Alerting = "alerting",
}

/**
 * Compute the overall health status from a set of collision states.
 *
 * - Alerting: any state is CollisionCourse or MergeHell
 * - Warning: any state is Crossroads or Neighbors (and none are CollisionCourse/MergeHell)
 * - Healthy: empty set or all states are Solo
 */
export function computeHealthStatus(states: CollisionState[]): HealthStatus {
  let hasWarning = false;

  for (const state of states) {
    if (
      state === CollisionState.CollisionCourse ||
      state === CollisionState.MergeHell
    ) {
      return HealthStatus.Alerting;
    }
    if (
      state === CollisionState.Crossroads ||
      state === CollisionState.Neighbors
    ) {
      hasWarning = true;
    }
  }

  return hasWarning ? HealthStatus.Warning : HealthStatus.Healthy;
}


// ---------------------------------------------------------------------------
// Freshness Color Scale
// ---------------------------------------------------------------------------

/** Default interval per freshness level in minutes. */
export const DEFAULT_FRESHNESS_INTERVAL_MINUTES = 10;

/** Default 10-level color scale from green (most recent) to black (least recent). */
export const DEFAULT_FRESHNESS_COLORS: readonly string[] = [
  "#22c55e", // Level 1: Bright Green  (0–10 min)
  "#16a34a", // Level 2: Green         (10–20 min)
  "#14b8a6", // Level 3: Teal          (20–30 min)
  "#06b6d4", // Level 4: Cyan          (30–40 min)
  "#3b82f6", // Level 5: Blue          (40–50 min)
  "#6366f1", // Level 6: Indigo        (50–60 min)
  "#8b5cf6", // Level 7: Purple        (60–70 min)
  "#6b21a8", // Level 8: Dim Purple    (70–80 min)
  "#4b5563", // Level 9: Dark Gray     (80–90 min)
  "#1f2937", // Level 10: Black        (90+ min)
];

/**
 * Compute the freshness level (1–10) based on time since last heartbeat.
 *
 * Level 1 is the freshest (0 to intervalMinutes), level 10 is the stalest
 * (9× intervalMinutes or more).
 *
 * @param lastHeartbeat  ISO 8601 timestamp of the last heartbeat
 * @param intervalMinutes  Minutes per freshness level (default 10)
 * @returns  Freshness level from 1 to 10
 */
export function computeFreshnessLevel(
  lastHeartbeat: string,
  intervalMinutes: number = DEFAULT_FRESHNESS_INTERVAL_MINUTES,
): number {
  const elapsedMs = Date.now() - new Date(lastHeartbeat).getTime();
  const elapsedMinutes = Math.max(0, elapsedMs / 60_000);
  const level = Math.floor(elapsedMinutes / intervalMinutes) + 1;
  return Math.min(level, 10);
}

// ---------------------------------------------------------------------------
// Notification Types
// ---------------------------------------------------------------------------

export interface BatonNotificationUser {
  userId: string;
  branch: string;
  /** Session source — "active" (default/omitted), "github_pr", or "github_commit" */
  source?: "active" | "github_pr" | "github_commit";
  /** PR number when source is github_pr */
  prNumber?: number;
  /** PR URL when source is github_pr */
  prUrl?: string;
  /** Commit date range when source is github_commit */
  commitDateRange?: string;
}

export interface BatonNotification {
  id: string;                       // UUID
  repo: string;                     // "owner/repo"
  timestamp: string;                // ISO 8601
  notificationType: HealthStatus;   // Healthy, Warning, Alerting
  collisionState: CollisionState;   // Solo, Neighbors, Crossroads, CollisionCourse, MergeHell
  jiras: string[];                  // JIRA ticket IDs if known, empty array if unknown
  summary: string;                  // Human-readable description
  users: BatonNotificationUser[];
  resolved: boolean;
  resolvedAt?: string;              // ISO 8601, set when resolved
}

// ---------------------------------------------------------------------------
// Query Log
// ---------------------------------------------------------------------------

export interface QueryLogEntry {
  id: string;                       // UUID
  repo: string;                     // "owner/repo"
  timestamp: string;                // ISO 8601
  userId: string;                   // Who triggered the activity
  branch: string;                   // Branch the user is on
  queryType: string;                // Activity type: "session", "query", "collision", "files_changed", etc.
  parameters: Record<string, unknown>;
  summary?: string;                 // Human-readable description of the activity
}

// ---------------------------------------------------------------------------
// Repo Summary
// ---------------------------------------------------------------------------

export interface RepoBranch {
  name: string;
  githubUrl: string;
  users: string[];
}

export interface RepoActiveUser {
  userId: string;
  githubUrl: string;
  lastHeartbeat: string;            // ISO 8601
  hasConnected: boolean;            // true if user has an active MCP session (not just GitHub)
}

export interface RepoSummary {
  repo: string;
  githubUrl: string;
  healthStatus: HealthStatus;
  branches: RepoBranch[];
  users: RepoActiveUser[];
  sessionCount: number;
  userCount: number;
}

// ---------------------------------------------------------------------------
// Baton Events (SSE)
// ---------------------------------------------------------------------------

export interface SlackConfigChangeEvent {
  channel: string;
  verbosity: number;
  changedBy: string;
  slackChannelLink: string;
}

export type BatonEvent =
  | { type: "session_change"; repo: string; data: RepoSummary }
  | { type: "notification_added"; repo: string; data: BatonNotification }
  | { type: "notification_resolved"; repo: string; data: { id: string } }
  | { type: "query_logged"; repo: string; data: QueryLogEntry }
  | { type: "github_pr_change"; repo: string; data: { action: "opened" | "updated" | "closed"; prNumber: number } }
  | { type: "admin_settings_change"; repo: string; data: { key: string; value: unknown; category: string } }
  | { type: "admin_user_change"; repo: string; data: { userId: string; changes: Record<string, unknown> } }
  | { type: "admin_channel_change"; repo: string; data: { channel: string; action: "promote" | "rollback" | "upload" | "assign" | "stale"; version?: string; deletedVersion?: string } }
  | { type: "bundle_change"; repo: string; data: { action: "delete"; version: string; staleChannels: string[] } | { action: "rescan"; added: string[]; removed: string[] } }
  | { type: "slack_config_change"; repo: string; data: SlackConfigChangeEvent }
  | { type: "collab_request_update"; repo: string; data: CollabRequest };

// ---------------------------------------------------------------------------
// Repo History (future — GitHub integration)
// ---------------------------------------------------------------------------

export interface RepoHistoryEntry {
  id: string;                       // UUID
  repo: string;                     // "owner/repo"
  timestamp: string;                // ISO 8601
  action: "commit" | "pr" | "merge";
  userId: string;                   // GitHub username
  summary: string;                  // Commit message, PR title, etc.
  githubUrl: string;                // Link to commit/PR/merge on GitHub
}
