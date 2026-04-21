/**
 * Unit Tests for Admin Slack API Routes
 *
 * Tests GET/PUT /api/admin/slack and POST /api/admin/slack/test endpoints.
 * Verifies admin auth requirement and token validation.
 *
 * Requirements: 11.5, 11.6, 6.1, 6.2, 6.4, 6.5, 6.10
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { handleAdminRoute, type AdminRouteDeps } from "./admin-routes.js";
import { AdminSettingsStore } from "./admin-settings-store.js";
import { MemorySettingsBackend } from "./settings-store.js";
import { InstallerChannelStore } from "./installer-channel-store.js";
import { SlackSettingsManager } from "./slack-settings.js";
import { SlackNotifier } from "./slack-notifier.js";
import { SlackStateTracker } from "./slack-state-tracker.js";
import { KonductorLogger } from "./logger.js";
import { BatonEventEmitter } from "./baton-event-emitter.js";
import {
  encodeAdminSession,
  createAdminSession,
  getSessionSecret,
  resetSessionSecret,
} from "./admin-auth.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_API_KEY = "test-slack-admin-api-key";
const TEST_SECRET = "test-session-secret-long-enough-for-aes";

function createTestServer(depsOverrides?: Partial<AdminRouteDeps>) {
  const settingsBackend = new MemorySettingsBackend();
  const adminSettingsStore = new AdminSettingsStore(settingsBackend);
  const slackSettingsManager = new SlackSettingsManager(adminSettingsStore);
  const slackStateTracker = new SlackStateTracker();
  const logger = new KonductorLogger();
  const slackNotifier = new SlackNotifier(slackSettingsManager, slackStateTracker, logger);
  const batonEventEmitter = new BatonEventEmitter();

  const deps: AdminRouteDeps = {
    apiKey: TEST_API_KEY,
    adminSettingsStore,
    installerChannelStore: new InstallerChannelStore(),
    logger,
    batonEventEmitter,
    serverUrl: "http://localhost:3100",
    port: 3100,
    protocol: "http",
    useTls: false,
    adminList: ["admin1"],
    slackSettingsManager,
    slackNotifier,
    ...depsOverrides,
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const handled = await handleAdminRoute(req, res, url, deps);
    if (!handled) {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  return { server, deps };
}

async function startServer(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });
}

function makeAdminHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${TEST_API_KEY}`,
    "X-Konductor-User": "admin1",
  };
}

function makeNonAdminHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${TEST_API_KEY}`,
    "X-Konductor-User": "regular-user",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Admin Slack API Routes", () => {
  let server: Server;
  let port: number;

  beforeEach(async () => {
    process.env.KONDUCTOR_SESSION_SECRET = TEST_SECRET;
    process.env.KONDUCTOR_ADMINS = "admin1";
    resetSessionSecret();

    const s = createTestServer();
    server = s.server;
    port = await startServer(server);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    delete process.env.KONDUCTOR_SESSION_SECRET;
    delete process.env.KONDUCTOR_ADMINS;
    delete process.env.SLACK_BOT_TOKEN;
    resetSessionSecret();
  });

  describe("GET /api/admin/slack", () => {
    it("returns not configured when no bot token (Req 11.5, 6.1)", async () => {
      const res = await fetch(`http://localhost:${port}/api/admin/slack`, {
        headers: makeAdminHeaders(),
      });
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.configured).toBe(false);
      expect(data.authMode).toBe("bot_token");
    });

    it("rejects non-admin users (Req 11.5)", async () => {
      const res = await fetch(`http://localhost:${port}/api/admin/slack`, {
        headers: makeNonAdminHeaders(),
      });
      expect(res.status).toBe(403);
    });

    it("rejects unauthenticated requests", async () => {
      const res = await fetch(`http://localhost:${port}/api/admin/slack`);
      expect(res.status).toBe(401);
    });
  });

  describe("PUT /api/admin/slack", () => {
    it("rejects when SLACK_BOT_TOKEN env var is set (read-only)", async () => {
      process.env.SLACK_BOT_TOKEN = "xoxb-env-token";
      const res = await fetch(`http://localhost:${port}/api/admin/slack`, {
        method: "PUT",
        headers: { ...makeAdminHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ botToken: "xoxb-new-token" }),
      });
      expect(res.status).toBe(400);
      const data: any = await res.json();
      expect(data.error).toContain("read-only");
    });

    it("rejects non-admin users (Req 11.6)", async () => {
      const res = await fetch(`http://localhost:${port}/api/admin/slack`, {
        method: "PUT",
        headers: { ...makeNonAdminHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ botToken: "xoxb-test" }),
      });
      expect(res.status).toBe(403);
    });

    it("returns 400 when neither botToken nor OAuth credentials provided", async () => {
      const res = await fetch(`http://localhost:${port}/api/admin/slack`, {
        method: "PUT",
        headers: { ...makeAdminHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const data: any = await res.json();
      expect(data.error).toContain("Must provide");
    });

    it("returns 400 for invalid JSON body", async () => {
      const res = await fetch(`http://localhost:${port}/api/admin/slack`, {
        method: "PUT",
        headers: { ...makeAdminHeaders(), "Content-Type": "application/json" },
        body: "not json",
      });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/admin/slack/test", () => {
    it("returns error when bot token not configured (Req 6.10)", async () => {
      const res = await fetch(`http://localhost:${port}/api/admin/slack/test`, {
        method: "POST",
        headers: { ...makeAdminHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "general" }),
      });
      expect(res.status).toBe(400);
      const data: any = await res.json();
      expect(data.error).toContain("not configured");
    });

    it("returns 400 when channel is missing", async () => {
      const res = await fetch(`http://localhost:${port}/api/admin/slack/test`, {
        method: "POST",
        headers: { ...makeAdminHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const data: any = await res.json();
      expect(data.error).toContain("channel is required");
    });

    it("rejects non-admin users", async () => {
      const res = await fetch(`http://localhost:${port}/api/admin/slack/test`, {
        method: "POST",
        headers: { ...makeNonAdminHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "general" }),
      });
      expect(res.status).toBe(403);
    });
  });
});
