/**
 * Property-Based Tests for Proactive Collision Push
 *
 * Uses fast-check to verify correctness properties from the design document.
 * Feature: konductor-bugs-and-missing-features
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { ServerResponse } from "node:http";
import {
  UserTransportRegistry,
  buildCollisionAlert,
  pushCollisionAlerts,
  writeSseEvent,
} from "./proactive-push.js";
import { CollisionState } from "./types.js";
import type { CollisionResult, WorkSession } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fake ServerResponse that captures written data. */
function createFakeResponse(): { res: ServerResponse; chunks: string[] } {
  const chunks: string[] = [];
  const res = {
    writableEnded: false,
    destroyed: false,
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
  } as unknown as ServerResponse;
  return { res, chunks };
}

/** Create a fake ServerResponse that is already closed. */
function createClosedResponse(): ServerResponse {
  return {
    writableEnded: true,
    destroyed: true,
    write() { throw new Error("stream closed"); },
  } as unknown as ServerResponse;
}

/** Build a minimal WorkSession for testing. */
function makeSession(userId: string, repo: string, branch: string, files: string[]): WorkSession {
  return {
    sessionId: `session-${userId}`,
    userId,
    repo,
    branch,
    files,
    createdAt: new Date().toISOString(),
    lastHeartbeat: new Date().toISOString(),
  };
}

