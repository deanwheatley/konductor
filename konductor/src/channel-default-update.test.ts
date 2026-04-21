/**
 * Regression Tests — Default Channel Auto-Update Flow
 *
 * Verifies that when the admin sets a new global default channel,
 * clients automatically receive the correct installer URL for that channel.
 *
 * Test flow:
 *   1. Seed dev and uat channels with distinct tarballs
 *   2. Admin sets defaultChannel to "dev"
 *   3. Verify channel-specific endpoints serve correct tarballs
 *   4. Verify register_session returns updateUrl pointing to the default channel
 *   5. Admin changes defaultChannel to "uat" → updateUrl changes accordingly
 *   6. Verify prod fallback when no defaultChannel is set
 *
 * Requirements: 4.3, 6.1–6.5
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";

import { buildMcpServer, buildChannelUpdateUrl, startSseServer } from "./index.js";
import { SessionManager } from "./session-manager.js";
import { CollisionEvaluator } from "./collision-evaluator.js";
import { SummaryFormatter } from "./summary-formatter.js";
import { ConfigManager } from "./config-manager.js";
import { PersistenceStore } from "./persistence-store.js";
import { QueryEngine } from "./query-engine.js";
import { InstallerChannelStore } from "./installer-channel-store.js";
import { AdminSettingsStore } from "./admin-settings-store.js";
import { MemorySettingsBackend } from "./settings-store.js";
import { handleAdminRoute, type AdminRouteDeps } from "./admin-routes.js";
import { resetSessionSecret } from "./admin-auth.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_API_KEY = "test-channel-api-key-12345";
const DEV_TARBALL = Buffer.from("DEV-INSTALLER-CONTENT-" + "x".repeat(100));
const UAT_TARBALL = Buffer.from("UAT-INSTALLER-CONTENT-" + "y".repeat(100));
const PROD_TARBALL = Buffer.from("PROD-INSTALLER-CONTENT-" + "z".repeat(100));

function parseResult(result: { content: { type: string; text: string }[] }) {
  return JSON.parse(result.content[0].text);
}

async function makeTempDir(): Promise<string> {
  const dir = join(tmpdir(), `konductor-ch-test-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Unit tests: buildChannelUpdateUrl
// ---------------------------------------------------------------------------

describe("buildChannelUpdateUrl", () => {
  const base = "http://localhost:3100";

  it("returns prod URL when defaultChannel is null", () => {
    expect(buildChannelUpdateUrl(base, null)).toBe(`${base}/bundle/installer.tgz`);
  });

  it("returns prod URL when defaultChannel is undefined", () => {
    expect(buildChannelUpdateUrl(base)).toBe(`${base}/bundle/installer.tgz`);
  });

  it("returns prod URL when defaultChannel is 'prod'", () => {
    expect(buildChannelUpdateUrl(base, "prod")).toBe(`${base}/bundle/installer.tgz`);
  });

  it("returns dev URL when defaultChannel is 'dev'", () => {
    expect(buildChannelUpdateUrl(base, "dev")).toBe(`${base}/bundle/installer-dev.tgz`);
  });

  it("returns uat URL when defaultChannel is 'uat'", () => {
    expect(buildChannelUpdateUrl(base, "uat")).toBe(`${base}/bundle/installer-uat.tgz`);
  });

  it("returns prod URL for invalid channel name", () => {
    expect(buildChannelUpdateUrl(base, "invalid")).toBe(`${base}/bundle/installer.tgz`);
  });

  it("returns latest URL when defaultChannel is 'latest'", () => {
    expect(buildChannelUpdateUrl(base, "latest")).toBe(`${base}/bundle/installer-latest.tgz`);
  });
});


// ---------------------------------------------------------------------------
// MCP tool: register_session returns channel-aware updateUrl
// ---------------------------------------------------------------------------

describe("MCP register_session — channel-aware updateUrl", () => {
  let client: Client;
  let tempDir: string;
  let adminSettingsStore: AdminSettingsStore;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    tempDir = await makeTempDir();
    const configPath = join(tempDir, "konductor.yaml");
    const sessionsPath = join(tempDir, "sessions.json");

    const configManager = new ConfigManager();
    await configManager.load(configPath);

    const persistenceStore = new PersistenceStore(sessionsPath);
    const sessionManager = new SessionManager(
      persistenceStore,
      () => configManager.getTimeout() * 1000,
    );
    await sessionManager.init();

    const collisionEvaluator = new CollisionEvaluator();
    const summaryFormatter = new SummaryFormatter();
    const settingsBackend = new MemorySettingsBackend();
    adminSettingsStore = new AdminSettingsStore(settingsBackend);

    const mcp = buildMcpServer({
      sessionManager,
      collisionEvaluator,
      summaryFormatter,
      configManager,
      serverVersion: "2.0.0",       // higher than any client version we'll send
      serverUrl: "http://localhost:3100",
      adminSettingsStore,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcp.connect(serverTransport);

    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);

    cleanup = async () => {
      await client.close();
      await rm(tempDir, { recursive: true, force: true });
    };
  });

  afterEach(async () => {
    await cleanup();
  });

  it("returns prod updateUrl when no defaultChannel is set", async () => {
    const result = await client.callTool({
      name: "register_session",
      arguments: {
        userId: "alice",
        repo: "org/app",
        branch: "main",
        files: ["src/index.ts"],
        clientVersion: "0.1.0",  // outdated
      },
    });
    const data = parseResult(result as any);
    expect(data.updateRequired).toBe(true);
    expect(data.updateUrl).toBe("http://localhost:3100/bundle/installer.tgz");
  });

  it("returns dev updateUrl when defaultChannel is 'dev'", async () => {
    await adminSettingsStore.set("defaultChannel", "dev", "client");

    const result = await client.callTool({
      name: "register_session",
      arguments: {
        userId: "alice",
        repo: "org/app",
        branch: "main",
        files: ["src/index.ts"],
        clientVersion: "0.1.0",
      },
    });
    const data = parseResult(result as any);
    expect(data.updateRequired).toBe(true);
    expect(data.updateUrl).toBe("http://localhost:3100/bundle/installer-dev.tgz");
  });

  it("returns uat updateUrl when defaultChannel is 'uat'", async () => {
    await adminSettingsStore.set("defaultChannel", "uat", "client");

    const result = await client.callTool({
      name: "register_session",
      arguments: {
        userId: "bob",
        repo: "org/app",
        branch: "feature-x",
        files: ["src/utils.ts"],
        clientVersion: "0.1.0",
      },
    });
    const data = parseResult(result as any);
    expect(data.updateRequired).toBe(true);
    expect(data.updateUrl).toBe("http://localhost:3100/bundle/installer-uat.tgz");
  });

  it("switches updateUrl when admin changes defaultChannel mid-session", async () => {
    // Start with prod (default)
    const r1 = await client.callTool({
      name: "register_session",
      arguments: {
        userId: "carol",
        repo: "org/app",
        branch: "main",
        files: ["README.md"],
        clientVersion: "0.1.0",
      },
    });
    expect(parseResult(r1 as any).updateUrl).toBe("http://localhost:3100/bundle/installer.tgz");

    // Admin changes default to dev
    await adminSettingsStore.set("defaultChannel", "dev", "client");

    const r2 = await client.callTool({
      name: "register_session",
      arguments: {
        userId: "carol",
        repo: "org/app",
        branch: "main",
        files: ["README.md"],
        clientVersion: "0.1.0",
      },
    });
    expect(parseResult(r2 as any).updateUrl).toBe("http://localhost:3100/bundle/installer-dev.tgz");

    // Admin changes default to uat
    await adminSettingsStore.set("defaultChannel", "uat", "client");

    const r3 = await client.callTool({
      name: "register_session",
      arguments: {
        userId: "carol",
        repo: "org/app",
        branch: "main",
        files: ["README.md"],
        clientVersion: "0.1.0",
      },
    });
    expect(parseResult(r3 as any).updateUrl).toBe("http://localhost:3100/bundle/installer-uat.tgz");
  });

  it("does not include updateUrl when client is current", async () => {
    await adminSettingsStore.set("defaultChannel", "dev", "client");

    const result = await client.callTool({
      name: "register_session",
      arguments: {
        userId: "dave",
        repo: "org/app",
        branch: "main",
        files: ["src/app.ts"],
        clientVersion: "2.0.0",  // matches server version
      },
    });
    const data = parseResult(result as any);
    expect(data.updateRequired).toBeUndefined();
    expect(data.updateUrl).toBeUndefined();
  });
});


// ---------------------------------------------------------------------------
// HTTP: channel-specific tarball serving + admin default channel change
// ---------------------------------------------------------------------------

describe("HTTP — channel tarball serving and default channel flow", () => {
  let server: Server;
  let port: number;
  let closeServer: () => Promise<void>;
  let installerChannelStore: InstallerChannelStore;
  let adminSettingsStore: AdminSettingsStore;

  beforeEach(async () => {
    process.env.KONDUCTOR_SESSION_SECRET = "test-secret-long-enough-for-aes";
    process.env.KONDUCTOR_ADMINS = "admin1";
    resetSessionSecret();

    const settingsBackend = new MemorySettingsBackend();
    adminSettingsStore = new AdminSettingsStore(settingsBackend);
    installerChannelStore = new InstallerChannelStore();

    // Seed all three channels with distinct tarballs
    await installerChannelStore.setTarball("dev", DEV_TARBALL, "1.0.0-dev");
    await installerChannelStore.setTarball("uat", UAT_TARBALL, "1.0.0-uat");
    await installerChannelStore.setTarball("prod", PROD_TARBALL, "1.0.0");

    const deps: AdminRouteDeps = {
      apiKey: TEST_API_KEY,
      adminSettingsStore,
      installerChannelStore,
      serverUrl: "http://localhost:3100",
      port: 3100,
      protocol: "http",
      useTls: false,
    };

    server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost`);

      // Handle admin routes
      const handled = await handleAdminRoute(req, res, url, deps);
      if (handled) return;

      // Handle channel-specific installer tarballs
      const channelMatch = url.pathname.match(/^\/bundle\/installer-(dev|uat|prod)\.tgz$/);
      if (req.method === "GET" && channelMatch) {
        const ch = channelMatch[1] as "dev" | "uat" | "prod";
        const tgz = await installerChannelStore.getTarball(ch);
        if (!tgz) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Channel "${ch}" has no installer` }));
          return;
        }
        res.writeHead(200, {
          "Content-Type": "application/gzip",
          "Content-Length": tgz.length,
        });
        res.end(tgz);
        return;
      }

      // Handle /bundle/installer.tgz (prod fallback)
      if (req.method === "GET" && /^\/bundle\/installer(-[\d.]+)?\.tgz$/.test(url.pathname)) {
        const prodTgz = await installerChannelStore.getTarball("prod");
        if (prodTgz) {
          res.writeHead(200, {
            "Content-Type": "application/gzip",
            "Content-Length": prodTgz.length,
          });
          res.end(prodTgz);
          return;
        }
        res.writeHead(404);
        res.end();
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    port = await new Promise<number>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });

    closeServer = () => new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterEach(async () => {
    await closeServer();
    delete process.env.KONDUCTOR_SESSION_SECRET;
    delete process.env.KONDUCTOR_ADMINS;
    resetSessionSecret();
  });

  it("serves distinct tarballs from /bundle/installer-dev.tgz and /bundle/installer-uat.tgz", async () => {
    const devRes = await fetch(`http://localhost:${port}/bundle/installer-dev.tgz`);
    expect(devRes.status).toBe(200);
    const devBody = Buffer.from(await devRes.arrayBuffer());
    expect(devBody.toString()).toContain("DEV-INSTALLER-CONTENT");

    const uatRes = await fetch(`http://localhost:${port}/bundle/installer-uat.tgz`);
    expect(uatRes.status).toBe(200);
    const uatBody = Buffer.from(await uatRes.arrayBuffer());
    expect(uatBody.toString()).toContain("UAT-INSTALLER-CONTENT");

    const prodRes = await fetch(`http://localhost:${port}/bundle/installer.tgz`);
    expect(prodRes.status).toBe(200);
    const prodBody = Buffer.from(await prodRes.arrayBuffer());
    expect(prodBody.toString()).toContain("PROD-INSTALLER-CONTENT");
  });

  it("admin can change defaultChannel and install-commands reflect the change", async () => {
    // Set default to dev via admin API
    const setRes = await fetch(`http://localhost:${port}/api/admin/settings/defaultChannel`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${TEST_API_KEY}`,
        "X-Konductor-User": "admin1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ value: "dev", category: "client" }),
    });
    expect(setRes.status).toBe(200);

    // Verify the setting was persisted
    const stored = await adminSettingsStore.get("defaultChannel");
    expect(stored).toBe("dev");

    // Verify install-commands reflect the new default
    const cmdRes = await fetch(`http://localhost:${port}/api/admin/install-commands`, {
      headers: {
        Authorization: `Bearer ${TEST_API_KEY}`,
        "X-Konductor-User": "admin1",
      },
    });
    expect(cmdRes.status).toBe(200);
    const cmdData: any = await cmdRes.json();
    expect(cmdData.defaultChannel).toBe("dev");
  });

  it("admin changes defaultChannel from prod → dev → uat and each is reflected", async () => {
    // Initially no defaultChannel set — should default to prod
    const cmd1 = await fetch(`http://localhost:${port}/api/admin/install-commands`, {
      headers: {
        Authorization: `Bearer ${TEST_API_KEY}`,
        "X-Konductor-User": "admin1",
      },
    });
    expect((await cmd1.json() as any).defaultChannel).toBe("prod");

    // Change to dev
    await fetch(`http://localhost:${port}/api/admin/settings/defaultChannel`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${TEST_API_KEY}`,
        "X-Konductor-User": "admin1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ value: "dev", category: "client" }),
    });

    const cmd2 = await fetch(`http://localhost:${port}/api/admin/install-commands`, {
      headers: {
        Authorization: `Bearer ${TEST_API_KEY}`,
        "X-Konductor-User": "admin1",
      },
    });
    expect((await cmd2.json() as any).defaultChannel).toBe("dev");

    // Change to uat
    await fetch(`http://localhost:${port}/api/admin/settings/defaultChannel`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${TEST_API_KEY}`,
        "X-Konductor-User": "admin1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ value: "uat", category: "client" }),
    });

    const cmd3 = await fetch(`http://localhost:${port}/api/admin/install-commands`, {
      headers: {
        Authorization: `Bearer ${TEST_API_KEY}`,
        "X-Konductor-User": "admin1",
      },
    });
    expect((await cmd3.json() as any).defaultChannel).toBe("uat");
  });

  it("channel tarball content is distinct per channel after promotion", async () => {
    // Promote dev → uat
    const promoteRes = await fetch(`http://localhost:${port}/api/admin/channels/promote`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TEST_API_KEY}`,
        "X-Konductor-User": "admin1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ source: "dev", destination: "uat" }),
    });
    expect(promoteRes.status).toBe(200);

    // After promotion, uat should now have dev's content
    const uatRes = await fetch(`http://localhost:${port}/bundle/installer-uat.tgz`);
    const uatBody = Buffer.from(await uatRes.arrayBuffer());
    expect(uatBody.toString()).toContain("DEV-INSTALLER-CONTENT");

    // Dev should still have its original content
    const devRes = await fetch(`http://localhost:${port}/bundle/installer-dev.tgz`);
    const devBody = Buffer.from(await devRes.arrayBuffer());
    expect(devBody.toString()).toContain("DEV-INSTALLER-CONTENT");

    // Prod should still have its original content
    const prodRes = await fetch(`http://localhost:${port}/bundle/installer.tgz`);
    const prodBody = Buffer.from(await prodRes.arrayBuffer());
    expect(prodBody.toString()).toContain("PROD-INSTALLER-CONTENT");
  });
});


// ---------------------------------------------------------------------------
// HTTP: install-commands includes channelAvailability
// ---------------------------------------------------------------------------

describe("HTTP — install-commands channelAvailability", () => {
  let server: Server;
  let port: number;
  let closeServer: () => Promise<void>;
  let installerChannelStore: InstallerChannelStore;
  let adminSettingsStore: AdminSettingsStore;

  beforeEach(async () => {
    process.env.KONDUCTOR_SESSION_SECRET = "test-secret-long-enough-for-aes";
    process.env.KONDUCTOR_ADMINS = "admin1";
    resetSessionSecret();

    const settingsBackend = new MemorySettingsBackend();
    adminSettingsStore = new AdminSettingsStore(settingsBackend);
    installerChannelStore = new InstallerChannelStore();

    // Only seed prod — dev and uat have no tarball
    await installerChannelStore.setTarball("prod", PROD_TARBALL, "1.0.0");

    const deps: AdminRouteDeps = {
      apiKey: TEST_API_KEY,
      adminSettingsStore,
      installerChannelStore,
      serverUrl: "http://localhost:3100",
      port: 3100,
      protocol: "http",
      useTls: false,
    };

    server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost`);
      const handled = await handleAdminRoute(req, res, url, deps);
      if (!handled) {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    port = await new Promise<number>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });

    closeServer = () => new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterEach(async () => {
    await closeServer();
    delete process.env.KONDUCTOR_SESSION_SECRET;
    delete process.env.KONDUCTOR_ADMINS;
    resetSessionSecret();
  });

  it("returns channelAvailability showing which channels have tarballs", async () => {
    const res = await fetch(`http://localhost:${port}/api/admin/install-commands`, {
      headers: {
        Authorization: `Bearer ${TEST_API_KEY}`,
        "X-Konductor-User": "admin1",
      },
    });
    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.channelAvailability).toEqual({
      dev: false,
      uat: false,
      prod: true,
    });
  });

  it("channelAvailability updates after uploading a tarball to dev", async () => {
    // Upload to dev
    await installerChannelStore.setTarball("dev", DEV_TARBALL, "1.0.0-dev");

    const res = await fetch(`http://localhost:${port}/api/admin/install-commands`, {
      headers: {
        Authorization: `Bearer ${TEST_API_KEY}`,
        "X-Konductor-User": "admin1",
      },
    });
    const data: any = await res.json();
    expect(data.channelAvailability).toEqual({
      dev: true,
      uat: false,
      prod: true,
    });
  });

  it("channelAvailability shows all true after promoting dev → uat", async () => {
    await installerChannelStore.setTarball("dev", DEV_TARBALL, "1.0.0-dev");
    await installerChannelStore.promote("dev", "uat");

    const res = await fetch(`http://localhost:${port}/api/admin/install-commands`, {
      headers: {
        Authorization: `Bearer ${TEST_API_KEY}`,
        "X-Konductor-User": "admin1",
      },
    });
    const data: any = await res.json();
    expect(data.channelAvailability).toEqual({
      dev: true,
      uat: true,
      prod: true,
    });
  });
});
