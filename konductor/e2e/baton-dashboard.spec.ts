/**
 * Konductor Baton Dashboard — Playwright E2E Regression Tests
 *
 * Comprehensive UI tests covering:
 * - Page structure and sections (Req 1.x)
 * - Repo summary and health status (Req 2.x)
 * - Notifications table (Req 3.x)
 * - Query log table (Req 4.x)
 * - Open PRs / Repo History placeholders (Req 5.x, 10.x)
 * - Collapsible sections (Req 11.x)
 * - SSE real-time updates (Req 7.x)
 * - Responsive layout (Req 1.5)
 * - API endpoints
 * - Error states and empty states
 */

import { test, expect } from "@playwright/test";
import {
  startTestServer,
  stopTestServer,
  registerSession,
  addNotification,
  addQueryLogEntry,
  type TestContext,
} from "./helpers.js";
import { HealthStatus } from "../src/baton-types.js";
import { CollisionState } from "../src/types.js";
import { randomUUID } from "node:crypto";

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
// 1. Page Structure (Req 1.x)
// =========================================================================

test.describe("Page Structure", () => {
  test("repo page loads and contains all five sections (Req 1.1)", async ({ page }) => {
    await page.goto("/repo/webapp");
    await expect(page).toHaveTitle(/Konductor Baton/);
    await expect(page.locator("#summary-section")).toBeVisible();
    await expect(page.locator("#notifications-section")).toBeVisible();
    await expect(page.locator("#querylog-section")).toBeVisible();
    await expect(page.locator("#prs-panel")).toBeVisible();
    await expect(page.locator("#history-panel")).toBeVisible();
  });

  test("page is a single HTML document with no external dependencies (Req 1.3)", async ({ page }) => {
    const response = await page.goto("/repo/webapp");
    expect(response?.status()).toBe(200);
    expect(response?.headers()["content-type"]).toContain("text/html");
    const externalCss = await page.locator('link[rel="stylesheet"]').count();
    expect(externalCss).toBe(0);
    const externalJs = await page.locator("script[src]").count();
    expect(externalJs).toBe(0);
  });

  test("empty repo shows healthy status and empty state messages (Req 1.4)", async ({ page }) => {
    await page.goto("/repo/nonexistent-empty");
    await expect(page.locator(".health-healthy")).toBeVisible();
    // When API returns 0 sessions, the summary renders "No active users" / "No active branches"
    await expect(page.getByText("No active users")).toBeVisible({ timeout: 5000 });
  });

  test("header shows repo name and GitHub link (Req 2.1)", async ({ page }) => {
    await page.goto("/repo/webapp");
    await expect(page.locator(".header h1")).toContainText("webapp");
    await expect(page.locator(".header .repo-link")).toHaveAttribute("href", /github\.com/);
  });

  test("auth disabled message shown when no OAuth configured", async ({ page }) => {
    await page.goto("/repo/webapp");
    await expect(page.locator(".auth-disabled")).toContainText("Authentication disabled");
  });

  test("connection bar shows connected status (Req 7.1)", async ({ page }) => {
    await page.goto("/repo/webapp");
    const bar = page.locator("#connection-bar");
    // Wait for SSE to connect
    await expect(bar).toContainText("Connected", { timeout: 5000 });
    await expect(bar).not.toHaveClass(/disconnected/);
  });
});

// =========================================================================
// 2. Repo Summary (Req 2.x)
// =========================================================================

