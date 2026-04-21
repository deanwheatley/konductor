/**
 * Proactive Collision Push — user-to-transport mapping and collision alert emission.
 *
 * Tracks which userId is associated with which SSE response objects, and provides
 * a method to push collision_alert events to affected users when a new registration
 * creates a collision.
 *
 * Requirements: 3.1, 3.4
 */

import type { ServerResponse } from "node:http";
import type { CollisionResult } from "./types.js";

// ---------------------------------------------------------------------------
// Collision Alert Payload
// ---------------------------------------------------------------------------

export interface CollisionAlertPayload {
  type: "collision_alert";
  repo: string;
  collisionState: string;
  triggeringUser: string;
  sharedFiles: string[];
  summary: string;
}

// ---------------------------------------------------------------------------
// UserTransportRegistry
// ---------------------------------------------------------------------------

/**
 * Maps userId → Set<ServerResponse> for active SSE connections.
 * Used to push proactive collision alerts to existing users when a new
 * registration creates a collision.
 */
export class UserTransportRegistry {
  private readonly userTransports = new Map<string, Set<ServerResponse>>();

  /** Register an SSE response for a userId. */
  add(userId: string, res: ServerResponse): void {
    let transports = this.userTransports.get(userId);
    if (!transports) {
      transports = new Set();
      this.userTransports.set(userId, transports);
    }
    transports.add(res);
  }

  /** Remove an SSE response for a userId (on connection close). */
  remove(userId: string, res: ServerResponse): void {
    const transports = this.userTransports.get(userId);
    if (!transports) return;
    transports.delete(res);
    if (transports.size === 0) {
      this.userTransports.delete(userId);
    }
  }

  /** Get all active SSE responses for a userId. Returns empty set if none. */
  get(userId: string): Set<ServerResponse> {
    return this.userTransports.get(userId) ?? new Set();
  }

  /** Check if a userId has any active SSE connections. */
  has(userId: string): boolean {
    const transports = this.userTransports.get(userId);
    return !!transports && transports.size > 0;
  }

  /** Get the number of tracked users. */
  get userCount(): number {
    return this.userTransports.size;
  }

  /** Get the total number of tracked transports across all users. */
  get transportCount(): number {
    let count = 0;
    for (const transports of this.userTransports.values()) {
      count += transports.size;
    }
    return count;
  }
}

// ---------------------------------------------------------------------------
// Push collision alert to affected users
// ---------------------------------------------------------------------------

/**
 * Build a collision_alert SSE payload from a collision result.
 */
export function buildCollisionAlert(
  repo: string,
  result: CollisionResult,
  triggeringUser: string,
  summary: string,
): CollisionAlertPayload {
  return {
    type: "collision_alert",
    repo,
    collisionState: result.state,
    triggeringUser,
    sharedFiles: result.sharedFiles,
    summary,
  };
}

/**
 * Write an SSE event to a ServerResponse. Best-effort — errors are silently caught.
 * Returns true if the write succeeded, false otherwise.
 */
export function writeSseEvent(res: ServerResponse, event: string, data: string): boolean {
  try {
    if (res.writableEnded || res.destroyed) return false;
    res.write(`event: ${event}\ndata: ${data}\n\n`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Push a collision_alert SSE event to all overlapping users' active SSE connections.
 *
 * Best-effort: never blocks the registration flow. Failed sends are silently skipped.
 * Returns the number of users successfully notified (at least one transport received the event).
 */
export function pushCollisionAlerts(
  registry: UserTransportRegistry,
  repo: string,
  result: CollisionResult,
  triggeringUser: string,
  summary: string,
): number {
  if (result.state === "solo") return 0;

  const alert = buildCollisionAlert(repo, result, triggeringUser, summary);
  const data = JSON.stringify(alert);
  let notifiedUsers = 0;

  for (const overlapping of result.overlappingSessions) {
    // Don't push back to the triggering user
    if (overlapping.userId === triggeringUser) continue;

    const transports = registry.get(overlapping.userId);
    if (transports.size === 0) continue;

    let userNotified = false;
    for (const res of transports) {
      if (writeSseEvent(res, "collision_alert", data)) {
        userNotified = true;
      }
    }
    if (userNotified) notifiedUsers++;
  }

  return notifiedUsers;
}
