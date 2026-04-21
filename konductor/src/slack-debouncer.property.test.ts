/**
 * Property-Based Tests for SlackDebouncer
 *
 * Uses fast-check to verify correctness properties from the design document.
 *
 * Validates: Requirements 4.1, 4.2, 4.3
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import { SlackDebouncer } from "./slack-debouncer.js";
import { CollisionState } from "./types.js";
import type { CollisionResult, WorkSession } from "./types.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const collisionStateArb = fc.constantFrom(
  CollisionState.Solo,
  CollisionState.Neighbors,
  CollisionState.Crossroads,
  CollisionState.CollisionCourse,
  CollisionState.MergeHell,
);

const repoArb = fc.stringMatching(/^[a-z][a-z0-9-]{1,20}\/[a-z][a-z0-9-]{1,20}$/);
const userIdArb = fc.stringMatching(/^[a-z][a-z0-9_]{2,15}$/);
const filePathArb = fc.stringMatching(/^src\/[a-z][a-z0-9-]{1,15}\.[a-z]{2,4}$/);
const branchArb = fc.stringMatching(/^[a-z][a-z0-9/-]{2,20}$/);

function collisionResultArb(stateArb?: fc.Arbitrary<CollisionState>): fc.Arbitrary<CollisionResult> {
  return fc.record({
    state: stateArb ?? collisionStateArb,
    repo: repoArb,
    queryingUser: userIdArb,
    overlappingSessions: fc.array(
      fc.record({
        sessionId: fc.uuid(),
        userId: userIdArb,
        repo: repoArb,
        branch: branchArb,
        files: fc.array(filePathArb, { minLength: 1, maxLength: 3 }),
        createdAt: fc.constant("2026-04-19T10:00:00Z"),
        lastHeartbeat: fc.constant("2026-04-19T10:00:00Z"),
      }) as fc.Arbitrary<WorkSession>,
      { minLength: 1, maxLength: 2 },
    ),
    overlappingDetails: fc.constant([]),
    sharedFiles: fc.array(filePathArb, { minLength: 1, maxLength: 3 }),
    sharedDirectories: fc.constant([]),
    actions: fc.constant([]),
  }) as fc.Arbitrary<CollisionResult>;
}

/** Generate a sequence of state changes for a single repo. */
const stateChangeSeqArb = fc.array(
  fc.record({
    result: collisionResultArb(),
    userId: userIdArb,
  }),
  { minLength: 2, maxLength: 10 },
);

// ---------------------------------------------------------------------------
// Property 6: Slack debounce coalesces rapid changes
// **Feature: konductor-bugs-and-missing-features, Property 6: Slack debounce coalesces rapid changes**
// **Validates: Requirements 4.1, 4.2, 4.3**
// ---------------------------------------------------------------------------

