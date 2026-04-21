/**
 * SlackDebouncer — Per-repo timer management for Slack notification debouncing.
 *
 * Coalesces rapid collision state changes into a single Slack notification
 * by waiting a configurable debounce period before invoking the callback.
 * If a new state change arrives within the window, the timer resets and
 * the pending notification is updated to reflect the latest state.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4
 */

import type { CollisionResult } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_DEBOUNCE_MS = 5_000;   // 5 seconds
const MAX_DEBOUNCE_MS = 300_000; // 300 seconds
const DEFAULT_DEBOUNCE_MS = 30_000; // 30 seconds

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PendingNotification {
  timer: ReturnType<typeof setTimeout>;
  repo: string;
  result: CollisionResult;
  triggeringUserId: string;
}

export type DebouncedCallback = (repo: string, result: CollisionResult, userId: string) => Promise<void>;

// ---------------------------------------------------------------------------
// SlackDebouncer
// ---------------------------------------------------------------------------

export class SlackDebouncer {
  private pending = new Map<string, PendingNotification>();
  private debounceMs: number;

  constructor(debounceMs: number = DEFAULT_DEBOUNCE_MS) {
    this.debounceMs = clampDebounce(debounceMs);
  }

  /**
   * Schedule (or reschedule) a debounced notification for a repo.
   *
   * If a timer is already active for this repo, it is cleared and reset
   * with the latest state. When the timer expires, the callback is invoked
   * with the most recent result and userId.
   *
   * Requirements: 4.1, 4.2, 4.3
   */
  schedule(
    repo: string,
    result: CollisionResult,
    userId: string,
    callback: DebouncedCallback,
  ): void {
    const existing = this.pending.get(repo);
    if (existing) {
      clearTimeout(existing.timer);
    }

    const timer = setTimeout(async () => {
      this.pending.delete(repo);
      try {
        await callback(repo, result, userId);
      } catch {
        // Best effort — never throw from timer
      }
    }, this.debounceMs);

    this.pending.set(repo, { timer, repo, result, triggeringUserId: userId });
  }

  /**
   * Update the debounce period. Clamped to [5s, 300s].
   * Does not affect already-running timers — only future schedules.
   *
   * Requirement: 4.4
   */
  setDebounceMs(ms: number): void {
    this.debounceMs = clampDebounce(ms);
  }

  /** Get the current debounce period in milliseconds. */
  getDebounceMs(): number {
    return this.debounceMs;
  }

  /** Check if a repo has a pending debounced notification. */
  hasPending(repo: string): boolean {
    return this.pending.has(repo);
  }

  /** Get the pending notification for a repo (for testing). */
  getPending(repo: string): PendingNotification | undefined {
    return this.pending.get(repo);
  }

  /** Get the count of pending notifications (for testing). */
  get pendingCount(): number {
    return this.pending.size;
  }

  /** Cancel all pending timers (for cleanup). */
  cancelAll(): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
    }
    this.pending.clear();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampDebounce(ms: number): number {
  return Math.max(MIN_DEBOUNCE_MS, Math.min(MAX_DEBOUNCE_MS, ms));
}
