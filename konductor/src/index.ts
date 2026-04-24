#!/usr/bin/env node

/**
 * Konductor MCP Server — entry point.
 *
 * Exposes four MCP tools (register_session, check_status, deregister_session,
 * list_sessions) over stdio (default) or SSE transport.
 *
 * Usage:
 *   npx konductor              # stdio transport (local)
 *   npx konductor --sse        # SSE transport on KONDUCTOR_PORT (default 3100)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { z } from "zod";
import { resolve, extname, join, relative } from "node:path";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { hostname as osHostname } from "node:os";
import { execSync } from "node:child_process";
import { randomUUID, randomBytes as cryptoRandomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Load .env.local if present (lightweight, no external dependency)
// ---------------------------------------------------------------------------

function loadEnvLocal() {
  const envPath = resolve(process.cwd(), ".env.local");
  try {
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      // Don't override existing env vars (CLI/shell takes precedence)
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env.local is optional — silently skip if missing
  }
}

loadEnvLocal();

import { SessionManager } from "./session-manager.js";
import { CollisionEvaluator } from "./collision-evaluator.js";
import { SummaryFormatter } from "./summary-formatter.js";
import { ConfigManager } from "./config-manager.js";
import { PersistenceStore } from "./persistence-store.js";
import { KonductorLogger } from "./logger.js";
import { QueryEngine } from "./query-engine.js";
import type { CollisionResult, WorkSession } from "./types.js";
import { NotificationStore } from "./baton-notification-store.js";
import { QueryLogStore } from "./baton-query-log.js";
import { BatonEventEmitter } from "./baton-event-emitter.js";
import { buildRepoSummary } from "./baton-repo-summary.js";
import { buildRepoPage } from "./baton-page-builder.js";
import { buildRepoPageUrl, extractRepoName } from "./baton-url.js";
import { computeHealthStatus, HealthStatus } from "./baton-types.js";
import type { BatonNotification } from "./baton-types.js";
import { GitHubPoller } from "./github-poller.js";
import { CommitPoller } from "./commit-poller.js";
import { MemoryHistoryStore } from "./memory-history-store.js";
import { HistoryPurger } from "./history-purger.js";
import type { ISessionHistoryStore } from "./session-history-types.js";
import {
  BatonAuthModule,
  parseCookies,
  serializeCookie,
  build403Page,
  build503Page,
  buildAuthErrorPage,
  buildLoggedOutPage,
} from "./baton-auth.js";
import { InstallerChannelStore, resolveEffectiveChannel, VALID_CHANNELS, VALID_CHANNEL_OVERRIDES } from "./installer-channel-store.js";
import type { ChannelName, EffectiveChannel } from "./installer-channel-store.js";
import { handleAdminRoute } from "./admin-routes.js";
import { AdminSettingsStore } from "./admin-settings-store.js";
import { MemorySettingsBackend } from "./settings-store.js";
import { FileSettingsBackend } from "./file-settings-backend.js";
import { parseKonductorAdmins } from "./admin-auth.js";
import { SlackSettingsManager, validateChannelName, validateVerbosity } from "./slack-settings.js";
import { formatLineRanges } from "./line-range-formatter.js";
import { LocalPersistence } from "./local-persistence.js";
import { S3Persistence } from "./s3-persistence.js";
import { SlackNotifier } from "./slack-notifier.js";
import { SlackStateTracker } from "./slack-state-tracker.js";
import { SlackDebouncer } from "./slack-debouncer.js";
import type { SlackConfigChangeEvent } from "./baton-types.js";
import { BundleRegistry } from "./bundle-registry.js";
import { UserTransportRegistry, pushCollisionAlerts } from "./proactive-push.js";
import { CollabRequestStore } from "./collab-request-store.js";
import type { CollabRequest } from "./collab-request-store.js";

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const REPO_REGEX = /^[^/]+\/[^/]+$/;

// ---------------------------------------------------------------------------
// File format normalization (Requirements 2.3, 2.4, 2.5, 7.1)
// ---------------------------------------------------------------------------

import type { FileChange, LineRange } from "./types.js";

/**
 * Normalize a mixed files array (strings and/or FileChange objects) into
 * a consistent FileChange[] and a flat string[] of paths.
 *
 * Accepts:
 *   - string[] (backward compatible — no line ranges)
 *   - FileChange[] (objects with path and optional lineRanges)
 *   - Mixed arrays of both
 *
 * Returns { files: string[], fileChanges: FileChange[] }
 */
export function normalizeFilesInput(
  input: unknown[],
): { files: string[]; fileChanges: FileChange[] } {
  const fileChanges: FileChange[] = [];

  for (const item of input) {
    if (typeof item === "string") {
      fileChanges.push({ path: item });
    } else if (typeof item === "object" && item !== null && "path" in item) {
      const obj = item as { path: string; lineRanges?: unknown[] };
      const fc: FileChange = { path: obj.path };
      if (Array.isArray(obj.lineRanges) && obj.lineRanges.length > 0) {
        const validRanges: LineRange[] = [];
        for (const lr of obj.lineRanges) {
          if (
            typeof lr === "object" &&
            lr !== null &&
            "startLine" in lr &&
            "endLine" in lr &&
            typeof (lr as any).startLine === "number" &&
            typeof (lr as any).endLine === "number" &&
            (lr as any).startLine >= 1 &&
            (lr as any).endLine >= (lr as any).startLine
          ) {
            validRanges.push({
              startLine: (lr as any).startLine,
              endLine: (lr as any).endLine,
            });
          }
        }
        if (validRanges.length > 0) {
          fc.lineRanges = validRanges;
        }
      }
      fileChanges.push(fc);
    }
  }

  const files = fileChanges.map((fc) => fc.path);
  return { files, fileChanges };
}

// ---------------------------------------------------------------------------
// GitHub history builder
// ---------------------------------------------------------------------------

export interface GitHubHistoryEntry {
  timestamp: string;
  action: "PR Opened" | "PR Approved" | "Commit";
  user: string;
  branch: string;
  summary: string;
}

/**
 * Build a chronological history from passive sessions (PRs and commits).
 * Returns entries sorted newest-first.
 */
export function buildGitHubHistory(sessions: WorkSession[]): GitHubHistoryEntry[] {
  const entries: GitHubHistoryEntry[] = [];

  for (const s of sessions) {
    if (s.source === "github_pr") {
      entries.push({
        timestamp: s.createdAt,
        action: s.prApproved ? "PR Approved" : "PR Opened",
        user: s.userId,
        branch: s.branch,
        summary: `PR #${s.prNumber ?? "?"}${s.prDraft ? " (draft)" : ""} → ${s.prTargetBranch ?? "?"}  ·  ${s.files.length} file${s.files.length !== 1 ? "s" : ""}`,
      });
    } else if (s.source === "github_commit") {
      const range = s.commitDateRange
        ? `${s.commitDateRange.earliest.slice(0, 10)} – ${s.commitDateRange.latest.slice(0, 10)}`
        : "";
      entries.push({
        timestamp: s.commitDateRange?.latest ?? s.createdAt,
        action: "Commit",
        user: s.userId,
        branch: s.branch,
        summary: `${s.files.length} file${s.files.length !== 1 ? "s" : ""} modified${range ? ` (${range})` : ""}`,
      });
    }
  }

  // Sort newest first
  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return entries;
}

// ---------------------------------------------------------------------------
// Open PRs builder
// ---------------------------------------------------------------------------

export interface OpenPREntry {
  prNumber: number;
  prUrl: string;
  user: string;
  branch: string;
  targetBranch: string;
  status: "draft" | "approved" | "open";
  filesCount: number;
  hoursOpen: number;
}

/**
 * Build a list of open PRs from passive PR sessions.
 * Returns entries sorted by hours open (newest first).
 */
export function buildOpenPRs(sessions: WorkSession[]): OpenPREntry[] {
  const now = Date.now();
  const entries: OpenPREntry[] = [];

  for (const s of sessions) {
    if (s.source !== "github_pr") continue;

    const createdMs = new Date(s.createdAt).getTime();
    const hoursOpen = Math.max(0, Math.round((now - createdMs) / 3_600_000 * 10) / 10);

    const status: "draft" | "approved" | "open" = s.prDraft
      ? "draft"
      : s.prApproved
        ? "approved"
        : "open";

    entries.push({
      prNumber: s.prNumber ?? 0,
      prUrl: s.prUrl ?? "",
      user: s.userId,
      branch: s.branch,
      targetBranch: s.prTargetBranch ?? "",
      status,
      filesCount: s.files.length,
      hoursOpen,
    });
  }

  // Sort newest first (fewest hours open)
  entries.sort((a, b) => a.hoursOpen - b.hoursOpen);
  return entries;
}

// ---------------------------------------------------------------------------
// Collision activity log summary builder
// ---------------------------------------------------------------------------

/**
 * Build a human-readable collision summary for the Baton activity log.
 *
 * Examples:
 *   "Collision detected. Proximity with bob on src/utils.ts — different sections (your lines 1-10, their lines 20-30)."
 *   "Collision detected. Collision course with bob on src/index.ts — same lines (lines 5-15). High merge conflict risk."
 *   "Neighbors with alice — different files."
 *   "Crossroads with carol — same directories."
 */
export function buildCollisionSummary(result: CollisionResult, userId: string): string {
  const stateLabel = result.state.replace(/_/g, " ");
  const overlappingUsers = [...new Set(result.overlappingSessions.map((s) => s.userId))];
  const userList = overlappingUsers.join(", ");

  // Neighbors: no shared files, just different files in same repo
  if (result.state === "neighbors") {
    return `Neighbors with ${userList} — different files.`;
  }

  // Crossroads: same directories but different files
  if (result.state === "crossroads") {
    const dirs = result.sharedDirectories.length > 0
      ? result.sharedDirectories.slice(0, 3).join(", ") + (result.sharedDirectories.length > 3 ? ` +${result.sharedDirectories.length - 3} more` : "")
      : "shared directories";
    return `Crossroads with ${userList} in ${dirs}.`;
  }

  // For proximity, collision_course, merge_hell — include file and line details
  const sharedFiles = result.sharedFiles.length > 0 ? result.sharedFiles : [];
  const fileDisplay = sharedFiles.length > 0
    ? sharedFiles.slice(0, 3).join(", ") + (sharedFiles.length > 3 ? ` +${sharedFiles.length - 3} more` : "")
    : "shared files";

  let summary = `Collision detected. ${stateLabel.charAt(0).toUpperCase() + stateLabel.slice(1)} with ${userList} on ${fileDisplay}`;

  // Add line-level context from overlapping details
  const lineContextParts: string[] = [];
  for (const detail of result.overlappingDetails) {
    if (!detail.lineOverlapDetails || detail.lineOverlapDetails.length === 0) continue;
    for (const lod of detail.lineOverlapDetails) {
      if (lod.lineOverlap === true) {
        const overlappingRanges = formatLineRanges(lod.userRanges);
        const otherRanges = formatLineRanges(lod.otherRanges);
        lineContextParts.push(`${lod.file}: same lines (your ${overlappingRanges}, their ${otherRanges})`);
      } else if (lod.lineOverlap === false) {
        const userRanges = formatLineRanges(lod.userRanges);
        const otherRanges = formatLineRanges(lod.otherRanges);
        lineContextParts.push(`${lod.file}: different sections (your ${userRanges}, their ${otherRanges})`);
      }
    }
  }

  if (lineContextParts.length > 0) {
    const maxParts = 3;
    const displayed = lineContextParts.slice(0, maxParts);
    const extra = lineContextParts.length > maxParts ? ` +${lineContextParts.length - maxParts} more` : "";
    summary += ` — ${displayed.join("; ")}${extra}`;
  }

  // Add severity context
  if (result.overlapSeverity === "severe") {
    summary += ". High merge conflict risk.";
  } else if (result.overlapSeverity === "minimal") {
    summary += ". Minor overlap — likely a quick merge resolution.";
  } else {
    summary += ".";
  }

  return summary;
}

function validateRepo(repo: string): string | null {
  if (!REPO_REGEX.test(repo)) {
    return `Invalid repo format "${repo}": expected "owner/repo"`;
  }
  return null;
}

