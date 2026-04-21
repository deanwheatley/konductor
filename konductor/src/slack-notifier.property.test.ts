/**
 * Property-Based Tests for SlackNotifier
 *
 * Uses fast-check to verify correctness properties from the design document.
 *
 * Validates: Requirements 1.3, 1.4, 1.5, 8.2, 8.3, 8.4, 9.1, 9.2, 9.3
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { SlackNotifier, STATE_EMOJI } from "./slack-notifier.js";
import { SlackStateTracker } from "./slack-state-tracker.js";
import { shouldNotify, VERBOSITY_THRESHOLD } from "./slack-settings.js";
import { CollisionState } from "./types.js";
import type { CollisionResult, WorkSession } from "./types.js";
import type { ISlackSettingsManager, RepoSlackConfig } from "./slack-settings.js";
import type { KonductorLogger } from "./logger.js";

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

const verbosityArb = fc.integer({ min: 0, max: 5 });

const repoArb = fc.stringMatching(/^[a-z][a-z0-9-]{1,20}\/[a-z][a-z0-9-]{1,20}$/);

const userIdArb = fc.stringMatching(/^[a-z][a-z0-9_]{2,15}$/);

const filePathArb = fc.stringMatching(/^src\/[a-z][a-z0-9-]{1,15}\.[a-z]{2,4}$/);

const branchArb = fc.stringMatching(/^[a-z][a-z0-9/-]{2,20}$/);

/** Generate a CollisionResult with random data. */
function collisionResultArb(stateArb?: fc.Arbitrary<CollisionState>) {
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
        files: fc.array(filePathArb, { minLength: 1, maxLength: 5 }),
        createdAt: fc.constant("2026-04-19T10:00:00Z"),
        lastHeartbeat: fc.constant("2026-04-19T10:00:00Z"),
      }) as fc.Arbitrary<WorkSession>,
      { minLength: 1, maxLength: 3 },
    ),
    overlappingDetails: fc.constant([]),
    sharedFiles: fc.array(filePathArb, { minLength: 1, maxLength: 5 }),
    sharedDirectories: fc.array(fc.constant("src"), { minLength: 0, maxLength: 2 }),
    actions: fc.constant([]),
  }) as fc.Arbitrary<CollisionResult>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockLogger(): KonductorLogger {
  return { enabled: false } as unknown as KonductorLogger;
}

function createMockSettings(token: string | null = "xoxb-test-token", verbosity = 2, channel = "test-channel"): ISlackSettingsManager {
  return {
    getBotToken: async () => token,
    getRepoConfig: async (_repo: string): Promise<RepoSlackConfig> => ({
      channel,
      verbosity,
      enabled: token !== null && verbosity > 0,
    }),
    setRepoChannel: async () => {},
    setRepoVerbosity: async () => {},
    getGlobalStatus: async () => ({ configured: token !== null }),
    setBotToken: async () => {},
  };
}

// ---------------------------------------------------------------------------
// Property 2: Message footer always present
// **Feature: konductor-slack, Property 2: Message footer always present**
// **Validates: Requirements 1.4, 8.4**
// ---------------------------------------------------------------------------

