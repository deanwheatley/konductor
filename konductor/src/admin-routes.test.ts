/**
 * Unit Tests for Admin API Routes
 *
 * Tests auth middleware integration (cookie + header paths),
 * settings CRUD, channel promote/rollback, user management,
 * and error cases (403, 404, 400).
 *
 * Requirements: 1.1–1.4, 2.1–2.5, 3.1–3.4, 4.1–4.8, 7.8–7.10
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { handleAdminRoute, type AdminRouteDeps, type AdminUserRecord } from "./admin-routes.js";
import { AdminSettingsStore } from "./admin-settings-store.js";
import { MemorySettingsBackend } from "./settings-store.js";
import { InstallerChannelStore } from "./installer-channel-store.js";
import {
  encodeAdminSession,
  createAdminSession,
  getSessionSecret,
  resetSessionSecret,
} from "./admin-auth.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_API_KEY = "test-admin-api-key-12345";
const TEST_SECRET = "test-session-secret-long-enough-for-aes";

/** Create a test HTTP server with admin routes. */
function createTestServer(depsOverrides?: Partial<AdminRouteDeps>): { server: Server; port: number; close: () => Promise<void> } {
  const settingsBackend = new MemorySettingsBackend();
  const adminSettingsStore = new AdminSettingsStore(settingsBackend);
  const installerChannelStore = new InstallerChannelStore();

  const users: AdminUserRecord[] = [
    { userId: "admin1", admin: true, adminSource: "database" },
    { userId: "user1", admin: false, adminSource: null },
    { userId: "envadmin", admin: true, adminSource: "env", email: "[email protected]" },
  ];

  const deps: AdminRouteDeps = {
    apiKey: TEST_API_KEY,
    adminSettingsStore,
    installerChannelStore,
    serverUrl: "http://localhost:3100",
    port: 3100,
    protocol: "http",
    useTls: false,
    getUsers: async () => users,
    updateUser: async (userId, updates) => {
      const user = users.find((u) => u.userId === userId);
      if (!user) return false;
      if (updates.installerChannel !== undefined) user.installerChannel = updates.installerChannel;
      if (updates.admin !== undefined) user.admin = updates.admin;
      return true;
    },
    ...depsOverrides,
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost`);
    const handled = await handleAdminRoute(req, res, url, deps);
    if (!handled) {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  let port = 0;
  return {
    server,
    get port() { return port; },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function startServer(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });
}

function makeAdminCookie(): string {
  const secret = getSessionSecret();
  const session = createAdminSession("admin1", TEST_API_KEY);
  return encodeAdminSession(session, secret);
}

function makeNonAdminCookie(): string {
  const secret = getSessionSecret();
  const session = createAdminSession("user1", TEST_API_KEY);
  return encodeAdminSession(session, secret);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Admin API Routes", () => {
  let server: Server;
  let port: number;
  let closeServer: () => Promise<void>;

  beforeEach(async () => {
    // Set env for admin resolution
    process.env.KONDUCTOR_SESSION_SECRET = TEST_SECRET;
    process.env.KONDUCTOR_ADMINS = "admin1,envadmin";
    resetSessionSecret();

    const s = createTestServer();
    server = s.server;
    closeServer = s.close;
    port = await startServer(server);
  });

  afterEach(async () => {
    await closeServer();
    delete process.env.KONDUCTOR_SESSION_SECRET;
    delete process.env.KONDUCTOR_ADMINS;
    resetSessionSecret();
  });

  // ── Login Routes ────────────────────────────────────────────────────

  describe("GET /login", () => {
    it("serves login form HTML (Req 2.1)", async () => {
      const res = await fetch(`http://localhost:${port}/login`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Konductor Admin");
      expect(html).toContain("userId");
      expect(html).toContain("apiKey");
    });
  });

  describe("POST /login", () => {
    it("sets session cookie and redirects on valid credentials (Req 2.2)", async () => {
      const res = await fetch(`http://localhost:${port}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `userId=admin1&apiKey=${TEST_API_KEY}`,
        redirect: "manual",
      });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/admin");
      const setCookie = res.headers.get("set-cookie");
      expect(setCookie).toContain("konductor_admin_session");
    });

    it("returns error on invalid API key (Req 2.3)", async () => {
      const res = await fetch(`http://localhost:${port}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "userId=admin1&apiKey=wrong-key",
        redirect: "manual",
      });
      expect(res.status).toBe(401);
      const html = await res.text();
      expect(html).toContain("Invalid credentials");
    });

    it("returns error on empty fields", async () => {
      const res = await fetch(`http://localhost:${port}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "userId=&apiKey=",
        redirect: "manual",
      });
      expect(res.status).toBe(400);
    });
  });

  // ── Admin Dashboard ─────────────────────────────────────────────────

  describe("GET /admin", () => {
    it("redirects to /login when not authenticated (Req 2.1)", async () => {
      const res = await fetch(`http://localhost:${port}/admin`, { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/login");
    });

    it("serves dashboard for admin with valid cookie (Req 1.3)", async () => {
      const cookie = makeAdminCookie();
      const res = await fetch(`http://localhost:${port}/admin`, {
        headers: { Cookie: `konductor_admin_session=${encodeURIComponent(cookie)}` },
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Konductor Admin");
    });

    it("serves dashboard for admin with header auth (Req 2.4)", async () => {
      const res = await fetch(`http://localhost:${port}/admin`, {
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          "X-Konductor-User": "admin1",
        },
      });
      expect(res.status).toBe(200);
    });

    it("returns 403 for non-admin user (Req 1.4)", async () => {
      const res = await fetch(`http://localhost:${port}/admin`, {
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          "X-Konductor-User": "nobody",
        },
      });
      expect(res.status).toBe(403);
    });
  });

  // ── Settings API ────────────────────────────────────────────────────

  describe("GET /api/admin/settings", () => {
    it("returns 401 without auth", async () => {
      const res = await fetch(`http://localhost:${port}/api/admin/settings`);
      expect(res.status).toBe(401);
    });

    it("returns 403 for non-admin", async () => {
      const res = await fetch(`http://localhost:${port}/api/admin/settings`, {
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          "X-Konductor-User": "nobody",
        },
      });
      expect(res.status).toBe(403);
    });

    it("returns settings for admin (Req 3.1)", async () => {
      const res = await fetch(`http://localhost:${port}/api/admin/settings`, {
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          "X-Konductor-User": "admin1",
        },
      });
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data).toHaveProperty("settings");
    });
  });

  describe("PUT /api/admin/settings/:key", () => {
    it("updates a setting (Req 3.2)", async () => {
      const res = await fetch(`http://localhost:${port}/api/admin/settings/heartbeatTimeout`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          "X-Konductor-User": "admin1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ value: 120, category: "system" }),
      });
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.success).toBe(true);
    });

    it("returns 400 for invalid JSON body", async () => {
      const res = await fetch(`http://localhost:${port}/api/admin/settings/foo`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          "X-Konductor-User": "admin1",
          "Content-Type": "application/json",
        },
        body: "not json",
      });
      expect(res.status).toBe(400);
    });
  });

  // ── Channel API ─────────────────────────────────────────────────────

  describe("GET /api/admin/channels", () => {
    it("returns channel metadata (Req 4.1)", async () => {
      const res = await fetch(`http://localhost:${port}/api/admin/channels`, {
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          "X-Konductor-User": "admin1",
        },
      });
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data).toHaveProperty("channels");
    });
  });

  describe("POST /api/admin/channels/promote", () => {
    it("returns 400 when source has no tarball", async () => {
      const res = await fetch(`http://localhost:${port}/api/admin/channels/promote`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          "X-Konductor-User": "admin1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ source: "dev", destination: "uat" }),
      });
      expect(res.status).toBe(400);
      const data: any = await res.json();
      expect(data.error).toContain("no tarball");
    });

    it("returns 400 for invalid channel name", async () => {
      const res = await fetch(`http://localhost:${port}/api/admin/channels/promote`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          "X-Konductor-User": "admin1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ source: "invalid", destination: "uat" }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/admin/channels/rollback", () => {
    it("returns 400 when no previous version", async () => {
      const res = await fetch(`http://localhost:${port}/api/admin/channels/rollback`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          "X-Konductor-User": "admin1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ channel: "prod" }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("PUT /api/admin/channels/:channel/assign", () => {
    let assignPort: number;
    let assignClose: () => Promise<void>;

    beforeEach(async () => {
      // Create a server with a bundleRegistry that has a bundle
      const { BundleRegistry } = await import("./bundle-registry.js");
      const registry = new BundleRegistry();
      // Manually add a bundle to the registry for testing
      (registry as any).bundles.set("1.0.0", {
        metadata: {
          version: "1.0.0",
          createdAt: "2026-04-20T09:00:00.000Z",
          author: "test",
          summary: "test bundle",
          hash: "abc123",
          fileSize: 1024,
          filePath: "/tmp/installer-1.0.0.tgz",
          channels: [],
        },
        tarball: Buffer.from("fake-tarball-data"),
      });

      const s = createTestServer({ bundleRegistry: registry });
      assignPort = await startServer(s.server);
      assignClose = s.close;
    });

    afterEach(async () => {
      await assignClose();
    });

    it("assigns a version to a channel (Req 4.3, 9.3)", async () => {
      const res = await fetch(`http://localhost:${assignPort}/api/admin/channels/dev/assign`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          "X-Konductor-User": "admin1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ version: "1.0.0" }),
      });
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.channel).toBe("dev");
      expect(data.version).toBe("1.0.0");
    });

    it("returns 404 when version not in registry", async () => {
      const res = await fetch(`http://localhost:${assignPort}/api/admin/channels/dev/assign`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          "X-Konductor-User": "admin1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ version: "9.9.9" }),
      });
      expect(res.status).toBe(404);
      const data: any = await res.json();
      expect(data.error).toContain("not found");
    });

    it("returns 400 for invalid channel name", async () => {
      const res = await fetch(`http://localhost:${assignPort}/api/admin/channels/staging/assign`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          "X-Konductor-User": "admin1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ version: "1.0.0" }),
      });
      expect(res.status).toBe(400);
      const data: any = await res.json();
      expect(data.error).toContain("Invalid channel");
    });

    it("returns 400 when registry is empty", async () => {
      // Create a server with an empty registry
      const { BundleRegistry } = await import("./bundle-registry.js");
      const emptyRegistry = new BundleRegistry();
      const s = createTestServer({ bundleRegistry: emptyRegistry });
      const emptyPort = await startServer(s.server);

      try {
        const res = await fetch(`http://localhost:${emptyPort}/api/admin/channels/dev/assign`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${TEST_API_KEY}`,
            "X-Konductor-User": "admin1",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ version: "1.0.0" }),
        });
        expect(res.status).toBe(400);
        const data: any = await res.json();
        expect(data.error).toContain("empty");
      } finally {
        await new Promise<void>((resolve) => s.server.close(() => resolve()));
      }
    });

    it("returns 400 when bundle registry is not available", async () => {
      // Use the default server (no bundleRegistry)
      const res = await fetch(`http://localhost:${port}/api/admin/channels/dev/assign`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          "X-Konductor-User": "admin1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ version: "1.0.0" }),
      });
      expect(res.status).toBe(400);
      const data: any = await res.json();
      expect(data.error).toContain("not available");
    });

    it("returns 400 for missing version field", async () => {
      const res = await fetch(`http://localhost:${assignPort}/api/admin/channels/dev/assign`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          "X-Konductor-User": "admin1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const data: any = await res.json();
      expect(data.error).toContain("version");
    });

    it("returns 400 for invalid JSON body", async () => {
      const res = await fetch(`http://localhost:${assignPort}/api/admin/channels/dev/assign`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          "X-Konductor-User": "admin1",
          "Content-Type": "application/json",
        },
        body: "not json",
      });
      expect(res.status).toBe(400);
    });
  });

  // ── Users API ───────────────────────────────────────────────────────

  describe("GET /api/admin/users", () => {
    it("returns user list (Req 7.1)", async () => {
      const res = await fetch(`http://localhost:${port}/api/admin/users`, {
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          "X-Konductor-User": "admin1",
        },
      });
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.users).toHaveLength(3);
    });
  });

  describe("PUT /api/admin/users/:userId", () => {
    it("updates user channel override (Req 7.8)", async () => {
      const res = await fetch(`http://localhost:${port}/api/admin/users/user1`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          "X-Konductor-User": "admin1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ installerChannel: "dev" }),
      });
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.success).toBe(true);
    });

    it("returns 400 when toggling env-sourced admin (Req 7.10)", async () => {
      const res = await fetch(`http://localhost:${port}/api/admin/users/envadmin`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          "X-Konductor-User": "admin1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ admin: false }),
      });
      expect(res.status).toBe(400);
      const data: any = await res.json();
      expect(data.error).toContain("read-only");
    });

    it("returns 404 for unknown user", async () => {
      const res = await fetch(`http://localhost:${port}/api/admin/users/nonexistent`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          "X-Konductor-User": "admin1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ admin: true }),
      });
      expect(res.status).toBe(404);
    });
  });

  // ── Install Commands API ────────────────────────────────────────────

  describe("GET /api/admin/bundles", () => {
    it("returns empty array when no bundle registry (Req 9.1)", async () => {
      const res = await fetch(`http://localhost:${port}/api/admin/bundles`, {
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          "X-Konductor-User": "admin1",
        },
      });
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.bundles).toEqual([]);
    });

    it("returns bundles sorted by semver when registry has entries", async () => {
      const { BundleRegistry } = await import("./bundle-registry.js");
      const registry = new BundleRegistry();
      (registry as any).bundles.set("1.0.0", {
        metadata: {
          version: "1.0.0",
          createdAt: "2026-04-01T09:00:00.000Z",
          author: "dev1",
          summary: "first release",
          hash: "aaa111",
          fileSize: 1024,
          filePath: "/tmp/installer-1.0.0.tgz",
          channels: ["prod"],
        },
        tarball: Buffer.from("fake"),
      });
      (registry as any).bundles.set("2.0.0", {
        metadata: {
          version: "2.0.0",
          createdAt: "2026-04-10T09:00:00.000Z",
          author: "dev2",
          summary: "second release",
          hash: "bbb222",
          fileSize: 2048,
          filePath: "/tmp/installer-2.0.0.tgz",
          channels: ["dev"],
        },
        tarball: Buffer.from("fake2"),
      });

      const s = createTestServer({ bundleRegistry: registry });
      const bundlePort = await startServer(s.server);
      try {
        const res = await fetch(`http://localhost:${bundlePort}/api/admin/bundles`, {
          headers: {
            Authorization: `Bearer ${TEST_API_KEY}`,
            "X-Konductor-User": "admin1",
          },
        });
        expect(res.status).toBe(200);
        const data: any = await res.json();
        expect(data.bundles).toHaveLength(2);
        // Newest first (2.0.0 before 1.0.0)
        expect(data.bundles[0].version).toBe("2.0.0");
        expect(data.bundles[1].version).toBe("1.0.0");
        // Metadata fields present (Req 9.1: version, size, createdAt, author, summary, channels, hash)
        expect(data.bundles[0].author).toBe("dev2");
        expect(data.bundles[0].channels).toEqual(["dev"]);
        expect(data.bundles[0].hash).toBe("bbb222");
        expect(data.bundles[0].size).toBe(2048);
        expect(data.bundles[0].createdAt).toBe("2026-04-10T09:00:00.000Z");
        expect(data.bundles[0].summary).toBe("second release");
        // filePath should NOT be exposed in API response
        expect(data.bundles[0].filePath).toBeUndefined();
      } finally {
        await new Promise<void>((resolve) => s.server.close(() => resolve()));
      }
    });

    it("returns 401 without auth", async () => {
      const res = await fetch(`http://localhost:${port}/api/admin/bundles`);
      expect(res.status).toBe(401);
    });
  });

  describe("DELETE /api/admin/bundles/:version", () => {
    let deletePort: number;
    let deleteClose: () => Promise<void>;
    let deleteRegistry: any;
    let emittedEvents: any[];

    beforeEach(async () => {
      emittedEvents = [];
      const { BundleRegistry } = await import("./bundle-registry.js");
      deleteRegistry = new BundleRegistry();
      // Add two bundles
      (deleteRegistry as any).bundles.set("1.0.0", {
        metadata: {
          version: "1.0.0",
          createdAt: "2026-04-01T09:00:00.000Z",
          author: "dev1",
          summary: "first release",
          hash: "aaa111",
          fileSize: 1024,
          filePath: "/tmp/installer-1.0.0.tgz",
          channels: [],
        },
        tarball: Buffer.from("fake-tarball-1"),
      });
      (deleteRegistry as any).bundles.set("2.0.0", {
        metadata: {
          version: "2.0.0",
          createdAt: "2026-04-10T09:00:00.000Z",
          author: "dev2",
          summary: "second release",
          hash: "bbb222",
          fileSize: 2048,
          filePath: "/tmp/installer-2.0.0.tgz",
          channels: ["dev"],
        },
        tarball: Buffer.from("fake-tarball-2"),
      });

      const mockEmitter = {
        emit: (event: any) => emittedEvents.push(event),
        subscribe: () => () => {},
      };

      const s = createTestServer({
        bundleRegistry: deleteRegistry,
        batonEventEmitter: mockEmitter as any,
      });
      deletePort = await startServer(s.server);
      deleteClose = s.close;
    });

    afterEach(async () => {
      await deleteClose();
    });

    it("deletes a bundle not assigned to any channel (Req 9.2)", async () => {
      const res = await fetch(`http://localhost:${deletePort}/api/admin/bundles/1.0.0`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          "X-Konductor-User": "admin1",
        },
      });
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.version).toBe("1.0.0");
      expect(data.staleChannels).toEqual([]);
      // Verify bundle is removed from registry
      expect(deleteRegistry.has("1.0.0")).toBe(false);
    });

    it("deletes a bundle assigned to channels and returns stale channels (Req 6.4)", async () => {
      const res = await fetch(`http://localhost:${deletePort}/api/admin/bundles/2.0.0`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          "X-Konductor-User": "admin1",
        },
      });
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.version).toBe("2.0.0");
      expect(data.staleChannels).toEqual(["dev"]);
      // Verify bundle is removed
      expect(deleteRegistry.has("2.0.0")).toBe(false);
    });

    it("emits SSE events on delete (Req 6.6)", async () => {
      await fetch(`http://localhost:${deletePort}/api/admin/bundles/2.0.0`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          "X-Konductor-User": "admin1",
        },
      });
      // Should emit admin_channel_change for stale channel + bundle_change
      const channelEvent = emittedEvents.find((e) => e.type === "admin_channel_change");
      expect(channelEvent).toBeDefined();
      expect(channelEvent.data.channel).toBe("dev");
      expect(channelEvent.data.action).toBe("stale");

      const bundleEvent = emittedEvents.find((e) => e.type === "bundle_change");
      expect(bundleEvent).toBeDefined();
      expect(bundleEvent.data.action).toBe("delete");
      expect(bundleEvent.data.version).toBe("2.0.0");
    });

    it("returns 404 when version not found", async () => {
      const res = await fetch(`http://localhost:${deletePort}/api/admin/bundles/9.9.9`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          "X-Konductor-User": "admin1",
        },
      });
      expect(res.status).toBe(404);
      const data: any = await res.json();
      expect(data.error).toContain("not found");
    });

    it("returns 400 when bundle registry is not available", async () => {
      // Use the default server (no bundleRegistry)
      const res = await fetch(`http://localhost:${port}/api/admin/bundles/1.0.0`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          "X-Konductor-User": "admin1",
        },
      });
      expect(res.status).toBe(400);
      const data: any = await res.json();
      expect(data.error).toContain("not available");
    });

    it("returns 401 without auth", async () => {
      const res = await fetch(`http://localhost:${deletePort}/api/admin/bundles/1.0.0`, {
        method: "DELETE",
      });
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/admin/install-commands", () => {
    it("returns install command data (Req 5.1)", async () => {
      const res = await fetch(`http://localhost:${port}/api/admin/install-commands`, {
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          "X-Konductor-User": "admin1",
        },
      });
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.mode).toBe("local");
      expect(data.channels).toHaveLength(3);
      expect(data.defaultChannel).toBe("prod");
    });
  });

  // ── SSE Events ──────────────────────────────────────────────────────

  describe("GET /api/admin/events", () => {
    it("returns SSE stream with connected event (Req 10.1)", async () => {
      const controller = new AbortController();
      const res = await fetch(`http://localhost:${port}/api/admin/events`, {
        headers: {
          Authorization: `Bearer ${TEST_API_KEY}`,
          "X-Konductor-User": "admin1",
        },
        signal: controller.signal,
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/event-stream");

      // Read the first chunk
      const reader = res.body!.getReader();
      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);
      expect(text).toContain('"type":"connected"');

      controller.abort();
    });
  });
});
