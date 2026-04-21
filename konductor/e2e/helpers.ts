/**
 * Playwright E2E test helpers.
 *
 * Spins up a real Konductor HTTP server on port 3199 (no auth, no TLS)
 * and provides helpers to seed sessions, notifications, and query log entries.
 */

import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";

import { SessionManager } from "../src/session-manager.js";
import { CollisionEvaluator } from "../src/collision-evaluator.js";
import { SummaryFormatter } from "../src/summary-formatter.js";
import { ConfigManager } from "../src/config-manager.js";
import { PersistenceStore } from "../src/persistence-store.js";
import { QueryEngine } from "../src/query-engine.js";
import { NotificationStore } from "../src/baton-notification-store.js";
import { QueryLogStore } from "../src/baton-query-log.js";
import { BatonEventEmitter } from "../src/baton-event-emitter.js";
import { buildMcpServer, startSseServer } from "../src/index.js";
import { buildRepoSummary } from "../src/baton-repo-summary.js";
import { HealthStatus } from "../src/baton-types.js";
import type { BatonNotification, QueryLogEntry } from "../src/baton-types.js";
import { CollisionState } from "../src/types.js";
import { InstallerChannelStore } from "../src/installer-channel-store.js";
import { AdminSettingsStore } from "../src/admin-settings-store.js";
import { MemorySettingsBackend } from "../src/settings-store.js";
import { SlackSettingsManager } from "../src/slack-settings.js";
import { SlackNotifier } from "../src/slack-notifier.js";
import { SlackStateTracker } from "../src/slack-state-tracker.js";
import { KonductorLogger } from "../src/logger.js";
import { CollabRequestStore } from "../src/collab-request-store.js";
import type { CollabRequest } from "../src/collab-request-store.js";

const DEFAULT_TEST_PORT = 3199;
const TEST_API_KEY = "test-e2e-api-key-12345";

export interface TestContext {
  server: Server;
  sessionManager: SessionManager;
  notificationStore: NotificationStore;
  queryLogStore: QueryLogStore;
  batonEventEmitter: BatonEventEmitter;
  collisionEvaluator: CollisionEvaluator;
  installerChannelStore: InstallerChannelStore;
  adminSettingsStore: AdminSettingsStore;
  slackSettingsManager: SlackSettingsManager;
  slackNotifier: SlackNotifier;
  slackStateTracker: SlackStateTracker;
  collabRequestStore: CollabRequestStore;
  tempDir: string;
  baseUrl: string;
  apiKey: string;
}

export async function startTestServer(port?: number): Promise<TestContext> {
  const testPort = port ?? DEFAULT_TEST_PORT;
  const tempDir = join(tmpdir(), `konductor-e2e-${randomUUID()}`);
  await mkdir(tempDir, { recursive: true });

  const configPath = join(tempDir, "konductor.yaml");
  const sessionsPath = join(tempDir, "sessions.json");
  await writeFile(configPath, "heartbeatTimeoutSeconds: 3600\n");

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
  const notificationStore = new NotificationStore();
  const queryLogStore = new QueryLogStore();
  const batonEventEmitter = new BatonEventEmitter();

  // Admin components
  const settingsBackend = new MemorySettingsBackend();
  const adminSettingsStore = new AdminSettingsStore(settingsBackend);
  const installerChannelStore = new InstallerChannelStore();

  // Slack components
  const slackSettingsManager = new SlackSettingsManager(adminSettingsStore);
  const slackStateTracker = new SlackStateTracker();
  const logger = new KonductorLogger({ enabled: false, toTerminal: false });
  const slackNotifier = new SlackNotifier(slackSettingsManager, slackStateTracker, logger);

  // Collab request store (Live Share integration)
  const collabRequestStore = new CollabRequestStore(() => 1800, () => true);

  // Set KONDUCTOR_ADMINS for test admin user
  process.env.KONDUCTOR_ADMINS = "test-admin";
  // Ensure admin auth is enabled for tests (may be disabled in .env.local)
  process.env.KONDUCTOR_ADMIN_AUTH = "true";

  const deps = {
    sessionManager,
    collisionEvaluator,
    summaryFormatter,
    configManager,
    queryEngine,
    notificationStore,
    queryLogStore,
    batonEventEmitter,
    installerChannelStore,
    adminSettingsStore,
    adminList: ["test-admin"],
    slackSettingsManager,
    slackNotifier,
    slackStateTracker,
    collabRequestStore,
  };

  const mcp = buildMcpServer({
    ...deps,
    serverVersion: "0.4.0",
    serverUrl: `http://localhost:${testPort}`,
  });

  const server = startSseServer(mcp, testPort, TEST_API_KEY, undefined, deps) as Server;

  // Wait for server to be listening
  await new Promise<void>((resolve) => {
    if (server.listening) return resolve();
    server.once("listening", resolve);
  });

  return {
    server,
    sessionManager,
    notificationStore,
    queryLogStore,
    batonEventEmitter,
    collisionEvaluator,
    installerChannelStore,
    adminSettingsStore,
    slackSettingsManager,
    slackNotifier,
    slackStateTracker,
    collabRequestStore,
    tempDir,
    baseUrl: `http://localhost:${testPort}`,
    apiKey: TEST_API_KEY,
  };
}

