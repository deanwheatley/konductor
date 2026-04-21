import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { CollisionState } from "./types.js";
import {
  HealthStatus,
  computeHealthStatus,
  computeFreshnessLevel,
  DEFAULT_FRESHNESS_INTERVAL_MINUTES,
} from "./baton-types.js";

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

const collisionStateListArb = fc.array(collisionStateArb, {
  minLength: 0,
  maxLength: 20,
});

// ---------------------------------------------------------------------------
// Property-Based Tests
// ---------------------------------------------------------------------------

describe("computeHealthStatus — Property Tests", () => {
  /**
   * **Feature: konductor-baton, Property 3: Health status rubric correctness**
   * **Validates: Requirements 2.3**
   *
   * For any set of collision states, the computed HealthStatus should be:
   * - Alerting when any state is CollisionCourse or MergeHell
   * - Warning when any state is Crossroads or Neighbors (and none are CollisionCourse/MergeHell)
   * - Healthy when the set is empty or all states are Solo
   */
  it("Property 3: Health status rubric correctness", () => {
    fc.assert(
      fc.property(collisionStateListArb, (states) => {
        const result = computeHealthStatus(states);

        const hasAlerting = states.some(
          (s) =>
            s === CollisionState.CollisionCourse ||
            s === CollisionState.MergeHell,
        );
        const hasWarning = states.some(
          (s) =>
            s === CollisionState.Crossroads ||
            s === CollisionState.Neighbors,
        );

        if (hasAlerting) {
          expect(result).toBe(HealthStatus.Alerting);
        } else if (hasWarning) {
          expect(result).toBe(HealthStatus.Warning);
        } else {
          expect(result).toBe(HealthStatus.Healthy);
        }
      }),
      { numRuns: 100 },
    );
  });
});


// ---------------------------------------------------------------------------
// Unit Tests — computeFreshnessLevel
// ---------------------------------------------------------------------------

describe("computeFreshnessLevel — Unit Tests", () => {
  /** Helper: create an ISO timestamp N minutes before now. */
  function minutesAgo(minutes: number): string {
    return new Date(Date.now() - minutes * 60_000).toISOString();
  }

  it("returns level 1 for a heartbeat just now (0 minutes ago)", () => {
    expect(computeFreshnessLevel(minutesAgo(0))).toBe(1);
  });

  it("returns level 1 for a heartbeat 9 minutes ago (within first interval)", () => {
    expect(computeFreshnessLevel(minutesAgo(9))).toBe(1);
  });

  it("returns level 2 for a heartbeat 10 minutes ago (boundary)", () => {
    expect(computeFreshnessLevel(minutesAgo(10))).toBe(2);
  });

  it("returns level 2 for a heartbeat 19 minutes ago", () => {
    expect(computeFreshnessLevel(minutesAgo(19))).toBe(2);
  });

  it("returns level 5 for a heartbeat 40 minutes ago", () => {
    expect(computeFreshnessLevel(minutesAgo(40))).toBe(5);
  });

  it("returns level 9 for a heartbeat 80 minutes ago", () => {
    expect(computeFreshnessLevel(minutesAgo(80))).toBe(9);
  });

  it("returns level 10 for a heartbeat 90 minutes ago (boundary)", () => {
    expect(computeFreshnessLevel(minutesAgo(90))).toBe(10);
  });

  it("returns level 10 for a heartbeat 200 minutes ago (clamped)", () => {
    expect(computeFreshnessLevel(minutesAgo(200))).toBe(10);
  });

  it("uses custom interval when provided", () => {
    // 5-minute intervals: 15 minutes ago → floor(15/5) + 1 = 4
    expect(computeFreshnessLevel(minutesAgo(15), 5)).toBe(4);
  });

  it("uses custom interval: 20-minute intervals, 25 minutes ago → level 2", () => {
    // floor(25/20) + 1 = 2
    expect(computeFreshnessLevel(minutesAgo(25), 20)).toBe(2);
  });

  it("clamps to level 10 with custom interval", () => {
    // 2-minute intervals: 30 minutes ago → floor(30/2) + 1 = 16, clamped to 10
    expect(computeFreshnessLevel(minutesAgo(30), 2)).toBe(10);
  });

  it("returns level 1 for a future heartbeat (clock skew)", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(computeFreshnessLevel(future)).toBe(1);
  });
});
