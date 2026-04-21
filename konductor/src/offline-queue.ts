/**
 * OfflineQueue — Stores file change events while the server is unreachable.
 *
 * Uses a Set for unique file paths with FIFO eviction when the queue exceeds
 * the configured maximum size. On reconnection, the cumulative file list
 * (union of all queued files) is replayed as a single registration.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7
 */

export interface OfflineQueueEvents {
  onEviction?: (evictedFile: string, maxSize: number) => void;
  onQueued?: (queueSize: number) => void;
}

export class OfflineQueue {
  private queue = new Set<string>();
  private _maxSize: number;
  private events: OfflineQueueEvents;

  constructor(maxSize: number = 100, events: OfflineQueueEvents = {}) {
    this._maxSize = Math.max(1, maxSize);
    this.events = events;
  }

  get size(): number {
    return this.queue.size;
  }

  get maxSize(): number {
    return this._maxSize;
  }

  /** Add files to the queue. FIFO eviction when queue exceeds max size. */
  enqueue(files: string[]): void {
    for (const f of files) {
      if (this.queue.size >= this._maxSize && !this.queue.has(f)) {
        // FIFO eviction: remove oldest (first inserted) — Set preserves insertion order
        const oldest = this.queue.values().next().value!;
        this.queue.delete(oldest);
        this.events.onEviction?.(oldest, this._maxSize);
      }
      this.queue.add(f);
    }
    this.events.onQueued?.(this.queue.size);
  }

  /** Drain the queue and return all files. Clears the queue. */
  drain(): string[] {
    const files = [...this.queue];
    this.queue.clear();
    return files;
  }

  /** Get all files currently in the queue without clearing. */
  peek(): string[] {
    return [...this.queue];
  }

  /** Check if the queue is empty. */
  isEmpty(): boolean {
    return this.queue.size === 0;
  }

  /** Clear the queue. */
  clear(): void {
    this.queue.clear();
  }
}
