/**
 * Property-Based Tests for Slack Settings Utilities
 *
 * Uses fast-check to verify correctness properties from the design document.
 *
 * Requirements: 2.2, 5.1, 5.2, 5.3, 6.6, 6.7, 11.3
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import {
  shouldNotify,
  sanitizeChannelName,
  validateChannelName,
  validateVerbosity,
  VERBOSITY_THRESHOLD,
  SlackSettingsManager,
} from "./slack-settings.js";
import { MemorySettingsBackend } from "./settings-store.js";
import { AdminSettingsStore } from "./admin-settings-store.js";
import { CollisionState } from "./types.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** All valid collision states. */
const collisionStateArb = fc.constantFrom(
  CollisionState.Solo,
  CollisionState.Neighbors,
  CollisionState.Crossroads,
  CollisionState.CollisionCourse,
  CollisionState.MergeHell,
);

/** Valid verbosity levels (0–5). */
const verbosityArb = fc.integer({ min: 0, max: 5 });

/** Arbitrary repo name strings (including unicode, special chars). */
const repoNameArb = fc.oneof(
  fc.stringMatching(/^[a-zA-Z0-9._-]{1,40}$/),
  fc.string({ minLength: 1, maxLength: 100 }),
  fc.constantFrom("org/My-Project.v2", "UPPER_CASE", "---leading", "a".repeat(200), "🚀emoji"),
);

/** Arbitrary strings for channel name validation testing. */
const arbitraryStringArb = fc.oneof(
  fc.string({ minLength: 0, maxLength: 100 }),
  fc.stringMatching(/^[a-z0-9_-]{0,90}$/),
  fc.stringMatching(/^[A-Z]{1,10}$/),
);

/** Arbitrary integers for verbosity validation testing. */
const arbitraryIntArb = fc.integer({ min: -100, max: 100 });

// ---------------------------------------------------------------------------
// Property 1: Verbosity threshold filtering
// **Feature: konductor-slack, Property 1: Verbosity threshold filtering**
// **Validates: Requirements 5.1, 5.2, 5.3**
// ---------------------------------------------------------------------------

