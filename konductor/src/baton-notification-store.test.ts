import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { CollisionState } from "./types.js";
import type { WorkSession } from "./types.js";
import { HealthStatus, type BatonNotification, type BatonNotificationUser, type BatonEvent } from "./baton-types.js";
import { NotificationStore } from "./baton-notification-store.js";
import { BatonEventEmitter } from "./baton-event-emitter.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const healthStatusArb = fc.constantFrom(
  HealthStatus.Healthy,
  HealthStatus.Warning,
  HealthStatus.Alerting,
);

const collisionStateArb = fc.constantFrom(
  CollisionState.Solo,
  CollisionState.Neighbors,
  CollisionState.Crossroads,
  CollisionState.CollisionCourse,
  CollisionState.MergeHell,
);

const timestampArb = fc
  .integer({ min: 1700000000000, max: 1800000000000 })
  .map((ms) => new Date(ms).toISOString());

/** Safe string that avoids delimiters used in the pretty-print format. */
const safeIdArb = fc.stringMatching(/^[a-z0-9_]{1,15}$/);

/** Branch names: alphanumeric with slashes and dashes, no parens or commas. */
const branchArb = fc.stringMatching(/^[a-z0-9/_-]{1,20}$/);

/** Repo in owner/repo format. */
const repoArb = fc
  .tuple(
    fc.stringMatching(/^[a-z0-9]{1,10}$/),
    fc.stringMatching(/^[a-z0-9-]{1,15}$/),
  )
  .map(([owner, name]) => `${owner}/${name}`);

/** JIRA ticket IDs like PROJ-123. */
const jiraArb = fc
  .tuple(
    fc.stringMatching(/^[A-Z]{2,5}$/),
    fc.integer({ min: 1, max: 9999 }),
  )
  .map(([proj, num]) => `${proj}-${num}`);

/** Summary text: single line, no newlines, avoids delimiters that break parsing. */
const summaryArb = fc.stringMatching(/^[a-zA-Z0-9 .!?;:_-]{1,80}$/);

