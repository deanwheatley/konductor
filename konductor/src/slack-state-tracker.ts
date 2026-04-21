/**
 * SlackStateTracker — In-memory tracker for the last notified collision state per repo.
 *
 * Used by SlackNotifier to detect escalation/de-escalation transitions.
 * State is held in memory and lost on restart — acceptable because collision
 * state is re-evaluated on next register_session.
 *
 * Requirements: 9.1, 9.4
 */

import type { CollisionState } from "./types.js";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface ISlackStateTracker {
  /** Get the last collision state that triggered a Slack notification for a repo. */
  getLastNotifiedState(repo: string): CollisionState | null;

  /** Record that a notification was sent for this repo at this state. */
  setLastNotifiedState(repo: string, state: CollisionState): void;

  /** Clear tracking for a repo (e.g., when Slack is disabled). */
  clear(repo: string): void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class SlackStateTracker implements ISlackStateTracker {
  private readonly states: Map<string, CollisionState> = new Map();

  getLastNotifiedState(repo: string): CollisionState | null {
    return this.states.get(repo) ?? null;
  }

  setLastNotifiedState(repo: string, state: CollisionState): void {
    this.states.set(repo, state);
  }

  clear(repo: string): void {
    this.states.delete(repo);
  }
}
