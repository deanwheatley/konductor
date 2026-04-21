/**
 * Konductor Admin Dashboard — Playwright E2E Regression Tests
 *
 * Covers:
 * - Login flow and access control (Admin Req 1.x, 2.x)
 * - System Settings panel (Admin Req 3.x)
 * - Global Client Settings / Channels panel (Admin Req 4.x)
 * - Client Install Commands panel (Admin Req 5.x)
 * - User Management panel (Admin Req 7.x)
 * - Slack Integration panel (Admin Req 6.x, Slack Req 6.x)
 * - Collapsible panels (Admin Req matching Baton design)
 * - SSE real-time updates (Admin Req 10.x)
 * - Admin API endpoints
 */

import { test, expect } from "@playwright/test";
import {
  startTestServer,
  stopTestServer,
  loginAsAdmin,
  registerSession,
  type TestContext,
} from "./helpers.js";

let ctx: TestContext;
let adminCookie: string;

test.beforeAll(async () => {
  ctx = await startTestServer(3200);
  adminCookie = await loginAsAdmin(ctx.baseUrl, ctx.apiKey);
  // Seed a session so user management has data
  await registerSession(ctx, "test-admin", "acme/webapp", "main", ["src/index.ts"]);
});

test.afterAll(async () => {
  if (ctx) await stopTestServer(ctx);
});

test.use({ baseURL: "http://localhost:3200" });

// =========================================================================
// 1. Login Flow (Admin Req 2.x)
// =========================================================================