describe("Verbosity Threshold Filtering — Property Tests", () => {
  /**
   * **Feature: konductor-slack, Property 1: Verbosity threshold filtering**
   * **Validates: Requirements 5.1, 5.2, 5.3**
   *
   * For any collision state and verbosity level N (0–5), shouldNotify returns
   * true iff the state is in the set defined by that verbosity level.
   * At level 0, no states match. At level 5, all states match.
   */
  it("Property 1: shouldNotify returns true iff state is in the verbosity threshold set", () => {
    fc.assert(
      fc.property(collisionStateArb, verbosityArb, (state, verbosity) => {
        const result = shouldNotify(state, verbosity);
        const expectedStates = VERBOSITY_THRESHOLD[verbosity];
        expect(result).toBe(expectedStates.includes(state));
      }),
      { numRuns: 100 },
    );
  });

  it("Property 1 (cont.): verbosity 0 never notifies", () => {
    fc.assert(
      fc.property(collisionStateArb, (state) => {
        expect(shouldNotify(state, 0)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 1 (cont.): verbosity 5 always notifies", () => {
    fc.assert(
      fc.property(collisionStateArb, (state) => {
        expect(shouldNotify(state, 5)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});


// ---------------------------------------------------------------------------
// Property 3: Channel name sanitization
// **Feature: konductor-slack, Property 3: Channel name sanitization**
// **Validates: Requirements 2.2**
// ---------------------------------------------------------------------------

describe("Channel Name Sanitization — Property Tests", () => {
  /**
   * **Feature: konductor-slack, Property 3: Channel name sanitization**
   * **Validates: Requirements 2.2**
   *
   * For any repository name string, the sanitized channel name SHALL:
   * be lowercase, contain only letters/numbers/hyphens/underscores,
   * not start with a hyphen, be at most 80 characters, and be non-empty.
   * The sanitization function is idempotent: sanitize(sanitize(x)) === sanitize(x).
   */
  it("Property 3: sanitized output meets all Slack channel naming rules", () => {
    fc.assert(
      fc.property(repoNameArb, (repoName) => {
        const sanitized = sanitizeChannelName(repoName);

        // Must be lowercase
        expect(sanitized).toBe(sanitized.toLowerCase());

        // Must only contain allowed characters
        expect(sanitized).toMatch(/^[a-z0-9_-]*$/);

        // Must not start with a hyphen
        expect(sanitized.startsWith("-")).toBe(false);

        // Must be at most 80 characters
        expect(sanitized.length).toBeLessThanOrEqual(80);

        // Must be non-empty
        expect(sanitized.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 3 (cont.): sanitization is idempotent", () => {
    fc.assert(
      fc.property(repoNameArb, (repoName) => {
        const once = sanitizeChannelName(repoName);
        const twice = sanitizeChannelName(once);
        expect(twice).toBe(once);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: Bot token source precedence
// **Feature: konductor-slack, Property 7: Bot token source precedence**
// **Validates: Requirements 6.6, 6.7**
// ---------------------------------------------------------------------------

describe("Bot Token Source Precedence — Property Tests", () => {
  const originalEnv = process.env.SLACK_BOT_TOKEN;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SLACK_BOT_TOKEN;
    } else {
      process.env.SLACK_BOT_TOKEN = originalEnv;
    }
  });

  /**
   * **Feature: konductor-slack, Property 7: Bot token source precedence**
   * **Validates: Requirements 6.6, 6.7**
   *
   * For any combination of SLACK_BOT_TOKEN env var and database-stored token,
   * the effective token SHALL be the env var when set, and the database value
   * otherwise. When neither is set, getBotToken() returns null.
   */
  it("Property 7: env var takes precedence over database token", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.option(fc.stringMatching(/^xoxb-[a-zA-Z0-9]{5,20}$/), { nil: undefined }),
        fc.option(fc.stringMatching(/^xoxb-[a-zA-Z0-9]{5,20}$/), { nil: undefined }),
        async (envToken, dbToken) => {
          // Set up env
          if (envToken) {
            process.env.SLACK_BOT_TOKEN = envToken;
          } else {
            delete process.env.SLACK_BOT_TOKEN;
          }

          // Set up database
          const backend = new MemorySettingsBackend();
          const settingsStore = new AdminSettingsStore(backend);
          if (dbToken) {
            await settingsStore.set("slack:bot_token", dbToken, "slack");
          }

          const manager = new SlackSettingsManager(settingsStore);
          const result = await manager.getBotToken();

          if (envToken) {
            expect(result).toBe(envToken);
          } else if (dbToken) {
            expect(result).toBe(dbToken);
          } else {
            expect(result).toBeNull();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 8: Slack channel name validation
// **Feature: konductor-slack, Property 8: Slack channel name validation**
// **Validates: Requirements 11.3**
// ---------------------------------------------------------------------------

describe("Slack Channel Name Validation — Property Tests", () => {
  /**
   * **Feature: konductor-slack, Property 8: Slack channel name validation**
   * **Validates: Requirements 11.3**
   *
   * For any string submitted as a Slack channel name, the validation function
   * SHALL accept strings matching Slack's naming rules and reject all others.
   */
  it("Property 8: valid channel names are accepted", () => {
    const validChannelArb = fc.stringMatching(/^[a-z0-9_][a-z0-9_-]{0,79}$/);

    fc.assert(
      fc.property(validChannelArb, (name) => {
        expect(validateChannelName(name)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 8 (cont.): invalid channel names are rejected", () => {
    const invalidChannelArb = fc.oneof(
      // Empty string
      fc.constant(""),
      // Starts with hyphen
      fc.stringMatching(/^-[a-z0-9_-]{0,10}$/).filter((s) => s.length > 0),
      // Contains uppercase
      fc.stringMatching(/^[a-z0-9_-]*[A-Z][a-z0-9_-]*$/),
      // Too long (81+ chars)
      fc.stringMatching(/^[a-z][a-z0-9_-]{80,100}$/),
      // Contains spaces or special chars
      fc.stringMatching(/^[a-z0-9]*[ @#!][a-z0-9]*$/),
    );

    fc.assert(
      fc.property(invalidChannelArb, (name) => {
        expect(validateChannelName(name)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 9: Verbosity range validation
// **Feature: konductor-slack, Property 9: Verbosity range validation**
// **Validates: Requirements 11.3**
// ---------------------------------------------------------------------------

describe("Verbosity Range Validation — Property Tests", () => {
  /**
   * **Feature: konductor-slack, Property 9: Verbosity range validation**
   * **Validates: Requirements 11.3**
   *
   * For any integer submitted as a verbosity level, the validation function
   * SHALL accept values 0–5 and reject all others.
   */
  it("Property 9: integers 0–5 are accepted", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5 }), (n) => {
        expect(validateVerbosity(n)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 9 (cont.): integers outside 0–5 are rejected", () => {
    const outOfRangeArb = fc.integer().filter((n) => n < 0 || n > 5);

    fc.assert(
      fc.property(outOfRangeArb, (n) => {
        expect(validateVerbosity(n)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 9 (cont.): non-integers are rejected", () => {
    const nonIntArb = fc.oneof(
      fc.double().filter((n) => !Number.isInteger(n) && Number.isFinite(n)),
      fc.constant(NaN),
      fc.constant(Infinity),
      fc.constant(-Infinity),
    );

    fc.assert(
      fc.property(nonIntArb, (n) => {
        expect(validateVerbosity(n)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