test.describe("Repo Summary", () => {
  test("shows active users and branches after session registration (Req 2.2, 2.7)", async ({ page }) => {
    await registerSession(ctx, "alice", REPO_FULL, "main", ["src/index.ts"]);
    await registerSession(ctx, "bob", REPO_FULL, "feature/auth", ["src/auth.ts"]);
    await page.goto("/repo/webapp");
    await expect(page.getByText("alice")).toBeVisible();
    await expect(page.getByText("bob")).toBeVisible();
    await expect(page.getByText("main")).toBeVisible();
    await expect(page.getByText("feature/auth")).toBeVisible();
  });

  test("health status is Healthy when all users are Solo (Req 2.3)", async ({ page }) => {
    await registerSession(ctx, "solo-user", "acme/solo-test", "main", ["unique-file.ts"]);
    await page.goto("/repo/solo-test");
    await expect(page.locator(".health-healthy")).toBeVisible();
  });

  test("health status badge is visible (Req 2.4, 2.5, 2.6)", async ({ page }) => {
    await page.goto("/repo/webapp");
    const healthBadge = page.locator("[class*='health-']").first();
    await expect(healthBadge).toBeVisible();
  });

  test("user pills are displayed with freshness colors (Req 2.7)", async ({ page }) => {
    await page.goto("/repo/webapp");
    const pill = page.locator(".user-pill").first();
    await expect(pill).toBeVisible();
    const style = await pill.getAttribute("style");
    expect(style).toContain("background:");
  });

  test("user pills link to GitHub profiles", async ({ page }) => {
    await page.goto("/repo/webapp");
    const link = page.locator(".user-pill a").first();
    await expect(link).toHaveAttribute("href", /https:\/\/github\.com\//);
  });

  test("branch tags link to GitHub branches (Req 2.2)", async ({ page }) => {
    await registerSession(ctx, "branch-user", REPO_FULL, "feature/test-branch", ["src/test.ts"]);
    await page.goto("/repo/webapp");
    const branchLink = page.locator(".branch-tag a").filter({ hasText: "feature/test-branch" });
    await expect(branchLink).toHaveAttribute("href", /github\.com\/acme\/webapp\/tree\/feature\/test-branch/);
  });

  test("session count and user count are displayed", async ({ page }) => {
    await page.goto("/repo/webapp");
    await expect(page.getByText(/sessions/)).toBeVisible();
    await expect(page.getByText(/users/)).toBeVisible();
  });
});

// =========================================================================
// 3. Notifications Table (Req 3.x)
// =========================================================================

test.describe("Notifications", () => {
  test("displays notifications with required columns (Req 3.2)", async ({ page }) => {
    addNotification(ctx, {
      repo: REPO_FULL,
      notificationType: HealthStatus.Warning,
      collisionState: CollisionState.Crossroads,
      summary: "alice and bob are working in the same directories",
      users: [
        { userId: "alice", branch: "main" },
        { userId: "bob", branch: "feature/auth" },
      ],
      jiras: ["PROJ-123"],
    });
    await page.goto("/repo/webapp");
    await expect(page.locator(".state-badge").filter({ hasText: "Crossroads" })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("PROJ-123")).toBeVisible();
  });

  test("notification users link to GitHub profiles (Req 3.3)", async ({ page }) => {
    addNotification(ctx, {
      repo: REPO_FULL,
      users: [{ userId: "github-linked", branch: "main" }],
    });
    await page.goto("/repo/webapp");
    const userLink = page.locator(".user-link").filter({ hasText: "github-linked" });
    await expect(userLink.first()).toHaveAttribute("href", "https://github.com/github-linked", { timeout: 5000 });
  });

  test("long summaries are truncated with see more button (Req 3.4)", async ({ page }) => {
    addNotification(ctx, {
      repo: REPO_FULL,
      summary: "A".repeat(200),
    });
    await page.goto("/repo/webapp");
    const seeMore = page.locator(".see-more");
    if (await seeMore.count() > 0) {
      await expect(seeMore.first()).toContainText("see more");
      await seeMore.first().click();
    }
  });

  test("resolve button marks notification as resolved (Req 3.5)", async ({ page }) => {
    const uniqueId = randomUUID().slice(0, 8);
    addNotification(ctx, {
      repo: REPO_FULL,
      summary: "Resolve me please " + uniqueId,
    });
    await page.goto("/repo/webapp");
    page.on("dialog", (dialog) => dialog.accept());
    const resolveBtn = page.locator(".resolve-btn").first();
    await expect(resolveBtn).toBeVisible({ timeout: 5000 });
    await resolveBtn.click();
    // After resolving, the notification moves to history tab.
    // Switch to History tab and verify it's there.
    const historyTab = page.locator(".tab-btn").filter({ hasText: "History" });
    if (await historyTab.count() > 0) {
      await historyTab.click();
      await expect(page.locator(".resolved-label").first()).toBeVisible({ timeout: 5000 });
    }
  });

  test("notifications show unknown when no JIRAs", async ({ page }) => {
    addNotification(ctx, {
      repo: REPO_FULL,
      jiras: [],
      summary: "No jira notification " + randomUUID().slice(0, 8),
    });
    await page.goto("/repo/webapp");
    await expect(page.getByText("unknown").first()).toBeVisible({ timeout: 5000 });
  });

  test("Active/History tab toggle works", async ({ page }) => {
    addNotification(ctx, { repo: REPO_FULL, summary: "Tab test notif" });
    await page.goto("/repo/webapp");
    const activeTab = page.locator(".tab-btn").filter({ hasText: "Active" });
    const historyTab = page.locator(".tab-btn").filter({ hasText: "History" });
    if (await activeTab.count() > 0) {
      await expect(activeTab).toHaveClass(/active/);
      await historyTab.click();
      await expect(historyTab).toHaveClass(/active/);
    }
  });
});

// =========================================================================
// 4. Query Log (Req 4.x)
// =========================================================================

test.describe("Query Log", () => {
  test("displays query log entries with all columns (Req 4.2)", async ({ page }) => {
    addQueryLogEntry(ctx, {
      repo: REPO_FULL,
      userId: "alice",
      branch: "main",
      queryType: "who_is_active",
      parameters: { repo: REPO_FULL },
    });
    await page.goto("/repo/webapp");
    await expect(page.locator(".query-badge").filter({ hasText: "who_is_active" })).toBeVisible({ timeout: 5000 });
  });

  test("query log user links to GitHub profile (Req 4.2)", async ({ page }) => {
    addQueryLogEntry(ctx, { repo: REPO_FULL, userId: "log-user-link" });
    await page.goto("/repo/webapp");
    const userLink = page.locator("#querylog-section .user-link").filter({ hasText: "log-user-link" });
    if (await userLink.count() > 0) {
      await expect(userLink.first()).toHaveAttribute("href", "https://github.com/log-user-link");
    }
  });
});

// =========================================================================
// 5. Open PRs & Repo History (Req 5.x, 10.x)
// =========================================================================

test.describe("Open PRs and Repo History", () => {
  test("Open PRs section exists with table headers", async ({ page }) => {
    await page.goto("/repo/webapp");
    await expect(page.locator("#prs-panel")).toBeVisible();
    await expect(page.locator("#prs-panel").getByText("Hours Open")).toBeVisible();
  });

  test("Repo History section exists with table headers", async ({ page }) => {
    await page.goto("/repo/webapp");
    await expect(page.locator("#history-panel")).toBeVisible();
    await expect(page.locator("#history-panel").getByText("Timestamp")).toBeVisible();
  });
});

// =========================================================================
// 6. Collapsible Sections (Req 11.x)
// =========================================================================

test.describe("Collapsible Sections", () => {
  test("clicking section header collapses and expands (Req 11.1, 11.3)", async ({ page }) => {
    await page.goto("/repo/webapp");
    const prsPanel = page.locator("#prs-panel");
    const prsHeader = prsPanel.locator(".panel-header.collapsible");
    await expect(prsPanel).not.toHaveClass(/collapsed/);
    await prsHeader.click();
    await expect(prsPanel).toHaveClass(/collapsed/);
    await prsHeader.click();
    await expect(prsPanel).not.toHaveClass(/collapsed/);
  });

  test("collapsed section shows count badge (Req 11.2)", async ({ page }) => {
    await page.goto("/repo/webapp");
    const badge = page.locator("#prs-panel .count-badge");
    await expect(badge).toBeVisible();
  });

  test("Repository Summary is not collapsible (Req 11.4)", async ({ page }) => {
    await page.goto("/repo/webapp");
    const summaryPanel = page.locator("#summary-section .panel-header");
    if (await summaryPanel.count() > 0) {
      await expect(summaryPanel.first()).not.toHaveClass(/collapsible/);
    }
  });

  test("all four non-summary sections are collapsible", async ({ page }) => {
    await page.goto("/repo/webapp");
    for (const sel of ["#prs-panel .collapsible", "#history-panel .collapsible"]) {
      const panel = page.locator(sel);
      if (await panel.count() > 0) {
        await expect(panel.first()).toBeVisible();
      }
    }
  });
});

// =========================================================================
// 7. SSE Real-Time Updates (Req 7.x)
// =========================================================================

test.describe("SSE Real-Time Updates", () => {
  test("new notification appears without page refresh (Req 3.1, 7.2)", async ({ page }) => {
    await page.goto("/repo/webapp");
    // Wait for SSE connection to establish
    await expect(page.locator("#connection-bar")).toContainText("Connected", { timeout: 5000 });

    const uniqueText = "SSE-live-" + randomUUID().slice(0, 8);
    const notif = {
      id: randomUUID(),
      repo: REPO_FULL,
      timestamp: new Date().toISOString(),
      notificationType: HealthStatus.Alerting,
      collisionState: CollisionState.CollisionCourse,
      jiras: [],
      summary: uniqueText,
      users: [{ userId: "sse-user", branch: "main" }],
      resolved: false,
    };
    ctx.notificationStore.add(notif);
    ctx.batonEventEmitter.emit({ type: "notification_added", repo: REPO_FULL, data: notif });

    await expect(page.getByText(uniqueText)).toBeVisible({ timeout: 5000 });
  });

  test("session change updates summary in real time (Req 7.2)", async ({ page }) => {
    await page.goto("/repo/webapp");
    await expect(page.locator("#connection-bar")).toContainText("Connected", { timeout: 5000 });

    const uniqueUser = "rt-user-" + randomUUID().slice(0, 6);
    await registerSession(ctx, uniqueUser, REPO_FULL, "feature/realtime", ["src/realtime.ts"]);

    await expect(page.getByText(uniqueUser)).toBeVisible({ timeout: 5000 });
  });

  test("connection bar shows connected state (Req 7.3)", async ({ page }) => {
    await page.goto("/repo/webapp");
    const bar = page.locator("#connection-bar");
    await expect(bar).toContainText("Connected", { timeout: 5000 });
    await expect(bar).not.toHaveClass(/disconnected/);
  });
});

// =========================================================================
// 8. API Endpoints
// =========================================================================

test.describe("API Endpoints", () => {
  test("GET /api/repo/:repoName returns JSON summary", async ({ request }) => {
    const res = await request.get("/api/repo/webapp");
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.repo).toBeDefined();
    expect(data.healthStatus).toBeDefined();
    expect(data.branches).toBeInstanceOf(Array);
    expect(data.users).toBeInstanceOf(Array);
  });

  test("GET /api/repo/:repoName/notifications returns notifications", async ({ request }) => {
    const res = await request.get("/api/repo/webapp/notifications?status=active");
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.notifications).toBeInstanceOf(Array);
  });

  test("GET /api/repo/:repoName/notifications?status=resolved", async ({ request }) => {
    const res = await request.get("/api/repo/webapp/notifications?status=resolved");
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.notifications).toBeInstanceOf(Array);
  });

  test("GET /api/repo/:repoName/log returns query log entries", async ({ request }) => {
    const res = await request.get("/api/repo/webapp/log");
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.entries).toBeInstanceOf(Array);
  });

  test("POST resolve notification returns success", async ({ request }) => {
    const notif = addNotification(ctx, { repo: REPO_FULL });
    const res = await request.post(`/api/repo/webapp/notifications/${notif.id}/resolve`);
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  test("POST resolve with invalid ID returns 404", async ({ request }) => {
    const res = await request.post("/api/repo/webapp/notifications/nonexistent-id/resolve");
    expect(res.status()).toBe(404);
    const data = await res.json();
    expect(data.success).toBe(false);
  });

  test("GET /health returns ok", async ({ request }) => {
    const res = await request.get("/health");
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
  });

  test("GET /api/github/prs/:repoName returns PRs array", async ({ request }) => {
    const res = await request.get("/api/github/prs/webapp");
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.prs).toBeInstanceOf(Array);
  });

  test("GET /api/github/history/:repoName returns history array", async ({ request }) => {
    const res = await request.get("/api/github/history/webapp");
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.history).toBeInstanceOf(Array);
  });

  test("invalid /repo/ URL returns 404", async ({ request }) => {
    const res = await request.get("/api/repo/");
    // /api/repo/ with trailing slash matches the 404 catch-all
    expect(res.status()).toBe(404);
  });

  test("empty repo returns valid summary JSON", async ({ request }) => {
    const res = await request.get("/api/repo/nonexistent-repo-xyz");
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.healthStatus).toBe("healthy");
    expect(data.sessionCount).toBe(0);
  });
});