describe("Slack Debounce Coalesces Rapid Changes — Property Tests", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * **Feature: konductor-bugs-and-missing-features, Property 6: Slack debounce coalesces rapid changes**
   * **Validates: Requirements 4.1, 4.2, 4.3**
   *
   * For any sequence of collision state changes for a repo within the debounce
   * window, exactly one Slack message SHALL be posted after the debounce period
   * expires, reflecting the final (settled) state.
   */
  it("Property 6: rapid state changes for a single repo produce exactly one callback with the final state", () => {
    fc.assert(
      fc.property(stateChangeSeqArb, repoArb, (changes, repo) => {
        const debounceMs = 30_000;
        const debouncer = new SlackDebouncer(debounceMs);
        const callbackInvocations: Array<{ repo: string; result: CollisionResult; userId: string }> = [];

        const callback = async (r: string, result: CollisionResult, userId: string) => {
          callbackInvocations.push({ repo: r, result, userId });
        };

        // Schedule all changes rapidly (within the debounce window)
        for (const change of changes) {
          debouncer.schedule(repo, change.result, change.userId, callback);
        }

        // Before the debounce period: no callbacks should have fired
        expect(callbackInvocations.length).toBe(0);

        // Advance past the debounce period
        vi.advanceTimersByTime(debounceMs + 100);

        // Exactly one callback should have fired
        expect(callbackInvocations.length).toBe(1);

        // The callback should have the final (last) state
        const lastChange = changes[changes.length - 1];
        expect(callbackInvocations[0].result).toBe(lastChange.result);
        expect(callbackInvocations[0].userId).toBe(lastChange.userId);
        expect(callbackInvocations[0].repo).toBe(repo);

        debouncer.cancelAll();
      }),
      { numRuns: 100 },
    );
  });

  it("Property 6 (cont.): multiple repos debounce independently — each gets exactly one callback", () => {
    fc.assert(
      fc.property(
        fc.array(repoArb, { minLength: 2, maxLength: 5 }).chain((repos) => {
          // Ensure unique repos
          const uniqueRepos = [...new Set(repos)];
          fc.pre(uniqueRepos.length >= 2);
          return fc.record({
            repos: fc.constant(uniqueRepos),
            changes: fc.array(collisionResultArb(), { minLength: 1, maxLength: 3 }),
            userId: userIdArb,
          });
        }),
        ({ repos, changes, userId }) => {
          fc.pre(repos.length >= 2);
          const debounceMs = 30_000;
          const debouncer = new SlackDebouncer(debounceMs);
          const callbackInvocations: Array<{ repo: string }> = [];

          const callback = async (r: string) => {
            callbackInvocations.push({ repo: r });
          };

          // Schedule changes for each repo
          for (const repo of repos) {
            for (const result of changes) {
              debouncer.schedule(repo, result, userId, callback);
            }
          }

          // Advance past debounce
          vi.advanceTimersByTime(debounceMs + 100);

          // Each repo should have exactly one callback
          expect(callbackInvocations.length).toBe(repos.length);

          // Each repo should appear exactly once
          const repoSet = new Set(callbackInvocations.map((c) => c.repo));
          expect(repoSet.size).toBe(repos.length);

          debouncer.cancelAll();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: Debounce timer resets on new state change
// **Feature: konductor-bugs-and-missing-features, Property 7: Debounce timer resets on new state change**
// **Validates: Requirements 4.2**
// ---------------------------------------------------------------------------

describe("Debounce Timer Resets on New State Change — Property Tests", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * **Feature: konductor-bugs-and-missing-features, Property 7: Debounce timer resets on new state change**
   * **Validates: Requirements 4.2**
   *
   * For any collision state change that occurs while a debounce timer is active
   * for the same repo, the timer SHALL be reset, and the pending notification
   * SHALL be updated to reflect the new state.
   */
  it("Property 7: scheduling a new change resets the timer — callback fires debounceMs after the LAST schedule", () => {
    fc.assert(
      fc.property(
        collisionResultArb(),
        collisionResultArb(),
        repoArb,
        userIdArb,
        (firstResult, secondResult, repo, userId) => {
          const debounceMs = 10_000;
          const debouncer = new SlackDebouncer(debounceMs);
          const callbackInvocations: Array<{ result: CollisionResult }> = [];

          const callback = async (_r: string, result: CollisionResult) => {
            callbackInvocations.push({ result });
          };

          // Schedule first change
          debouncer.schedule(repo, firstResult, userId, callback);

          // Advance 70% of the debounce period (timer still active)
          vi.advanceTimersByTime(debounceMs * 0.7);
          expect(callbackInvocations.length).toBe(0);

          // Schedule second change — this should reset the timer
          debouncer.schedule(repo, secondResult, userId, callback);

          // Advance another 70% — still within the NEW debounce window
          vi.advanceTimersByTime(debounceMs * 0.7);
          expect(callbackInvocations.length).toBe(0);

          // Advance past the remaining 30% of the new window
          vi.advanceTimersByTime(debounceMs * 0.4);

          // Now the callback should have fired exactly once with the second result
          expect(callbackInvocations.length).toBe(1);
          expect(callbackInvocations[0].result).toBe(secondResult);

          debouncer.cancelAll();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("Property 7 (cont.): pending notification reflects the latest state at all times", () => {
    fc.assert(
      fc.property(
        stateChangeSeqArb,
        repoArb,
        (changes, repo) => {
          const debouncer = new SlackDebouncer(30_000);
          const callback = async () => {};

          for (const change of changes) {
            debouncer.schedule(repo, change.result, change.userId, callback);

            // After each schedule, the pending notification should reflect the latest state
            const pending = debouncer.getPending(repo);
            expect(pending).toBeDefined();
            expect(pending!.result).toBe(change.result);
            expect(pending!.triggeringUserId).toBe(change.userId);
          }

          debouncer.cancelAll();
        },
      ),
      { numRuns: 100 },
    );
  });
});