function validateFiles(files: string[]): string | null {
  if (files.length === 0) {
    return "File list must not be empty";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Bootstrap components
// ---------------------------------------------------------------------------

export async function createComponents(configPath?: string, sessionsPath?: string) {
  const cfgPath = configPath ?? resolve(process.cwd(), "konductor.yaml");
  const sesPath = sessionsPath ?? resolve(process.cwd(), "sessions.json");

  const logger = new KonductorLogger();

  const configManager = new ConfigManager(logger);
  await configManager.load(cfgPath);

  const persistenceStore = new PersistenceStore(sesPath);
  const sessionManager = new SessionManager(
    persistenceStore,
    () => configManager.getTimeout() * 1000,
    logger,
  );
  await sessionManager.init();

  const collisionEvaluator = new CollisionEvaluator();
  const summaryFormatter = new SummaryFormatter();
  const queryEngine = new QueryEngine(sessionManager, collisionEvaluator);

  // Baton dashboard components
  const notificationStore = new NotificationStore();
  const queryLogStore = new QueryLogStore();
  const batonEventEmitter = new BatonEventEmitter();

  // History store — must be created before GitHub pollers so they can upsert PR authors
  const historyStore = new MemoryHistoryStore();

  // GitHub pollers — instantiate only when config is present (Req 5.1, 5.2)
  let githubPoller: GitHubPoller | undefined;
  let commitPoller: CommitPoller | undefined;

  const ghConfig = configManager.getGitHubConfig();
  if (ghConfig) {
    githubPoller = new GitHubPoller(ghConfig, sessionManager, logger, undefined, batonEventEmitter, historyStore);
    commitPoller = new CommitPoller(ghConfig, sessionManager, logger);
  }

  // Watch for config changes
  configManager.onConfigChange(() => {
    /* config is already updated internally */
  });

  // Hot-reload: restart pollers when GitHub config changes (Req 5.6)
  configManager.onGitHubConfigChange((newGhConfig) => {
    if (newGhConfig) {
      if (githubPoller) {
        githubPoller.updateConfig(newGhConfig);
      } else {
        githubPoller = new GitHubPoller(newGhConfig, sessionManager, logger, undefined, batonEventEmitter, historyStore);
        githubPoller.start();
      }
      if (commitPoller) {
        commitPoller.updateConfig(newGhConfig);
      } else {
        commitPoller = new CommitPoller(newGhConfig, sessionManager, logger);
        commitPoller.start();
      }
    } else {
      // GitHub config removed — stop pollers
      if (githubPoller) { githubPoller.stop(); githubPoller = undefined; }
      if (commitPoller) { commitPoller.stop(); commitPoller = undefined; }
    }
  });

  // Baton auth module — initialize when OAuth env vars are present (Req 5.1–5.6)
  let batonAuth: BatonAuthModule | undefined;
  const batonClientId = process.env.BATON_GITHUB_CLIENT_ID;
  const batonClientSecret = process.env.BATON_GITHUB_CLIENT_SECRET;
  if (batonClientId && batonClientSecret) {
    const sessionSecret = process.env.BATON_SESSION_SECRET ?? (() => {
      const generated = cryptoRandomBytes(32).toString("hex");
      logger.logSystem("SERVER", "BATON_SESSION_SECRET not set — generated random secret. Sessions will not survive restarts.");
      return generated;
    })();
    batonAuth = new BatonAuthModule({
      clientId: batonClientId,
      clientSecret: batonClientSecret,
      serverUrl: "",  // will be set by startSseServer when the URL is known
      sessionSecret,
      sessionMaxAgeHours: parseInt(process.env.BATON_SESSION_HOURS ?? "8", 10),
      accessCacheMinutes: parseInt(process.env.BATON_ACCESS_CACHE_MINUTES ?? "5", 10),
    });
    logger.logSystem("SERVER", "Baton auth enabled (GitHub OAuth)");
  } else if (batonClientId && !batonClientSecret) {
    logger.logSystem("SERVER", "BATON_GITHUB_CLIENT_ID set but BATON_GITHUB_CLIENT_SECRET missing — auth disabled");
  }

  // Installer channel store — multi-channel tarball management (Requirements 6.1–6.7, 9.1–9.3)
  const installerChannelStore = new InstallerChannelStore();

  // Local bundle store: when KONDUCTOR_SERVE_CLIENT_BUNDLES_FROM_LOCAL_STORE=true,
  // scan a local directory for versioned .tgz bundles and index them in the BundleRegistry.
  // Channel assignment is done via the admin dashboard (not automatic).
  const useLocalStore = process.env.KONDUCTOR_SERVE_CLIENT_BUNDLES_FROM_LOCAL_STORE === "true";
  const localStoreDir = resolve(process.cwd(), "installers");
  let localStoreSeeded = false;

  // BundleRegistry — in-memory index of versioned bundles (Requirements 1.1–1.6, 3.1–3.6)
  const bundleRegistry = new BundleRegistry((_label, msg) => logger.logSystem("SERVER", msg));
  if (useLocalStore) {
    await bundleRegistry.scanLocalStore(localStoreDir);
    if (bundleRegistry.size > 0) {
      const versions = bundleRegistry.list().map((b) => b.version);
      logger.logSystem("SERVER", `Bundle registry: ${bundleRegistry.size} bundle(s) discovered — ${versions.join(", ")}`);
      localStoreSeeded = true;
    }

    // Watch the installers/ directory for new bundles — no restart required
    bundleRegistry.onRegistryChange((added, removed) => {
      if (added.length > 0 || removed.length > 0) {
        batonEventEmitter.emit({
          type: "bundle_change",
          repo: "__admin__",
          data: { action: "rescan", added, removed },
        });
      }
    });
    bundleRegistry.watchLocalStore(localStoreDir);
  }

  // Seed Prod channel with the current installer tarball if not already seeded from local store.
  // Skip entirely when the BundleRegistry is non-empty — bundles are available for admin assignment
  // via the dashboard, so the konductor-setup/ npm pack fallback is unnecessary (Requirement 1.5).
  if (bundleRegistry.size === 0 && (!localStoreSeeded || !(await installerChannelStore.getMetadata("prod")))) {
    if (useLocalStore) {
      logger.logSystem("SERVER", "Bundle registry is empty — falling back to packing konductor-setup/ for Prod channel (Requirement 1.5)");
    }
    const setupDir = resolve(process.cwd(), "..", "konductor-setup");
    const installerTgz = buildInstallerTarball(setupDir);
    if (installerTgz) {
      const pkgPath = resolve(setupDir, "package.json");
      let setupVersion = "0.0.0";
      try { setupVersion = JSON.parse(readFileSync(pkgPath, "utf-8")).version ?? "0.0.0"; } catch {}
      await installerChannelStore.setTarball("prod", installerTgz, setupVersion);
      logger.logSystem("SERVER", `Seeded Prod channel with installer v${setupVersion} (${(installerTgz.length / 1024).toFixed(0)} KB)`);
    } else if (useLocalStore) {
      logger.logSystem("SERVER", "Bundle registry is empty and konductor-setup/ not found — no installer available for Prod channel");
    }
  }

  // Parse KONDUCTOR_ADMINS at startup (Requirement 1.1, 1.6)
  const adminList = parseKonductorAdmins(process.env.KONDUCTOR_ADMINS);
  if (adminList.length > 0) {
    logger.logSystem("SERVER", `Admin list loaded: ${adminList.length} entries from KONDUCTOR_ADMINS`);
  }

  // Build env overrides for AdminSettingsStore (Requirement 11.4)
  const envOverrides = new Map<string, unknown>();
  if (process.env.KONDUCTOR_HEARTBEAT_TIMEOUT) {
    envOverrides.set("heartbeatTimeout", parseInt(process.env.KONDUCTOR_HEARTBEAT_TIMEOUT, 10));
  }
  if (process.env.KONDUCTOR_LOG_LEVEL) {
    envOverrides.set("logLevel", process.env.KONDUCTOR_LOG_LEVEL);
  }
  if (process.env.KONDUCTOR_VERBOSE) {
    envOverrides.set("verboseLogging", process.env.KONDUCTOR_VERBOSE === "true");
  }
  if (process.env.KONDUCTOR_STORAGE_MODE) {
    envOverrides.set("storageMode", process.env.KONDUCTOR_STORAGE_MODE);
  }

  // Admin settings store — wraps settings backend with JSON serialization and source tracking

  // When running locally, persist settings to disk so Baton dashboard config survives restarts
  const isLocal = process.env.KONDUCTOR_STARTUP_LOCAL === "true";
  const settingsBackend = isLocal
    ? new FileSettingsBackend(resolve(process.cwd(), "settings.json"))
    : historyStore as any;
  if (isLocal) {
    logger.logSystem("SERVER", "Local mode: settings will persist to settings.json");
  }
  const adminSettingsStore = new AdminSettingsStore(settingsBackend, envOverrides);

  // History purger — periodic cleanup of expired sessions (Req 3.1–3.5)
  const historyPurger = new HistoryPurger(historyStore, logger, 30, 6);
  historyPurger.start();

  // Slack integration components (Phase 6)
  const slackSettingsManager = new SlackSettingsManager(adminSettingsStore);
  const slackStateTracker = new SlackStateTracker();
  const slackDebounceMs = parseInt(process.env.KONDUCTOR_SLACK_DEBOUNCE_MS || "30000", 10);
  const slackDebouncer = new SlackDebouncer(slackDebounceMs);
  const slackNotifier = new SlackNotifier(slackSettingsManager, slackStateTracker, logger, slackDebouncer);

  // Log Slack configuration status at startup
  slackSettingsManager.getBotToken().then((token) => {
    if (token) {
      logger.logSystem("SERVER", "Slack integration configured (bot token available)");
    } else {
      logger.logSystem("SERVER", "Slack integration not configured (no bot token)");
    }
  }).catch(() => { /* best effort */ });

  // Collaboration request store (Live Share integration — Requirements 3.1–3.11, 11.1, 11.2)
  const collabRequestStore = new CollabRequestStore();

  // Local persistence — persist Baton stores to disk when running locally
  let localPersistence: LocalPersistence | undefined;
  if (isLocal) {
    localPersistence = new LocalPersistence({
      notificationStore,
      queryLogStore,
      historyStore,
      logger,
      dataDir: process.cwd(),
    });
    await localPersistence.load();
    logger.logSystem("SERVER", "Local persistence: loaded Baton data from disk");

    // Hook into event emitter to trigger saves on state changes
    batonEventEmitter.onAny((event) => {
      switch (event.type) {
        case "notification_added":
        case "notification_resolved":
          localPersistence!.saveNotifications();
          break;
        case "query_logged":
          localPersistence!.saveQueryLog();
          break;
        case "session_change":
        case "github_pr_change":
          localPersistence!.saveHistoryUsers();
          break;
      }
    });

    // Wrap historyStore.upsertUser to trigger persistence on every call
    // (covers check_status, register_session, and GitHub poller paths)
    const originalUpsertUser = historyStore.upsertUser.bind(historyStore);
    historyStore.upsertUser = async (...args: Parameters<typeof historyStore.upsertUser>) => {
      await originalUpsertUser(...args);
      localPersistence!.saveHistoryUsers();
    };
  }

  // S3 persistence — persist Baton stores to S3 when running in AWS (KONDUCTOR_S3_BUCKET set)
  let s3Persistence: S3Persistence | undefined;
  const s3Bucket = process.env.KONDUCTOR_S3_BUCKET;
  if (s3Bucket && !isLocal) {
    s3Persistence = new S3Persistence({ bucketName: s3Bucket });
    s3Persistence.setStores({ notificationStore, queryLogStore, historyStore, logger });
    await s3Persistence.load();
    s3Persistence.startPeriodicFlush();
    logger.logSystem("SERVER", `S3 persistence enabled (bucket: ${s3Bucket})`);

    // Hook into event emitter to mark stores dirty on state changes
    batonEventEmitter.onAny((event) => {
      switch (event.type) {
        case "notification_added":
        case "notification_resolved":
          s3Persistence!.markDirty("notifications");
          break;
        case "query_logged":
          s3Persistence!.markDirty("queryLog");
          break;
        case "session_change":
        case "github_pr_change":
          s3Persistence!.markDirty("historyUsers");
          break;
      }
    });

    // Wrap historyStore.upsertUser to mark dirty on every call
    const origUpsert = historyStore.upsertUser.bind(historyStore);
    historyStore.upsertUser = async (...args: Parameters<typeof historyStore.upsertUser>) => {
      await origUpsert(...args);
      s3Persistence!.markDirty("historyUsers");
    };
  }

  return { configManager, sessionManager, collisionEvaluator, summaryFormatter, queryEngine, logger, notificationStore, queryLogStore, batonEventEmitter, githubPoller, commitPoller, batonAuth, installerChannelStore, adminSettingsStore, adminList, slackSettingsManager, slackNotifier, slackStateTracker, historyStore, historyPurger, bundleRegistry, collabRequestStore, settingsBackend, localPersistence, s3Persistence };
}


// ---------------------------------------------------------------------------
// Build MCP server with tool registrations
// ---------------------------------------------------------------------------

/**
 * Build the update URL for a client, using the effective default channel.
 * Falls back to `/bundle/installer.tgz` (prod) when no channel is resolved.
 * Handles "latest" pseudo-channel → `/bundle/installer-latest.tgz` (Requirement 8.2, 8.4).
 */
export function buildChannelUpdateUrl(serverUrl: string, defaultChannel?: ChannelName | string | null): string {
  if (defaultChannel === "latest") {
    return `${serverUrl}/bundle/installer-latest.tgz`;
  }
  const channel = defaultChannel && ["dev", "uat", "prod"].includes(defaultChannel as string)
    ? defaultChannel as ChannelName
    : null;
  if (channel && channel !== "prod") {
    return `${serverUrl}/bundle/installer-${channel}.tgz`;
  }
  return `${serverUrl}/bundle/installer.tgz`;
}

// ---------------------------------------------------------------------------
// Pending collab requests piggyback helper (Requirement 5.1)
// ---------------------------------------------------------------------------

/**
 * Get pending collaboration requests to piggyback on check-in responses.
 *
 * Returns requests relevant to the given user:
 * - Pending requests where the user is the recipient (incoming invitations)
 * - Requests where the user is the initiator and status changed (accepted/declined/link_shared)
 *
 * Excludes expired requests (those are handled by the grace period in listForUser).
 */
export function getPendingCollabRequests(
  collabStore: CollabRequestStore | undefined,
  userId: string,
): CollabRequest[] {
  if (!collabStore) return [];

  const allForUser = collabStore.listForUser(userId);

  return allForUser.filter((req) => {
    // Pending requests where user is recipient (incoming invitations to act on)
    if (req.status === "pending" && req.recipient === userId) return true;
    // Status updates for requests the user initiated (accepted/declined/link_shared)
    if (req.initiator === userId && (req.status === "accepted" || req.status === "declined" || req.status === "link_shared")) return true;
    // Expired requests where user is initiator (so agent can notify about expiry)
    if (req.status === "expired" && req.initiator === userId) return true;
    return false;
  });
}

export function buildMcpServer(deps: {
  sessionManager: SessionManager;
  collisionEvaluator: CollisionEvaluator;
  summaryFormatter: SummaryFormatter;
  configManager: ConfigManager;
  queryEngine?: QueryEngine;
  logger?: KonductorLogger;
  serverVersion?: string;
  serverUrl?: string;
  notificationStore?: NotificationStore;
  queryLogStore?: QueryLogStore;
  batonEventEmitter?: BatonEventEmitter;
  slackSettingsManager?: SlackSettingsManager;
  slackNotifier?: SlackNotifier;
  historyStore?: ISessionHistoryStore;
  adminSettingsStore?: AdminSettingsStore;
  installerChannelStore?: InstallerChannelStore;
  bundleRegistry?: BundleRegistry;
  userTransportRegistry?: UserTransportRegistry;
  collabRequestStore?: CollabRequestStore;
  adminList?: string[];
}): McpServer {
  const { sessionManager, collisionEvaluator, summaryFormatter, configManager, queryEngine, logger, serverVersion, serverUrl, notificationStore, queryLogStore, batonEventEmitter, slackSettingsManager, slackNotifier, adminSettingsStore, installerChannelStore, collabRequestStore } = deps;
  const pkgVersion = serverVersion ?? "0.0.0";

  const mcp = new McpServer(
    { name: "konductor", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  // ── register_session ────────────────────────────────────────────────
  mcp.tool(
    "register_session",
    "Register or update a work session for a user in a repository. Returns the current collision state.",
    {
      userId: z.string().min(1).describe("User identifier"),
      repo: z.string().min(1).describe('Repository in "owner/repo" format'),
      branch: z.string().min(1).describe("Git branch name"),
      files: z.array(z.union([
        z.string().min(1),
        z.object({
          path: z.string().min(1),
          lineRanges: z.array(z.object({
            startLine: z.number().int().min(1),
            endLine: z.number().int().min(1),
          })).optional(),
        }),
      ])).describe("List of file paths being modified"),
      clientVersion: z.string().optional().describe("Client bundle version for update checking"),
    },
    async ({ userId, repo, branch, files: rawFiles, clientVersion }) => {
      const repoErr = validateRepo(repo);
      if (repoErr) return { content: [{ type: "text", text: JSON.stringify({ error: repoErr }) }], isError: true };

      // Normalize mixed file format (Requirements 2.3, 2.4, 2.5, 7.1)
      const { files, fileChanges } = normalizeFilesInput(rawFiles);

      const filesErr = validateFiles(files);
      if (filesErr) return { content: [{ type: "text", text: JSON.stringify({ error: filesErr }) }], isError: true };

      // Determine if we have any line range data to pass
      const hasLineData = fileChanges.some((fc) => fc.lineRanges && fc.lineRanges.length > 0);
      const session = await sessionManager.register(userId, repo, branch, files, hasLineData ? fileChanges : undefined);

      // Record in history store and upsert user (Req 2.1, 8.1)
      if (deps.historyStore) {
        deps.historyStore.record({ sessionId: session.sessionId, userId, repo, branch, files, status: "active", createdAt: session.createdAt }).catch(() => {});
        deps.historyStore.upsertUser(userId, repo, { branch, clientVersion: clientVersion ?? undefined }).catch(() => {});
      }

      const allSessions = await sessionManager.getActiveSessions(repo);
      const result: CollisionResult = collisionEvaluator.evaluate(session, allSessions);
      result.actions = configManager.getStateActions(result.state);
      const summary = summaryFormatter.format(result);

      // Log collision state
      if (logger) {
        const overlappingUsers = result.overlappingSessions.map((s) => s.userId);
        const branches = [...new Set(result.overlappingSessions.map((s) => s.branch))];
        logger.logCollisionState(userId, repo, result.state, overlappingUsers, result.sharedFiles, branches, files, branch);
        for (const action of result.actions) {
          logger.logCollisionAction(action.type, [userId, ...overlappingUsers], repo);
        }
      }

      // Baton: create notification if collision state is not Solo
      if (notificationStore && result.state !== "solo") {
        const healthStatus = computeHealthStatus([result.state]);
        const notification: BatonNotification = {
          id: randomUUID(),
          repo,
          timestamp: new Date().toISOString(),
          notificationType: healthStatus,
          collisionState: result.state,
          jiras: [],
          summary: summaryFormatter.format(result),
          users: [
            { userId, branch },
            ...result.overlappingDetails.map((d) => {
              const user: import("./baton-types.js").BatonNotificationUser = { userId: d.session.userId, branch: d.session.branch };
              if (d.source === "github_pr") {
                user.source = "github_pr";
                if (d.prNumber !== undefined) user.prNumber = d.prNumber;
                if (d.prUrl) user.prUrl = d.prUrl;
              } else if (d.source === "github_commit") {
                user.source = "github_commit";
                if (d.commitDateRange) user.commitDateRange = `${d.commitDateRange.earliest.slice(0, 10)} – ${d.commitDateRange.latest.slice(0, 10)}`;
              }
              return user;
            }),
          ],
          resolved: false,
        };
        notificationStore.add(notification);
        if (batonEventEmitter) {
          batonEventEmitter.emit({ type: "notification_added", repo, data: notification });
        }
      }

      // Baton: emit session_change event
      if (batonEventEmitter) {
        try {
          const repoSummary = await buildRepoSummary(sessionManager, collisionEvaluator, repo);
          batonEventEmitter.emit({ type: "session_change", repo, data: repoSummary });
        } catch { /* best effort */ }
      }

      // Baton: log session registration as activity
      if (queryLogStore) {
        const fileList = files.length <= 3 ? files.join(", ") : `${files.slice(0, 3).join(", ")} +${files.length - 3} more`;
        const sessionEntry = {
          id: randomUUID(),
          repo,
          timestamp: new Date().toISOString(),
          userId,
          branch,
          queryType: "session",
          parameters: { files: files.length, fileList: files },
          summary: `Registered with ${files.length} file${files.length !== 1 ? "s" : ""}: ${fileList}`,
        };
        queryLogStore.add(sessionEntry);
        if (batonEventEmitter) {
          batonEventEmitter.emit({ type: "query_logged", repo, data: sessionEntry });
        }
        // Log collision as separate activity entry
        if (result.state !== "solo") {
          const overlappingUsers = result.overlappingSessions.map((s) => s.userId);
          const collisionEntry = {
            id: randomUUID(),
            repo,
            timestamp: new Date().toISOString(),
            userId,
            branch,
            queryType: "collision",
            parameters: { state: result.state, sharedFiles: result.sharedFiles, overlapping: overlappingUsers },
            summary: buildCollisionSummary(result, userId),
          };
          queryLogStore.add(collisionEntry);
          if (batonEventEmitter) {
            batonEventEmitter.emit({ type: "query_logged", repo, data: collisionEntry });
          }
        }
      }

      // Slack: notify if collision state meets verbosity threshold (Requirement 1.1, 1.2)
      if (slackNotifier) {
        slackNotifier.onCollisionEvaluated(repo, result, userId).catch(() => { /* best effort — never block */ });
      }

      // Proactive collision push: notify existing users via SSE (Requirement 3.1, 3.4)
      if (deps.userTransportRegistry && result.state !== "solo") {
        try {
          pushCollisionAlerts(deps.userTransportRegistry, repo, result, userId, summary);
        } catch { /* best effort — never block registration */ }
      }

      const responsePayload: Record<string, unknown> = {
        sessionId: session.sessionId,
        collisionState: result.state,
        summary,
        sharedFiles: result.sharedFiles,
      };

      // Include repo page URL in response (Requirement 6.1, 6.3)
      if (serverUrl) {
        try {
          const parsed = new URL(serverUrl);
          responsePayload.repoPageUrl = buildRepoPageUrl(parsed.hostname, parseInt(parsed.port, 10), repo);
          // Include admin page URL if user is an admin
          const envAdminList = deps.adminList ?? [];
          const isEnvAdmin = envAdminList.includes(userId.toLowerCase());
          let isDbAdmin = false;
          if (!isEnvAdmin && deps.historyStore) {
            try {
              const userRecord = await deps.historyStore.getUser(userId);
              if (userRecord?.admin) isDbAdmin = true;
            } catch { /* best effort */ }
          }
          if (isEnvAdmin || isDbAdmin) {
            responsePayload.adminPageUrl = `${parsed.protocol}//${parsed.hostname}:${parsed.port}/admin`;
            responsePayload.isAdmin = true;
          }
        } catch { /* best effort — skip if serverUrl is malformed */ }
      }

      // Append version check if clientVersion provided (Requirement 6.5, 8.2, 8.3)
      // When user's effective channel is "latest", compare against the latest bundle's version
      // instead of the server's package version (Requirement 8.3 — latest users get updateRequired
      // when a new bundle is added to the registry).
      // When the channel store exists but no version is assigned to the user's channel, skip the
      // update check entirely — there's nothing to update to.
      const effectiveChannelVersion = await getEffectiveChannelVersion(userId, deps.historyStore, adminSettingsStore, installerChannelStore, deps.bundleRegistry);
      const versionToCompare = installerChannelStore ? effectiveChannelVersion : (effectiveChannelVersion ?? pkgVersion);
      const versionCheck = versionToCompare ? compareVersions(clientVersion, versionToCompare) : "current";
      if (versionCheck === "outdated") {
        responsePayload.updateRequired = true;
        responsePayload.serverVersion = versionToCompare;
        // Include update URL for the user's effective channel
        if (serverUrl) {
          // Resolve user's effective channel for the update URL
          let userEffectiveChannel: string | null = null;
          if (deps.historyStore) {
            try {
              const userRecord = await deps.historyStore.getUser(userId);
              if (userRecord?.installerChannel && VALID_CHANNEL_OVERRIDES.includes(userRecord.installerChannel)) {
                userEffectiveChannel = userRecord.installerChannel;
              }
            } catch { /* best effort */ }
          }
          responsePayload.updateUrl = buildChannelUpdateUrl(serverUrl, userEffectiveChannel ?? (adminSettingsStore ? await adminSettingsStore.get("defaultChannel") as string | null : null));
        }
      }

      // Check if user's effective channel is stale (Requirement 7.1)
      const staleInfo = await checkChannelStale(userId, deps.historyStore, adminSettingsStore, installerChannelStore, deps.bundleRegistry);
      if (staleInfo) {
        responsePayload.bundleStale = staleInfo.bundleStale;
        responsePayload.staleMessage = staleInfo.staleMessage;
      }

      // Include Slack config in response (Requirement 3.1)
      if (slackSettingsManager) {
        try {
          const slackConfig = await slackSettingsManager.getRepoConfig(repo);
          responsePayload.slackConfig = {
            channel: slackConfig.channel,
            verbosity: slackConfig.verbosity,
            enabled: slackConfig.enabled,
          };
        } catch { /* best effort — skip if Slack config unavailable */ }
      }

      // Include line overlap details when available (Requirements 4.1, 4.2, 4.3, 7.5)
      if (result.overlapSeverity) {
        responsePayload.overlapSeverity = result.overlapSeverity;
      }
      if (result.overlappingDetails.some((d) => d.lineOverlapDetails && d.lineOverlapDetails.length > 0)) {
        responsePayload.overlappingDetails = result.overlappingDetails
          .filter((d) => d.lineOverlapDetails && d.lineOverlapDetails.length > 0)
          .map((d) => ({
            userId: d.session.userId,
            sharedFiles: d.sharedFiles,
            lineOverlapDetails: d.lineOverlapDetails,
            overlapSeverity: d.overlapSeverity,
          }));
      }

      // Piggyback pending collab requests on check-in (Requirement 5.1)
      const pendingCollabRequests = getPendingCollabRequests(collabRequestStore, userId);
      if (pendingCollabRequests.length > 0) {
        responsePayload.pendingCollabRequests = pendingCollabRequests;
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify(responsePayload),
        }],
      };
    },
  );

  // ── check_status ────────────────────────────────────────────────────
  mcp.tool(
    "check_status",
    "Check the current collision state for a user in a repository without modifying sessions.",
    {
      userId: z.string().min(1).describe("User identifier"),
      repo: z.string().min(1).describe('Repository in "owner/repo" format'),
      files: z.array(z.string().min(1)).optional().describe("Optional file list override; uses existing session files if omitted"),
      clientVersion: z.string().optional().describe("Client bundle version for update checking"),
    },
    async ({ userId, repo, files, clientVersion }) => {
      const repoErr = validateRepo(repo);
      if (repoErr) return { content: [{ type: "text", text: JSON.stringify({ error: repoErr }) }], isError: true };

      const allSessions = await sessionManager.getActiveSessions(repo);

      // Find the user's existing session (if any)
      const existingSession = allSessions.find((s) => s.userId === userId);

      // Refresh heartbeat if user has an active session — keeps the session
      // alive while the file watcher is polling with check_status
      if (existingSession) {
        try {
          await sessionManager.heartbeat(existingSession.sessionId);
        } catch { /* best effort — session may have been cleaned up between find and heartbeat */ }
      }

      // Ensure user appears in admin panel even if they only call check_status
      if (deps.historyStore) {
        deps.historyStore.upsertUser(userId, repo, { branch: existingSession?.branch }).catch(() => {});
      }

      if (!existingSession && (!files || files.length === 0)) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ error: `No active session found for user "${userId}" in repo "${repo}". Provide a files list or register a session first.` }),
          }],
          isError: true,
        };
      }

      // Build a virtual session for evaluation
      const querySession = existingSession
        ? { ...existingSession, files: files ?? existingSession.files }
        : {
            sessionId: "__check_status__",
            userId,
            repo,
            branch: "",
            files: files!,
            createdAt: new Date().toISOString(),
            lastHeartbeat: new Date().toISOString(),
          };

      const result: CollisionResult = collisionEvaluator.evaluate(querySession, allSessions);
      result.actions = configManager.getStateActions(result.state);
      const summary = summaryFormatter.format(result);

      // Log query and collision state
      if (logger) {
        logger.logCheckStatus(userId, repo, result.state, querySession.files, querySession.branch || undefined);
        const overlappingUsers = result.overlappingSessions.map((s) => s.userId);
        const branches = [...new Set(result.overlappingSessions.map((s) => s.branch))];
        logger.logCollisionState(userId, repo, result.state, overlappingUsers, result.sharedFiles, branches, querySession.files, querySession.branch || undefined);
      }

      // Slack: notify if collision state meets verbosity threshold (Requirement 1.1, 1.2)
      if (slackNotifier) {
        slackNotifier.onCollisionEvaluated(repo, result, userId).catch(() => { /* best effort — never block */ });
      }

      const statusPayload: Record<string, unknown> = {
        collisionState: result.state,
        overlappingSessions: result.overlappingSessions.map((s) => ({
          sessionId: s.sessionId,
          userId: s.userId,
          branch: s.branch,
          files: s.files,
        })),
        summary,
        actions: result.actions,
      };

      // Append version check if clientVersion provided (Requirement 6.5)
      // Use channel-aware version resolution (Bug B2 fix — was using pkgVersion)
      const effectiveChannelVersionForStatus = installerChannelStore
        ? await getEffectiveChannelVersion(userId, deps.historyStore, adminSettingsStore, installerChannelStore, deps.bundleRegistry)
        : null;
      const versionToCompareForStatus = installerChannelStore ? effectiveChannelVersionForStatus : (effectiveChannelVersionForStatus ?? pkgVersion);
      const versionCheck = versionToCompareForStatus ? compareVersions(clientVersion, versionToCompareForStatus) : "current";
      if (versionCheck === "outdated") {
        statusPayload.updateRequired = true;
        statusPayload.serverVersion = versionToCompareForStatus;
        if (serverUrl) {
          let userEffectiveChannel: string | null = null;
          if (deps.historyStore) {
            try {
              const userRecord = await deps.historyStore.getUser(userId);
              if (userRecord?.installerChannel && VALID_CHANNEL_OVERRIDES.includes(userRecord.installerChannel)) {
                userEffectiveChannel = userRecord.installerChannel;
              }
            } catch { /* best effort */ }
          }
          statusPayload.updateUrl = buildChannelUpdateUrl(serverUrl, userEffectiveChannel ?? (adminSettingsStore ? await adminSettingsStore.get("defaultChannel") as string | null : null));
        }
      }

      // Include repo page URL for dashboard link
      if (serverUrl) {
        try {
          const parsed = new URL(serverUrl);
          statusPayload.repoPageUrl = buildRepoPageUrl(parsed.hostname, parseInt(parsed.port, 10), repo);
          // Include admin page URL if user is an admin
          const envAdminList = deps.adminList ?? [];
          const isEnvAdmin = envAdminList.includes(userId.toLowerCase());
          let isDbAdmin = false;
          if (!isEnvAdmin && deps.historyStore) {
            try {
              const userRecord = await deps.historyStore.getUser(userId);
              if (userRecord?.admin) isDbAdmin = true;
            } catch { /* best effort */ }
          }
          if (isEnvAdmin || isDbAdmin) {
            statusPayload.adminPageUrl = `${parsed.protocol}//${parsed.hostname}:${parsed.port}/admin`;
            statusPayload.isAdmin = true;
          }
        } catch { /* best effort — skip if serverUrl is malformed */ }
      }

      // Include line overlap details when available (Requirements 4.1, 4.2, 4.3, 7.5)
      if (result.overlapSeverity) {
        statusPayload.overlapSeverity = result.overlapSeverity;
      }
      if (result.overlappingDetails.some((d) => d.lineOverlapDetails && d.lineOverlapDetails.length > 0)) {
        statusPayload.overlappingDetails = result.overlappingDetails
          .filter((d) => d.lineOverlapDetails && d.lineOverlapDetails.length > 0)
          .map((d) => ({
            userId: d.session.userId,
            sharedFiles: d.sharedFiles,
            lineOverlapDetails: d.lineOverlapDetails,
            overlapSeverity: d.overlapSeverity,
          }));
      }

      // Piggyback pending collab requests on check-in (Requirement 5.1)
      const pendingCollabRequests = getPendingCollabRequests(collabRequestStore, userId);
      if (pendingCollabRequests.length > 0) {
        statusPayload.pendingCollabRequests = pendingCollabRequests;
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify(statusPayload),
        }],
      };
    },
  );

  // ── deregister_session ──────────────────────────────────────────────
  mcp.tool(
    "deregister_session",
    "Remove a work session by its session ID.",
    {
      sessionId: z.string().min(1).describe("The session ID to deregister"),
    },
    async ({ sessionId }) => {
      // Look up repo before deregistering (needed for Baton session_change event)
      let sessionRepo: string | undefined;
      if (batonEventEmitter) {
        const allSessions = await sessionManager.getAllActiveSessions();
        const session = allSessions.find((s) => s.sessionId === sessionId);
        sessionRepo = session?.repo;
      }

      const removed = await sessionManager.deregister(sessionId);

      // Baton: emit session_change event after deregistration
      if (removed && batonEventEmitter && sessionRepo) {
        try {
          const repoSummary = await buildRepoSummary(sessionManager, collisionEvaluator, sessionRepo);
          batonEventEmitter.emit({ type: "session_change", repo: sessionRepo, data: repoSummary });
        } catch { /* best effort */ }
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: removed,
            message: removed
              ? `Session ${sessionId} deregistered.`
              : `Session ${sessionId} not found.`,
          }),
        }],
      };
    },
  );

  // ── list_sessions ───────────────────────────────────────────────────
  mcp.tool(
    "list_sessions",
    "List all active (non-stale) work sessions for a repository.",
    {
      repo: z.string().min(1).describe('Repository in "owner/repo" format'),
    },
    async ({ repo }) => {
      const repoErr = validateRepo(repo);
      if (repoErr) return { content: [{ type: "text", text: JSON.stringify({ error: repoErr }) }], isError: true };

      const sessions = await sessionManager.getActiveSessions(repo);

      // Log query
      if (logger) {
        logger.logListSessions(repo, sessions.length);
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            sessions: sessions.map((s) => ({
              sessionId: s.sessionId,
              userId: s.userId,
              repo: s.repo,
              branch: s.branch,
              files: s.files,
              createdAt: s.createdAt,
              lastHeartbeat: s.lastHeartbeat,
            })),
          }),
        }],
      };
    },
  );

  // ── Query tools (Enhanced Chat) ───────────────────────────────────
  // These tools require a QueryEngine instance. If not provided (e.g.
  // legacy callers), the query tools are simply not registered.

  /** Helper: log a query tool invocation to the Baton QueryLogStore and emit event. */
  async function logBatonQuery(queryType: string, repo: string, params: Record<string, unknown>, userId?: string) {
    if (!queryLogStore) return;
    // Resolve user identity and branch from active sessions
    let resolvedUserId = userId ?? "unknown";
    let resolvedBranch = "";
    if (repo) {
      const sessions = await sessionManager.getActiveSessions(repo);
      const match = userId
        ? sessions.find((s) => s.userId === userId)
        : sessions[0]; // best effort when no userId
      if (match) {
        resolvedUserId = match.userId;
        resolvedBranch = match.branch;
      }
    }
    const entry = {
      id: randomUUID(),
      repo,
      timestamp: new Date().toISOString(),
      userId: resolvedUserId,
      branch: resolvedBranch,
      queryType,
      parameters: params,
    };
    queryLogStore.add(entry);
    if (batonEventEmitter) {
      batonEventEmitter.emit({ type: "query_logged", repo, data: entry });
    }
  }

  if (queryEngine) {
    // ── who_is_active ───────────────────────────────────────────────
    mcp.tool(
      "who_is_active",
      "List all active users in a repository with their branch, files, and session duration.",
      {
        repo: z.string().min(1).describe('Repository in "owner/repo" format'),
      },
      async ({ repo }) => {
        const repoErr = validateRepo(repo);
        if (repoErr) return { content: [{ type: "text", text: JSON.stringify({ error: repoErr }) }], isError: true };

        if (logger) logger.logQueryTool("who_is_active", { repo });
        await logBatonQuery("who_is_active", repo, { repo });
        const result = await queryEngine.whoIsActive(repo);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      },
    );

    // ── who_overlaps ────────────────────────────────────────────────
    mcp.tool(
      "who_overlaps",
      "Find users whose files overlap with a specific user's session.",
      {
        userId: z.string().min(1).describe("User identifier"),
        repo: z.string().min(1).describe('Repository in "owner/repo" format'),
      },
      async ({ userId, repo }) => {
        const repoErr = validateRepo(repo);
        if (repoErr) return { content: [{ type: "text", text: JSON.stringify({ error: repoErr }) }], isError: true };

        if (logger) logger.logQueryTool("who_overlaps", { userId, repo });
        await logBatonQuery("who_overlaps", repo, { userId, repo }, userId);
        const result = await queryEngine.whoOverlaps(userId, repo);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      },
    );

    // ── user_activity ───────────────────────────────────────────────
    mcp.tool(
      "user_activity",
      "Show all active sessions for a user across all repositories.",
      {
        userId: z.string().min(1).describe("User identifier"),
      },
      async ({ userId }) => {
        if (logger) logger.logQueryTool("user_activity", { userId });
        // user_activity is cross-repo, no single repo to log against
        const result = await queryEngine.userActivity(userId);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      },
    );

    // ── risk_assessment ─────────────────────────────────────────────
    mcp.tool(
      "risk_assessment",
      "Compute collision risk score for a user in a repository.",
      {
        userId: z.string().min(1).describe("User identifier"),
        repo: z.string().min(1).describe('Repository in "owner/repo" format'),
      },
      async ({ userId, repo }) => {
        const repoErr = validateRepo(repo);
        if (repoErr) return { content: [{ type: "text", text: JSON.stringify({ error: repoErr }) }], isError: true };

        if (logger) logger.logQueryTool("risk_assessment", { userId, repo });
        await logBatonQuery("risk_assessment", repo, { userId, repo }, userId);
        const result = await queryEngine.riskAssessment(userId, repo);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      },
    );

    // ── repo_hotspots ───────────────────────────────────────────────
    mcp.tool(
      "repo_hotspots",
      "Rank files in a repository by collision risk (number of concurrent editors).",
      {
        repo: z.string().min(1).describe('Repository in "owner/repo" format'),
      },
      async ({ repo }) => {
        const repoErr = validateRepo(repo);
        if (repoErr) return { content: [{ type: "text", text: JSON.stringify({ error: repoErr }) }], isError: true };

        if (logger) logger.logQueryTool("repo_hotspots", { repo });
        await logBatonQuery("repo_hotspots", repo, { repo });
        const result = await queryEngine.repoHotspots(repo);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      },
    );

    // ── active_branches ─────────────────────────────────────────────
    mcp.tool(
      "active_branches",
      "List all branches with active sessions in a repository and flag cross-branch file overlap.",
      {
        repo: z.string().min(1).describe('Repository in "owner/repo" format'),
      },
      async ({ repo }) => {
        const repoErr = validateRepo(repo);
        if (repoErr) return { content: [{ type: "text", text: JSON.stringify({ error: repoErr }) }], isError: true };

        if (logger) logger.logQueryTool("active_branches", { repo });
        await logBatonQuery("active_branches", repo, { repo });
        const result = await queryEngine.activeBranches(repo);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      },
    );

    // ── coordination_advice ─────────────────────────────────────────
    mcp.tool(
      "coordination_advice",
      "Suggest who to coordinate with, ranked by urgency.",
      {
        userId: z.string().min(1).describe("User identifier"),
        repo: z.string().min(1).describe('Repository in "owner/repo" format'),
      },
      async ({ userId, repo }) => {
        const repoErr = validateRepo(repo);
        if (repoErr) return { content: [{ type: "text", text: JSON.stringify({ error: repoErr }) }], isError: true };

        if (logger) logger.logQueryTool("coordination_advice", { userId, repo });
        await logBatonQuery("coordination_advice", repo, { userId, repo }, userId);
        const result = await queryEngine.coordinationAdvice(userId, repo);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      },
    );
  }

  // ── Client install/update info ──────────────────────────────────────

  mcp.tool(
    "client_install_info",
    "Get npx commands for installing or updating the Konductor client in a workspace.",
    {},
    async () => {
      const url = serverUrl ?? "http://localhost:3010";
      const tgzUrl = `${url}/bundle/installer.tgz`;
      const lines = [
        `Konductor server v${pkgVersion}`,
        "",
        "Install or update Konductor:",
        `  npx ${tgzUrl} --server ${url} --api-key <your-api-key>`,
      ];
      if (logger) logger.logQueryTool("client_install_info", {});
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  mcp.tool(
    "client_update_check",
    "Check if a client version is up to date with this server.",
    {
      clientVersion: z.string().min(1).describe("Client version string (semver)"),
    },
    async ({ clientVersion }) => {
      // Use channel-aware version resolution when available (Bug B3 fix — was using pkgVersion)
      // client_update_check doesn't have userId, so use global default channel only
      let versionToCompare: string | null = pkgVersion;
      if (installerChannelStore) {
        const globalDefault = adminSettingsStore ? await adminSettingsStore.get("defaultChannel") as string | null : null;
        const effectiveCh = resolveEffectiveChannel(null, (globalDefault ?? "prod") as ChannelName);
        if (effectiveCh === "latest") {
          if (deps.bundleRegistry && deps.bundleRegistry.size > 0) {
            const latest = deps.bundleRegistry.getLatest();
            versionToCompare = latest?.metadata.version ?? null;
          } else {
            versionToCompare = null;
          }
        } else {
          const metadata = await installerChannelStore.getMetadata(effectiveCh);
          versionToCompare = (metadata && !metadata.version.startsWith("__stale__")) ? metadata.version : null;
        }
      }
      const status = versionToCompare ? compareVersions(clientVersion, versionToCompare) : "current";
      const url = serverUrl ?? "http://localhost:3010";
      const result: Record<string, unknown> = {
        clientVersion,
        serverVersion: versionToCompare ?? pkgVersion,
        status,
      };
      if (status === "outdated") {
        const defaultCh = adminSettingsStore ? await adminSettingsStore.get("defaultChannel") as string | null : null;
        const updateUrl = buildChannelUpdateUrl(url, defaultCh);
        result.updateCommand = `npx ${updateUrl} --workspace --server ${url}`;
      }
      if (logger) logger.logQueryTool("client_update_check", { clientVersion });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  // ── Slack config tools (Requirements 7.1–7.5) ────────────────────────

  if (slackSettingsManager) {
    // ── get_slack_config ───────────────────────────────────────────────
    mcp.tool(
      "get_slack_config",
      "Get the Slack notification configuration for a repository.",
      {
        repo: z.string().min(1).describe('Repository in "owner/repo" format'),
      },
      async ({ repo }) => {
        const repoErr = validateRepo(repo);
        if (repoErr) return { content: [{ type: "text", text: JSON.stringify({ error: repoErr }) }], isError: true };

        if (logger) logger.logQueryTool("get_slack_config", { repo });

        try {
          const config = await slackSettingsManager.getRepoConfig(repo);
          return { content: [{ type: "text", text: JSON.stringify(config) }] };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
        }
      },
    );

    // ── set_slack_config ──────────────────────────────────────────────
    mcp.tool(
      "set_slack_config",
      "Update the Slack notification configuration for a repository. Changes channel and/or verbosity.",
      {
        repo: z.string().min(1).describe('Repository in "owner/repo" format'),
        channel: z.string().optional().describe("Slack channel name (no # prefix)"),
        verbosity: z.number().optional().describe("Notification verbosity level (0-5)"),
      },
      async ({ repo, channel, verbosity }) => {
        const repoErr = validateRepo(repo);
        if (repoErr) return { content: [{ type: "text", text: JSON.stringify({ error: repoErr }) }], isError: true };

        if (logger) logger.logQueryTool("set_slack_config", { repo, channel, verbosity });

        // Validate channel name (Requirement 7.2)
        if (channel !== undefined) {
          if (!validateChannelName(channel)) {
            return { content: [{ type: "text", text: JSON.stringify({ error: "Invalid Slack channel name. Must be lowercase, alphanumeric/hyphens/underscores, 1-80 chars, no leading hyphen." }) }], isError: true };
          }
        }

        // Validate verbosity (Requirement 7.3)
        if (verbosity !== undefined) {
          if (!validateVerbosity(verbosity)) {
            return { content: [{ type: "text", text: JSON.stringify({ error: "Invalid verbosity level. Must be an integer 0-5." }) }], isError: true };
          }
        }

        try {
          if (channel !== undefined) {
            await slackSettingsManager.setRepoChannel(repo, channel);
          }
          if (verbosity !== undefined) {
            await slackSettingsManager.setRepoVerbosity(repo, verbosity);
          }

          const updatedConfig = await slackSettingsManager.getRepoConfig(repo);

          // Build Slack channel link
          const slackChannelLink = `https://slack.com/app_redirect?channel=${updatedConfig.channel}`;

          // Emit slack_config_change SSE event (Requirement 7.5)
          if (batonEventEmitter) {
            const eventData: SlackConfigChangeEvent = {
              channel: updatedConfig.channel,
              verbosity: updatedConfig.verbosity,
              changedBy: "agent",
              slackChannelLink,
            };
            batonEventEmitter.emit({
              type: "slack_config_change",
              repo,
              data: eventData,
            });
          }

          // Log CONFIG entry
          if (logger) {
            logger.logConfigReloaded(`Slack channel for ${repo} changed to #${updatedConfig.channel} (verbosity: ${updatedConfig.verbosity}) by agent`);
          }

          // Send test notification to new channel
          if (slackNotifier && updatedConfig.enabled) {
            slackNotifier.sendTestMessage(updatedConfig.channel).catch(() => { /* best effort */ });
          }

          return { content: [{ type: "text", text: JSON.stringify(updatedConfig) }] };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
        }
      },
    );
  }

  // ── Collaboration request tools (Live Share — Requirements 3.2–3.7) ──

  if (collabRequestStore) {
    // ── create_collab_request ───────────────────────────────────────
    mcp.tool(
      "create_collab_request",
      "Create a collaboration request to pair with another user on shared files.",
      {
        initiator: z.string().min(1).describe("User initiating the request"),
        recipient: z.string().min(1).describe("Target user to pair with"),
        repo: z.string().min(1).describe('Repository in "owner/repo" format'),
        branch: z.string().min(1).describe("Git branch name"),
        files: z.array(z.string().min(1)).describe("List of file paths to collaborate on"),
        collisionState: z.string().min(1).describe("Current collision state"),
      },
      async ({ initiator, recipient, repo, branch, files, collisionState: csStr }) => {
        const repoErr = validateRepo(repo);
        if (repoErr) return { content: [{ type: "text", text: JSON.stringify({ error: repoErr }) }], isError: true };

        if (!initiator || !recipient || !branch || files.length === 0) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "All fields are required and files must not be empty." }) }], isError: true };
        }

        try {
          const request = collabRequestStore.create(
            initiator,
            recipient,
            repo,
            branch,
            files,
            csStr as import("./types.js").CollisionState,
          );

          // Emit SSE event (Req 3.7)
          if (batonEventEmitter) {
            batonEventEmitter.emit({ type: "collab_request_update", repo, data: request });
          }

          // Trigger Slack notification (best effort)
          if (slackNotifier) {
            slackNotifier.sendCollabRequest?.(repo, request).catch(() => { /* best effort */ });
          }

          if (logger) logger.logSystem("COLLAB", `Collab request created: ${initiator} → ${recipient} on ${repo} (${request.requestId})`);

          return { content: [{ type: "text", text: JSON.stringify({ requestId: request.requestId, status: request.status }) }] };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
        }
      },
    );

    // ── list_collab_requests ────────────────────────────────────────
    mcp.tool(
      "list_collab_requests",
      "List all active collaboration requests for a user.",
      {
        userId: z.string().min(1).describe("User identifier"),
      },
      async ({ userId }) => {
        const requests = collabRequestStore.listForUser(userId);
        return { content: [{ type: "text", text: JSON.stringify({ requests }) }] };
      },
    );

    // ── respond_collab_request ──────────────────────────────────────
    mcp.tool(
      "respond_collab_request",
      "Accept or decline a collaboration request.",
      {
        requestId: z.string().min(1).describe("The collaboration request ID"),
        action: z.enum(["accept", "decline"]).describe("Whether to accept or decline"),
      },
      async ({ requestId, action }) => {
        try {
          const request = collabRequestStore.respond(requestId, action);

          // Emit SSE event (Req 3.7)
          if (batonEventEmitter) {
            batonEventEmitter.emit({ type: "collab_request_update", repo: request.repo, data: request });
          }

          // Trigger Slack notification for status change (best effort)
          if (slackNotifier) {
            slackNotifier.sendCollabStatusUpdate?.(request.repo, request).catch(() => { /* best effort */ });
          }

          if (logger) logger.logSystem("COLLAB", `Collab request ${action}ed: ${requestId}`);

          return { content: [{ type: "text", text: JSON.stringify({ requestId: request.requestId, status: request.status }) }] };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
        }
      },
    );

    // ── share_link ──────────────────────────────────────────────────
    mcp.tool(
      "share_link",
      "Attach a Live Share join link to an accepted collaboration request.",
      {
        requestId: z.string().min(1).describe("The collaboration request ID"),
        shareLink: z.string().min(1).describe("The Live Share join URL"),
      },
      async ({ requestId, shareLink }) => {
        // Validate URL contains liveshare or vsengsaas.visualstudio.com (Req 3.6)
        if (!shareLink.includes("liveshare") && !shareLink.includes("vsengsaas.visualstudio.com")) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "Invalid Live Share URL. Must contain 'liveshare' or 'vsengsaas.visualstudio.com'." }) }], isError: true };
        }

        try {
          const request = collabRequestStore.attachLink(requestId, shareLink);

          // Emit SSE event (Req 3.7)
          if (batonEventEmitter) {
            batonEventEmitter.emit({ type: "collab_request_update", repo: request.repo, data: request });
          }

          // Trigger Slack notification with link (best effort)
          if (slackNotifier) {
            slackNotifier.sendCollabStatusUpdate?.(request.repo, request).catch(() => { /* best effort */ });
          }

          if (logger) logger.logSystem("COLLAB", `Share link attached to request ${requestId}`);

          return { content: [{ type: "text", text: JSON.stringify({ requestId: request.requestId, status: request.status, shareLink: request.shareLink }) }] };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
        }
      },
    );
  }

  return mcp;
}


