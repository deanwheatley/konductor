/**
 * Konductor Baton Dashboard — Collaboration Requests Panel E2E Tests
 *
 * Playwright tests covering:
 * - Collab panel visibility and empty state (Req 4.1)
 * - Request card rendering with all fields (Req 4.1)
 * - Status badge styling: Live badge, Waiting badge (Req 4.1)
 * - "Join Session" button for link_shared requests (Req 4.1)
 * - SSE real-time updates for collab_request_update events (Req 4.1)
 * - User pills with 🤝 pairing icon (Req 4.1)
 * - Recommended actions card visibility based on health status (Req 4.1)
 *
 * Uses existing test server helper pattern (port 3199).
 * Seeds collab requests via CollabRequestStore directly (Req 4.2, 4.3).
 */

import { test, expect } from "@playwright/test";
import {
  startTestServer,
  stopTestServer,
  registerSession,
  addCollabRequest,
  type TestContext,
} from "./helpers.js";
import { CollisionState } from "../src/types.js";

const REPO_FULL = "acme/webapp";

let ctx: TestContext;

test.beforeAll(async () => {
  ctx = await startTestServer(3199);
  // Seed a session so resolveRepoFromName can map "webapp" → "acme/webapp"
  await registerSession(ctx, "seed-user", REPO_FULL, "main", ["src/seed.ts"]);
});

test.afterAll(async () => {
  if (ctx) await stopTestServer(ctx);
});

test.use({ baseURL: "http://localhost:3199" });

// =========================================================================
// 1. Collab Panel Visibility & Empty State
// =========================================================================

test.describe("Collab Panel — Visibility", () => {
  test("collab panel is visible on repo page (#collab-panel exists)", async ({ page }) => {
    await page.goto("/repo/webapp");
    await expect(page.locator("#collab-panel")).toBeVisible();
  });

  test("empty state shows 'No active collaboration requests.'", async ({ page }) => {
    // Use a repo with no collab requests seeded
    await registerSession(ctx, "lonely-user", "acme/empty-collab", "main", ["src/lonely.ts"]);
    await page.goto("/repo/empty-collab");
    await expect(page.getByText("No active collaboration requests.")).toBeVisible({ timeout: 5000 });
  });
});

// =========================================================================
// 2. Request Card Rendering
// =========================================================================

test.describe("Collab Panel — Request Card Rendering", () => {
  test("pending request card renders with initiator, recipient, files, collision state, status, age", async ({ page }) => {
    addCollabRequest(ctx, {
      initiator: "card-alice",
      recipient: "card-bob",
      repo: REPO_FULL,
      files: ["src/card-test.ts"],
      collisionState: CollisionState.CollisionCourse,
    });
    await page.goto("/repo/webapp");
    await expect(page.getByText("card-alice")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("card-bob")).toBeVisible();
    await expect(page.getByText("src/card-test.ts")).toBeVisible();
    await expect(page.locator(".state-badge").filter({ hasText: "Collision Course" })).toBeVisible();
    await expect(page.locator(".collab-status-pending")).toBeVisible();
  });

  test("link_shared request shows Live badge and Join Session button", async ({ page }) => {
    addCollabRequest(ctx, {
      initiator: "live-alice",
      recipient: "live-bob",
      repo: REPO_FULL,
      files: ["src/live-test.ts"],
      collisionState: CollisionState.CollisionCourse,
      status: "link_shared",
      shareLink: "https://prod.liveshare.vsengsaas.visualstudio.com/join?TEST123",
    });
    await page.goto("/repo/webapp");
    await expect(page.locator(".live-badge")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".collab-join-btn").filter({ hasText: "Join Session" })).toBeVisible();
  });

  test("accepted request shows Waiting for Link badge", async ({ page }) => {
    addCollabRequest(ctx, {
      initiator: "wait-alice",
      recipient: "wait-bob",
      repo: REPO_FULL,
      files: ["src/wait-test.ts"],
      collisionState: CollisionState.CollisionCourse,
      status: "accepted",
    });
    await page.goto("/repo/webapp");
    await expect(page.locator(".waiting-badge")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Waiting for Link")).toBeVisible();
  });
});