test.describe("Login Flow", () => {
  test("GET /login serves login page (Req 2.1)", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveTitle(/Konductor Admin.*Login/);
    await expect(page.locator("#userId")).toBeVisible();
    await expect(page.locator("#apiKey")).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test("invalid credentials show error (Req 2.3)", async ({ page }) => {
    await page.goto("/login");
    await page.fill("#userId", "test-admin");
    await page.fill("#apiKey", "wrong-key");
    await page.click('button[type="submit"]');
    await expect(page.locator(".error-message")).toContainText("Invalid credentials");
  });

  test("valid credentials redirect to /admin (Req 2.2)", async ({ page }) => {
    await page.goto("/login");
    await page.fill("#userId", "test-admin");
    await page.fill("#apiKey", ctx.apiKey);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/admin");
    await expect(page).toHaveTitle(/Konductor Admin Dashboard/);
  });

  test("unauthenticated /admin redirects to /login (Req 2.1)", async ({ page }) => {
    // Clear cookies to ensure no session
    await page.context().clearCookies();
    await page.goto("/admin");
    await page.waitForURL("**/login");
    await expect(page.locator("#userId")).toBeVisible();
  });

  test("non-admin user gets 403 (Req 1.4)", async ({ request }) => {
    // Login as a non-admin user
    const loginRes = await request.post("/login", {
      form: { userId: "regular-user", apiKey: ctx.apiKey },
    });
    // The login succeeds (sets cookie) but /admin should return 403
    const cookie = loginRes.headers()["set-cookie"] ?? "";
    const match = cookie.match(/konductor_admin_session=([^;]+)/);
    if (match) {
      const res = await request.get("/admin", {
        headers: { Cookie: `konductor_admin_session=${match[1]}` },
      });
      expect(res.status()).toBe(403);
    }
  });
});

// =========================================================================
// 2. Admin Dashboard Structure (Admin Req 3.x, 4.x, 5.x, 7.x)
// =========================================================================

test.describe("Dashboard Structure", () => {
  test("admin dashboard loads with all panels", async ({ page }) => {
    await page.context().addCookies([{
      name: "konductor_admin_session",
      value: adminCookie.replace("konductor_admin_session=", ""),
      url: ctx.baseUrl,
    }]);
    await page.goto("/admin");
    await expect(page).toHaveTitle(/Konductor Admin Dashboard/);
    await expect(page.locator("#settings-panel")).toBeVisible();
    await expect(page.locator("#channels-panel")).toBeVisible();
    await expect(page.locator("#slack-panel")).toBeVisible();
    await expect(page.locator("#install-panel")).toBeVisible();
    await expect(page.locator("#users-panel")).toBeVisible();
    await expect(page.locator("#freshness-panel")).toBeVisible();
  });

  test("header shows admin username and logout link", async ({ page }) => {
    await page.context().addCookies([{
      name: "konductor_admin_session",
      value: adminCookie.replace("konductor_admin_session=", ""),
      url: ctx.baseUrl,
    }]);
    await page.goto("/admin");
    await expect(page.locator(".user-name")).toContainText("test-admin");
    await expect(page.locator(".logout-link")).toBeVisible();
  });

  test("connection bar shows connected status", async ({ page }) => {
    await page.context().addCookies([{
      name: "konductor_admin_session",
      value: adminCookie.replace("konductor_admin_session=", ""),
      url: ctx.baseUrl,
    }]);
    await page.goto("/admin");
    await expect(page.locator("#connection-bar")).toContainText("Connected", { timeout: 5000 });
  });
});

// =========================================================================
// 3. Collapsible Panels
// =========================================================================

test.describe("Collapsible Panels", () => {
  test("panels collapse and expand on header click", async ({ page }) => {
    await page.context().addCookies([{
      name: "konductor_admin_session",
      value: adminCookie.replace("konductor_admin_session=", ""),
      url: ctx.baseUrl,
    }]);
    await page.goto("/admin");
    const panel = page.locator("#settings-panel");
    const header = panel.locator(".panel-header.collapsible");
    await expect(panel).not.toHaveClass(/collapsed/);
    await header.click();
    await expect(panel).toHaveClass(/collapsed/);
    await header.click();
    await expect(panel).not.toHaveClass(/collapsed/);
  });
});

// =========================================================================
// 4. Admin API Endpoints
// =========================================================================

test.describe("Admin API", () => {
  const adminHeaders = () => ({
    Authorization: `Bearer ${ctx.apiKey}`,
    "X-Konductor-User": "test-admin",
  });

  test("GET /api/admin/settings returns settings (Req 3.1)", async ({ request }) => {
    const res = await request.get("/api/admin/settings", { headers: adminHeaders() });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.settings).toBeDefined();
  });

  test("PUT /api/admin/settings/:key updates setting (Req 3.2)", async ({ request }) => {
    const res = await request.put("/api/admin/settings/testKey", {
      headers: { ...adminHeaders(), "Content-Type": "application/json" },
      data: JSON.stringify({ value: "testValue", category: "system" }),
    });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  test("GET /api/admin/channels returns channel metadata (Req 4.1)", async ({ request }) => {
    const res = await request.get("/api/admin/channels", { headers: adminHeaders() });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.channels).toBeDefined();
  });

  test("POST /api/admin/channels/promote with invalid channel returns 400", async ({ request }) => {
    const res = await request.post("/api/admin/channels/promote", {
      headers: { ...adminHeaders(), "Content-Type": "application/json" },
      data: JSON.stringify({ source: "invalid", destination: "prod" }),
    });
    expect(res.status()).toBe(400);
  });

  test("GET /api/admin/users returns user list (Req 7.1)", async ({ request }) => {
    const res = await request.get("/api/admin/users", { headers: adminHeaders() });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.users).toBeInstanceOf(Array);
  });

  test("GET /api/admin/install-commands returns commands (Req 5.1)", async ({ request }) => {
    const res = await request.get("/api/admin/install-commands", { headers: adminHeaders() });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data).toBeDefined();
  });

  test("GET /api/admin/slack returns Slack status (Slack Req 11.5)", async ({ request }) => {
    const res = await request.get("/api/admin/slack", { headers: adminHeaders() });
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("configured");
    expect(data).toHaveProperty("authMode");
  });

  test("unauthenticated admin API returns 401", async ({ request }) => {
    const res = await request.get("/api/admin/settings");
    expect(res.status()).toBe(401);
  });

  test("non-admin admin API returns 403", async ({ request }) => {
    const res = await request.get("/api/admin/settings", {
      headers: {
        Authorization: `Bearer ${ctx.apiKey}`,
        "X-Konductor-User": "regular-user",
      },
    });
    expect(res.status()).toBe(403);
  });
});

// =========================================================================
// 5. Install Commands Panel (Admin Req 5.x)
// =========================================================================

test.describe("Install Commands Panel", () => {
  test("install commands panel shows channel selector", async ({ page }) => {
    await page.context().addCookies([{
      name: "konductor_admin_session",
      value: adminCookie.replace("konductor_admin_session=", ""),
      url: ctx.baseUrl,
    }]);
    await page.goto("/admin");
    const panel = page.locator("#install-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Install Commands")).toBeVisible();
  });
});

// =========================================================================
// 6. Slack Integration Panel (Admin Req 6.x)
// =========================================================================

test.describe("Admin Slack Panel", () => {
  test("Slack panel is visible on admin dashboard", async ({ page }) => {
    await page.context().addCookies([{
      name: "konductor_admin_session",
      value: adminCookie.replace("konductor_admin_session=", ""),
      url: ctx.baseUrl,
    }]);
    await page.goto("/admin");
    await expect(page.locator("#slack-panel")).toBeVisible();
    await expect(page.locator("#slack-panel").getByRole("heading", { name: /Slack Integration/ })).toBeVisible();
  });
});