/** Build a CollisionResult with overlapping sessions. */
function makeCollisionResult(
  state: CollisionState,
  queryingUser: string,
  repo: string,
  overlappingUserIds: string[],
  sharedFiles: string[],
): CollisionResult {
  const overlappingSessions = overlappingUserIds.map((uid) =>
    makeSession(uid, repo, "main", sharedFiles),
  );
  return {
    state,
    queryingUser,
    repo,
    overlappingSessions,
    overlappingDetails: overlappingSessions.map((s) => ({
      session: s,
      source: "active" as const,
      sharedFiles,
      severity: state,
    })),
    sharedFiles,
    sharedDirectories: [],
    actions: [],
  };
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const userIdArb = fc.stringMatching(/^[a-z][a-z0-9_]{1,10}$/);
const repoArb = fc.stringMatching(/^[a-z]{2,8}\/[a-z]{2,8}$/);
const filePathArb = fc.stringMatching(/^[a-z]{1,8}\/[a-z][a-z0-9-]{0,12}\.[a-z]{2,4}$/);
const fileListArb = fc.uniqueArray(filePathArb, { minLength: 1, maxLength: 5 });

/** Generate a non-solo collision state. */
const nonSoloStateArb = fc.constantFrom(
  CollisionState.Neighbors,
  CollisionState.Crossroads,
  CollisionState.Proximity,
  CollisionState.CollisionCourse,
  CollisionState.MergeHell,
);

// ---------------------------------------------------------------------------
// Property 5: Proactive collision push reaches affected users
// **Feature: konductor-bugs-and-missing-features, Property 5: Proactive collision push reaches affected users**
// **Validates: Requirements 3.1, 3.4**
// ---------------------------------------------------------------------------

describe("Proactive Collision Push Reaches Affected Users — Property Tests", () => {
  /**
   * **Feature: konductor-bugs-and-missing-features, Property 5: Proactive collision push reaches affected users**
   * **Validates: Requirements 3.1, 3.4**
   *
   * For any registration that creates a collision (state ≠ solo), all overlapping users
   * with active SSE connections SHALL receive a collision_alert event containing the
   * collision state, shared files, and triggering user.
   */
  it("Property 5: all overlapping users with SSE connections receive collision_alert", () => {
    fc.assert(
      fc.property(
        userIdArb,
        fc.uniqueArray(userIdArb, { minLength: 1, maxLength: 5 }),
        repoArb,
        nonSoloStateArb,
        fileListArb,
        (triggeringUser, overlappingUsers, repo, state, sharedFiles) => {
          // Ensure triggering user is not in the overlapping list
          const filteredOverlapping = overlappingUsers.filter((u) => u !== triggeringUser);
          fc.pre(filteredOverlapping.length > 0);

          const registry = new UserTransportRegistry();
          const responseMap = new Map<string, { res: ServerResponse; chunks: string[] }>();

          // Register SSE connections for each overlapping user
          for (const userId of filteredOverlapping) {
            const fake = createFakeResponse();
            registry.add(userId, fake.res);
            responseMap.set(userId, fake);
          }

          const result = makeCollisionResult(state, triggeringUser, repo, filteredOverlapping, sharedFiles);
          const summary = `[${state.toUpperCase()}] collision on ${repo}`;

          const notifiedCount = pushCollisionAlerts(registry, repo, result, triggeringUser, summary);

          // All overlapping users with connections should be notified
          expect(notifiedCount).toBe(filteredOverlapping.length);

          // Each user should have received exactly one SSE event
          for (const userId of filteredOverlapping) {
            const { chunks } = responseMap.get(userId)!;
            expect(chunks.length).toBe(1);

            // Parse the SSE event
            const eventStr = chunks[0];
            expect(eventStr).toContain("event: collision_alert");
            expect(eventStr).toContain("data: ");

            // Extract and parse the JSON data
            const dataLine = eventStr.split("\n").find((l) => l.startsWith("data: "));
            expect(dataLine).toBeDefined();
            const payload = JSON.parse(dataLine!.slice(6));

            // Verify payload contains required fields (Req 3.4)
            expect(payload.type).toBe("collision_alert");
            expect(payload.repo).toBe(repo);
            expect(payload.collisionState).toBe(state);
            expect(payload.triggeringUser).toBe(triggeringUser);
            expect(payload.sharedFiles).toEqual(sharedFiles);
            expect(payload.summary).toBe(summary);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("Property 5 (cont.): solo state never triggers proactive push", () => {
    fc.assert(
      fc.property(
        userIdArb,
        repoArb,
        fileListArb,
        (triggeringUser, repo, sharedFiles) => {
          const registry = new UserTransportRegistry();
          const fake = createFakeResponse();
          registry.add("some-other-user", fake.res);

          const result = makeCollisionResult(CollisionState.Solo, triggeringUser, repo, [], sharedFiles);
          const notifiedCount = pushCollisionAlerts(registry, repo, result, triggeringUser, "solo");

          expect(notifiedCount).toBe(0);
          expect(fake.chunks.length).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("Property 5 (cont.): triggering user is never notified about their own registration", () => {
    fc.assert(
      fc.property(
        userIdArb,
        repoArb,
        nonSoloStateArb,
        fileListArb,
        (triggeringUser, repo, state, sharedFiles) => {
          const registry = new UserTransportRegistry();
          const triggerFake = createFakeResponse();
          const otherFake = createFakeResponse();

          // Register both the triggering user and another user
          registry.add(triggeringUser, triggerFake.res);
          registry.add("other-user", otherFake.res);

          // Include triggering user in overlapping sessions (they should be skipped)
          const result = makeCollisionResult(state, triggeringUser, repo, [triggeringUser, "other-user"], sharedFiles);

          pushCollisionAlerts(registry, repo, result, triggeringUser, "test");

          // Triggering user should NOT receive the event
          expect(triggerFake.chunks.length).toBe(0);
          // Other user should receive the event
          expect(otherFake.chunks.length).toBe(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("Property 5 (cont.): closed transports are handled gracefully without blocking", () => {
    fc.assert(
      fc.property(
        userIdArb,
        fc.uniqueArray(userIdArb, { minLength: 1, maxLength: 3 }),
        repoArb,
        nonSoloStateArb,
        fileListArb,
        (triggeringUser, overlappingUsers, repo, state, sharedFiles) => {
          const filteredOverlapping = overlappingUsers.filter((u) => u !== triggeringUser);
          fc.pre(filteredOverlapping.length > 0);

          const registry = new UserTransportRegistry();

          // Register closed responses for all overlapping users
          for (const userId of filteredOverlapping) {
            const closedRes = createClosedResponse();
            registry.add(userId, closedRes);
          }

          const result = makeCollisionResult(state, triggeringUser, repo, filteredOverlapping, sharedFiles);

          // Should not throw, even with all closed transports
          const notifiedCount = pushCollisionAlerts(registry, repo, result, triggeringUser, "test");

          // No users should be notified (all transports are closed)
          expect(notifiedCount).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