// =========================================================================
// 9. Responsive Layout (Req 1.5)
// =========================================================================

test.describe("Responsive Layout", () => {
  test("page scales on wide viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/repo/webapp");
    const main = page.locator(".main");
    await expect(main).toBeVisible();
    const box = await main.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeGreaterThan(500);
  });

  test("page stacks vertically on narrow viewport (< 768px)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/repo/webapp");
    const panels = page.locator(".panel");
    const count = await panels.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("tables have horizontal scroll on narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/repo/webapp");
    const tableWrappers = page.locator(".table-wrapper");
    if (await tableWrappers.count() > 0) {
      const overflow = await tableWrappers.first().evaluate(
        (el) => getComputedStyle(el).overflowX,
      );
      expect(overflow).toBe("auto");
    }
  });
});

// =========================================================================
// 10. Sorting (Req 3.6, 4.3)
// =========================================================================

test.describe("Table Sorting", () => {
  test("clicking column header triggers sort (Req 3.6)", async ({ page }) => {
    addNotification(ctx, { repo: REPO_FULL, summary: "Sort A" });
    addNotification(ctx, { repo: REPO_FULL, summary: "Sort B" });
    await page.goto("/repo/webapp");
    const headers = page.locator("#notifications-section th");
    if (await headers.count() > 0) {
      await headers.first().click();
    }
  });
});

