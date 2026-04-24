/**
 * BatonEventEmitter — Lightweight pub/sub for Baton SSE events.
 *
 * Subscribers register for a specific repo and receive only events
 * matching that repo. The `subscribe()` method returns an unsubscribe
 * function for cleanup.
 */

import type { BatonEvent } from "./baton-types.js";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface IBatonEventEmitter {
  emit(event: BatonEvent): void;
  subscribe(repo: string, callback: (event: BatonEvent) => void): () => void;
  /** Subscribe to all events regardless of repo. */
  onAny(callback: (event: BatonEvent) => void): () => void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class BatonEventEmitter implements IBatonEventEmitter {
  private readonly subscribers = new Map<
    string,
    Set<(event: BatonEvent) => void>
  >();
  private readonly globalSubscribers = new Set<(event: BatonEvent) => void>();

  emit(event: BatonEvent): void {
    const callbacks = this.subscribers.get(event.repo);
    if (callbacks) {
      for (const cb of callbacks) {
        cb(event);
      }
    }
    for (const cb of this.globalSubscribers) {
      cb(event);
    }
  }

  subscribe(
    repo: string,
    callback: (event: BatonEvent) => void,
  ): () => void {
    let callbacks = this.subscribers.get(repo);
    if (!callbacks) {
      callbacks = new Set();
      this.subscribers.set(repo, callbacks);
    }
    callbacks.add(callback);

    return () => {
      callbacks!.delete(callback);
      if (callbacks!.size === 0) {
        this.subscribers.delete(repo);
      }
    };
  }

  onAny(callback: (event: BatonEvent) => void): () => void {
    this.globalSubscribers.add(callback);
    return () => {
      this.globalSubscribers.delete(callback);
    };
  }
}