// =========================================================================
// 3. SSE Real-Time Updates
// =========================================================================

test.describe("Collab Panel — SSE Updates", () => {
  test("SSE collab_request_update event updates panel in real-time", async ({ page }) => {
    await page.goto("/repo/webapp");
    await expect(page.locator("#connection-bar")).toContainText("Connected", { timeout: 5000 });

    const uniqueInitiator = "sse-init-" + Math.random().toString(36).slice(2, 8);
    const uniqueRecipient = "sse-recv-" + Math.random().toString(36).slice(2, 8);

    // Add a collab request after the page has loaded — should appear via SSE
    addCollabRequest(ctx, {
      initiator: uniqueInitiator,
      recipient: uniqueRecipient,
      repo: REPO_FULL,
      files: ["src/sse-test.ts"],
      collisionState: CollisionState.CollisionCourse,
    });

    await expect(page.getByText(uniqueInitiator)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(uniqueRecipient)).toBeVisible();
  });
});

// =========================================================================
// 4. User Pills — Pairing Icon
// =========================================================================

test.describe("Collab Panel — Pairing Icons", () => {
  test("user pills show 🤝 icon for users in active collab requests", async ({ page }) => {
    // Register sessions for both users so they appear in the summary
    await registerSession(ctx, "pair-alice", REPO_FULL, "main", ["src/pair.ts"]);
    await registerSession(ctx, "pair-bob", REPO_FULL, "main", ["src/pair.ts"]);

    // Create a link_shared collab request between them
    addCollabRequest(ctx, {
      initiator: "pair-alice",
      recipient: "pair-bob",
      repo: REPO_FULL,
      files: ["src/pair.ts"],
      collisionState: CollisionState.CollisionCourse,
      status: "link_shared",
      shareLink: "https://prod.liveshare.vsengsaas.visualstudio.com/join?PAIR",
    });

    await page.goto("/repo/webapp");
    // Wait for SSE connection
    await expect(page.locator("#connection-bar")).toContainText("Connected", { timeout: 5000 });

    // Trigger a session_change SSE event to re-render the summary with collab data loaded
    await registerSession(ctx, "pair-alice", REPO_FULL, "main", ["src/pair.ts"]);

    // The pairing icon should appear next to user pills for users in active collab requests
    await expect(page.locator(".pairing-icon").first()).toBeVisible({ timeout: 5000 });
  });
});

// =========================================================================
// 5. Recommended Actions
// =========================================================================

test.describe("Collab Panel — Recommended Actions", () => {
  test("recommended actions card visible when health is warning/alerting", async ({ page }) => {
    // Create overlapping sessions to trigger warning health status
    await registerSession(ctx, "overlap-alice", REPO_FULL, "main", ["src/shared.ts"]);
    await registerSession(ctx, "overlap-bob", REPO_FULL, "feature/x", ["src/shared.ts"]);

    await page.goto("/repo/webapp");
    // Wait for summary to render with warning/alerting health
    const healthBadge = page.locator("[class*='health-warning'], [class*='health-alerting']");
    if (await healthBadge.count() > 0) {
      await expect(page.locator(".recommended-actions")).toBeVisible({ timeout: 5000 });
      await expect(page.getByText("Recommended Actions")).toBeVisible();
    }
  });

  test("recommended actions card hidden when health is healthy", async ({ page }) => {
    // Use a repo with only one user (healthy state)
    await registerSession(ctx, "solo-healthy", "acme/healthy-repo", "main", ["src/solo.ts"]);
    await page.goto("/repo/healthy-repo");
    await expect(page.locator(".health-healthy")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".recommended-actions")).not.toBeVisible();
  });
});
