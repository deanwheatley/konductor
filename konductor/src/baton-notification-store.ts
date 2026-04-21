/**
 * NotificationStore — In-memory store for Baton collision notifications.
 *
 * Provides CRUD operations, JSON serialization/deserialization for persistence,
 * and a pretty-print/parse round-trip for human-readable display.
 */

import { CollisionState } from "./types.js";
import {
  HealthStatus,
  type BatonNotification,
  type BatonNotificationUser,
} from "./baton-types.js";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface INotificationStore {
  add(notification: BatonNotification): void;
  getActive(repo: string): BatonNotification[];
  getResolved(repo: string): BatonNotification[];
  resolve(notificationId: string): boolean;
  serialize(): string;
  deserialize(json: string): void;
  prettyPrint(notification: BatonNotification): string;
  parse(text: string): BatonNotification;
}

// ---------------------------------------------------------------------------
// Label maps for pretty-print format
// ---------------------------------------------------------------------------

const HEALTH_LABELS: Record<HealthStatus, string> = {
  [HealthStatus.Healthy]: "HEALTHY",
  [HealthStatus.Warning]: "WARNING",
  [HealthStatus.Alerting]: "ALERTING",
};

const LABEL_TO_HEALTH: Record<string, HealthStatus> = Object.fromEntries(
  Object.entries(HEALTH_LABELS).map(([k, v]) => [v, k as HealthStatus]),
) as Record<string, HealthStatus>;

const STATE_LABELS: Record<CollisionState, string> = {
  [CollisionState.Solo]: "solo",
  [CollisionState.Neighbors]: "neighbors",
  [CollisionState.Crossroads]: "crossroads",
  [CollisionState.Proximity]: "proximity",
  [CollisionState.CollisionCourse]: "collision_course",
  [CollisionState.MergeHell]: "merge_hell",
};