// ---------------------------------------------------------------------------
// Version comparison
// ---------------------------------------------------------------------------

/**
 * Compare two semver version strings (major.minor.patch).
 * Returns "outdated" if client < server, "current" if equal, "newer" if client > server.
 * Malformed or missing versions are treated as outdated.
 */
export function compareVersions(
  clientVersion: string | undefined | null,
  serverVersion: string,
): "outdated" | "current" | "newer" {
  if (!clientVersion || typeof clientVersion !== "string") return "outdated";

  const parse = (v: string): [number, number, number] | null => {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
    if (!m) return null;
    return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
  };

  const c = parse(clientVersion);
  if (!c) return "outdated";

  const s = parse(serverVersion);
  if (!s) return "current"; // can't compare against malformed server version

  for (let i = 0; i < 3; i++) {
    if (c[i] < s[i]) return "outdated";
    if (c[i] > s[i]) return "newer";
  }
  return "current";
}

// ---------------------------------------------------------------------------
// Stale channel check (Requirement 7.1)
// ---------------------------------------------------------------------------

/**
 * Check if a user's effective channel is stale (bundle was deleted).
 * Returns stale info if the channel is stale, null otherwise.
 */
export async function checkChannelStale(
  userId: string,
  historyStore?: ISessionHistoryStore,
  adminSettingsStore?: AdminSettingsStore,
  installerChannelStore?: InstallerChannelStore,
  bundleRegistry?: BundleRegistry,
): Promise<{ bundleStale: true; staleMessage: string } | null> {
  if (!installerChannelStore) return null;

  // Resolve the user's effective channel
  let userOverride: ChannelName | "latest" | null = null;
  if (historyStore) {
    try {
      const userRecord = await historyStore.getUser(userId);
      if (userRecord?.installerChannel && VALID_CHANNEL_OVERRIDES.includes(userRecord.installerChannel)) {
        userOverride = userRecord.installerChannel as ChannelName | "latest";
      }
    } catch { /* best effort */ }
  }

  const globalDefault = adminSettingsStore
    ? ((await adminSettingsStore.get("defaultChannel")) as ChannelName | null) ?? "prod"
    : "prod";

  const effectiveChannel = resolveEffectiveChannel(userOverride, globalDefault as ChannelName);

  // "latest" pseudo-channel: resolve from bundle registry (Requirement 8.2)
  if (effectiveChannel === "latest") {
    // If no bundle registry or it's empty, the latest channel has nothing to serve
    if (!bundleRegistry || bundleRegistry.size === 0) {
      return null; // Not stale — just empty (404 handled at serve time)
    }
    return null; // Latest always resolves to the newest bundle, never stale
  }

  // Check if the channel's version indicates stale state
  const metadata = await installerChannelStore.getMetadata(effectiveChannel);
  if (metadata?.version?.startsWith("__stale__")) {
    const deletedVersion = metadata.version.replace("__stale__:", "");
    return {
      bundleStale: true,
      staleMessage: `The installer bundle (v${deletedVersion}) assigned to the "${effectiveChannel}" channel was removed by an admin. Waiting for a replacement...`,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Effective channel version resolution (Requirement 7.4)
// ---------------------------------------------------------------------------

/**
 * Get the version assigned to the user's effective channel.
 * Used to detect when a previously-stale channel has been resolved with a new version,
 * triggering the updateRequired flow for clients that are still on the old version.
 */
export async function getEffectiveChannelVersion(
  userId: string,
  historyStore?: ISessionHistoryStore,
  adminSettingsStore?: AdminSettingsStore,
  installerChannelStore?: InstallerChannelStore,
  bundleRegistry?: BundleRegistry,
): Promise<string | null> {
  if (!installerChannelStore) return null;

  // Resolve the user's effective channel (same logic as checkChannelStale)
  let userOverride: ChannelName | "latest" | null = null;
  if (historyStore) {
    try {
      const userRecord = await historyStore.getUser(userId);
      if (userRecord?.installerChannel && VALID_CHANNEL_OVERRIDES.includes(userRecord.installerChannel)) {
        userOverride = userRecord.installerChannel as ChannelName | "latest";
      }
    } catch { /* best effort */ }
  }

  const globalDefault = adminSettingsStore
    ? ((await adminSettingsStore.get("defaultChannel")) as ChannelName | null) ?? "prod"
    : "prod";

  const effectiveChannel = resolveEffectiveChannel(userOverride, globalDefault as ChannelName);

  // "latest" pseudo-channel: resolve version from bundle registry (Requirement 8.2, 8.3)
  if (effectiveChannel === "latest") {
    if (!bundleRegistry) return null;
    const latest = bundleRegistry.getLatest();
    return latest?.metadata.version ?? null;
  }

  const metadata = await installerChannelStore.getMetadata(effectiveChannel);
  if (!metadata || metadata.version.startsWith("__stale__")) return null;

  return metadata.version;
}

// ---------------------------------------------------------------------------
// Bundle manifest builder
// ---------------------------------------------------------------------------

interface BundleManifest {
  version: string;
  files: string[];
}

/**
 * Walk a directory recursively and return all file paths relative to `root`.
 */
function walkDir(dir: string, root: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      results.push(...walkDir(fullPath, root));
    } else if (stat.isFile()) {
      results.push(relative(root, fullPath));
    }
  }
  return results;
}

/**
 * Build the bundle manifest by scanning konductor_bundle/ on disk.
 * Called once at startup and cached.
 */
export function buildBundleManifest(bundleDir: string, version: string): BundleManifest {
  const files = walkDir(bundleDir, bundleDir);
  // Normalize to forward slashes for cross-platform consistency
  const normalizedFiles = files.map((f) => f.split("\\").join("/"));
  return { version, files: normalizedFiles };
}

// ---------------------------------------------------------------------------
// Installer tarball builder
// ---------------------------------------------------------------------------

let cachedInstallerTgz: Buffer | null = null;

/**
 * Build an npm-compatible tarball from the konductor-setup package.
 * Uses `npm pack` and caches the result. Returns null if the setup
 * package isn't found or packing fails.
 */
export function buildInstallerTarball(setupDir: string): Buffer | null {
  if (cachedInstallerTgz) return cachedInstallerTgz;
  if (!existsSync(join(setupDir, "package.json"))) return null;
  try {
    const output = execSync("npm pack --pack-destination .", { cwd: setupDir, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    // npm pack may output prepack script output before the filename — take the last non-empty line
    const lines = output.split("\n").filter((l) => l.trim().length > 0);
    const tgzName = lines[lines.length - 1].trim();
    const tgzPath = join(setupDir, tgzName);
    cachedInstallerTgz = readFileSync(tgzPath);
    // Clean up the generated file
    try { execSync(`rm ${JSON.stringify(tgzPath)}`); } catch { /* best effort */ }
    return cachedInstallerTgz;
  } catch {
    return null;
  }
}

/** Clear the cached tarball (for testing or after updates). */
export function clearInstallerCache(): void {
  cachedInstallerTgz = null;
}

// ---------------------------------------------------------------------------
// SSE transport with API key auth
// ---------------------------------------------------------------------------

export function startSseServer(
  mcp: McpServer,
  port: number,
  apiKey: string | undefined,
  logger?: KonductorLogger,
  deps?: {
    sessionManager: SessionManager;
    collisionEvaluator: CollisionEvaluator;
    summaryFormatter: SummaryFormatter;
    configManager: ConfigManager;
    queryEngine?: QueryEngine;
    notificationStore?: NotificationStore;
    queryLogStore?: QueryLogStore;
    batonEventEmitter?: BatonEventEmitter;
    batonAuth?: BatonAuthModule;
    installerChannelStore?: InstallerChannelStore;
    adminSettingsStore?: AdminSettingsStore;
    adminList?: string[];
    slackSettingsManager?: SlackSettingsManager;
    slackNotifier?: SlackNotifier;
    slackStateTracker?: SlackStateTracker;
    historyStore?: ISessionHistoryStore;
    historyPurger?: HistoryPurger;
    bundleRegistry?: BundleRegistry;
    collabRequestStore?: CollabRequestStore;
  },
  tlsOptions?: { key: Buffer; cert: Buffer },
) {
  const transports = new Map<string, SSEServerTransport>();
  const userTransportRegistry = new UserTransportRegistry();

  // Persistent mapping of short repo names → full "owner/repo" strings.
  // Populated on every session registration so that Baton dashboard lookups
  // work even after all sessions have expired (fixes empty tables issue).
  const repoNameCache = new Map<string, string>();

  // Seed the cache from any sessions that already exist at startup (including stale)
  if (deps?.sessionManager) {
    for (const repo of deps.sessionManager.getKnownRepos()) {
      const short = extractRepoName(repo);
      repoNameCache.set(short, repo);
    }
  }
  // Also seed from notification store (notifications persist after sessions expire)
  if (deps?.notificationStore) {
    for (const repo of deps.notificationStore.getKnownRepos()) {
      const short = extractRepoName(repo);
      repoNameCache.set(short, repo);
    }
  }
  // Also seed from query log store
  if (deps?.queryLogStore) {
    for (const repo of deps.queryLogStore.getKnownRepos()) {
      const short = extractRepoName(repo);
      repoNameCache.set(short, repo);
    }
  }

  // Build bundle manifest once at startup
  const bundleDir = resolve(process.cwd(), "konductor_bundle");
  const pkgJsonPath = resolve(process.cwd(), "package.json");
  let pkgVersion = "0.0.0";
  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
    pkgVersion = pkg.version ?? "0.0.0";
  } catch { /* use default */ }
  const bundleManifest = buildBundleManifest(bundleDir, pkgVersion);

  // Resolve server URL for client install info
  const protocol = tlsOptions ? "https" : "http";
  const serverUrl = process.env.KONDUCTOR_EXTERNAL_URL || `${protocol}://${osHostname()}:${port}`;

  // Update batonAuth with the actual server URL (Req 5.6)
  if (deps?.batonAuth) {
    deps.batonAuth.setServerUrl(serverUrl);
  }

  const requestHandler = async (req: IncomingMessage, res: ServerResponse) => {
    // CORS headers for SSE
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const clientIp = req.socket.remoteAddress ?? "unknown";
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    // ── Bundle endpoints (no auth required) ─────────────────────────

    // Bundle manifest
    if (req.method === "GET" && url.pathname === "/bundle/manifest.json") {
      if (logger) {
        logger.logClientInstall(clientIp, pkgVersion);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(bundleManifest));
      return;
    }

    // Bundle file serving
    if (req.method === "GET" && (req.url ?? "").startsWith("/bundle/files/")) {
      const rawPath = (req.url ?? "").slice("/bundle/files/".length);
      const filePath = decodeURIComponent(rawPath);
      // Reject path traversal (check both raw and decoded)
      if (rawPath.includes("..") || filePath.includes("..")) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid path" }));
        return;
      }
      const fullPath = resolve(bundleDir, filePath);
      try {
        const content = readFileSync(fullPath);
        const ext = extname(filePath);
        const contentType = ext === ".json" ? "application/json" : "text/plain";
        res.writeHead(200, { "Content-Type": contentType });
        res.end(content);
      } catch {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "File not found" }));
      }
      return;
    }

    // Latest installer tarball: /bundle/installer-latest.tgz
    // When BundleRegistry is available, serves the bundle with the most recent createdAt (Requirement 8.4).
    // Falls back to InstallerChannelStore.getLatestTarball() when registry is unavailable or empty.
    if (req.method === "GET" && url.pathname === "/bundle/installer-latest.tgz") {
      // Try BundleRegistry first (Requirement 8.4)
      if (deps?.bundleRegistry && deps.bundleRegistry.size > 0) {
        const latest = deps.bundleRegistry.getLatest();
        if (latest) {
          res.writeHead(200, {
            "Content-Type": "application/gzip",
            "Content-Disposition": "attachment; filename=konductor-setup-latest.tgz",
            "Content-Length": latest.tarball.length,
            "Cache-Control": "no-cache, no-store, must-revalidate",
          });
          res.end(latest.tarball);
          return;
        }
      }
      // Fallback to InstallerChannelStore (most recently uploaded across channels)
      if (deps?.installerChannelStore) {
        const latest = await deps.installerChannelStore.getLatestTarball();
        if (latest) {
          res.writeHead(200, {
            "Content-Type": "application/gzip",
            "Content-Disposition": "attachment; filename=konductor-setup-latest.tgz",
            "Content-Length": latest.tarball.length,
            "Cache-Control": "no-cache, no-store, must-revalidate",
          });
          res.end(latest.tarball);
          return;
        }
      }
      // No bundles available (Requirement 8.5)
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No bundles available in the registry" }));
      return;
    }

    // Channel-specific installer tarballs: /bundle/installer-dev.tgz, /bundle/installer-uat.tgz, /bundle/installer-prod.tgz
    // Serves from InstallerChannelStore when available (Requirements 6.2, 6.3, 6.4, 6.7)
    const channelTgzMatch = url.pathname.match(/^\/bundle\/installer-(dev|uat|prod)\.tgz$/);
    if (req.method === "GET" && channelTgzMatch && deps?.installerChannelStore) {
      const channelName = channelTgzMatch[1] as import("./installer-channel-store.js").ChannelName;
      const tgz = await deps.installerChannelStore.getTarball(channelName);
      if (!tgz || tgz.length === 0) {
        // Check if the channel is stale (bundle was deleted) vs simply unassigned
        const metadata = await deps.installerChannelStore.getMetadata(channelName);
        const isStale = metadata?.version?.startsWith("__stale__");
        const message = isStale
          ? `Channel "${channelName}" is stale — the assigned bundle was deleted by an admin`
          : `Channel "${channelName}" has no installer available`;
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: message }));
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename=konductor-setup-${channelName}.tgz`,
        "Content-Length": tgz.length,
        "Cache-Control": "no-cache, no-store, must-revalidate",
      });
      res.end(tgz);
      return;
    }

    // Installer tarball (npm-compatible .tgz of konductor-setup)
    // Matches /bundle/installer.tgz and /bundle/installer-<version>.tgz for cache busting
    // Serves Prod channel tarball for backward compatibility (Requirement 6.6)
    if (req.method === "GET" && /^\/bundle\/installer(-[\d.]+)?\.tgz$/.test(url.pathname)) {
      // Try channel store first (Prod channel for backward compat)
      if (deps?.installerChannelStore) {
        const prodTgz = await deps.installerChannelStore.getTarball("prod");
        if (prodTgz && prodTgz.length > 0) {
          res.writeHead(200, {
            "Content-Type": "application/gzip",
            "Content-Disposition": "attachment; filename=konductor-setup.tgz",
            "Content-Length": prodTgz.length,
            "Cache-Control": "no-cache, no-store, must-revalidate",
          });
          res.end(prodTgz);
          return;
        }
      }
      // Fall back to npm-packed tarball from konductor-setup
      const setupDir = resolve(process.cwd(), "..", "konductor-setup");
      const tgz = buildInstallerTarball(setupDir);
      if (!tgz) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Installer package not found" }));
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/gzip",
        "Content-Disposition": "attachment; filename=konductor-setup.tgz",
        "Content-Length": tgz.length,
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "ETag": `"${pkgVersion}"`,
      });
      res.end(tgz);
      return;
    }

    // Health check (no auth required)
    if (req.method === "GET" && url.pathname === "/health") {
      if (logger) {
        logger.logHealthCheck(clientIp);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    // ── Admin Routes (/login, /admin, /api/admin/*) ───────────────────
    if (deps?.adminSettingsStore && deps?.installerChannelStore) {
      const handled = await handleAdminRoute(req, res, url, {
        apiKey,
        adminSettingsStore: deps.adminSettingsStore,
        installerChannelStore: deps.installerChannelStore,
        logger,
        batonEventEmitter: deps.batonEventEmitter,
        serverUrl,
        port,
        protocol,
        useTls: !!tlsOptions,
        adminList: deps.adminList,
        slackSettingsManager: deps.slackSettingsManager,
        slackNotifier: deps.slackNotifier,
        bundleRegistry: deps.bundleRegistry,
        getUsers: deps.historyStore ? async () => {
          const users = await deps.historyStore!.getAllUsers();
          const adminList = deps.adminList ?? [];
          return users.map(u => ({
            userId: u.userId,
            email: null,
            admin: adminList.includes(u.userId.toLowerCase()) || u.admin,
            adminSource: adminList.includes(u.userId.toLowerCase()) ? "env" as const : (u.admin ? "database" as const : null),
            installerChannel: u.installerChannel,
            lastSeen: u.lastSeen,
            clientVersion: u.clientVersion ?? null,
            lastRepo: u.lastRepo ?? null,
            lastBranch: u.lastBranch ?? null,
            ipAddress: u.ipAddress ?? null,
          }));
        } : undefined,
        updateUser: deps.historyStore ? async (userId: string, updates: { installerChannel?: string; admin?: boolean }) => {
          return deps.historyStore!.updateUser(userId, updates);
        } : undefined,
      });
      if (handled) return;
    }

    // ── Slack OAuth Callback (no API key required) ──────────────────────
    // GET /auth/slack/callback — handle Slack OAuth callback (Requirements 6.3, 6.9)
    if (req.method === "GET" && url.pathname === "/auth/slack/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      // If Slack returned an error (user denied, etc.)
      if (error) {
        res.writeHead(302, { Location: "/admin?slack_error=" + encodeURIComponent(error) });
        res.end();
        return;
      }

      if (!code || !state) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html><html><head><title>400 Bad Request</title></head><body><h1>400 Bad Request</h1><p>Missing authorization code or state parameter.</p><a href="/admin">Back to Admin</a></body></html>`);
        return;
      }

      // Retrieve OAuth credentials from settings store
      const slackSettingsManager = deps?.slackSettingsManager;
      const adminSettingsStore = deps?.adminSettingsStore;
      if (!slackSettingsManager || !adminSettingsStore) {
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html><html><head><title>500 Error</title></head><body><h1>500 Error</h1><p>Slack integration not available.</p><a href="/admin">Back to Admin</a></body></html>`);
        return;
      }

      try {
        const clientId = await adminSettingsStore.get("slack:oauth_client_id") as string | undefined;
        const clientSecret = await adminSettingsStore.get("slack:oauth_client_secret") as string | undefined;

        if (!clientId || !clientSecret) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`<!DOCTYPE html><html><head><title>400 Bad Request</title></head><body><h1>400 Bad Request</h1><p>OAuth credentials not configured. Set Client ID and Client Secret in the Admin Dashboard first.</p><a href="/admin">Back to Admin</a></body></html>`);
          return;
        }

        // Exchange authorization code for bot token via oauth.v2.access
        const redirectUri = `${serverUrl}/auth/slack/callback`;
        const tokenResponse = await fetch("https://slack.com/api/oauth.v2.access", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            redirect_uri: redirectUri,
          }).toString(),
        });

        const tokenData = await tokenResponse.json() as {
          ok: boolean;
          access_token?: string;
          team?: { name?: string; id?: string };
          bot_user_id?: string;
          error?: string;
        };

        if (!tokenData.ok || !tokenData.access_token) {
          const slackError = tokenData.error || "Unknown error";
          res.writeHead(302, { Location: "/admin?slack_error=" + encodeURIComponent(slackError) });
          res.end();
          return;
        }

        // Store the bot token
        await slackSettingsManager.setBotToken(tokenData.access_token);

        // Validate the token via auth.test
        const slackNotifier = deps?.slackNotifier;
        if (slackNotifier) {
          await slackNotifier.validateToken();
        }

        if (logger) {
          logger.logConfigReloaded("Slack OAuth flow completed — bot token stored");
        }

        res.writeHead(302, { Location: "/admin?slack_success=true" });
        res.end();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        if (logger) {
          logger.logConfigError(`Slack OAuth callback error: ${message}`);
        }
        res.writeHead(302, { Location: "/admin?slack_error=" + encodeURIComponent(message) });
        res.end();
      }
      return;
    }

    // ── Baton Auth Routes (no API key required) ───────────────────────
    // These routes handle the GitHub OAuth flow for Baton dashboard access.
    // Requirements: 1.1–1.7, 3.4

    const batonAuth = deps?.batonAuth;

    // GET /auth/login?redirect=<path> — initiate OAuth flow (Req 1.1, 1.2)
    if (req.method === "GET" && url.pathname === "/auth/login" && batonAuth?.isEnabled()) {
      const redirectPath = url.searchParams.get("redirect") || "/";
      const { url: authUrl, state } = batonAuth.buildAuthUrl(redirectPath);
      // Store state + redirect in a short-lived cookie (10 min TTL)
      const statePayload = JSON.stringify({ state, redirect: redirectPath });
      const useTls = !!tlsOptions;
      const stateCookie = serializeCookie("baton_auth_state", statePayload, {
        httpOnly: true,
        secure: useTls,
        sameSite: "Lax",
        maxAge: 600, // 10 minutes
        path: "/",
      });
      res.writeHead(302, {
        Location: authUrl,
        "Set-Cookie": stateCookie,
      });
      res.end();
      return;
    }

    // GET /auth/callback?code=<code>&state=<state> — handle OAuth callback (Req 1.3, 1.4, 1.5, 1.6, 1.7)
    if (req.method === "GET" && url.pathname === "/auth/callback" && batonAuth?.isEnabled()) {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const cookies = parseCookies(req.headers.cookie);
      let expectedState = "";
      let redirectPath = "/";
      try {
        const stateData = JSON.parse(cookies.baton_auth_state || "{}");
        expectedState = stateData.state || "";
        redirectPath = stateData.redirect || "/";
      } catch { /* invalid state cookie */ }

      if (!code || !state) {
        const html = buildAuthErrorPage("Missing authorization code or state parameter.");
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      try {
        const session = await batonAuth.handleCallback(code, state, expectedState);
        const sessionCookie = serializeCookie("baton_session", batonAuth.encodeSession(session), {
          httpOnly: true,
          secure: !!tlsOptions,
          sameSite: "Lax",
          maxAge: batonAuth.getSessionMaxAgeSec(),
          path: "/",
        });
        // Clear the state cookie
        const clearStateCookie = serializeCookie("baton_auth_state", "", {
          httpOnly: true,
          secure: !!tlsOptions,
          sameSite: "Lax",
          maxAge: 0,
          path: "/",
        });
        res.writeHead(302, {
          Location: redirectPath,
          "Set-Cookie": [sessionCookie, clearStateCookie],
        });
        res.end();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown authentication error";
        // State mismatch → 403 (Req 1.7)
        const statusCode = message.includes("state mismatch") ? 403 : 500;
        const html = buildAuthErrorPage(message);
        res.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      }
      return;
    }

    // GET /auth/logout — clear session, clear cache, redirect (Req 3.4)
    if (req.method === "GET" && url.pathname === "/auth/logout") {
      if (batonAuth?.isEnabled()) {
        const cookies = parseCookies(req.headers.cookie);
        const session = cookies.baton_session ? batonAuth.decodeSession(cookies.baton_session) : null;
        if (session) {
          batonAuth.clearAccessCache(session.accessToken);
        }
      }
      const clearSessionCookie = serializeCookie("baton_session", "", {
        httpOnly: true,
        secure: !!tlsOptions,
        sameSite: "Lax",
        maxAge: 0,
        path: "/",
      });
      res.writeHead(302, {
        Location: "/auth/logged-out",
        "Set-Cookie": clearSessionCookie,
      });
      res.end();
      return;
    }

    // GET /auth/logged-out — serve logged-out page
    if (req.method === "GET" && url.pathname === "/auth/logged-out") {
      const html = buildLoggedOutPage();
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    // ── Baton Dashboard (with optional auth) ────────────────────────

    // ── Auth middleware helpers ────────────────────────────────────────
    // Used by both page routes and API routes.

    /**
     * Check the session cookie and return the decoded session, or null.
     * For page routes: redirects to login if no session.
     * For API routes: returns 401 JSON if no session.
     */
    function getSessionFromRequest(): import("./baton-auth.js").BatonSession | null {
      if (!batonAuth?.isEnabled()) return null;
      const cookies = parseCookies(req.headers.cookie);
      if (!cookies.baton_session) return null;
      return batonAuth.decodeSession(cookies.baton_session);
    }

    /**
     * Full auth check for page routes. Returns true if the request was handled
     * (redirected or error page served), false if the request should proceed.
     */
    async function handlePageAuth(repoFullName: string): Promise<{ handled: boolean; session?: import("./baton-auth.js").BatonSession }> {
      if (!batonAuth?.isEnabled()) return { handled: false };

      const session = getSessionFromRequest();
      if (!session) {
        // Expired or missing session → redirect to login (Req 1.1, 3.3)
        const clearCookie = serializeCookie("baton_session", "", {
          httpOnly: true, secure: !!tlsOptions, sameSite: "Lax", maxAge: 0, path: "/",
        });
        res.writeHead(302, {
          Location: `/auth/login?redirect=${encodeURIComponent(url.pathname)}`,
          "Set-Cookie": clearCookie,
        });
        res.end();
        return { handled: true };
      }

      // Check repo access (Req 2.1–2.5)
      const [owner, repo] = repoFullName.split("/");
      if (owner && repo) {
        const access = await batonAuth.checkRepoAccess(session.accessToken, owner, repo);
        if (access === "denied") {
          const html = build403Page(repoFullName, session.githubUsername);
          res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
          res.end(html);
          return { handled: true };
        }
        if (access === "error") {
          const html = build503Page(url.pathname);
          res.writeHead(503, { "Content-Type": "text/html; charset=utf-8" });
          res.end(html);
          return { handled: true };
        }
      }

      return { handled: false, session };
    }

    /**
     * Full auth check for API routes. Returns true if the request was handled
     * (401/403 JSON sent), false if the request should proceed.
     * Requirements: 4.1, 4.2, 4.3, 4.4
     */
    async function handleApiAuth(repoFullName: string): Promise<{ handled: boolean; session?: import("./baton-auth.js").BatonSession }> {
      if (!batonAuth?.isEnabled()) return { handled: false };

      const session = getSessionFromRequest();
      if (!session) {
        // No session → 401 JSON (Req 4.1)
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Authentication required" }));
        return { handled: true };
      }

      // Check repo access (Req 4.2)
      const [owner, repo] = repoFullName.split("/");
      if (owner && repo) {
        const access = await batonAuth.checkRepoAccess(session.accessToken, owner, repo);
        if (access === "denied") {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Repository access denied" }));
          return { handled: true };
        }
        if (access === "error") {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "GitHub API unavailable" }));
          return { handled: true };
        }
      }

      return { handled: false, session };
    }

    // Helper: find the full "owner/repo" string from just the repo name
    // by scanning active sessions, then falling back to the persistent cache.
    async function resolveRepoFromName(repoName: string): Promise<string | null> {
      // 1. Check active sessions
      if (deps) {
        const allSessions = await deps.sessionManager.getAllActiveSessions();
        for (const s of allSessions) {
          if (extractRepoName(s.repo) === repoName) {
            repoNameCache.set(repoName, s.repo);
            return s.repo;
          }
        }
      }
      // 2. Check persistent cache (survives session expiry)
      return repoNameCache.get(repoName) ?? null;
    }

    // Serve repo page HTML: GET /repo/:repoName (with auth middleware — Req 1.1, 2.1–2.5)
    const repoPageMatch = url.pathname.match(/^\/repo\/([^/]+)$/);
    if (req.method === "GET" && repoPageMatch) {
      const repoName = repoPageMatch[1];
      const fullRepo = await resolveRepoFromName(repoName);
      // Use a synthetic owner/repo if no sessions exist yet
      const repo = fullRepo ?? `_/${repoName}`;

      // Auth check for page routes (Req 1.1, 2.1–2.5)
      const authResult = await handlePageAuth(repo);
      if (authResult.handled) return;

      // Pass user info to page builder when authenticated
      const user = authResult.session
        ? { username: authResult.session.githubUsername, avatarUrl: authResult.session.githubAvatarUrl }
        : (batonAuth?.isEnabled() ? undefined : null);
      const html = buildRepoPage(repo, serverUrl, user);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    // Repo summary JSON: GET /api/repo/:repoName (with auth middleware — Req 4.1, 4.2)
    const apiRepoMatch = url.pathname.match(/^\/api\/repo\/([^/]+)$/);
    if (req.method === "GET" && apiRepoMatch && deps) {
      const repoName = apiRepoMatch[1];
      const fullRepo = await resolveRepoFromName(repoName);
      const repo = fullRepo ?? `_/${repoName}`;

      // Auth check for API routes
      const authResult = await handleApiAuth(repo);
      if (authResult.handled) return;

      if (!fullRepo) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ repo: repoName, githubUrl: "", healthStatus: "healthy", branches: [], users: [], sessionCount: 0, userCount: 0 }));
        return;
      }
      try {
        const summary = await buildRepoSummary(deps.sessionManager, deps.collisionEvaluator, fullRepo);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(summary));
      } catch {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to build repo summary" }));
      }
      return;
    }

    // Notifications: GET /api/repo/:repoName/notifications?status=active|resolved (with auth — Req 4.1, 4.2)
    const apiNotifMatch = url.pathname.match(/^\/api\/repo\/([^/]+)\/notifications$/);
    if (req.method === "GET" && apiNotifMatch && deps?.notificationStore) {
      const repoName = apiNotifMatch[1];
      const fullRepo = await resolveRepoFromName(repoName);
      const repo = fullRepo ?? `_/${repoName}`;

      const authResult = await handleApiAuth(repo);
      if (authResult.handled) return;

      const status = url.searchParams.get("status") ?? "active";
      const notifications = status === "resolved"
        ? deps.notificationStore.getResolved(repo)
        : deps.notificationStore.getActive(repo);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ notifications }));
      return;
    }

    // Resolve notification: POST /api/repo/:repoName/notifications/:id/resolve (with auth — Req 4.4)
    const apiResolveMatch = url.pathname.match(/^\/api\/repo\/([^/]+)\/notifications\/([^/]+)\/resolve$/);
    if (req.method === "POST" && apiResolveMatch && deps?.notificationStore) {
      const repoName = apiResolveMatch[1];
      const fullRepo = await resolveRepoFromName(repoName);
      const repo = fullRepo ?? `_/${repoName}`;

      const authResult = await handleApiAuth(repo);
      if (authResult.handled) return;

      const notificationId = apiResolveMatch[2];
      const success = deps.notificationStore.resolve(notificationId);
      if (success && deps.batonEventEmitter) {
        deps.batonEventEmitter.emit({
          type: "notification_resolved",
          repo,
          data: { id: notificationId },
        });
      }
      res.writeHead(success ? 200 : 404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success }));
      return;
    }

    // Query log: GET /api/repo/:repoName/log (with auth — Req 4.1, 4.2)
    const apiLogMatch = url.pathname.match(/^\/api\/repo\/([^/]+)\/log$/);
    if (req.method === "GET" && apiLogMatch && deps?.queryLogStore) {
      const repoName = apiLogMatch[1];
      const fullRepo = await resolveRepoFromName(repoName);
      const repo = fullRepo ?? `_/${repoName}`;

      const authResult = await handleApiAuth(repo);
      if (authResult.handled) return;

      const entries = deps.queryLogStore.getEntries(repo);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ entries }));
      return;
    }

    // ── Per-Repo Slack API Routes (Requirements 11.1, 11.2, 11.3, 11.4, 11.7) ──

    // GET /api/repo/:repoName/slack — return Slack config for repo
    const apiSlackGetMatch = url.pathname.match(/^\/api\/repo\/([^/]+)\/slack$/);
    if (req.method === "GET" && apiSlackGetMatch && deps?.slackSettingsManager) {
      const repoName = apiSlackGetMatch[1];
      const fullRepo = await resolveRepoFromName(repoName);
      const repo = fullRepo ?? `_/${repoName}`;

      const authResult = await handleApiAuth(repo);
      if (authResult.handled) return;

      try {
        const config = await deps.slackSettingsManager.getRepoConfig(repo);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          channel: config.channel,
          verbosity: config.verbosity,
          enabled: config.enabled,
        }));
      } catch {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to get Slack config" }));
      }
      return;
    }

    // PUT /api/repo/:repoName/slack — update Slack config for repo
    if (req.method === "PUT" && apiSlackGetMatch && deps?.slackSettingsManager) {
      const repoName = apiSlackGetMatch[1];
      const fullRepo = await resolveRepoFromName(repoName);
      const repo = fullRepo ?? `_/${repoName}`;

      const authResult = await handleApiAuth(repo);
      if (authResult.handled) return;

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

      // Validate channel name (Requirement 11.3)
      if (body.channel !== undefined) {
        if (!validateChannelName(body.channel)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid Slack channel name. Must be lowercase, alphanumeric/hyphens/underscores, 1-80 chars, no leading hyphen." }));
          return;
        }
      }

      // Validate verbosity (Requirement 11.3)
      if (body.verbosity !== undefined) {
        if (!validateVerbosity(body.verbosity)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid verbosity level. Must be an integer 0-5." }));
          return;
        }
      }

      try {
        if (body.channel !== undefined) {
          await deps.slackSettingsManager.setRepoChannel(repo, body.channel);
        }
        if (body.verbosity !== undefined) {
          await deps.slackSettingsManager.setRepoVerbosity(repo, body.verbosity);
        }

        // Get updated config
        const updatedConfig = await deps.slackSettingsManager.getRepoConfig(repo);

        // Determine who made the change
        const changedBy = authResult.session?.githubUsername ?? "unknown";

        // Build Slack channel link
        const slackChannelLink = `https://slack.com/app_redirect?channel=${updatedConfig.channel}`;

        // Emit slack_config_change SSE event (Requirement 4.1)
        if (deps.batonEventEmitter) {
          const eventData: SlackConfigChangeEvent = {
            channel: updatedConfig.channel,
            verbosity: updatedConfig.verbosity,
            changedBy,
            slackChannelLink,
          };
          deps.batonEventEmitter.emit({
            type: "slack_config_change",
            repo,
            data: eventData,
          });
        }

        // Log CONFIG entry (Requirement 4.3)
        if (logger) {
          logger.logConfigReloaded(`Slack channel for ${repo} changed to #${updatedConfig.channel} (verbosity: ${updatedConfig.verbosity}) by ${changedBy}`);
        }

        // Send test notification to new channel (Requirement 3.8)
        if (deps.slackNotifier && updatedConfig.enabled) {
          deps.slackNotifier.sendTestMessage(updatedConfig.channel).catch(() => { /* best effort */ });
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          channel: updatedConfig.channel,
          verbosity: updatedConfig.verbosity,
          enabled: updatedConfig.enabled,
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: message }));
      }
      return;
    }

    // SSE event stream: GET /api/repo/:repoName/events (with auth — Req 4.3)
    const apiEventsMatch = url.pathname.match(/^\/api\/repo\/([^/]+)\/events$/);
    if (req.method === "GET" && apiEventsMatch && deps?.batonEventEmitter) {
      const repoName = apiEventsMatch[1];
      const fullRepo = await resolveRepoFromName(repoName);
      const repo = fullRepo ?? `_/${repoName}`;

      const authResult = await handleApiAuth(repo);
      if (authResult.handled) return;

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      res.write("data: {\"type\":\"connected\"}\n\n");

      const unsubscribe = deps.batonEventEmitter.subscribe(repo, (event) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      });

      req.on("close", () => {
        unsubscribe();
      });
      return;
    }

    // GitHub open PRs: GET /api/github/prs/:repoName (with auth — Req 7.1)
    const apiGitHubPrsMatch = url.pathname.match(/^\/api\/github\/prs\/([^/]+)$/);
    if (req.method === "GET" && apiGitHubPrsMatch && deps) {
      const repoName = apiGitHubPrsMatch[1];
      const fullRepo = await resolveRepoFromName(repoName);
      const repo = fullRepo ?? `_/${repoName}`;

      const authResult = await handleApiAuth(repo);
      if (authResult.handled) return;

      const allSessions = await deps.sessionManager.getActiveSessions(repo);
      const prs = buildOpenPRs(allSessions);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ prs }));
      return;
    }

    // GitHub history: GET /api/github/history/:repoName (with auth)
    const apiGitHubHistoryMatch = url.pathname.match(/^\/api\/github\/history\/([^/]+)$/);
    if (req.method === "GET" && apiGitHubHistoryMatch && deps) {
      const repoName = apiGitHubHistoryMatch[1];
      const fullRepo = await resolveRepoFromName(repoName);
      const repo = fullRepo ?? `_/${repoName}`;

      const authResult = await handleApiAuth(repo);
      if (authResult.handled) return;

      const allSessions = await deps.sessionManager.getActiveSessions(repo);
      const history = buildGitHubHistory(allSessions);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ history }));
      return;
    }

    // Collab requests: GET /api/repo/:repoName/collab-requests (with auth — Req 7.1)
    const apiCollabListMatch = url.pathname.match(/^\/api\/repo\/([^/]+)\/collab-requests$/);
    if (req.method === "GET" && apiCollabListMatch && deps?.collabRequestStore) {
      const repoName = apiCollabListMatch[1];
      const fullRepo = await resolveRepoFromName(repoName);
      const repo = fullRepo ?? `_/${repoName}`;

      const authResult = await handleApiAuth(repo);
      if (authResult.handled) return;

      const requests = deps.collabRequestStore.listForRepo(repo);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ requests }));
      return;
    }

    // Respond to collab request: POST /api/collab-requests/:requestId/respond (with auth — Req 7.3)
    const apiCollabRespondMatch = url.pathname.match(/^\/api\/collab-requests\/([^/]+)\/respond$/);
    if (req.method === "POST" && apiCollabRespondMatch && deps?.collabRequestStore) {
      const requestId = apiCollabRespondMatch[1];

      // Look up the request to determine the repo for auth
      const request = deps.collabRequestStore.getById(requestId);
      if (!request) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Collaboration request not found: ${requestId}` }));
        return;
      }

      const authResult = await handleApiAuth(request.repo);
      if (authResult.handled) return;

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      let body: { action?: string };
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
        return;
      }

      if (body.action !== "accept" && body.action !== "decline") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: 'Invalid action. Must be "accept" or "decline".' }));
        return;
      }

      try {
        const updated = deps.collabRequestStore.respond(requestId, body.action);

        // Emit SSE event (Req 7.4)
        if (deps.batonEventEmitter) {
          deps.batonEventEmitter.emit({ type: "collab_request_update", repo: updated.repo, data: updated });
        }

        // Trigger Slack notification for status change (best effort)
        if (deps.slackNotifier) {
          deps.slackNotifier.sendCollabStatusUpdate?.(updated.repo, updated).catch(() => { /* best effort */ });
        }

        if (logger) logger.logSystem("COLLAB", `Collab request ${body.action}ed via REST: ${requestId}`);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ requestId: updated.requestId, status: updated.status }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: message }));
      }
      return;
    }

    // 404 for invalid /repo/ or /api/repo/ patterns
    if (url.pathname.startsWith("/repo/") || url.pathname.startsWith("/api/repo/") || url.pathname.startsWith("/api/github/") || url.pathname.startsWith("/api/collab-requests/")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid repo URL. Expected /repo/:repoName" }));
      return;
    }

    // ── API key authentication ──────────────────────────────────────
    if (apiKey) {
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${apiKey}`) {
        if (logger) {
          const reason = !authHeader ? "missing API key" : "invalid API key";
          logger.logAuthRejection(clientIp, reason);
        }
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid or missing API key" }));
        return;
      }
    }

    // ── REST API: register session (for file watchers) ──────────────
    if (req.method === "POST" && url.pathname === "/api/register" && deps) {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
        const { userId, repo, branch, files: rawFiles } = body;
        if (!userId || !repo || !branch || !rawFiles || !Array.isArray(rawFiles) || rawFiles.length === 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing required fields: userId, repo, branch, files" }));
          return;
        }
        const repoErr = validateRepo(repo);
        if (repoErr) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: repoErr }));
          return;
        }

        // Normalize mixed file format (Requirements 2.3, 2.4)
        const { files, fileChanges } = normalizeFilesInput(rawFiles);
        const hasLineData = fileChanges.some((fc) => fc.lineRanges && fc.lineRanges.length > 0);
        const session = await deps.sessionManager.register(userId, repo, branch, files, hasLineData ? fileChanges : undefined);

        // Cache the repo name mapping so Baton dashboard lookups work after sessions expire
        repoNameCache.set(extractRepoName(repo), repo);

        // Record in history store and upsert user (Req 2.1, 8.1)
        // clientVersion may come from the POST body or the X-Konductor-Client-Version header (file watcher sends it as a header)
        const bodyClientVersion = body.clientVersion || (req.headers["x-konductor-client-version"] as string | undefined);
        if (deps.historyStore) {
          deps.historyStore.record({ sessionId: session.sessionId, userId, repo, branch, files, status: "active", createdAt: session.createdAt }).catch(() => {});
          deps.historyStore.upsertUser(userId, repo, { branch, clientVersion: bodyClientVersion, ipAddress: clientIp }).catch(() => {});
        }

        const allSessions = await deps.sessionManager.getActiveSessions(repo);
        const result: CollisionResult = deps.collisionEvaluator.evaluate(session, allSessions);
        result.actions = deps.configManager.getStateActions(result.state);
        const summary = deps.summaryFormatter.format(result);
        if (logger) {
          const overlappingUsers = result.overlappingSessions.map((s) => s.userId);
          const branches = [...new Set(result.overlappingSessions.map((s) => s.branch))];
          logger.logSessionRegistered(userId, session.sessionId, repo, branch, files);
          logger.logCollisionState(userId, repo, result.state, overlappingUsers, result.sharedFiles, branches, files, branch);
        }

        // Baton: create notification if collision state is not Solo
        if (deps.notificationStore && result.state !== "solo") {
          const healthStatus = computeHealthStatus([result.state]);
          const notification: BatonNotification = {
            id: randomUUID(),
            repo,
            timestamp: new Date().toISOString(),
            notificationType: healthStatus,
            collisionState: result.state,
            jiras: [],
            summary,
            users: [
              { userId, branch },
              ...result.overlappingDetails.map((d) => {
                const user: import("./baton-types.js").BatonNotificationUser = { userId: d.session.userId, branch: d.session.branch };
                if (d.source === "github_pr") {
                  user.source = "github_pr";
                  if (d.prNumber !== undefined) user.prNumber = d.prNumber;
                  if (d.prUrl) user.prUrl = d.prUrl;
                } else if (d.source === "github_commit") {
                  user.source = "github_commit";
                  if (d.commitDateRange) user.commitDateRange = `${d.commitDateRange.earliest.slice(0, 10)} – ${d.commitDateRange.latest.slice(0, 10)}`;
                }
                return user;
              }),
            ],
            resolved: false,
          };
          deps.notificationStore.add(notification);
          if (deps.batonEventEmitter) {
            deps.batonEventEmitter.emit({ type: "notification_added", repo, data: notification });
          }
        }

        // Baton: emit session_change event
        if (deps.batonEventEmitter) {
          try {
            const repoSummary = await buildRepoSummary(deps.sessionManager, deps.collisionEvaluator, repo);
            deps.batonEventEmitter.emit({ type: "session_change", repo, data: repoSummary });
          } catch { /* best effort */ }
        }

        // Baton: log session registration as activity
        if (deps.queryLogStore) {
          const fileList = files.length <= 3 ? files.join(", ") : `${files.slice(0, 3).join(", ")} +${files.length - 3} more`;
          const sessionEntry = {
            id: randomUUID(),
            repo,
            timestamp: new Date().toISOString(),
            userId,
            branch,
            queryType: "session",
            parameters: { files: files.length, fileList: files },
            summary: `Registered with ${files.length} file${files.length !== 1 ? "s" : ""}: ${fileList}`,
          };
          deps.queryLogStore.add(sessionEntry);
          if (deps.batonEventEmitter) {
            deps.batonEventEmitter.emit({ type: "query_logged", repo, data: sessionEntry });
          }
          if (result.state !== "solo") {
            const overlappingUsers = result.overlappingSessions.map((s) => s.userId);
            const collisionEntry = {
              id: randomUUID(),
              repo,
              timestamp: new Date().toISOString(),
              userId,
              branch,
              queryType: "collision",
              parameters: { state: result.state, sharedFiles: result.sharedFiles, overlapping: overlappingUsers },
              summary: buildCollisionSummary(result, userId),
            };
            deps.queryLogStore.add(collisionEntry);
            if (deps.batonEventEmitter) {
              deps.batonEventEmitter.emit({ type: "query_logged", repo, data: collisionEntry });
            }
          }
        }

        // Slack: notify if collision state meets verbosity threshold (Requirement 1.1, 1.2)
        if (deps.slackNotifier) {
          deps.slackNotifier.onCollisionEvaluated(repo, result, userId).catch(() => { /* best effort — never block */ });
        }

        // Proactive collision push: notify existing users via SSE (Requirement 3.1, 3.4)
        if (result.state !== "solo") {
          try {
            pushCollisionAlerts(userTransportRegistry, repo, result, userId, summary);
          } catch { /* best effort — never block registration */ }
        }

        const registerPayload: Record<string, unknown> = { sessionId: session.sessionId, collisionState: result.state, summary, sharedFiles: result.sharedFiles };

        // Include repo page URL in response (Requirement 6.1, 6.3)
        try {
          const parsed = new URL(serverUrl);
          registerPayload.repoPageUrl = buildRepoPageUrl(parsed.hostname, parseInt(parsed.port, 10), repo);
          // Include admin page URL if user is an admin
          const envAdminList = deps.adminList ?? [];
          const isEnvAdmin = envAdminList.includes(userId.toLowerCase());
          let isDbAdmin = false;
          if (!isEnvAdmin && deps.historyStore) {
            try {
              const userRecord = await deps.historyStore.getUser(userId);
              if (userRecord?.admin) isDbAdmin = true;
            } catch { /* best effort */ }
          }
          if (isEnvAdmin || isDbAdmin) {
            registerPayload.adminPageUrl = `${parsed.protocol}//${parsed.hostname}:${parsed.port}/admin`;
            registerPayload.isAdmin = true;
          }
        } catch { /* best effort — skip if serverUrl is malformed */ }

        // Version check from X-Konductor-Client-Version header (Requirement 6.5)
        const clientVersion = req.headers["x-konductor-client-version"] as string | undefined;
        // When user's effective channel is "latest", compare against the latest bundle's version (Requirement 8.3)
        // When the channel store exists but no version is assigned, skip — nothing to update to.
        const effectiveChannelVersion = await getEffectiveChannelVersion(userId, deps.historyStore, deps.adminSettingsStore, deps.installerChannelStore, deps.bundleRegistry);
        const versionToCompare = deps.installerChannelStore ? effectiveChannelVersion : (effectiveChannelVersion ?? pkgVersion);
        const versionCheck = versionToCompare ? compareVersions(clientVersion, versionToCompare) : "current";
        if (versionCheck === "outdated") {
          registerPayload.updateRequired = true;
          registerPayload.serverVersion = versionToCompare;
          // Resolve user's effective channel for the update URL
          let userEffectiveChannel: string | null = null;
          if (deps.historyStore) {
            try {
              const userRecord = await deps.historyStore.getUser(userId);
              if (userRecord?.installerChannel && VALID_CHANNEL_OVERRIDES.includes(userRecord.installerChannel)) {
                userEffectiveChannel = userRecord.installerChannel;
              }
            } catch { /* best effort */ }
          }
          registerPayload.updateUrl = buildChannelUpdateUrl(serverUrl, userEffectiveChannel ?? (deps.adminSettingsStore ? await deps.adminSettingsStore.get("defaultChannel") as string | null : null));
        }

        // Check if user's effective channel is stale (Requirement 7.1)
        const staleInfo = await checkChannelStale(userId, deps.historyStore, deps.adminSettingsStore, deps.installerChannelStore, deps.bundleRegistry);
        if (staleInfo) {
          registerPayload.bundleStale = staleInfo.bundleStale;
          registerPayload.staleMessage = staleInfo.staleMessage;
        }

        // Include line overlap details when available (Requirements 4.1, 4.2, 4.3, 7.5)
        if (result.overlapSeverity) {
          registerPayload.overlapSeverity = result.overlapSeverity;
        }
        if (result.overlappingDetails.some((d) => d.lineOverlapDetails && d.lineOverlapDetails.length > 0)) {
          registerPayload.overlappingDetails = result.overlappingDetails
            .filter((d) => d.lineOverlapDetails && d.lineOverlapDetails.length > 0)
            .map((d) => ({
              userId: d.session.userId,
              sharedFiles: d.sharedFiles,
              lineOverlapDetails: d.lineOverlapDetails,
              overlapSeverity: d.overlapSeverity,
            }));
        }

        // Piggyback pending collab requests on check-in (Requirement 5.1)
        const pendingCollabReqs = getPendingCollabRequests(deps.collabRequestStore, userId);
        if (pendingCollabReqs.length > 0) {
          registerPayload.pendingCollabRequests = pendingCollabReqs;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(registerPayload));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
      }
      return;
    }

    // ── REST API: check status (for polling) ────────────────────────
    if (req.method === "POST" && url.pathname === "/api/status" && deps) {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      try {
        const { userId, repo, files } = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
        if (!userId || !repo) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing required fields: userId, repo" }));
          return;
        }
        const repoErr = validateRepo(repo);
        if (repoErr) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: repoErr }));
          return;
        }
        const allSessions = await deps.sessionManager.getActiveSessions(repo);
        const existingSession = allSessions.find((s) => s.userId === userId);

        // Refresh heartbeat if user has an active session — keeps the session
        // alive while the file watcher is polling with check_status
        if (existingSession) {
          try {
            await deps.sessionManager.heartbeat(existingSession.sessionId);
          } catch { /* best effort */ }
        }

        // Ensure user appears in admin panel even if they only call check_status
        if (deps.historyStore) {
          deps.historyStore.upsertUser(userId, repo, { branch: existingSession?.branch }).catch(() => {});
        }

        if (!existingSession && (!files || files.length === 0)) {
          const earlyPayload: Record<string, unknown> = { collisionState: "none", overlappingSessions: [], sharedFiles: [], actions: [] };
          // Still check version even when no active session (Requirement 6.5)
          // Use channel-aware version resolution (Bug B1 fix — was using pkgVersion)
          const clientVersion = req.headers["x-konductor-client-version"] as string | undefined;
          const earlyEffectiveVersion = deps.installerChannelStore
            ? await getEffectiveChannelVersion(userId, deps.historyStore, deps.adminSettingsStore, deps.installerChannelStore, deps.bundleRegistry)
            : null;
          const earlyVersionToCompare = deps.installerChannelStore ? earlyEffectiveVersion : (earlyEffectiveVersion ?? pkgVersion);
          const versionCheck = earlyVersionToCompare ? compareVersions(clientVersion, earlyVersionToCompare) : "current";
          if (versionCheck === "outdated") {
            earlyPayload.updateRequired = true;
            earlyPayload.serverVersion = earlyVersionToCompare;
            let earlyUserChannel: string | null = null;
            if (deps.historyStore) {
              try {
                const userRecord = await deps.historyStore.getUser(userId);
                if (userRecord?.installerChannel && VALID_CHANNEL_OVERRIDES.includes(userRecord.installerChannel)) {
                  earlyUserChannel = userRecord.installerChannel;
                }
              } catch { /* best effort */ }
            }
            earlyPayload.updateUrl = buildChannelUpdateUrl(serverUrl, earlyUserChannel ?? (deps.adminSettingsStore ? await deps.adminSettingsStore.get("defaultChannel") as string | null : null));
          }
          // Piggyback pending collab requests even on early return (Requirement 5.1)
          const earlyPendingCollab = getPendingCollabRequests(deps.collabRequestStore, userId);
          if (earlyPendingCollab.length > 0) {
            earlyPayload.pendingCollabRequests = earlyPendingCollab;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(earlyPayload));
          return;
        }
        const querySession = existingSession
          ? { ...existingSession, files: files ?? existingSession.files }
          : { sessionId: "__api_status__", userId, repo, branch: "", files: files!, createdAt: new Date().toISOString(), lastHeartbeat: new Date().toISOString() };
        const result: CollisionResult = deps.collisionEvaluator.evaluate(querySession, allSessions);
        result.actions = deps.configManager.getStateActions(result.state);
        if (logger) {
          logger.logCheckStatus(userId, repo, result.state, querySession.files, querySession.branch || undefined);
        }

        // Slack: notify if collision state meets verbosity threshold (Requirement 1.1, 1.2)
        if (deps.slackNotifier) {
          deps.slackNotifier.onCollisionEvaluated(repo, result, userId).catch(() => { /* best effort — never block */ });
        }

        const statusPayload: Record<string, unknown> = {
          collisionState: result.state,
          overlappingSessions: result.overlappingSessions.map((s) => ({
            sessionId: s.sessionId, userId: s.userId, branch: s.branch, files: s.files,
          })),
          sharedFiles: result.sharedFiles,
          actions: result.actions,
        };

        // Version check from X-Konductor-Client-Version header (Requirement 6.5)
        // Use channel-aware version resolution (Bug B1 fix — was using pkgVersion)
        const clientVersion = req.headers["x-konductor-client-version"] as string | undefined;
        const mainEffectiveVersion = deps.installerChannelStore
          ? await getEffectiveChannelVersion(userId, deps.historyStore, deps.adminSettingsStore, deps.installerChannelStore, deps.bundleRegistry)
          : null;
        const mainVersionToCompare = deps.installerChannelStore ? mainEffectiveVersion : (mainEffectiveVersion ?? pkgVersion);
        const versionCheck = mainVersionToCompare ? compareVersions(clientVersion, mainVersionToCompare) : "current";
        if (versionCheck === "outdated") {
          statusPayload.updateRequired = true;
          statusPayload.serverVersion = mainVersionToCompare;
          let mainUserChannel: string | null = null;
          if (deps.historyStore) {
            try {
              const userRecord = await deps.historyStore.getUser(userId);
              if (userRecord?.installerChannel && VALID_CHANNEL_OVERRIDES.includes(userRecord.installerChannel)) {
                mainUserChannel = userRecord.installerChannel;
              }
            } catch { /* best effort */ }
          }
          statusPayload.updateUrl = buildChannelUpdateUrl(serverUrl, mainUserChannel ?? (deps.adminSettingsStore ? await deps.adminSettingsStore.get("defaultChannel") as string | null : null));
        }

        // Include repo page URL for dashboard link
        if (serverUrl) {
          try {
            const parsed = new URL(serverUrl);
            statusPayload.repoPageUrl = buildRepoPageUrl(parsed.hostname, parseInt(parsed.port, 10), repo);
            // Include admin page URL if user is an admin
            const envAdminList = deps.adminList ?? [];
            const isEnvAdmin = envAdminList.includes(userId.toLowerCase());
            let isDbAdmin = false;
            if (!isEnvAdmin && deps.historyStore) {
              try {
                const userRecord = await deps.historyStore.getUser(userId);
                if (userRecord?.admin) isDbAdmin = true;
              } catch { /* best effort */ }
            }
            if (isEnvAdmin || isDbAdmin) {
              statusPayload.adminPageUrl = `${parsed.protocol}//${parsed.hostname}:${parsed.port}/admin`;
              statusPayload.isAdmin = true;
            }
          } catch { /* best effort */ }
        }

        // Piggyback pending collab requests on check-in (Requirement 5.1)
        const pendingCollabReqs = getPendingCollabRequests(deps.collabRequestStore, userId);
        if (pendingCollabReqs.length > 0) {
          statusPayload.pendingCollabRequests = pendingCollabReqs;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(statusPayload));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
      }
      return;
    }

    // ── REST API: deregister session ────────────────────────────────
    if (req.method === "POST" && url.pathname === "/api/deregister" && deps) {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      try {
        const { sessionId } = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
        if (!sessionId) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing required field: sessionId" }));
          return;
        }
        const success = await deps.sessionManager.deregister(sessionId);
        if (!success) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Session not found", sessionId }));
          return;
        }
        if (logger) {
          logger.logSystem("SESSION", `Deregistered session ${sessionId} via REST API`);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, sessionId }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
      }
      return;
    }

    // ── REST API: mark committed (for client watcher) ─────────────
    if (req.method === "POST" && url.pathname === "/api/mark-committed" && deps?.historyStore) {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      try {
        const { sessionId, userId, repo } = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
        const count = await deps.historyStore.markCommitted({ sessionId, userId, repo });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, count, message: count > 0 ? `Marked ${count} session(s) as committed` : "No matching sessions found" }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/sse") {
      const transport = new SSEServerTransport("/messages", res);
      transports.set(transport.sessionId, transport);

      // Track userId → ServerResponse for proactive collision push (Req 3.1)
      const sseUserId = req.headers["x-konductor-user"] as string || undefined;
      if (sseUserId) {
        userTransportRegistry.add(sseUserId, res);
      }

      if (logger) {
        if (sseUserId) {
          logger.logConnection(sseUserId, clientIp);
          logger.logAuthentication(sseUserId);
        } else {
          logger.logTransportConnection(transport.sessionId.slice(0, 8), clientIp);
          logger.logTransportAuthentication(transport.sessionId.slice(0, 8));
        }
      }

      res.on("close", () => {
        transports.delete(transport.sessionId);
        // Clean up user transport mapping (Req 3.1)
        if (sseUserId) {
          userTransportRegistry.remove(sseUserId, res);
        }
        if (logger) {
          if (sseUserId) {
            logger.logDisconnection(sseUserId);
          } else {
            logger.logTransportDisconnection(transport.sessionId.slice(0, 8));
          }
        }
      });

      // Each SSE client gets its own McpServer instance (SDK limitation: one transport per instance)
      const clientMcp = deps
        ? buildMcpServer({ ...deps, logger, serverVersion: pkgVersion, serverUrl, userTransportRegistry })
        : mcp;
      await clientMcp.connect(transport);
      return;
    }

    if (req.method === "POST" && url.pathname === "/messages") {
      const sessionId = url.searchParams.get("sessionId");
      if (!sessionId || !transports.has(sessionId)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid or missing sessionId" }));
        return;
      }

      // Read body
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));

      const transport = transports.get(sessionId)!;
      await transport.handlePostMessage(req, res, body);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  };

  const httpServer = tlsOptions
    ? createHttpsServer(tlsOptions, requestHandler)
    : createServer(requestHandler);

  httpServer.listen(port, () => {
    console.error(`Konductor SSE server listening on ${protocol}://localhost:${port}`);
    if (tlsOptions) {
      console.error(`  📊 Admin Dashboard: ${protocol}://localhost:${port}/admin`);
      console.error(`  🔑 Login:           ${protocol}://localhost:${port}/login`);
    }
  });

  return httpServer;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const useSSE = args.includes("--sse") || !!process.env.KONDUCTOR_PORT;

  const components = await createComponents();

  // Read package version for version checking
  let mainPkgVersion = "0.0.0";
  try {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf-8"));
    mainPkgVersion = pkg.version ?? "0.0.0";
  } catch { /* use default */ }

  if (useSSE) {
    const port = parseInt(process.env.KONDUCTOR_PORT ?? "3010", 10);
    const apiKey = process.env.KONDUCTOR_API_KEY;

    // TLS config — default to HTTPS if certs exist
    const tlsKeyPath = process.env.KONDUCTOR_TLS_KEY ?? resolve(process.cwd(), "certs", "key.pem");
    const tlsCertPath = process.env.KONDUCTOR_TLS_CERT ?? resolve(process.cwd(), "certs", "cert.pem");
    const forceHttp = process.env.KONDUCTOR_PROTOCOL === "http";

    let tlsOptions: { key: Buffer; cert: Buffer } | undefined;
    if (!forceHttp && existsSync(tlsKeyPath) && existsSync(tlsCertPath)) {
      tlsOptions = {
        key: readFileSync(tlsKeyPath) as unknown as Buffer,
        cert: readFileSync(tlsCertPath) as unknown as Buffer,
      };
    }

    const protocol = tlsOptions ? "https" : "http";
    const serverUrl = process.env.KONDUCTOR_EXTERNAL_URL || `${protocol}://${osHostname()}:${port}`;

    const mcp = buildMcpServer({ ...components, serverVersion: mainPkgVersion, serverUrl });
    const { logger } = components;

    if (logger) {
      logger.logServerStart("SSE", port);
    }
    startSseServer(mcp, port, apiKey, logger, components, tlsOptions);

    // Start GitHub pollers after server is listening (Req 5.1)
    if (components.githubPoller) components.githubPoller.start();
    if (components.commitPoller) components.commitPoller.start();

    // When HTTPS is enabled, also listen on HTTP for localhost MCP connections
    // (Kiro's Electron runtime doesn't trust mkcert CAs)
    if (tlsOptions) {
      const httpPort = port + 1;
      const httpServerUrl = `http://${osHostname()}:${httpPort}`;
      const httpMcp = buildMcpServer({ ...components, serverVersion: mainPkgVersion, serverUrl: httpServerUrl });
      startSseServer(httpMcp, httpPort, apiKey, logger, components);
    }

    // Graceful shutdown: stop pollers and watchers when process exits
    const shutdownPollers = async () => {
      if (components.githubPoller) components.githubPoller.stop();
      if (components.commitPoller) components.commitPoller.stop();
      components.bundleRegistry?.stopWatching();
      if (components.settingsBackend && "flush" in components.settingsBackend) {
        await (components.settingsBackend as any).flush();
      }
      if (components.localPersistence) {
        await components.localPersistence.flush();
      }
      if (components.s3Persistence) {
        await components.s3Persistence.shutdown();
      }
    };
    process.on("SIGTERM", shutdownPollers);
    process.on("SIGINT", shutdownPollers);
  } else {
    const mcp = buildMcpServer({ ...components, serverVersion: mainPkgVersion });
    const { logger } = components;

    const transport = new StdioServerTransport();
    if (logger) {
      logger.logServerStart("stdio");
    }
    await mcp.connect(transport);
    console.error("Konductor MCP server running on stdio");
  }
}

// Only run main() when executed directly, not when imported by tests
if (process.env.VITEST === undefined) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