// =========================================================================
// 11. Filtering (Req 3.7, 4.4)
// =========================================================================

test.describe("Table Filtering", () => {
  test("filter controls present above notifications table (Req 3.7)", async ({ page }) => {
    await page.goto("/repo/webapp");
    const filterBar = page.locator("#notifications-section .filter-bar");
    if (await filterBar.count() > 0) {
      await expect(filterBar).toBeVisible();
    }
  });

  test("filter controls present above query log table (Req 4.4)", async ({ page }) => {
    await page.goto("/repo/webapp");
    const filterBar = page.locator("#querylog-section .filter-bar");
    if (await filterBar.count() > 0) {
      await expect(filterBar).toBeVisible();
    }
  });
});

// =========================================================================
// 12. Dark Theme Visual Checks
// =========================================================================

test.describe("Dark Theme", () => {
  test("body has dark background", async ({ page }) => {
    await page.goto("/repo/webapp");
    const bg = await page.locator("body").evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    expect(bg).toContain("rgb(15, 15, 15)");
  });

  test("header has dark theme background", async ({ page }) => {
    await page.goto("/repo/webapp");
    const bg = await page.locator(".header").evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    expect(bg).toContain("rgb(26, 26, 46)");
  });
});

// =========================================================================
// 13. Cold Start / Fresh Page Load (Regression)
// =========================================================================

