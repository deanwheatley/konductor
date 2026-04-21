/**
 * Integration Tests for the Collision → Slack Pipeline
 *
 * Tests the full flow: collision evaluation triggers SlackNotifier,
 * which posts messages to Slack (mocked fetch).
 *
 * Requirements: 1.1, 1.5, 1.6, 5.1, 9.2
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { rm, mkdir } from "node:fs/promises";

import { buildMcpServer } from "./index.js";
import { SessionManager } from "./session-manager.js";
import { CollisionEvaluator } from "./collision-evaluator.js";
import { SummaryFormatter } from "./summary-formatter.js";
import { ConfigManager } from "./config-manager.js";
import { PersistenceStore } from "./persistence-store.js";
import { QueryEngine } from "./query-engine.js";
import { AdminSettingsStore } from "./admin-settings-store.js";
import { MemorySettingsBackend } from "./settings-store.js";
import { SlackSettingsManager } from "./slack-settings.js";
import { SlackNotifier } from "./slack-notifier.js";
import { SlackStateTracker } from "./slack-state-tracker.js";
import { KonductorLogger } from "./logger.js";
import { BatonEventEmitter } from "./baton-event-emitter.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseResult(result: any) {
  const text = result.content[0].text;
  return JSON.parse(text);
}

async function makeTempDir(): Promise<string> {
  const dir = join(tmpdir(), `konductor-slack-int-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

interface TestContext {
  client: Client;
  tempDir: string;
  slackSettingsManager: SlackSettingsManager;
  slackNotifier: SlackNotifier;
  slackStateTracker: SlackStateTracker;
  adminSettingsStore: AdminSettingsStore;
  fetchCalls: Array<{ url: string; body: any }>;
  cleanup: () => Promise<void>;
}

async function setupTest(): Promise<TestContext> {
  const tempDir = await makeTempDir();
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
  const queryEngine = new QueryEngine(sessionManager, collisionEvaluator);
  const logger = new KonductorLogger();
  const batonEventEmitter = new BatonEventEmitter();

  const settingsBackend = new MemorySettingsBackend();
  const adminSettingsStore = new AdminSettingsStore(settingsBackend);
  const slackSettingsManager = new SlackSettingsManager(adminSettingsStore);
  const slackStateTracker = new SlackStateTracker();
  const slackNotifier = new SlackNotifier(slackSettingsManager, slackStateTracker, logger);

  // Track fetch calls for assertions
  const fetchCalls: Array<{ url: string; body: any }> = [];

  // Mock global fetch to intercept Slack API calls
  const originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url: any, opts: any) => {
    const urlStr = typeof url === "string" ? url : url.toString();
    const body = opts?.body ? JSON.parse(opts.body) : undefined;
    fetchCalls.push({ url: urlStr, body });

    if (urlStr.includes("chat.postMessage")) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (urlStr.includes("auth.test")) {
      return new Response(JSON.stringify({ ok: true, team: "TestTeam", user: "konductor-bot" }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: false, error: "unknown_method" }), { status: 200 });
  }) as any;

  const mcp = buildMcpServer({
    sessionManager,
    collisionEvaluator,
    summaryFormatter,
    configManager,
    queryEngine,
    logger,
    batonEventEmitter,
    slackSettingsManager,
    slackNotifier,
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcp.connect(serverTransport);

  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientTransport);

  const cleanup = async () => {
    globalThis.fetch = originalFetch;
    await client.close();
    await mcp.close();
    await rm(tempDir, { recursive: true, force: true });
  };

  return { client, tempDir, slackSettingsManager, slackNotifier, slackStateTracker, adminSettingsStore, fetchCalls, cleanup };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Collision → Slack Pipeline Integration", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTest();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("posts Slack message when collision meets verbosity threshold (Req 1.1)", async () => {
    // Configure bot token and channel
    await ctx.adminSettingsStore.set("slack:bot_token", "xoxb-test-token", "slack");
    await ctx.slackSettingsManager.setRepoChannel("org/my-project", "team-alerts");
    await ctx.slackSettingsManager.setRepoVerbosity("org/my-project", 2);

    // Register first user
    await ctx.client.callTool({
      name: "register_session",
      arguments: { userId: "alice", repo: "org/my-project", branch: "main", files: ["src/index.ts"] },
    });

    // Register second user on same files → collision_course
    await ctx.client.callTool({
      name: "register_session",
      arguments: { userId: "bob", repo: "org/my-project", branch: "feature-x", files: ["src/index.ts"] },
    });

    // Wait for async Slack notification
    await new Promise((r) => setTimeout(r, 50));

    // Verify Slack message was posted
    const postCalls = ctx.fetchCalls.filter((c) => c.url.includes("chat.postMessage"));
    expect(postCalls.length).toBeGreaterThanOrEqual(1);

    const lastPost = postCalls[postCalls.length - 1];
    expect(lastPost.body.channel).toBe("team-alerts");
    expect(lastPost.body.blocks).toBeDefined();

    // Verify footer is present
    const contextBlock = lastPost.body.blocks.find((b: any) => b.type === "context");
    expect(contextBlock).toBeDefined();
    expect(contextBlock.elements[0].text).toContain("konductor collision alert for org/my-project");
  });

  it("sends de-escalation message when collision resolves (Req 9.2)", async () => {
    // Configure bot token
    await ctx.adminSettingsStore.set("slack:bot_token", "xoxb-test-token", "slack");
    await ctx.slackSettingsManager.setRepoChannel("org/my-project", "team-alerts");
    await ctx.slackSettingsManager.setRepoVerbosity("org/my-project", 2);

    // Register two users on same files → collision
    await ctx.client.callTool({
      name: "register_session",
      arguments: { userId: "alice", repo: "org/my-project", branch: "main", files: ["src/index.ts"] },
    });
    const bobResult = await ctx.client.callTool({
      name: "register_session",
      arguments: { userId: "bob", repo: "org/my-project", branch: "feature-x", files: ["src/index.ts"] },
    });

    await new Promise((r) => setTimeout(r, 50));

    // Deregister bob → collision resolves
    const bobData = parseResult(bobResult);
    await ctx.client.callTool({
      name: "deregister_session",
      arguments: { sessionId: bobData.sessionId },
    });

    // Alice re-registers (now solo) → triggers de-escalation check
    await ctx.client.callTool({
      name: "register_session",
      arguments: { userId: "alice", repo: "org/my-project", branch: "main", files: ["src/index.ts"] },
    });

    await new Promise((r) => setTimeout(r, 50));

    // Verify de-escalation message was sent
    const postCalls = ctx.fetchCalls.filter((c) => c.url.includes("chat.postMessage"));
    const deescalationMsg = postCalls.find((c) =>
      c.body.blocks?.some((b: any) => b.text?.text?.includes("Collision resolved")),
    );
    expect(deescalationMsg).toBeDefined();
  });

  it("does not post Slack message when verbosity is 0 (Req 5.1)", async () => {
    // Configure bot token but disable Slack for this repo
    await ctx.adminSettingsStore.set("slack:bot_token", "xoxb-test-token", "slack");
    await ctx.slackSettingsManager.setRepoVerbosity("org/my-project", 0);

    // Register two users on same files → collision
    await ctx.client.callTool({
      name: "register_session",
      arguments: { userId: "alice", repo: "org/my-project", branch: "main", files: ["src/index.ts"] },
    });
    await ctx.client.callTool({
      name: "register_session",
      arguments: { userId: "bob", repo: "org/my-project", branch: "feature-x", files: ["src/index.ts"] },
    });

    await new Promise((r) => setTimeout(r, 50));

    // No Slack messages should have been posted
    const postCalls = ctx.fetchCalls.filter((c) => c.url.includes("chat.postMessage"));
    expect(postCalls).toHaveLength(0);
  });

  it("does not post Slack message when bot token is missing (Req 1.6)", async () => {
    // No bot token configured — Slack should be silently skipped
    // Clear env var that may leak from .env.local
    const savedToken = process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_BOT_TOKEN;

    // Register two users on same files → collision
    await ctx.client.callTool({
      name: "register_session",
      arguments: { userId: "alice", repo: "org/my-project", branch: "main", files: ["src/index.ts"] },
    });
    await ctx.client.callTool({
      name: "register_session",
      arguments: { userId: "bob", repo: "org/my-project", branch: "feature-x", files: ["src/index.ts"] },
    });

    await new Promise((r) => setTimeout(r, 50));

    // No Slack messages should have been posted
    const postCalls = ctx.fetchCalls.filter((c) => c.url.includes("chat.postMessage"));
    expect(postCalls).toHaveLength(0);

    // Restore env var
    if (savedToken) process.env.SLACK_BOT_TOKEN = savedToken;
  });
});