export async function stopTestServer(ctx: TestContext): Promise<void> {
  delete process.env.KONDUCTOR_ADMINS;
  delete process.env.KONDUCTOR_ADMIN_AUTH;
  await new Promise<void>((resolve, reject) => {
    ctx.server.close((err) => (err ? reject(err) : resolve()));
  });
  await rm(ctx.tempDir, { recursive: true, force: true });
}

/** Register a session and emit Baton events (mirrors server behavior). */
export async function registerSession(
  ctx: TestContext,
  userId: string,
  repo: string,
  branch: string,
  files: string[],
) {
  const session = await ctx.sessionManager.register(userId, repo, branch, files);
  // Emit session_change event so the Baton page updates in real time
  try {
    const summary = await buildRepoSummary(ctx.sessionManager, ctx.collisionEvaluator, repo);
    ctx.batonEventEmitter.emit({ type: "session_change", repo, data: summary });
  } catch { /* best effort */ }
  return session;
}

/** Add a notification directly to the store. */
export function addNotification(
  ctx: TestContext,
  overrides: Partial<BatonNotification> = {},
): BatonNotification {
  const notification: BatonNotification = {
    id: randomUUID(),
    repo: "acme/webapp",
    timestamp: new Date().toISOString(),
    notificationType: HealthStatus.Warning,
    collisionState: CollisionState.Crossroads,
    jiras: [],
    summary: "Test notification summary",
    users: [{ userId: "alice", branch: "main" }],
    resolved: false,
    ...overrides,
  };
  ctx.notificationStore.add(notification);
  return notification;
}

/** Add a query log entry directly to the store. */
export function addQueryLogEntry(
  ctx: TestContext,
  overrides: Partial<QueryLogEntry> = {},
): QueryLogEntry {
  const entry: QueryLogEntry = {
    id: randomUUID(),
    repo: "acme/webapp",
    timestamp: new Date().toISOString(),
    userId: "alice",
    branch: "main",
    queryType: "who_is_active",
    parameters: { repo: "acme/webapp" },
    ...overrides,
  };
  ctx.queryLogStore.add(entry);
  return entry;
}

/**
 * Login as admin and return the session cookie string.
 * Uses the test API key and the "test-admin" user from KONDUCTOR_ADMINS.
 */
export async function loginAsAdmin(baseUrl: string, apiKey: string): Promise<string> {
  const res = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `userId=test-admin&apiKey=${encodeURIComponent(apiKey)}`,
    redirect: "manual",
  });
  const setCookie = res.headers.get("set-cookie") ?? "";
  // Extract the cookie value
  const match = setCookie.match(/konductor_admin_session=([^;]+)/);
  return match ? `konductor_admin_session=${match[1]}` : "";
}

/**
 * Add a collaboration request directly to the store and optionally emit an SSE event.
 * Mirrors the pattern used by addNotification / addQueryLogEntry.
 *
 * Requirements: 4.2, 4.3
 */
export function addCollabRequest(
  ctx: TestContext,
  overrides: Partial<CollabRequest> & { initiator: string; recipient: string } = { initiator: "alice", recipient: "bob" },
): CollabRequest {
  const request = ctx.collabRequestStore.create(
    overrides.initiator,
    overrides.recipient,
    overrides.repo ?? "acme/webapp",
    overrides.branch ?? "main",
    overrides.files ?? ["src/index.ts"],
    (overrides.collisionState as CollisionState) ?? CollisionState.CollisionCourse,
  );

  // Apply status overrides by progressing through the lifecycle
  if (overrides.status === "accepted" || overrides.status === "link_shared") {
    if (request.status === "pending") {
      ctx.collabRequestStore.respond(request.requestId, "accept");
    }
  }
  if (overrides.status === "declined") {
    if (request.status === "pending") {
      ctx.collabRequestStore.respond(request.requestId, "decline");
    }
  }
  if (overrides.status === "link_shared" && overrides.shareLink) {
    ctx.collabRequestStore.attachLink(request.requestId, overrides.shareLink);
  }

  // Emit SSE event so the Baton page updates in real time
  ctx.batonEventEmitter.emit({
    type: "collab_request_update",
    repo: request.repo,
    data: request,
  });

  return request;
}
