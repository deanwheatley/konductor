/**
 * Integration Tests — Local Bundle Store Full Flow
 *
 * Tests the complete lifecycle: scan local store → assign versions to channels
 * → serve tarballs → delete bundle → stale state → reassign → recovery.
 *
 * Requirements: 1.1–1.6, 3.1–3.6, 4.3, 6.4–6.6, 7.1, 8.2, 9.1–9.3, 10.1–10.2
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { handleAdminRoute, type AdminRouteDeps } from "./admin-routes.js";
import { AdminSettingsStore } from "./admin-settings-store.js";
import { MemorySettingsBackend } from "./settings-store.js";
import { InstallerChannelStore, type ChannelName } from "./installer-channel-store.js";
import { BundleRegistry } from "./bundle-registry.js";
import { BatonEventEmitter } from "./baton-event-emitter.js";
import { resetSessionSecret } from "./admin-auth.js";
import { buildInstallerTarball, clearInstallerCache } from "./index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_API_KEY = "integration-test-key-12345";
const TEST_SECRET = "integration-test-secret-long-enough";

/** Create a tar header block for a file entry. */
function createTarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, Math.min(name.length, 100), "utf-8");
  header.write("0000644\0", 100, 8, "utf-8");
  header.write("0001000\0", 108, 8, "utf-8");
  header.write("0001000\0", 116, 8, "utf-8");
  header.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "utf-8");
  header.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, "0") + "\0", 136, 12, "utf-8");
  header.write("        ", 148, 8, "utf-8");
  header.write("0", 156, 1, "utf-8");
  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += header[i];
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "utf-8");
  return header;
}