/** A single notification user (userId + branch, optionally with source context). */
const notificationUserArb: fc.Arbitrary<BatonNotificationUser> = fc.oneof(
  // Active user (no source or explicit "active")
  fc.record({
    userId: safeIdArb,
    branch: branchArb,
  }),
  // PR user
  fc.record({
    userId: safeIdArb,
    branch: branchArb,
    source: fc.constant("github_pr" as const),
    prNumber: fc.integer({ min: 1, max: 9999 }),
  }),
  // Commit user
  fc.record({
    userId: safeIdArb,
    branch: branchArb,
    source: fc.constant("github_commit" as const),
    commitDateRange: fc
      .tuple(
        fc.integer({ min: 2024, max: 2026 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
      )
      .map(([y, m, d]) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`),
  }),
);

/**
 * Generator for a valid BatonNotification.
 * Ensures all fields are round-trip safe for both JSON and pretty-print formats.
 */
const notificationArb: fc.Arbitrary<BatonNotification> = fc
  .record({
    id: fc.uuid(),
    repo: repoArb,
    timestamp: timestampArb,
    notificationType: healthStatusArb,
    collisionState: collisionStateArb,
    jiras: fc.array(jiraArb, { minLength: 0, maxLength: 3 }),
    summary: summaryArb,
    users: fc.array(notificationUserArb, { minLength: 0, maxLength: 4 }),
    resolved: fc.boolean(),
    resolvedAt: fc.option(timestampArb, { nil: undefined }),
  })
  .map((n) => {
    // Keep resolved/resolvedAt consistent
    if (n.resolved) {
      if (!n.resolvedAt) n.resolvedAt = new Date().toISOString();
    } else {
      delete (n as Partial<BatonNotification>).resolvedAt;
    }
    return n as BatonNotification;
  });

/**
 * Generator for a list of notifications with unique IDs, all for the same repo.
 */
function notificationListArb(repo: string, minLen = 1, maxLen = 10) {
  return fc
    .array(notificationArb, { minLength: minLen, maxLength: maxLen })
    .map((list) =>
      list.map((n, i) => ({
        ...n,
        repo,
        // ensure unique IDs
        id: `${n.id.slice(0, -4)}${String(i).padStart(4, "0")}`,
      })),
    );
}

// ---------------------------------------------------------------------------
// Property-Based Tests
// ---------------------------------------------------------------------------

describe("NotificationStore — Property Tests", () => {
  /**
   * **Feature: konductor-baton, Property 5: Resolving a notification moves it from active to resolved**
   * **Validates: Requirements 3.5**
   *
   * For any NotificationStore containing active notifications, resolving a
   * notification by ID should remove it from the active list and add it to
   * the resolved list, and the total count (active + resolved) should remain unchanged.
   */
  it("Property 5: Resolving a notification moves it from active to resolved", () => {
    fc.assert(
      fc.property(
        repoArb,
        notificationListArb("test/repo", 1, 10).chain((list) =>
          fc.record({
            notifications: fc.constant(list),
            targetIndex: fc.integer({ min: 0, max: list.length - 1 }),
          }),
        ),
        (repo, { notifications, targetIndex }) => {
          const store = new NotificationStore();
          // Force all notifications to the same repo and active state
          const items = notifications.map((n) => ({
            ...n,
            repo,
            resolved: false,
            resolvedAt: undefined,
          }));
          for (const n of items) store.add(n);

          const totalBefore =
            store.getActive(repo).length + store.getResolved(repo).length;
          const targetId = items[targetIndex].id;

          // Resolve one
          const result = store.resolve(targetId);
          expect(result).toBe(true);

          const activeAfter = store.getActive(repo);
          const resolvedAfter = store.getResolved(repo);
          const totalAfter = activeAfter.length + resolvedAfter.length;

          // Total count invariant
          expect(totalAfter).toBe(totalBefore);

          // Target moved to resolved
          expect(activeAfter.find((n) => n.id === targetId)).toBeUndefined();
          expect(resolvedAfter.find((n) => n.id === targetId)).toBeDefined();
          expect(
            resolvedAfter.find((n) => n.id === targetId)!.resolved,
          ).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Feature: konductor-baton, Property 8: Notification JSON serialization round-trip**
   * **Validates: Requirements 9.3**
   *
   * For any valid BatonNotification, serializing to JSON and then
   * deserializing should produce a notification object equivalent to the original.
   */
  it("Property 8: Notification JSON serialization round-trip", () => {
    fc.assert(
      fc.property(
        fc.array(notificationArb, { minLength: 1, maxLength: 10 }),
        (notifications) => {
          const store = new NotificationStore();
          for (const n of notifications) store.add(n);

          const json = store.serialize();
          const restored = new NotificationStore();
          restored.deserialize(json);

          // All repos present in original should round-trip
          const repos = [...new Set(notifications.map((n) => n.repo))];
          for (const repo of repos) {
            const origActive = store.getActive(repo);
            const origResolved = store.getResolved(repo);
            const restoredActive = restored.getActive(repo);
            const restoredResolved = restored.getResolved(repo);

            // Sort by id for stable comparison
            const byId = (a: BatonNotification, b: BatonNotification) =>
              a.id.localeCompare(b.id);

            expect(restoredActive.sort(byId)).toEqual(origActive.sort(byId));
            expect(restoredResolved.sort(byId)).toEqual(origResolved.sort(byId));
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Feature: konductor-baton, Property 9: Notification pretty-print round-trip**
   * **Validates: Requirements 9.5**
   *
   * For any valid BatonNotification, pretty-printing to human-readable text
   * and then parsing should produce a notification object equivalent to the original.
   */
  it("Property 9: Notification pretty-print round-trip", () => {
    fc.assert(
      fc.property(notificationArb, (notification) => {
        const store = new NotificationStore();
        const text = store.prettyPrint(notification);
        const parsed = store.parse(text);

        expect(parsed.id).toBe(notification.id);
        expect(parsed.repo).toBe(notification.repo);
        expect(parsed.timestamp).toBe(notification.timestamp);
        expect(parsed.notificationType).toBe(notification.notificationType);
        expect(parsed.collisionState).toBe(notification.collisionState);
        expect(parsed.jiras).toEqual(notification.jiras);
        expect(parsed.summary).toBe(notification.summary);
        expect(parsed.users).toEqual(notification.users.map((u) => {
          // Round-trip normalizes: active users lose source field, PR users keep prNumber, commit users keep commitDateRange
          const normalized: BatonNotificationUser = { userId: u.userId, branch: u.branch };
          if (u.source === "github_pr" && u.prNumber !== undefined) {
            normalized.source = "github_pr";
            normalized.prNumber = u.prNumber;
          } else if (u.source === "github_commit" && u.commitDateRange) {
            normalized.source = "github_commit";
            normalized.commitDateRange = u.commitDateRange;
          }
          return normalized;
        }));
        expect(parsed.resolved).toBe(notification.resolved);
        if (notification.resolved) {
          expect(parsed.resolvedAt).toBe(notification.resolvedAt);
        }
      }),
      { numRuns: 100 },
    );
  });
});


// ---------------------------------------------------------------------------
// Property 8 — Baton receives real-time GitHub events
// ---------------------------------------------------------------------------

/** Generator for a passive WorkSession (PR or commit). */
const passiveSessionArb: fc.Arbitrary<WorkSession> = fc.oneof(
  // PR session
  fc.record({
    sessionId: fc.uuid(),
    userId: safeIdArb,
    repo: repoArb,
    branch: branchArb,
    files: fc.array(fc.stringMatching(/^[a-z]{1,6}\/[a-z]{1,6}\.[a-z]{2,3}$/), { minLength: 1, maxLength: 5 }),
    createdAt: timestampArb,
    lastHeartbeat: timestampArb,
    source: fc.constant("github_pr" as const),
    prNumber: fc.integer({ min: 1, max: 9999 }),
    prUrl: fc.constant("https://github.com/org/repo/pull/1"),
    prTargetBranch: branchArb,
    prDraft: fc.boolean(),
    prApproved: fc.boolean(),
  }),
  // Commit session
  fc.record({
    sessionId: fc.uuid(),
    userId: safeIdArb,
    repo: repoArb,
    branch: branchArb,
    files: fc.array(fc.stringMatching(/^[a-z]{1,6}\/[a-z]{1,6}\.[a-z]{2,3}$/), { minLength: 1, maxLength: 5 }),
    createdAt: timestampArb,
    lastHeartbeat: timestampArb,
    source: fc.constant("github_commit" as const),
    commitDateRange: fc.record({
      earliest: timestampArb,
      latest: timestampArb,
    }),
  }),
);

describe("Baton GitHub Event Delivery — Property Tests", () => {
  /**
   * **Feature: konductor-github, Property 8: Baton receives real-time GitHub events**
   * **Validates: Requirements 7.3**
   *
   * For any set of passive session changes (PR or commit sessions being added),
   * every subscriber to the BatonEventEmitter for the affected repo receives
   * exactly one notification_added event per notification, and the event data
   * matches the notification that was added to the store.
   */
  it("Property 8: Baton receives real-time GitHub events", () => {
    fc.assert(
      fc.property(
        repoArb,
        fc.array(passiveSessionArb, { minLength: 1, maxLength: 5 }),
        fc.integer({ min: 1, max: 3 }), // number of subscribers
        (repo, sessions, subscriberCount) => {
          const emitter = new BatonEventEmitter();
          const store = new NotificationStore();

          // Bind all sessions to the same repo
          const boundSessions = sessions.map((s) => ({ ...s, repo }));

          // Set up multiple subscribers
          const receivedEvents: BatonEvent[][] = [];
          const unsubscribes: (() => void)[] = [];
          for (let i = 0; i < subscriberCount; i++) {
            const events: BatonEvent[] = [];
            receivedEvents.push(events);
            unsubscribes.push(emitter.subscribe(repo, (evt) => events.push(evt)));
          }

          // Simulate adding notifications for each passive session (as the server does)
          const addedNotifications: BatonNotification[] = [];
          for (const session of boundSessions) {
            const notification: BatonNotification = {
              id: session.sessionId,
              repo,
              timestamp: new Date().toISOString(),
              notificationType: HealthStatus.Warning,
              collisionState: CollisionState.CollisionCourse,
              jiras: [],
              summary: `Collision with ${session.userId}`,
              users: [{ userId: session.userId, branch: session.branch, source: session.source }],
              resolved: false,
            };
            store.add(notification);
            emitter.emit({ type: "notification_added", repo, data: notification });
            addedNotifications.push(notification);
          }

          // Every subscriber received exactly one event per notification
          for (let i = 0; i < subscriberCount; i++) {
            expect(receivedEvents[i].length).toBe(boundSessions.length);
            for (let j = 0; j < addedNotifications.length; j++) {
              const evt = receivedEvents[i][j];
              expect(evt.type).toBe("notification_added");
              if (evt.type === "notification_added") {
                expect(evt.data.id).toBe(addedNotifications[j].id);
                expect(evt.data.repo).toBe(repo);
                // Source context is preserved in the event
                expect(evt.data.users[0].source).toBe(boundSessions[j].source);
              }
            }
          }

          // Notifications are in the store
          const active = store.getActive(repo);
          expect(active.length).toBe(boundSessions.length);

          // Cleanup
          for (const unsub of unsubscribes) unsub();
        },
      ),
      { numRuns: 100 },
    );
  });
});
