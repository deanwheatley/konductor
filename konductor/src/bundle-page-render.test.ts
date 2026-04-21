/**
 * Tests — Bundle Manager page renders correctly with auth
 *
 * Validates that GET /admin/bundles:
 * - Requires authentication (redirects to /login without it)
 * - Returns 403 for non-admin users
 * - Renders the Bundle Manager page HTML for authenticated admins
 * - Shows "Local Store Mode" badge when KONDUCTOR_SERVE_CLIENT_BUNDLES_FROM_LOCAL_STORE=true
 * - Contains expected structural elements (channel summary, bundle table, back link)
 *
 * Requirements: 5.1, 5.2, 5.3, 5.5, 5.6
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { handleAdminRoute, type AdminRouteDeps } from "./admin-routes.js";
import { AdminSettingsStore } from "./admin-settings-store.js";
import { MemorySettingsBackend } from "./settings-store.js";
import { InstallerChannelStore } from "./installer-channel-store.js";
import { resetSessionSecret } from "./admin-auth.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_API_KEY = "bundle-page-test-key-12345";
const TEST_SECRET = "bundle-page-test-secret-long-enough";

function createTestServer(envOverrides?: Record<string, string>): {
  server: Server;
  start: () => Promise<number>;
  close: () => Promise<void>;
} {
  const settingsBackend = new MemorySettingsBackend();
  const adminSettingsStore = new AdminSettingsStore(settingsBackend);
  const installerChannelStore = new InstallerChannelStore();

  const deps: AdminRouteDeps = {
    apiKey: TEST_API_KEY,
    adminSettingsStore,
    installerChannelStore,
    serverUrl: "http://localhost:0",
    port: 0,
    protocol: "http",
    useTls: false,
    getUsers: async () => [
      { userId: "admin1", admin: true, adminSource: "env" as const },
      { userId: "viewer", admin: false, adminSource: null },
    ],
    updateUser: async () => true,
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const handled = await handleAdminRoute(req, res, url, deps);
    if (!handled) {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  return {
    server,
    start: () =>
      new Promise<number>((resolve) => {
        server.listen(0, () => {
          const addr = server.address();
          resolve(typeof addr === "object" && addr ? addr.port : 0);
        });
      }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function adminHeaders() {
  return {
    Authorization: `Bearer ${TEST_API_KEY}`,
    "X-Konductor-User": "admin1",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Bundle Manager Page — GET /admin/bundles", () => {
  let port: number;
  let close: () => Promise<void>;

  beforeEach(async () => {
    process.env.KONDUCTOR_SESSION_SECRET = TEST_SECRET;
    process.env.KONDUCTOR_ADMINS = "admin1";
    process.env.KONDUCTOR_ADMIN_AUTH = "false";
    process.env.KONDUCTOR_SERVE_CLIENT_BUNDLES_FROM_LOCAL_STORE = "true";
    resetSessionSecret();

    const s = createTestServer();
    port = await s.start();
    close = s.close;
  });

  afterEach(async () => {
    await close();
    delete process.env.KONDUCTOR_SESSION_SECRET;
    delete process.env.KONDUCTOR_ADMINS;
    delete process.env.KONDUCTOR_ADMIN_AUTH;
    delete process.env.KONDUCTOR_SERVE_CLIENT_BUNDLES_FROM_LOCAL_STORE;
    resetSessionSecret();
  });

  it("redirects to /login when not authenticated (Req 5.1)", async () => {
    // Disable auth bypass for this test
    process.env.KONDUCTOR_ADMIN_AUTH = "true";

    const res = await fetch(`http://localhost:${port}/admin/bundles`, {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("returns 403 for non-admin user (Req 5.1)", async () => {
    // Disable auth bypass for this test
    process.env.KONDUCTOR_ADMIN_AUTH = "true";

    const res = await fetch(`http://localhost:${port}/admin/bundles`, {
      headers: {
        Authorization: `Bearer ${TEST_API_KEY}`,
        "X-Konductor-User": "viewer",
      },
    });
    expect(res.status).toBe(403);
    const html = await res.text();
    expect(html).toContain("403 Forbidden");
  });

  it("renders page for authenticated admin (Req 5.1)", async () => {
    const res = await fetch(`http://localhost:${port}/admin/bundles`, {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Bundle Manager");
  });

  it("contains channel summary cards (Req 5.2)", async () => {
    const res = await fetch(`http://localhost:${port}/admin/bundles`, {
      headers: adminHeaders(),
    });
    const html = await res.text();
    expect(html).toContain('id="card-dev"');
    expect(html).toContain('id="card-uat"');
    expect(html).toContain('id="card-prod"');
    expect(html).toContain('id="card-latest"');
  });

  it("contains bundle table with expected columns (Req 5.3)", async () => {
    const res = await fetch(`http://localhost:${port}/admin/bundles`, {
      headers: adminHeaders(),
    });
    const html = await res.text();
    expect(html).toContain('id="bundle-table"');
    expect(html).toContain("Version");
    expect(html).toContain("Channels");
    expect(html).toContain("Size");
    expect(html).toContain("Created");
    expect(html).toContain("Author");
    expect(html).toContain("Notes");
    expect(html).toContain("Actions");
  });

  it("shows Local Store Mode badge when env var is true (Req 5.5)", async () => {
    const res = await fetch(`http://localhost:${port}/admin/bundles`, {
      headers: adminHeaders(),
    });
    const html = await res.text();
    expect(html).toContain("Local Store Mode");
    expect(html).toContain("Local Store");
  });

  it("includes back link to admin dashboard (Req 5.6)", async () => {
    const res = await fetch(`http://localhost:${port}/admin/bundles`, {
      headers: adminHeaders(),
    });
    const html = await res.text();
    expect(html).toContain('href="/admin"');
    expect(html).toContain("Back to Admin Dashboard");
  });

  it("includes SSE connection script for real-time updates (Req 5.7)", async () => {
    const res = await fetch(`http://localhost:${port}/admin/bundles`, {
      headers: adminHeaders(),
    });
    const html = await res.text();
    expect(html).toContain("EventSource");
    expect(html).toContain("/api/admin/events");
  });

  it("does not show Local Store badge when env var is false", async () => {
    process.env.KONDUCTOR_SERVE_CLIENT_BUNDLES_FROM_LOCAL_STORE = "false";

    const res = await fetch(`http://localhost:${port}/admin/bundles`, {
      headers: adminHeaders(),
    });
    const html = await res.text();
    // The "Local Store Mode" text badge should not appear in the page content
    expect(html).not.toContain("Local Store Mode");
    // The header badge element should not be rendered
    expect(html).not.toContain("Local Store</span>");
  });

  it("includes filter input for version filtering (Req 5.4)", async () => {
    const res = await fetch(`http://localhost:${port}/admin/bundles`, {
      headers: adminHeaders(),
    });
    const html = await res.text();
    expect(html).toContain('id="bundle-filter"');
    expect(html).toContain("Filter by version");
  });
});