/** Create a minimal .tgz buffer with optional bundle-manifest.json content. */
function createTgz(manifest?: object): Buffer {
  const blocks: Buffer[] = [];
  if (manifest) {
    const content = Buffer.from(JSON.stringify(manifest), "utf-8");
    blocks.push(createTarHeader("package/bundle-manifest.json", content.length));
    blocks.push(content);
    const padding = 512 - (content.length % 512);
    if (padding < 512) blocks.push(Buffer.alloc(padding));
  }
  const pkgContent = Buffer.from('{"name":"test"}', "utf-8");
  blocks.push(createTarHeader("package/package.json", pkgContent.length));
  blocks.push(pkgContent);
  const pkgPadding = 512 - (pkgContent.length % 512);
  if (pkgPadding < 512) blocks.push(Buffer.alloc(pkgPadding));
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

function authHeaders() {
  return {
    Authorization: `Bearer ${TEST_API_KEY}`,
    "X-Konductor-User": "admin1",
    "Content-Type": "application/json",
  };
}


// ---------------------------------------------------------------------------
// Integration Test Suite
// ---------------------------------------------------------------------------

describe("Bundle Store Integration — Full Flow", () => {
  let tempDir: string;
  let server: Server;
  let port: number;
  let registry: BundleRegistry;
  let channelStore: InstallerChannelStore;
  let eventEmitter: BatonEventEmitter;
  let emittedEvents: any[];

  beforeEach(async () => {
    process.env.KONDUCTOR_SESSION_SECRET = TEST_SECRET;
    process.env.KONDUCTOR_ADMINS = "admin1";
    process.env.KONDUCTOR_ADMIN_AUTH = "false";
    process.env.KONDUCTOR_SERVE_CLIENT_BUNDLES_FROM_LOCAL_STORE = "true";
    resetSessionSecret();

    tempDir = mkdtempSync(join(tmpdir(), "bundle-integration-"));
    emittedEvents = [];

    // Create test bundles in the temp directory
    writeFileSync(
      join(tempDir, "installer-1.0.0.tgz"),
      createTgz({ version: "1.0.0", createdAt: "2026-01-01T00:00:00.000Z", author: "dev1", summary: "Initial release" }),
    );
    writeFileSync(
      join(tempDir, "installer-2.0.0.tgz"),
      createTgz({ version: "2.0.0", createdAt: "2026-02-01T00:00:00.000Z", author: "dev2", summary: "Major update" }),
    );
    writeFileSync(
      join(tempDir, "installer-2.1.0-beta.1.tgz"),
      createTgz({ version: "2.1.0-beta.1", createdAt: "2026-03-01T00:00:00.000Z", author: "dev2", summary: "Beta feature" }),
    );

    // Initialize components
    registry = new BundleRegistry();
    await registry.scanLocalStore(tempDir);

    channelStore = new InstallerChannelStore();
    eventEmitter = new BatonEventEmitter();

    // Capture emitted events
    eventEmitter.subscribe("__admin__", (event) => emittedEvents.push(event));

    const settingsBackend = new MemorySettingsBackend();
    const adminSettingsStore = new AdminSettingsStore(settingsBackend);

    const deps: AdminRouteDeps = {
      apiKey: TEST_API_KEY,
      adminSettingsStore,
      installerChannelStore: channelStore,
      serverUrl: "http://localhost:0",
      port: 0,
      protocol: "http",
      useTls: false,
      bundleRegistry: registry,
      batonEventEmitter: eventEmitter,
      getUsers: async () => [
        { userId: "admin1", admin: true, adminSource: "env" as const },
        { userId: "user1", admin: false, adminSource: null },
      ],
      updateUser: async () => true,
    };

    server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const handled = await handleAdminRoute(req, res, url, deps);
      if (!handled) {
        // Serve tarball endpoints for backward compatibility testing
        if (req.method === "GET" && url.pathname.startsWith("/bundle/installer-")) {
          const channelMatch = url.pathname.match(/^\/bundle\/installer-(dev|uat|prod|latest)\.tgz$/);
          if (channelMatch) {
            const ch = channelMatch[1];
            if (ch === "latest") {
              const latest = registry.getLatest();
              if (latest) {
                res.writeHead(200, { "Content-Type": "application/gzip" });
                res.end(latest.tarball);
              } else {
                res.writeHead(404);
                res.end("Not found");
              }
            } else {
              const tarball = await channelStore.getTarball(ch as ChannelName);
              if (tarball && tarball.length > 0) {
                res.writeHead(200, { "Content-Type": "application/gzip" });
                res.end(tarball);
              } else {
                res.writeHead(404);
                res.end("Not found");
              }
            }
            return;
          }
        }
        if (req.method === "GET" && url.pathname === "/bundle/installer.tgz") {
          const tarball = await channelStore.getTarball("prod");
          if (tarball && tarball.length > 0) {
            res.writeHead(200, { "Content-Type": "application/gzip" });
            res.end(tarball);
          } else {
            res.writeHead(404);
            res.end("Not found");
          }
          return;
        }
        res.writeHead(404);
        res.end("Not found");
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        port = typeof addr === "object" && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.KONDUCTOR_SESSION_SECRET;
    delete process.env.KONDUCTOR_ADMINS;
    delete process.env.KONDUCTOR_ADMIN_AUTH;
    delete process.env.KONDUCTOR_SERVE_CLIENT_BUNDLES_FROM_LOCAL_STORE;
    resetSessionSecret();
  });

  // ── Step 1: Scan local store ──────────────────────────────────────

  it("Step 1: registry discovers all valid bundles from local store", async () => {
    // Registry was populated in beforeEach via scanLocalStore
    expect(registry.size).toBe(3);
    expect(registry.has("1.0.0")).toBe(true);
    expect(registry.has("2.0.0")).toBe(true);
    expect(registry.has("2.1.0-beta.1")).toBe(true);

    // GET /api/admin/bundles returns all bundles sorted by semver
    const res = await fetch(`http://localhost:${port}/api/admin/bundles`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const data: any = await res.json();
    expect(data.bundles).toHaveLength(3);
    // Newest first: 2.1.0-beta.1 < 2.0.0 (pre-release lower), so order is 2.0.0, 2.1.0-beta.1, 1.0.0
    // Actually: 2.1.0-beta.1 has major.minor.patch = 2.1.0 which is > 2.0.0
    // But it's a pre-release of 2.1.0, so it's lower than 2.1.0 but higher than 2.0.0
    expect(data.bundles[0].version).toBe("2.1.0-beta.1");
    expect(data.bundles[1].version).toBe("2.0.0");
    expect(data.bundles[2].version).toBe("1.0.0");
  });

  // ── Step 2: Assign versions to channels ───────────────────────────

  it("Step 2: assign versions to channels via API", async () => {
    // Assign 1.0.0 to prod
    const resProd = await fetch(`http://localhost:${port}/api/admin/channels/prod/assign`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ version: "1.0.0" }),
    });
    expect(resProd.status).toBe(200);
    const prodData: any = await resProd.json();
    expect(prodData.success).toBe(true);
    expect(prodData.channel).toBe("prod");
    expect(prodData.version).toBe("1.0.0");

    // Assign 2.0.0 to dev
    const resDev = await fetch(`http://localhost:${port}/api/admin/channels/dev/assign`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ version: "2.0.0" }),
    });
    expect(resDev.status).toBe(200);

    // Assign 2.0.0 to uat (same version on multiple channels is allowed)
    const resUat = await fetch(`http://localhost:${port}/api/admin/channels/uat/assign`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ version: "2.0.0" }),
    });
    expect(resUat.status).toBe(200);

    // Verify channel metadata
    const channelsRes = await fetch(`http://localhost:${port}/api/admin/channels`, {
      headers: authHeaders(),
    });
    const channelsData: any = await channelsRes.json();
    expect(channelsData.channels.prod.version).toBe("1.0.0");
    expect(channelsData.channels.dev.version).toBe("2.0.0");
    expect(channelsData.channels.uat.version).toBe("2.0.0");

    // Verify SSE events were emitted for each assignment
    const channelEvents = emittedEvents.filter((e) => e.type === "admin_channel_change" && e.data.action === "assign");
    expect(channelEvents.length).toBe(3);
  });

  // ── Step 3: Serve tarballs via channel endpoints ──────────────────

  it("Step 3: serve tarballs through channel endpoints after assignment", async () => {
    // Assign versions
    await fetch(`http://localhost:${port}/api/admin/channels/prod/assign`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ version: "1.0.0" }),
    });
    await fetch(`http://localhost:${port}/api/admin/channels/dev/assign`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ version: "2.0.0" }),
    });

    // Serve prod tarball via /bundle/installer.tgz (backward compat — Req 10.1)
    const prodRes = await fetch(`http://localhost:${port}/bundle/installer.tgz`);
    expect(prodRes.status).toBe(200);
    const prodBuf = Buffer.from(await prodRes.arrayBuffer());
    expect(prodBuf.length).toBeGreaterThan(0);

    // Serve dev tarball via /bundle/installer-dev.tgz (Req 10.2)
    const devRes = await fetch(`http://localhost:${port}/bundle/installer-dev.tgz`);
    expect(devRes.status).toBe(200);
    const devBuf = Buffer.from(await devRes.arrayBuffer());
    expect(devBuf.length).toBeGreaterThan(0);

    // Tarballs should match what's in the registry
    const prodEntry = registry.get("1.0.0")!;
    const devEntry = registry.get("2.0.0")!;
    expect(prodBuf.equals(prodEntry.tarball)).toBe(true);
    expect(devBuf.equals(devEntry.tarball)).toBe(true);

    // Serve latest tarball (Req 8.4) — most recent createdAt is 2.1.0-beta.1
    const latestRes = await fetch(`http://localhost:${port}/bundle/installer-latest.tgz`);
    expect(latestRes.status).toBe(200);
    const latestBuf = Buffer.from(await latestRes.arrayBuffer());
    const latestEntry = registry.getLatest()!;
    expect(latestBuf.equals(latestEntry.tarball)).toBe(true);
  });

  // ── Step 4: Delete bundle → stale state ───────────────────────────

  it("Step 4: deleting an assigned bundle triggers stale state", async () => {
    // Assign 2.0.0 to dev and uat
    await fetch(`http://localhost:${port}/api/admin/channels/dev/assign`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ version: "2.0.0" }),
    });
    await fetch(`http://localhost:${port}/api/admin/channels/uat/assign`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ version: "2.0.0" }),
    });

    emittedEvents.length = 0; // Clear previous events

    // Delete 2.0.0 — should make dev and uat stale
    const deleteRes = await fetch(`http://localhost:${port}/api/admin/bundles/2.0.0`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(deleteRes.status).toBe(200);
    const deleteData: any = await deleteRes.json();
    expect(deleteData.success).toBe(true);
    expect(deleteData.staleChannels).toContain("dev");
    expect(deleteData.staleChannels).toContain("uat");
    expect(deleteData.staleChannels.length).toBe(2);

    // Bundle removed from registry
    expect(registry.has("2.0.0")).toBe(false);

    // File removed from disk (Req 6.5)
    expect(existsSync(join(tempDir, "installer-2.0.0.tgz"))).toBe(false);

    // SSE events emitted (Req 6.6)
    const staleEvents = emittedEvents.filter(
      (e) => e.type === "admin_channel_change" && e.data.action === "stale",
    );
    expect(staleEvents.length).toBe(2);
    const bundleChangeEvent = emittedEvents.find((e) => e.type === "bundle_change");
    expect(bundleChangeEvent).toBeDefined();
    expect(bundleChangeEvent.data.action).toBe("delete");

    // Channels are now stale — serving returns 404 or empty
    const devRes = await fetch(`http://localhost:${port}/bundle/installer-dev.tgz`);
    expect(devRes.status).toBe(404);
  });

  // ── Step 5: Stale state verification ──────────────────────────────

  it("Step 5: stale channels report unavailability in install-commands", async () => {
    // Assign and then delete to create stale state
    await fetch(`http://localhost:${port}/api/admin/channels/dev/assign`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ version: "2.0.0" }),
    });
    await fetch(`http://localhost:${port}/api/admin/bundles/2.0.0`, {
      method: "DELETE",
      headers: authHeaders(),
    });

    // Check install-commands reports dev as unavailable (Req 11.4)
    const cmdRes = await fetch(`http://localhost:${port}/api/admin/install-commands`, {
      headers: authHeaders(),
    });
    expect(cmdRes.status).toBe(200);
    const cmdData: any = await cmdRes.json();
    expect(cmdData.channelAvailability.dev).toBe(false);
  });

  // ── Step 6: Reassign → recovery ──────────────────────────────────

  it("Step 6: reassigning a new version to a stale channel recovers it", async () => {
    // Create stale state: assign 2.0.0 to dev, then delete it
    await fetch(`http://localhost:${port}/api/admin/channels/dev/assign`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ version: "2.0.0" }),
    });
    await fetch(`http://localhost:${port}/api/admin/bundles/2.0.0`, {
      method: "DELETE",
      headers: authHeaders(),
    });

    // Dev is now stale
    let devRes = await fetch(`http://localhost:${port}/bundle/installer-dev.tgz`);
    expect(devRes.status).toBe(404);

    emittedEvents.length = 0;

    // Reassign dev to 1.0.0 — recovery
    const assignRes = await fetch(`http://localhost:${port}/api/admin/channels/dev/assign`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ version: "1.0.0" }),
    });
    expect(assignRes.status).toBe(200);

    // Dev now serves 1.0.0 tarball
    devRes = await fetch(`http://localhost:${port}/bundle/installer-dev.tgz`);
    expect(devRes.status).toBe(200);
    const devBuf = Buffer.from(await devRes.arrayBuffer());
    const entry = registry.get("1.0.0")!;
    expect(devBuf.equals(entry.tarball)).toBe(true);

    // SSE event emitted for the reassignment
    const assignEvents = emittedEvents.filter(
      (e) => e.type === "admin_channel_change" && e.data.action === "assign",
    );
    expect(assignEvents.length).toBe(1);
    expect(assignEvents[0].data.version).toBe("1.0.0");

    // Install commands now show dev as available
    const cmdRes = await fetch(`http://localhost:${port}/api/admin/install-commands`, {
      headers: authHeaders(),
    });
    const cmdData: any = await cmdRes.json();
    expect(cmdData.channelAvailability.dev).toBe(true);
  });

  // ── Full end-to-end flow in one test ──────────────────────────────

  it("Full flow: scan → assign → serve → delete → stale → reassign → recovery", async () => {
    // 1. Registry already scanned (3 bundles)
    expect(registry.size).toBe(3);

    // 2. Assign versions to all channels
    await fetch(`http://localhost:${port}/api/admin/channels/prod/assign`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ version: "1.0.0" }),
    });
    await fetch(`http://localhost:${port}/api/admin/channels/dev/assign`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ version: "2.0.0" }),
    });
    await fetch(`http://localhost:${port}/api/admin/channels/uat/assign`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ version: "2.0.0" }),
    });

    // 3. Verify all channels serve correct tarballs
    const prodRes = await fetch(`http://localhost:${port}/bundle/installer.tgz`);
    expect(prodRes.status).toBe(200);
    const devRes = await fetch(`http://localhost:${port}/bundle/installer-dev.tgz`);
    expect(devRes.status).toBe(200);
    const uatRes = await fetch(`http://localhost:${port}/bundle/installer-uat.tgz`);
    expect(uatRes.status).toBe(200);

    // 4. Delete 2.0.0 — dev and uat go stale
    const deleteRes = await fetch(`http://localhost:${port}/api/admin/bundles/2.0.0`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    const deleteData: any = await deleteRes.json();
    expect(deleteData.staleChannels.sort()).toEqual(["dev", "uat"]);

    // 5. Stale channels can't serve tarballs
    const devStale = await fetch(`http://localhost:${port}/bundle/installer-dev.tgz`);
    expect(devStale.status).toBe(404);
    const uatStale = await fetch(`http://localhost:${port}/bundle/installer-uat.tgz`);
    expect(uatStale.status).toBe(404);

    // Prod is unaffected
    const prodStill = await fetch(`http://localhost:${port}/bundle/installer.tgz`);
    expect(prodStill.status).toBe(200);

    // 6. Reassign dev and uat to 1.0.0 — recovery
    await fetch(`http://localhost:${port}/api/admin/channels/dev/assign`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ version: "1.0.0" }),
    });
    await fetch(`http://localhost:${port}/api/admin/channels/uat/assign`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ version: "1.0.0" }),
    });

    // 7. Channels recovered — serve tarballs again
    const devRecovered = await fetch(`http://localhost:${port}/bundle/installer-dev.tgz`);
    expect(devRecovered.status).toBe(200);
    const uatRecovered = await fetch(`http://localhost:${port}/bundle/installer-uat.tgz`);
    expect(uatRecovered.status).toBe(200);

    // All channels now serve 1.0.0
    const prodBuf = Buffer.from(await (await fetch(`http://localhost:${port}/bundle/installer.tgz`)).arrayBuffer());
    const devBuf = Buffer.from(await devRecovered.arrayBuffer());
    expect(prodBuf.equals(devBuf)).toBe(true);
  });

  // ── Backward compatibility ────────────────────────────────────────

  it("backward compat: /bundle/installer.tgz serves prod channel (Req 10.1)", async () => {
    await fetch(`http://localhost:${port}/api/admin/channels/prod/assign`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ version: "1.0.0" }),
    });

    const res = await fetch(`http://localhost:${port}/bundle/installer.tgz`);
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.equals(registry.get("1.0.0")!.tarball)).toBe(true);
  });

  // ── Empty registry fallback ───────────────────────────────────────

  it("empty registry: bundle list returns empty, assign returns 400", async () => {
    // Create a fresh server with empty registry
    const emptyDir = mkdtempSync(join(tmpdir(), "bundle-empty-"));
    const emptyRegistry = new BundleRegistry();
    await emptyRegistry.scanLocalStore(emptyDir);

    const settingsBackend = new MemorySettingsBackend();
    const adminSettingsStore = new AdminSettingsStore(settingsBackend);
    const emptyChannelStore = new InstallerChannelStore();

    const deps: AdminRouteDeps = {
      apiKey: TEST_API_KEY,
      adminSettingsStore,
      installerChannelStore: emptyChannelStore,
      serverUrl: "http://localhost:0",
      port: 0,
      protocol: "http",
      useTls: false,
      bundleRegistry: emptyRegistry,
      getUsers: async () => [{ userId: "admin1", admin: true, adminSource: "env" as const }],
      updateUser: async () => true,
    };

    const emptyServer = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const handled = await handleAdminRoute(req, res, url, deps);
      if (!handled) { res.writeHead(404); res.end(); }
    });

    const emptyPort = await new Promise<number>((resolve) => {
      emptyServer.listen(0, () => {
        const addr = emptyServer.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });

    try {
      // List returns empty
      const listRes = await fetch(`http://localhost:${emptyPort}/api/admin/bundles`, {
        headers: authHeaders(),
      });
      const listData: any = await listRes.json();
      expect(listData.bundles).toEqual([]);

      // Assign returns 400 (registry empty)
      const assignRes = await fetch(`http://localhost:${emptyPort}/api/admin/channels/dev/assign`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ version: "1.0.0" }),
      });
      expect(assignRes.status).toBe(400);
    } finally {
      await new Promise<void>((resolve) => emptyServer.close(() => resolve()));
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  // ── Bundle Manager page ───────────────────────────────────────────

  it("Bundle Manager page renders with auth (Req 5.1)", async () => {
    const res = await fetch(`http://localhost:${port}/admin/bundles`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Bundle Manager");
    expect(html).toContain("Local Store Mode");
  });

  // ── Channel assignment with SSE events ────────────────────────────

  it("channel assignment emits SSE events (Req 4.5)", async () => {
    emittedEvents.length = 0;

    await fetch(`http://localhost:${port}/api/admin/channels/prod/assign`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ version: "1.0.0" }),
    });

    const assignEvent = emittedEvents.find(
      (e) => e.type === "admin_channel_change" && e.data.action === "assign",
    );
    expect(assignEvent).toBeDefined();
    expect(assignEvent.data.channel).toBe("prod");
    expect(assignEvent.data.version).toBe("1.0.0");
  });

  // ── Channel assignment API with SSE stream delivery ───────────────

  it("channel assignment delivers events through SSE stream endpoint (Req 4.5, 9.3)", async () => {
    // Connect to SSE stream
    const controller = new AbortController();
    const sseRes = await fetch(`http://localhost:${port}/api/admin/events`, {
      headers: authHeaders(),
      signal: controller.signal,
    });
    expect(sseRes.status).toBe(200);
    expect(sseRes.headers.get("content-type")).toBe("text/event-stream");

    const reader = sseRes.body!.getReader();
    const decoder = new TextDecoder();

    // Read the initial "connected" event
    const { value: firstChunk } = await reader.read();
    const firstText = decoder.decode(firstChunk);
    expect(firstText).toContain('"type":"connected"');

    // Perform a channel assignment
    const assignRes = await fetch(`http://localhost:${port}/api/admin/channels/dev/assign`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ version: "2.0.0" }),
    });
    expect(assignRes.status).toBe(200);

    // Read the SSE event from the stream
    const { value: eventChunk } = await reader.read();
    const eventText = decoder.decode(eventChunk);
    expect(eventText).toContain("admin_channel_change");
    expect(eventText).toContain('"action":"assign"');
    expect(eventText).toContain('"channel":"dev"');
    expect(eventText).toContain('"version":"2.0.0"');

    controller.abort();
  });

  it("multiple channel assignments deliver multiple SSE events in order (Req 4.5)", async () => {
    // Connect to SSE stream
    const controller = new AbortController();
    const sseRes = await fetch(`http://localhost:${port}/api/admin/events`, {
      headers: authHeaders(),
      signal: controller.signal,
    });
    expect(sseRes.status).toBe(200);

    const reader = sseRes.body!.getReader();
    const decoder = new TextDecoder();

    // Read the initial "connected" event
    await reader.read();

    // Perform multiple channel assignments
    await fetch(`http://localhost:${port}/api/admin/channels/dev/assign`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ version: "1.0.0" }),
    });
    await fetch(`http://localhost:${port}/api/admin/channels/uat/assign`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ version: "2.0.0" }),
    });
    await fetch(`http://localhost:${port}/api/admin/channels/prod/assign`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ version: "1.0.0" }),
    });

    // Collect SSE events — they may arrive in one or multiple chunks
    let allText = "";
    const readWithTimeout = async (): Promise<string> => {
      const timeoutPromise = new Promise<string>((resolve) => setTimeout(() => resolve(""), 500));
      const readPromise = reader.read().then(({ value }) => value ? decoder.decode(value) : "");
      return Promise.race([readPromise, timeoutPromise]);
    };

    // Read chunks until we have all 3 events or timeout
    for (let i = 0; i < 5; i++) {
      const chunk = await readWithTimeout();
      if (!chunk) break;
      allText += chunk;
      const assignCount = (allText.match(/"action":"assign"/g) || []).length;
      if (assignCount >= 3) break;
    }

    // Verify all 3 assignment events were delivered
    expect(allText).toContain('"channel":"dev"');
    expect(allText).toContain('"channel":"uat"');
    expect(allText).toContain('"channel":"prod"');
    const assignMatches = allText.match(/"action":"assign"/g) || [];
    expect(assignMatches.length).toBe(3);

    controller.abort();
  });

  it("SSE stream receives bundle_change event on delete after channel assignment (Req 6.6)", async () => {
    // First assign a version to a channel
    await fetch(`http://localhost:${port}/api/admin/channels/dev/assign`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ version: "2.0.0" }),
    });

    // Connect to SSE stream
    const controller = new AbortController();
    const sseRes = await fetch(`http://localhost:${port}/api/admin/events`, {
      headers: authHeaders(),
      signal: controller.signal,
    });
    expect(sseRes.status).toBe(200);

    const reader = sseRes.body!.getReader();
    const decoder = new TextDecoder();

    // Read the initial "connected" event
    await reader.read();

    // Delete the assigned bundle — should trigger stale + bundle_change events
    const deleteRes = await fetch(`http://localhost:${port}/api/admin/bundles/2.0.0`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(deleteRes.status).toBe(200);

    // Read SSE events — expect both admin_channel_change (stale) and bundle_change (delete)
    let allText = "";
    const readWithTimeout = async (): Promise<string> => {
      const timeoutPromise = new Promise<string>((resolve) => setTimeout(() => resolve(""), 500));
      const readPromise = reader.read().then(({ value }) => value ? decoder.decode(value) : "");
      return Promise.race([readPromise, timeoutPromise]);
    };

    for (let i = 0; i < 5; i++) {
      const chunk = await readWithTimeout();
      if (!chunk) break;
      allText += chunk;
      if (allText.includes("bundle_change") && allText.includes("admin_channel_change")) break;
    }

    expect(allText).toContain('"action":"stale"');
    expect(allText).toContain('"channel":"dev"');
    expect(allText).toContain('"action":"delete"');
    expect(allText).toContain('"version":"2.0.0"');

    controller.abort();
  });
});

