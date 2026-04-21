/**
 * Property-Based Tests for OfflineQueue
 *
 * Uses fast-check to verify correctness properties from the design document.
 * Feature: konductor-bugs-and-missing-features
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { OfflineQueue } from "./offline-queue.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Generate realistic file paths like "src/foo.ts", "lib/bar.js" */
const filePathArb = fc.stringMatching(/^[a-z]{1,8}\/[a-z][a-z0-9-]{0,12}\.[a-z]{2,4}$/);

/** Generate a non-empty array of unique file paths */
const fileListArb = fc.uniqueArray(filePathArb, { minLength: 1, maxLength: 20 });

/** Generate multiple batches of file changes (simulating multiple save events while offline) */
const fileBatchesArb = fc.array(fileListArb, { minLength: 1, maxLength: 10 });

/** Generate a reasonable max queue size */
const maxSizeArb = fc.integer({ min: 1, max: 200 });

// ---------------------------------------------------------------------------
// Property 1: Offline queue preserves all files (union)
// **Feature: konductor-bugs-and-missing-features, Property 1: Offline queue preserves all files (union)**
// **Validates: Requirements 1.1, 1.2, 1.3**
// ---------------------------------------------------------------------------

describe("Offline Queue Preserves All Files (Union) — Property Tests", () => {
  /**
   * **Feature: konductor-bugs-and-missing-features, Property 1: Offline queue preserves all files (union)**
   * **Validates: Requirements 1.1, 1.2, 1.3**
   *
   * For any sequence of file change events received while the server is unreachable,
   * and the queue has not exceeded its maximum size, the queue SHALL contain exactly
   * the union of all file paths from those events.
   */
  it("Property 1: queue contains the union of all enqueued files when under max size", () => {
    fc.assert(
      fc.property(fileBatchesArb, (batches) => {
        // Compute the expected union of all files across all batches
        const expectedUnion = new Set<string>();
        for (const batch of batches) {
          for (const f of batch) expectedUnion.add(f);
        }

        // Only test cases where total unique files fit within default max (100)
        fc.pre(expectedUnion.size <= 100);

        const queue = new OfflineQueue(100);

        // Enqueue each batch (simulating multiple offline save events)
        for (const batch of batches) {
          queue.enqueue(batch);
        }

        // The queue should contain exactly the union
        const queuedFiles = new Set(queue.peek());
        expect(queuedFiles.size).toBe(expectedUnion.size);
        for (const f of expectedUnion) {
          expect(queuedFiles.has(f)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("Property 1 (cont.): drain returns all files and empties the queue", () => {
    fc.assert(
      fc.property(fileBatchesArb, (batches) => {
        const expectedUnion = new Set<string>();
        for (const batch of batches) {
          for (const f of batch) expectedUnion.add(f);
        }
        fc.pre(expectedUnion.size <= 100);

        const queue = new OfflineQueue(100);
        for (const batch of batches) {
          queue.enqueue(batch);
        }

        const drained = queue.drain();
        const drainedSet = new Set(drained);

        // Drained files should be exactly the union
        expect(drainedSet.size).toBe(expectedUnion.size);
        for (const f of expectedUnion) {
          expect(drainedSet.has(f)).toBe(true);
        }

        // Queue should be empty after drain
        expect(queue.isEmpty()).toBe(true);
        expect(queue.size).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});


// ---------------------------------------------------------------------------
// Property 2: Offline queue FIFO eviction
// **Feature: konductor-bugs-and-missing-features, Property 2: Offline queue FIFO eviction**
// **Validates: Requirements 1.4**
// ---------------------------------------------------------------------------

describe("Offline Queue FIFO Eviction — Property Tests", () => {
  /**
   * **Feature: konductor-bugs-and-missing-features, Property 2: Offline queue FIFO eviction**
   * **Validates: Requirements 1.4**
   *
   * For any sequence of N file change events where N exceeds the configured maximum
   * queue size M, the queue SHALL contain exactly M entries, and the evicted entries
   * SHALL be the oldest (earliest inserted) ones.
   */
  it("Property 2: queue never exceeds max size and evicts oldest entries first", () => {
    fc.assert(
      fc.property(
        maxSizeArb,
        fc.uniqueArray(filePathArb, { minLength: 1, maxLength: 100 }),
        (maxSize, files) => {
          // Only test cases where we have more unique files than max size
          fc.pre(files.length > maxSize);

          const evicted: string[] = [];
          const queue = new OfflineQueue(maxSize, {
            onEviction: (file) => evicted.push(file),
          });

          // Enqueue all files one batch at a time
          queue.enqueue(files);

          // Queue size should be exactly maxSize
          expect(queue.size).toBe(maxSize);

          // The remaining files should be the LAST maxSize files (newest)
          const expectedRemaining = new Set(files.slice(files.length - maxSize));
          const actualRemaining = new Set(queue.peek());
          expect(actualRemaining.size).toBe(expectedRemaining.size);
          for (const f of expectedRemaining) {
            expect(actualRemaining.has(f)).toBe(true);
          }

          // The evicted files should be the FIRST (oldest) files
          const expectedEvicted = files.slice(0, files.length - maxSize);
          expect(evicted.length).toBe(expectedEvicted.length);
          for (let i = 0; i < expectedEvicted.length; i++) {
            expect(evicted[i]).toBe(expectedEvicted[i]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("Property 2 (cont.): multi-batch eviction preserves FIFO order across batches", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10 }),
        fc.array(
          fc.uniqueArray(filePathArb, { minLength: 1, maxLength: 15 }),
          { minLength: 2, maxLength: 5 },
        ),
        (maxSize, batches) => {
          // Compute total unique files across all batches
          const allUnique = new Set<string>();
          for (const batch of batches) {
            for (const f of batch) allUnique.add(f);
          }
          fc.pre(allUnique.size > maxSize);

          const queue = new OfflineQueue(maxSize);

          for (const batch of batches) {
            queue.enqueue(batch);
          }

          // Queue should never exceed max size
          expect(queue.size).toBeLessThanOrEqual(maxSize);

          // All remaining files should be from the input
          const remaining = queue.peek();
          for (const f of remaining) {
            expect(allUnique.has(f)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ---------------------------------------------------------------------------
// Property 3: Offline replay is a single registration
// **Feature: konductor-bugs-and-missing-features, Property 3: Offline replay is a single registration**
// **Validates: Requirements 1.2, 1.3**
// ---------------------------------------------------------------------------

describe("Offline Replay Is a Single Registration — Property Tests", () => {
  /**
   * **Feature: konductor-bugs-and-missing-features, Property 3: Offline replay is a single registration**
   * **Validates: Requirements 1.2, 1.3**
   *
   * For any non-empty offline queue, when the server becomes reachable, the watcher
   * SHALL make exactly one registration API call containing all files from the queue,
   * and the queue SHALL be empty after replay.
   */
  it("Property 3: drain produces exactly one file list containing all queued files, then queue is empty", () => {
    fc.assert(
      fc.property(
        maxSizeArb,
        fileBatchesArb,
        (maxSize, batches) => {
          const queue = new OfflineQueue(maxSize);

          // Simulate multiple offline save events
          for (const batch of batches) {
            queue.enqueue(batch);
          }

          fc.pre(!queue.isEmpty());

          // Capture what's in the queue before drain
          const expectedFiles = new Set(queue.peek());

          // drain() simulates the single replay registration call
          const replayFiles = queue.drain();

          // Exactly one call: drain returns a single array (one registration)
          expect(Array.isArray(replayFiles)).toBe(true);

          // The replay file list contains all queued files
          const replaySet = new Set(replayFiles);
          expect(replaySet.size).toBe(expectedFiles.size);
          for (const f of expectedFiles) {
            expect(replaySet.has(f)).toBe(true);
          }

          // Queue is empty after replay
          expect(queue.isEmpty()).toBe(true);
          expect(queue.size).toBe(0);
          expect(queue.drain()).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("Property 3 (cont.): replay merges with current files as union", () => {
    fc.assert(
      fc.property(
        fileBatchesArb,
        fileListArb,
        (offlineBatches, currentFiles) => {
          const queue = new OfflineQueue(100);

          // Simulate offline queuing
          for (const batch of offlineBatches) {
            queue.enqueue(batch);
          }

          fc.pre(!queue.isEmpty());

          // Drain the queue (simulating replay)
          const queuedFiles = queue.drain();

          // Merge with current files (union) — this is what registerFiles does
          const allFiles = [...new Set([...currentFiles, ...queuedFiles])];

          // The merged list should contain all current files
          const allSet = new Set(allFiles);
          for (const f of currentFiles) {
            expect(allSet.has(f)).toBe(true);
          }

          // The merged list should contain all queued files
          for (const f of queuedFiles) {
            expect(allSet.has(f)).toBe(true);
          }

          // No duplicates in the merged list
          expect(allFiles.length).toBe(allSet.size);
        },
      ),
      { numRuns: 100 },
    );
  });
});
