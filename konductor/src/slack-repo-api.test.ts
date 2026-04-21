/**
 * Unit Tests for Per-Repo Slack API Routes
 *
 * Tests GET/PUT /api/repo/:repoName/slack endpoints including
 * validation, SSE event emission, and test notification.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.7
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { AdminSettingsStore } from "./admin-settings-store.js";
import { MemorySettingsBackend } from "./settings-store.js";
import { SlackSettingsManager, validateChannelName, validateVerbosity } from "./slack-settings.js";
import { SlackNotifier } from "./slack-notifier.js";
import { SlackStateTracker } from "./slack-state-tracker.js";
import { BatonEventEmitter } from "./baton-event-emitter.js";
import { KonductorLogger } from "./logger.js";
import type { BatonEvent, SlackConfigChangeEvent } from "./baton-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestDeps() {
  const settingsBackend = new MemorySettingsBackend();
  const adminSettingsStore = new AdminSettingsStore(settingsBackend);
  const slackSettingsManager = new SlackSettingsManager(adminSettingsStore);
  const slackStateTracker = new SlackStateTracker();
  const logger = new KonductorLogger();
  const slackNotifier = new SlackNotifier(slackSettingsManager, slackStateTracker, logger);
  const batonEventEmitter = new BatonEventEmitter();

  return { adminSettingsStore, slackSettingsManager, slackNotifier, slackStateTracker, logger, batonEventEmitter };
}

/**
 * Create a minimal HTTP server that handles per-repo Slack routes.
 * Mimics the logic from index.ts without needing the full server.
 */
function createSlackApiServer(deps: ReturnType<typeof createTestDeps>) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    // Simulate: no auth required for tests (auth is tested separately)
    const apiSlackMatch = url.pathname.match(/^\/api\/repo\/([^/]+)\/slack$/);

    if (req.method === "GET" && apiSlackMatch) {
      const repoName = apiSlackMatch[1];
      const repo = `_/${repoName}`;
      try {
        const config = await deps.slackSettingsManager.getRepoConfig(repo);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ channel: config.channel, verbosity: config.verbosity, enabled: config.enabled }));
      } catch {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to get Slack config" }));
      }
      return;
    }

    if (req.method === "PUT" && apiSlackMatch) {
      const repoName = apiSlackMatch[1];
      const repo = `_/${repoName}`;

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      let body: { channel?: string; verbosity?: number };
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
        return;
      }

      if (body.channel !== undefined && !validateChannelName(body.channel)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid Slack channel name." }));
        return;
      }

      if (body.verbosity !== undefined && !validateVerbosity(body.verbosity)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid verbosity level." }));
        return;
      }

      try {
        if (body.channel !== undefined) await deps.slackSettingsManager.setRepoChannel(repo, body.channel);
        if (body.verbosity !== undefined) await deps.slackSettingsManager.setRepoVerbosity(repo, body.verbosity);

        const updatedConfig = await deps.slackSettingsManager.getRepoConfig(repo);
        const changedBy = "test-user";
        const slackChannelLink = `https://slack.com/app_redirect?channel=${updatedConfig.channel}`;

        const eventData: SlackConfigChangeEvent = {
          channel: updatedConfig.channel,
          verbosity: updatedConfig.verbosity,
          changedBy,
          slackChannelLink,
        };
        deps.batonEventEmitter.emit({ type: "slack_config_change", repo, data: eventData });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ channel: updatedConfig.channel, verbosity: updatedConfig.verbosity, enabled: updatedConfig.enabled }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }));
      }
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  return server;
}

async function startServer(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Per-Repo Slack API Routes", () => {
  let server: Server;
  let port: number;
  let deps: ReturnType<typeof createTestDeps>;

  beforeEach(async () => {
    deps = createTestDeps();
    server = createSlackApiServer(deps);
    port = await startServer(server);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  describe("GET /api/repo/:repoName/slack", () => {
    it("returns default config when no settings stored (Req 11.1)", async () => {
      const res = await fetch(`http://localhost:${port}/api/repo/my-project/slack`);
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.channel).toBe("konductor-alerts-my-project");
      expect(data.verbosity).toBe(2);
      expect(data.enabled).toBe(false); // no bot token configured
    });

    it("returns stored config after setting channel and verbosity", async () => {
      await deps.slackSettingsManager.setRepoChannel("_/my-project", "custom-channel");
      await deps.slackSettingsManager.setRepoVerbosity("_/my-project", 4);

      const res = await fetch(`http://localhost:${port}/api/repo/my-project/slack`);
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.channel).toBe("custom-channel");
      expect(data.verbosity).toBe(4);
    });
  });

  describe("PUT /api/repo/:repoName/slack", () => {
    it("updates channel and returns new config (Req 11.2)", async () => {
      const res = await fetch(`http://localhost:${port}/api/repo/my-project/slack`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "new-alerts" }),
      });
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.channel).toBe("new-alerts");
    });

    it("updates verbosity and returns new config", async () => {
      const res = await fetch(`http://localhost:${port}/api/repo/my-project/slack`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verbosity: 3 }),
      });
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.verbosity).toBe(3);
    });

    it("returns 400 for invalid channel name (Req 11.3)", async () => {
      const res = await fetch(`http://localhost:${port}/api/repo/my-project/slack`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "-invalid-leading-hyphen" }),
      });
      expect(res.status).toBe(400);
      const data: any = await res.json();
      expect(data.error).toContain("Invalid Slack channel name");
    });

    it("returns 400 for invalid verbosity (Req 11.3)", async () => {
      const res = await fetch(`http://localhost:${port}/api/repo/my-project/slack`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verbosity: 7 }),
      });
      expect(res.status).toBe(400);
      const data: any = await res.json();
      expect(data.error).toContain("Invalid verbosity");
    });

    it("emits slack_config_change event with correct payload (Req 4.1)", async () => {
      const events: BatonEvent[] = [];
      const unsub = deps.batonEventEmitter.subscribe("_/my-project", (event) => {
        events.push(event);
      });

      await fetch(`http://localhost:${port}/api/repo/my-project/slack`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "team-alerts", verbosity: 4 }),
      });

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("slack_config_change");
      const data = events[0].data as SlackConfigChangeEvent;
      expect(data.channel).toBe("team-alerts");
      expect(data.verbosity).toBe(4);
      expect(data.changedBy).toBe("test-user");
      expect(data.slackChannelLink).toContain("team-alerts");

      unsub();
    });

    it("returns 400 for invalid JSON body", async () => {
      const res = await fetch(`http://localhost:${port}/api/repo/my-project/slack`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      expect(res.status).toBe(400);
    });
  });
});