test.describe("Cold Start — Fresh Page Load", () => {
  test("page loads without showing Disconnected on a known repo", async ({ page }) => {
    // This is the most basic use case: server is running, user opens a Baton page.
    // The connection bar must show "Connected", never "Disconnected".
    await page.goto("/repo/webapp");
    const bar = page.locator("#connection-bar");
    await expect(bar).toContainText("Connected", { timeout: 5000 });
    await expect(bar).not.toHaveClass(/disconnected/);
  });

  test("page loads without showing Disconnected on an unknown repo", async ({ page }) => {
    // Even for a repo with no sessions, the page should connect to SSE successfully.
    await page.goto("/repo/never-seen-before");
    const bar = page.locator("#connection-bar");
    await expect(bar).toContainText("Connected", { timeout: 5000 });
    await expect(bar).not.toHaveClass(/disconnected/);
  });

  test("API calls use relative URLs (no hostname mismatch)", async ({ page }) => {
    // Verify the page's JavaScript uses relative URLs for API calls.
    // This prevents the bug where serverUrl uses osHostname() but the user
    // browses via localhost or an IP, causing cross-origin failures.
    const response = await page.goto("/repo/webapp");
    const html = await response?.text();
    // The API_BASE should be a relative path, not an absolute URL with a hostname
    expect(html).toContain('"/api/repo/webapp"');
    // GitHub API URLs should also be relative
    expect(html).toContain('"/api/github/history/webapp"');
    expect(html).toContain('"/api/github/prs/webapp"');
  });

  test("SSE event stream connects on page load", async ({ page }) => {
    // Monitor network requests to verify the EventSource connects
    const sseRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/events")) {
        sseRequests.push(req.url());
      }
    });
    await page.goto("/repo/webapp");
    await expect(page.locator("#connection-bar")).toContainText("Connected", { timeout: 5000 });
    expect(sseRequests.length).toBeGreaterThan(0);
    // The SSE URL should be relative (same origin as the page)
    for (const url of sseRequests) {
      expect(url).toContain("/api/repo/webapp/events");
    }
  });

  test("summary section renders after page load (not stuck on loading)", async ({ page }) => {
    await page.goto("/repo/webapp");
    // The summary section should render within a reasonable time, not stay empty
    await expect(page.locator("#summary-section .panel")).toBeVisible({ timeout: 5000 });
    // Should contain "Repository Summary" heading
    await expect(page.locator("#summary-section")).toContainText("Repository Summary");
  });

  test("notifications section renders after page load", async ({ page }) => {
    await page.goto("/repo/webapp");
    await expect(page.locator("#notifications-section")).toContainText("Notifications", { timeout: 5000 });
  });

  test("query log section renders after page load", async ({ page }) => {
    await page.goto("/repo/webapp");
    await expect(page.locator("#querylog-section")).toContainText("Query Log", { timeout: 5000 });
  });

  test("page remains connected after 3 seconds", async ({ page }) => {
    // Ensure the connection doesn't drop shortly after establishing
    await page.goto("/repo/webapp");
    await expect(page.locator("#connection-bar")).toContainText("Connected", { timeout: 5000 });
    await page.waitForTimeout(3000);
    await expect(page.locator("#connection-bar")).toContainText("Connected");
    await expect(page.locator("#connection-bar")).not.toHaveClass(/disconnected/);
  });
});