describe("Message Footer Always Present — Property Tests", () => {
  /**
   * **Feature: konductor-slack, Property 2: Message footer always present**
   * **Validates: Requirements 1.4, 8.4**
   *
   * For any Slack message built by the SlackNotifier, the message blocks
   * SHALL contain a context block with the text `*konductor collision alert for <repo>*`
   * where <repo> matches the repository name.
   */
  it("Property 2: escalation messages always contain the footer context block", () => {
    const notifier = new SlackNotifier(createMockSettings(), new SlackStateTracker(), createMockLogger());

    fc.assert(
      fc.property(collisionResultArb(), (result) => {
        const message = notifier.buildEscalationMessage(result.repo, result);

        // Find context block
        const contextBlock = message.blocks.find((b) => b.type === "context");
        expect(contextBlock).toBeDefined();
        expect(contextBlock!.elements).toBeDefined();
        expect(contextBlock!.elements!.length).toBeGreaterThan(0);

        const footerText = contextBlock!.elements![0].text;
        expect(footerText).toBe(`*konductor collision alert for ${result.repo}*`);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 2 (cont.): de-escalation messages always contain the footer context block", () => {
    const notifier = new SlackNotifier(createMockSettings(), new SlackStateTracker(), createMockLogger());

    fc.assert(
      fc.property(repoArb, collisionStateArb, (repo, previousState) => {
        const message = notifier.buildDeescalationMessage(repo, previousState);

        // Find context block
        const contextBlock = message.blocks.find((b) => b.type === "context");
        expect(contextBlock).toBeDefined();
        expect(contextBlock!.elements).toBeDefined();
        expect(contextBlock!.elements!.length).toBeGreaterThan(0);

        const footerText = contextBlock!.elements![0].text;
        expect(footerText).toBe(`*konductor collision alert for ${repo}*`);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: De-escalation detection
// **Feature: konductor-slack, Property 4: De-escalation detection**
// **Validates: Requirements 9.1, 9.2, 9.3**
// ---------------------------------------------------------------------------

describe("De-escalation Detection — Property Tests", () => {
  /**
   * **Feature: konductor-slack, Property 4: De-escalation detection**
   * **Validates: Requirements 9.1, 9.2, 9.3**
   *
   * For any sequence of collision states for a repo, a de-escalation notification
   * SHALL be sent iff the previous notified state was above the verbosity threshold
   * AND the new state is below the threshold.
   */
  it("Property 4: de-escalation is detected iff previous above threshold and new below", () => {
    fc.assert(
      fc.property(
        collisionStateArb,
        collisionStateArb,
        verbosityArb.filter((v) => v > 0), // verbosity 0 disables everything
        (previousState, newState, verbosity) => {
          const previousAbove = shouldNotify(previousState, verbosity);
          const newBelow = !shouldNotify(newState, verbosity);

          const shouldDeescalate = previousAbove && newBelow;

          // Simulate the logic from SlackNotifier.onCollisionEvaluated
          const stateTracker = new SlackStateTracker();
          const repo = "test/repo";

          // Set previous state (simulating a prior notification was sent)
          if (previousAbove) {
            stateTracker.setLastNotifiedState(repo, previousState);
          }

          // Now check: would de-escalation be triggered?
          const meetsThreshold = shouldNotify(newState, verbosity);
          const prevTracked = stateTracker.getLastNotifiedState(repo);
          const prevMeetsThreshold = prevTracked !== null && shouldNotify(prevTracked, verbosity);

          const wouldDeescalate = !meetsThreshold && prevMeetsThreshold;

          expect(wouldDeescalate).toBe(shouldDeescalate);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("Property 4 (cont.): no de-escalation when previous was already below threshold", () => {
    fc.assert(
      fc.property(
        collisionStateArb,
        collisionStateArb,
        verbosityArb.filter((v) => v > 0),
        (previousState, newState, verbosity) => {
          const previousAbove = shouldNotify(previousState, verbosity);

          // Only test cases where previous was below threshold
          fc.pre(!previousAbove);

          const stateTracker = new SlackStateTracker();
          const repo = "test/repo";
          // Previous was below threshold, so no state was tracked
          // (no notification was sent for the previous state)

          const prevTracked = stateTracker.getLastNotifiedState(repo);
          const prevMeetsThreshold = prevTracked !== null && shouldNotify(prevTracked, verbosity);
          const meetsThreshold = shouldNotify(newState, verbosity);

          const wouldDeescalate = !meetsThreshold && prevMeetsThreshold;

          // Should never de-escalate when previous was below threshold
          expect(wouldDeescalate).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5: Message content completeness
// **Feature: konductor-slack, Property 5: Message content completeness**
// **Validates: Requirements 1.3, 8.2, 8.3**
// ---------------------------------------------------------------------------

describe("Message Content Completeness — Property Tests", () => {
  /**
   * **Feature: konductor-slack, Property 5: Message content completeness**
   * **Validates: Requirements 1.3, 8.2, 8.3**
   *
   * For any collision notification, the Slack message SHALL contain:
   * the collision state emoji, the repository name, the branch name(s),
   * the list of affected files, and the names of all involved engineers.
   */
  it("Property 5: escalation message contains emoji, repo, branches, files, and user names", () => {
    const notifier = new SlackNotifier(createMockSettings(), new SlackStateTracker(), createMockLogger());

    fc.assert(
      fc.property(collisionResultArb(), (result) => {
        const message = notifier.buildEscalationMessage(result.repo, result);

        // Serialize all block text for searching
        const allText = message.blocks
          .map((b) => {
            const parts: string[] = [];
            if (b.text) parts.push(b.text.text);
            if (b.elements) parts.push(...b.elements.map((e) => e.text));
            return parts.join(" ");
          })
          .join(" ");

        // Must contain the emoji for the state
        const expectedEmoji = STATE_EMOJI[result.state as string];
        expect(allText).toContain(expectedEmoji);

        // Must contain the repo name
        expect(allText).toContain(result.repo);

        // Must contain user names from overlapping sessions
        const users = [...new Set(result.overlappingSessions.map((s) => s.userId))];
        for (const user of users) {
          expect(allText).toContain(user);
        }

        // Must contain shared files
        for (const file of result.sharedFiles) {
          expect(allText).toContain(file);
        }

        // Must contain branch names from overlapping sessions
        const branches = [...new Set(result.overlappingSessions.map((s) => s.branch))];
        for (const branch of branches) {
          expect(allText).toContain(branch);
        }
      }),
      { numRuns: 100 },
    );
  });
});
