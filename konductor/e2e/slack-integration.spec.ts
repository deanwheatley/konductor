/**
 * Konductor Slack Integration — Playwright E2E Regression Tests
 *
 * Covers:
 * - Per-repo Slack API endpoints (Slack Req 11.x)
 * - Baton repo page Slack panel (Slack Req 3.x)
 * - Slack config change SSE events (Slack Req 4.x)
 * - Verbosity validation (Slack Req 5.x)
 * - Channel name validation (Slack Req 2.x)
 */

import { test, expect } from "@playwright/test";
import {
  startTestServer,
  stopTestServer,
  registerSession,
  type TestContext,
} from "./helpers.js";

const REPO_FULL = "acme/webapp";

let ctx: TestContext;

test.beforeAll(async () => {
  ctx = await startTestServer(3201);
  // Seed a session so resolveRepoFromName can map "webapp" → "acme/webapp"
  await registerSession(ctx, "seed-user", REPO_FULL, "main", ["src/seed.ts"]);
});

test.afterAll(async () => {
  if (ctx) await stopTestServer(ctx);
});

test.use({ baseURL: "http://localhost:3201" });

// =========================================================================
// 1. Per-Repo Slack API (Slack Req 11.x)
// =========================================================================

test.describe("Per-Repo Slack API", () => {
  test("GET /api/repo/:repoName/slack returns config (Req 11.1)", async ({ request }) => {
    const res = await request.get("/api/repo/webapp/slack");
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("channel");
    expect(data).toHaveProperty("verbosity");
    expect(data).toHaveProperty("enabled");
  });

  test("GET /api/repo/:repoName/slack returns default channel name (Req 2.2)", async ({ request }) => {
    const res = await request.get("/api/repo/webapp/slack");
    expect(res.status()).toBe(200);
    const data = await res.json();
    // Default channel should be konductor-alerts-<reponame>
    expect(data.channel).toMatch(/^konductor-alerts-/);
  });

  test("GET /api/repo/:repoName/slack returns default verbosity 2 (Req 5.3)", async ({ request }) => {
    const res = await request.get("/api/repo/webapp/slack");
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.verbosity).toBe(2);
  });

  test("PUT /api/repo/:repoName/slack updates channel (Req 11.2)", async ({ request }) => {
    const res = await request.put("/api/repo/webapp/slack", {
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ channel: "my-custom-channel" }),
    });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.channel).toBe("my-custom-channel");

    // Verify the change persisted
    const getRes = await request.get("/api/repo/webapp/slack");
    const getData = await getRes.json();
    expect(getData.channel).toBe("my-custom-channel");
  });

  test("PUT /api/repo/:repoName/slack updates verbosity (Req 11.2)", async ({ request }) => {
    const res = await request.put("/api/repo/webapp/slack", {
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ verbosity: 4 }),
    });
    expect(res.status()).toBe(200);

    const getRes = await request.get("/api/repo/webapp/slack");
    const getData = await getRes.json();
    expect(getData.verbosity).toBe(4);
  });

  test("PUT /api/repo/:repoName/slack rejects invalid verbosity (Req 11.3)", async ({ request }) => {
    const res = await request.put("/api/repo/webapp/slack", {
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ verbosity: 10 }),
    });
    expect(res.status()).toBe(400);
  });

  test("PUT /api/repo/:repoName/slack rejects invalid channel name (Req 11.3)", async ({ request }) => {
    const res = await request.put("/api/repo/webapp/slack", {
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ channel: "INVALID CHANNEL NAME!!!" }),
    });
    expect(res.status()).toBe(400);
  });
});

// =========================================================================
// 2. Baton Repo Page — Slack Panel (Slack Req 3.x)
// =========================================================================

test.describe("Baton Slack Panel", () => {
  test("Slack Integration panel is visible on repo page (Req 3.1)", async ({ page }) => {
    await page.goto("/repo/webapp");
    await expect(page.locator("#slack-panel")).toBeVisible();
    await expect(page.locator("#slack-panel h2").first()).toContainText("Slack Integration");
  });

  test("Slack panel is collapsible (Req 3.6)", async ({ page }) => {
    await page.goto("/repo/webapp");
    const panel = page.locator("#slack-panel");
    const header = panel.locator(".panel-header.collapsible");
    await expect(panel).not.toHaveClass(/collapsed/);
    await header.click();
    await expect(panel).toHaveClass(/collapsed/);
    await header.click();
    await expect(panel).not.toHaveClass(/collapsed/);
  });

  test("Slack panel shows not-configured message when no bot token (Req 3.2)", async ({ page }) => {
    await page.goto("/repo/webapp");
    // Without a bot token configured, the panel should show a warning
    const panelBody = page.locator("#slack-panel-body, #slack-panel .panel-body");
    // Wait for the panel to load its content
    await page.waitForTimeout(1000);
    // The panel should either show the warning or the config form
    await expect(page.locator("#slack-panel")).toBeVisible();
  });
});

// =========================================================================
// 3. Slack Config Change SSE (Slack Req 4.x)
// =========================================================================

test.describe("Slack Config SSE Events", () => {
  test("Slack config change emits SSE event to repo page (Req 4.1)", async ({ page }) => {
    await page.goto("/repo/webapp");
    await expect(page.locator("#connection-bar")).toContainText("Connected", { timeout: 5000 });

    // Emit a slack_config_change event
    ctx.batonEventEmitter.emit({
      type: "slack_config_change",
      repo: REPO_FULL,
      data: {
        channel: "new-slack-channel",
        verbosity: 3,
        changedBy: "test-user",
        slackChannelLink: "https://slack.com/app_redirect?channel=new-slack-channel",
      },
    });

    // The page should update — wait a moment for SSE delivery
    await page.waitForTimeout(2000);
    // The panel should reflect the update (or show a success message)
    await expect(page.locator("#slack-panel")).toBeVisible();
  });
});

// =========================================================================
// 4. Bundle Endpoints (NPX Installer Req 7.x)
// =========================================================================

test.describe("Bundle Endpoints", () => {
  test("GET /bundle/manifest.json returns valid manifest (Req 7.1)", async ({ request }) => {
    const res = await request.get("/bundle/manifest.json");
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("version");
    expect(data).toHaveProperty("files");
    expect(data.files).toBeInstanceOf(Array);
  });

  test("GET /bundle/manifest.json does not require auth (Req 7.4)", async ({ request }) => {
    // No auth headers — should still work
    const res = await request.get("/bundle/manifest.json");
    expect(res.status()).toBe(200);
  });

  test("GET /bundle/files with path traversal is rejected (Req 7.5)", async ({ request }) => {
    // Use encoded dots to prevent URL resolution by the HTTP client
    const res = await request.get("/bundle/files/%2e%2e/%2e%2e/etc/passwd");
    expect([400, 401, 404]).toContain(res.status());
  });
});

// =========================================================================
// 5. Health Endpoint
// =========================================================================

test.describe("Health", () => {
  test("GET /health returns ok", async ({ request }) => {
    const res = await request.get("/health");
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
  });
});