const LABEL_TO_STATE: Record<string, CollisionState> = Object.fromEntries(
  Object.entries(STATE_LABELS).map(([k, v]) => [v, k as CollisionState]),
) as Record<string, CollisionState>;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class NotificationStore implements INotificationStore {
  private readonly notifications = new Map<string, BatonNotification>();

  add(notification: BatonNotification): void {
    this.notifications.set(notification.id, { ...notification });
  }

  getActive(repo: string): BatonNotification[] {
    const result: BatonNotification[] = [];
    for (const n of this.notifications.values()) {
      if (n.repo === repo && !n.resolved) {
        result.push({ ...n, users: [...n.users] });
      }
    }
    return result;
  }

  getResolved(repo: string): BatonNotification[] {
    const result: BatonNotification[] = [];
    for (const n of this.notifications.values()) {
      if (n.repo === repo && n.resolved) {
        result.push({ ...n, users: [...n.users] });
      }
    }
    return result;
  }

  resolve(notificationId: string): boolean {
    const n = this.notifications.get(notificationId);
    if (!n || n.resolved) return false;
    n.resolved = true;
    n.resolvedAt = new Date().toISOString();
    return true;
  }

  // -----------------------------------------------------------------------
  // JSON serialization / deserialization
  // -----------------------------------------------------------------------

  serialize(): string {
    const arr = Array.from(this.notifications.values());
    return JSON.stringify(arr, null, 2);
  }

  deserialize(json: string): void {
    const arr: BatonNotification[] = JSON.parse(json);
    this.notifications.clear();
    for (const n of arr) {
      this.notifications.set(n.id, n);
    }
  }

  // -----------------------------------------------------------------------
  // Pretty-print / parse round-trip
  // -----------------------------------------------------------------------

  /**
   * Format a notification as human-readable text.
   *
   * Format:
   *   [<ISO timestamp>] [<TYPE>] [<state>] <repo>
   *     Users: <user1> (<branch1>), <user2> (<branch2>)
   *     JIRAs: <jira1>, <jira2>   (or "none")
   *     Summary: <summary text>
   *     Status: active | resolved at <ISO timestamp>
   *     ID: <uuid>
   */
  prettyPrint(notification: BatonNotification): string {
    const lines: string[] = [];

    // Header line
    const ts = notification.timestamp;
    const typeLabel = HEALTH_LABELS[notification.notificationType];
    const stateLabel = STATE_LABELS[notification.collisionState];
    lines.push(`[${ts}] [${typeLabel}] [${stateLabel}] ${notification.repo}`);

    // Users — include source context for passive sessions
    const userParts = notification.users
      .map((u) => {
        let part = `${u.userId} (${u.branch})`;
        if (u.source && u.source !== "active") {
          if (u.source === "github_pr" && u.prNumber !== undefined) {
            part += ` [PR #${u.prNumber}]`;
          } else if (u.source === "github_commit" && u.commitDateRange) {
            part += ` [commits ${u.commitDateRange}]`;
          } else {
            part += ` [${u.source}]`;
          }
        }
        return part;
      })
      .join(", ");
    lines.push(`  Users: ${userParts || "none"}`);

    // JIRAs
    const jiraStr = notification.jiras.length > 0
      ? notification.jiras.join(", ")
      : "none";
    lines.push(`  JIRAs: ${jiraStr}`);

    // Summary
    lines.push(`  Summary: ${notification.summary}`);

    // Status
    if (notification.resolved && notification.resolvedAt) {
      lines.push(`  Status: resolved at ${notification.resolvedAt}`);
    } else {
      lines.push(`  Status: active`);
    }

    // ID (needed for round-trip)
    lines.push(`  ID: ${notification.id}`);

    return lines.join("\n");
  }

  /**
   * Parse a pretty-printed notification back into a BatonNotification.
   * Throws if the format is invalid.
   */
  parse(text: string): BatonNotification {
    const lines = text.split("\n");

    // --- Header line ---
    const headerMatch = lines[0]?.match(
      /^\[(.+?)\] \[([A-Z]+)\] \[([a-z_]+)\] (.+)$/,
    );
    if (!headerMatch) {
      throw new Error("Malformed pretty-print: invalid header line");
    }
    const [, timestamp, typeLabel, stateLabel, repo] = headerMatch;

    const notificationType = LABEL_TO_HEALTH[typeLabel];
    if (notificationType === undefined) {
      throw new Error(`Malformed pretty-print: unknown type "${typeLabel}"`);
    }
    const collisionState = LABEL_TO_STATE[stateLabel];
    if (collisionState === undefined) {
      throw new Error(`Malformed pretty-print: unknown state "${stateLabel}"`);
    }

    // --- Users line ---
    const usersLine = lines[1];
    if (!usersLine?.startsWith("  Users: ")) {
      throw new Error("Malformed pretty-print: missing Users line");
    }
    const usersStr = usersLine.slice("  Users: ".length);
    let users: BatonNotificationUser[] = [];
    if (usersStr !== "none" && usersStr.length > 0) {
      users = usersStr.split(", ").map((part) => {
        // Match: userId (branch) [PR #N] or userId (branch) [commits range] or userId (branch) [source] or userId (branch)
        const mWithPr = part.match(/^(.+?) \((.+?)\) \[PR #(\d+)\]$/);
        if (mWithPr) {
          return { userId: mWithPr[1], branch: mWithPr[2], source: "github_pr" as const, prNumber: parseInt(mWithPr[3], 10) };
        }
        const mWithCommits = part.match(/^(.+?) \((.+?)\) \[commits (.+?)\]$/);
        if (mWithCommits) {
          return { userId: mWithCommits[1], branch: mWithCommits[2], source: "github_commit" as const, commitDateRange: mWithCommits[3] };
        }
        const mWithSource = part.match(/^(.+?) \((.+?)\) \[(.+?)\]$/);
        if (mWithSource) {
          return { userId: mWithSource[1], branch: mWithSource[2], source: mWithSource[3] as BatonNotificationUser["source"] };
        }
        const m = part.match(/^(.+?) \((.+?)\)$/);
        if (!m) throw new Error(`Malformed pretty-print: invalid user entry "${part}"`);
        return { userId: m[1], branch: m[2] };
      });
    }

    // --- JIRAs line ---
    const jirasLine = lines[2];
    if (!jirasLine?.startsWith("  JIRAs: ")) {
      throw new Error("Malformed pretty-print: missing JIRAs line");
    }
    const jirasStr = jirasLine.slice("  JIRAs: ".length);
    const jiras = jirasStr === "none" ? [] : jirasStr.split(", ");

    // --- Summary line ---
    const summaryLine = lines[3];
    if (!summaryLine?.startsWith("  Summary: ")) {
      throw new Error("Malformed pretty-print: missing Summary line");
    }
    const summary = summaryLine.slice("  Summary: ".length);

    // --- Status line ---
    const statusLine = lines[4];
    if (!statusLine?.startsWith("  Status: ")) {
      throw new Error("Malformed pretty-print: missing Status line");
    }
    const statusStr = statusLine.slice("  Status: ".length);
    let resolved = false;
    let resolvedAt: string | undefined;
    if (statusStr.startsWith("resolved at ")) {
      resolved = true;
      resolvedAt = statusStr.slice("resolved at ".length);
    }

    // --- ID line ---
    const idLine = lines[5];
    if (!idLine?.startsWith("  ID: ")) {
      throw new Error("Malformed pretty-print: missing ID line");
    }
    const id = idLine.slice("  ID: ".length);

    const notification: BatonNotification = {
      id,
      repo,
      timestamp,
      notificationType,
      collisionState,
      jiras,
      summary,
      users,
      resolved,
    };
    if (resolvedAt !== undefined) {
      notification.resolvedAt = resolvedAt;
    }

    return notification;
  }
}