// ---------------------------------------------------------------------------
// Empty Registry Fallback to konductor-setup/ Pack
// ---------------------------------------------------------------------------

describe("Bundle Store Integration — Empty Registry Fallback (Req 1.5)", () => {
  beforeEach(() => {
    clearInstallerCache();
  });

  afterEach(() => {
    clearInstallerCache();
  });

  it("buildInstallerTarball packs konductor-setup/ and returns a valid .tgz buffer", () => {
    const setupDir = resolve(process.cwd(), "..", "konductor-setup");

    // Skip if konductor-setup/ doesn't exist in this environment
    if (!existsSync(join(setupDir, "package.json"))) {
      console.log("Skipping: konductor-setup/ not found at", setupDir);
      return;
    }

    const tarball = buildInstallerTarball(setupDir);
    expect(tarball).not.toBeNull();
    expect(tarball!.length).toBeGreaterThan(0);

    // Verify it's a valid gzip buffer (starts with gzip magic bytes 1f 8b)
    expect(tarball![0]).toBe(0x1f);
    expect(tarball![1]).toBe(0x8b);
  });

  it("buildInstallerTarball returns null when setup directory does not exist", () => {
    const nonExistentDir = join(tmpdir(), "non-existent-konductor-setup-" + Date.now());
    const tarball = buildInstallerTarball(nonExistentDir);
    expect(tarball).toBeNull();
  });

  it("empty registry falls back to konductor-setup/ pack and seeds Prod channel", async () => {
    const setupDir = resolve(process.cwd(), "..", "konductor-setup");

    // Skip if konductor-setup/ doesn't exist in this environment
    if (!existsSync(join(setupDir, "package.json"))) {
      console.log("Skipping: konductor-setup/ not found at", setupDir);
      return;
    }

    // Simulate the fallback logic from createComponents:
    // 1. Create an empty registry (no bundles in installers/)
    const emptyDir = mkdtempSync(join(tmpdir(), "bundle-fallback-"));
    const emptyRegistry = new BundleRegistry();
    await emptyRegistry.scanLocalStore(emptyDir);
    expect(emptyRegistry.size).toBe(0);

    // 2. Since registry is empty, fall back to buildInstallerTarball
    const installerTgz = buildInstallerTarball(setupDir);
    expect(installerTgz).not.toBeNull();

    // 3. Seed the Prod channel with the packed tarball
    const channelStore = new InstallerChannelStore();
    const { readFileSync } = await import("node:fs");
    const pkgPath = resolve(setupDir, "package.json");
    let setupVersion = "0.0.0";
    try { setupVersion = JSON.parse(readFileSync(pkgPath, "utf-8")).version ?? "0.0.0"; } catch {}

    await channelStore.setTarball("prod", installerTgz!, setupVersion);

    // 4. Verify Prod channel is now seeded
    const prodTarball = await channelStore.getTarball("prod");
    expect(prodTarball).not.toBeNull();
    expect(prodTarball!.length).toBeGreaterThan(0);
    expect(prodTarball!.equals(installerTgz!)).toBe(true);

    // 5. Verify metadata
    const metadata = await channelStore.getMetadata("prod");
    expect(metadata).not.toBeNull();
    expect(metadata!.version).toBe(setupVersion);

    // 6. Verify the tarball is a valid gzip
    expect(prodTarball![0]).toBe(0x1f);
    expect(prodTarball![1]).toBe(0x8b);

    rmSync(emptyDir, { recursive: true, force: true });
  });

  it("empty registry with missing konductor-setup/ leaves Prod channel empty", async () => {
    // Simulate the fallback when konductor-setup/ doesn't exist
    const emptyDir = mkdtempSync(join(tmpdir(), "bundle-fallback-no-setup-"));
    const emptyRegistry = new BundleRegistry();
    await emptyRegistry.scanLocalStore(emptyDir);
    expect(emptyRegistry.size).toBe(0);

    // buildInstallerTarball returns null for non-existent directory
    const nonExistentSetup = join(tmpdir(), "no-such-konductor-setup-" + Date.now());
    const installerTgz = buildInstallerTarball(nonExistentSetup);
    expect(installerTgz).toBeNull();

    // Prod channel remains empty (no tarball available)
    const channelStore = new InstallerChannelStore();
    const prodTarball = await channelStore.getTarball("prod");
    expect(prodTarball).toBeNull();

    rmSync(emptyDir, { recursive: true, force: true });
  });
});
