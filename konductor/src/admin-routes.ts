/**
 * Admin API Routes — Konductor Admin Dashboard
 *
 * Handles all /login, /admin, and /api/admin/* routes.
 * Provides login page, admin dashboard, settings CRUD, channel management,
 * user management, install commands, and SSE event stream.
 *
 * Requirements: 1.1–1.4, 2.1–2.5, 3.1–3.4, 4.1–4.8, 5.1–5.4, 7.1–7.10, 10.1–10.4
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  parseKonductorAdmins,
  resolveAdminStatus,
  encodeAdminSession,
  decodeAdminSession,
  createAdminSession,
  getSessionSecret,
  hashApiKey,
  type AdminAuthResult,
  type AdminSession,
} from "./admin-auth.js";
import { parseCookies, serializeCookie } from "./baton-auth.js";
import type { AdminSettingsStore } from "./admin-settings-store.js";
import type { InstallerChannelStore, ChannelName } from "./installer-channel-store.js";
import { VALID_CHANNELS } from "./installer-channel-store.js";
import { buildInstallCommands } from "./admin-install-commands.js";
import { buildLoginPage, buildAdminDashboard } from "./admin-page-builder.js";
import { buildBundleManagerPage } from "./bundle-page-builder.js";
import type { KonductorLogger } from "./logger.js";
import type { BatonEventEmitter } from "./baton-event-emitter.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdminRouteDeps {
  apiKey: string | undefined;
  adminSettingsStore: AdminSettingsStore;
  installerChannelStore: InstallerChannelStore;
  logger?: KonductorLogger;
  batonEventEmitter?: BatonEventEmitter;
  serverUrl: string;
  port: number;
  protocol: "http" | "https";
  useTls: boolean;
  /** Pre-parsed KONDUCTOR_ADMINS list (parsed at startup) */
  adminList?: string[];
  /** Function to get all user records for user management */
  getUsers?: () => Promise<AdminUserRecord[]>;
  /** Function to update a user record */
  updateUser?: (userId: string, updates: { installerChannel?: string; admin?: boolean }) => Promise<boolean>;
  /** Slack settings manager for admin Slack routes */
  slackSettingsManager?: import("./slack-settings.js").SlackSettingsManager;
  /** Slack notifier for test messages and token validation */
  slackNotifier?: import("./slack-notifier.js").SlackNotifier;
  /** Bundle registry for local store mode */
  bundleRegistry?: import("./bundle-registry.js").BundleRegistry;
}

export interface AdminUserRecord {
  userId: string;
  email?: string | null;
  admin: boolean;
  adminSource: "env" | "database" | null;
  installerChannel?: string | null;
  lastSeen?: string | null;
  clientVersion?: string | null;
  lastRepo?: string | null;
  lastBranch?: string | null;
  ipAddress?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read the full request body as a string. */
async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/** Parse URL-encoded form body. */
function parseFormBody(body: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of body.split("&")) {
    const [key, ...rest] = pair.split("=");
    if (key) {
      result[decodeURIComponent(key)] = decodeURIComponent(rest.join("=") || "");
    }
  }
  return result;
}

/**
 * Authenticate the request via admin session cookie or Authorization header.
 * Returns the userId if authenticated, null otherwise.
 */
function authenticateRequest(
  req: IncomingMessage,
  apiKey: string | undefined,
): { userId: string | null; method: "cookie" | "header" | null } {
  // Try cookie first
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.konductor_admin_session) {
    const secret = getSessionSecret();
    const session = decodeAdminSession(cookies.konductor_admin_session, secret);
    if (session) {
      return { userId: session.userId, method: "cookie" };
    }
  }

  // Try Authorization header + X-Konductor-User header
  const authHeader = req.headers.authorization;
  const userHeader = req.headers["x-konductor-user"] as string | undefined;
  if (authHeader && userHeader && apiKey) {
    if (authHeader === `Bearer ${apiKey}`) {
      return { userId: userHeader, method: "header" };
    }
  }

  // When KONDUCTOR_ADMIN_AUTH=false, accept API key header alone (no user header)
  // This allows programmatic access in dev mode without requiring X-Konductor-User
  if (process.env.KONDUCTOR_ADMIN_AUTH === "false" && authHeader && apiKey && authHeader === `Bearer ${apiKey}`) {
    const adminList = parseKonductorAdmins(process.env.KONDUCTOR_ADMINS);
    return { userId: adminList[0] || "admin", method: "header" };
  }

  return { userId: null, method: null };
}

// Login page HTML is now provided by admin-page-builder.ts

// ---------------------------------------------------------------------------
// Route Handler
// ---------------------------------------------------------------------------

/**
 * Handle admin routes. Returns true if the route was handled, false otherwise.
 * This allows the main request handler to fall through to other routes.
 */
export async function handleAdminRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: AdminRouteDeps,
): Promise<boolean> {
  // GET /login — serve login form (Requirement 2.1)
  if (req.method === "GET" && url.pathname === "/login") {
    // In local dev mode with auth disabled, pre-fill credentials
    const isLocal = process.env.KONDUCTOR_STARTUP_LOCAL === "true";
    const authDisabled = process.env.KONDUCTOR_ADMIN_AUTH === "false";
    let prefill: { userId?: string; apiKey?: string } | undefined;
    if (isLocal && authDisabled) {
      const adminList = deps.adminList ?? parseKonductorAdmins(process.env.KONDUCTOR_ADMINS);
      prefill = {
        userId: adminList[0] || "admin",
        apiKey: deps.apiKey || "",
      };
    }
    const html = buildLoginPage(undefined, prefill);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return true;
  }

  // POST /login — validate credentials, set cookie (Requirements 2.2, 2.3)
  if (req.method === "POST" && url.pathname === "/login") {
    const body = await readBody(req);
    const form = parseFormBody(body);
    const userId = form.userId?.trim();
    const submittedKey = form.apiKey?.trim();

    if (!userId || !submittedKey) {
      const html = buildLoginPage("Invalid credentials");
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return true;
    }

    // Validate API key against server's configured key
    if (!deps.apiKey || submittedKey !== deps.apiKey) {
      const html = buildLoginPage("Invalid credentials");
      res.writeHead(401, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return true;
    }

    // Check admin status before granting session
    const adminList = deps.adminList ?? parseKonductorAdmins(process.env.KONDUCTOR_ADMINS);
    const authResult = resolveAdminStatus(userId, null, adminList, null);

    // Create session and set cookie
    const secret = getSessionSecret();
    const session = createAdminSession(userId, submittedKey);
    const encoded = encodeAdminSession(session, secret);
    const cookie = serializeCookie("konductor_admin_session", encoded, {
      httpOnly: true,
      secure: deps.useTls,
      sameSite: "Lax",
      maxAge: 8 * 60 * 60, // 8 hours
      path: "/",
    });

    res.writeHead(302, {
      Location: "/admin",
      "Set-Cookie": cookie,
    });
    res.end();
    return true;
  }

  // GET /admin — serve admin dashboard (Requirements 1.1–1.4, 2.4)
  if (req.method === "GET" && url.pathname === "/admin") {
    const auth = authenticateRequest(req, deps.apiKey);

    // Not authenticated → redirect to login (Requirement 2.1)
    if (!auth.userId) {
      res.writeHead(302, { Location: "/login" });
      res.end();
      return true;
    }

    // Check admin status (Requirements 1.1–1.4)
    const adminList = deps.adminList ?? parseKonductorAdmins(process.env.KONDUCTOR_ADMINS);
    // For header-based auth, we don't have the user record admin flag readily available
    // We'll check env first, then assume database lookup would be needed
    const adminResult = resolveAdminStatus(auth.userId, null, adminList, null);

    // If not in env list, we need to check via getUsers
    let isAdmin = adminResult.isAdmin;
    // Bypass admin check when KONDUCTOR_ADMIN_AUTH=false
    if (process.env.KONDUCTOR_ADMIN_AUTH === "false") {
      isAdmin = true;
    }
    if (!isAdmin && deps.getUsers) {
      const users = await deps.getUsers();
      const userRecord = users.find((u) => u.userId.toLowerCase() === auth.userId!.toLowerCase());
      if (userRecord?.admin) {
        isAdmin = true;
      }
    }

    if (!isAdmin) {
      res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!DOCTYPE html><html><head><title>403 Forbidden</title></head><body><h1>403 Forbidden</h1><p>Admin access is required.</p></body></html>`);
      return true;
    }

    // Serve admin dashboard HTML
    const dashboardHtml = buildAdminDashboard(auth.userId);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(dashboardHtml);
    return true;
  }

  // ── Admin API routes (all require admin auth) ─────────────────────

  // GET /admin/bundles — serve Bundle Manager page (Requirement 5.1)
  if (req.method === "GET" && url.pathname === "/admin/bundles") {
    const auth = authenticateRequest(req, deps.apiKey);

    // Not authenticated → redirect to login
    if (!auth.userId) {
      res.writeHead(302, { Location: "/login" });
      res.end();
      return true;
    }

    // Check admin status
    const adminList = deps.adminList ?? parseKonductorAdmins(process.env.KONDUCTOR_ADMINS);
    let isAdmin = resolveAdminStatus(auth.userId, null, adminList, null).isAdmin;
    if (process.env.KONDUCTOR_ADMIN_AUTH === "false") {
      isAdmin = true;
    }
    if (!isAdmin && deps.getUsers) {
      const users = await deps.getUsers();
      const userRecord = users.find((u) => u.userId.toLowerCase() === auth.userId!.toLowerCase());
      if (userRecord?.admin) {
        isAdmin = true;
      }
    }

    if (!isAdmin) {
      res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!DOCTYPE html><html><head><title>403 Forbidden</title></head><body><h1>403 Forbidden</h1><p>Admin access is required.</p></body></html>`);
      return true;
    }

    const localStoreMode = process.env.KONDUCTOR_SERVE_CLIENT_BUNDLES_FROM_LOCAL_STORE === "true";
    const html = buildBundleManagerPage({ localStoreMode });
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return true;
  }

  if (url.pathname.startsWith("/api/admin/")) {
    // Authenticate
    const auth = authenticateRequest(req, deps.apiKey);
    if (!auth.userId) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Authentication required" }));
      return true;
    }

    // Check admin status
    const adminList = deps.adminList ?? parseKonductorAdmins(process.env.KONDUCTOR_ADMINS);
    let adminResult = resolveAdminStatus(auth.userId, null, adminList, null);
    let isAdmin = adminResult.isAdmin;
    // Bypass admin check when KONDUCTOR_ADMIN_AUTH=false
    if (process.env.KONDUCTOR_ADMIN_AUTH === "false") {
      isAdmin = true;
    }
    if (!isAdmin && deps.getUsers) {
      const users = await deps.getUsers();
      const userRecord = users.find((u) => u.userId.toLowerCase() === auth.userId!.toLowerCase());
      if (userRecord?.admin) {
        isAdmin = true;
      }
    }

    if (!isAdmin) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Admin access required" }));
      return true;
    }

    // ── GET /api/admin/settings (Requirement 3.1)
    if (req.method === "GET" && url.pathname === "/api/admin/settings") {
      const settings = await deps.adminSettingsStore.getAllWithSource();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ settings }));
      return true;
    }

    // ── PUT /api/admin/settings/:key (Requirements 3.2, 3.3, 3.4)
    const settingsKeyMatch = url.pathname.match(/^\/api\/admin\/settings\/([^/]+)$/);
    if (req.method === "PUT" && settingsKeyMatch) {
      const key = decodeURIComponent(settingsKeyMatch[1]);
      const body = await readBody(req);
      let parsed: { value: unknown; category?: string };
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
        return true;
      }

      // Check if env-sourced (Requirement 3.4)
      const source = deps.adminSettingsStore.getSource(key);
      if (source === "env") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Setting is read-only (set by environment variable)" }));
        return true;
      }

      try {
        await deps.adminSettingsStore.set(key, parsed.value, parsed.category ?? "system");
        // Log CONFIG entry (Requirement 3.3)
        if (deps.logger) {
          deps.logger.logConfigReloaded(`Admin setting "${key}" updated to ${JSON.stringify(parsed.value)}`);
        }
        // Emit admin_settings_change event (Requirement 10.3)
        if (deps.batonEventEmitter) {
          deps.batonEventEmitter.emit({
            type: "admin_settings_change",
            repo: "__admin__",
            data: { key, value: parsed.value, category: parsed.category ?? "system" },
          });
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, key, value: parsed.value }));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: message }));
      }
      return true;
    }

    // ── GET /api/admin/channels (Requirement 4.1)
    if (req.method === "GET" && url.pathname === "/api/admin/channels") {
      const metadata = await deps.installerChannelStore.getAllMetadata();
      const channels: Record<string, unknown> = {};
      for (const [name, meta] of metadata) {
        channels[name] = meta;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ channels }));
      return true;
    }

    // ── POST /api/admin/channels/:channel/upload — upload tarball to a channel
    const uploadMatch = url.pathname.match(/^\/api\/admin\/channels\/(dev|uat|prod)\/upload$/);
    if (req.method === "POST" && uploadMatch) {
      const channel = uploadMatch[1] as ChannelName;
      // Read raw body as binary
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      const body = Buffer.concat(chunks);

      // Expect JSON with { version, tarball } where tarball is base64-encoded
      let parsed: { version: string; tarball: string };
      try {
        parsed = JSON.parse(body.toString("utf-8"));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body. Expected { version, tarball }" }));
        return true;
      }

      if (!parsed.version || !parsed.tarball) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing required fields: version, tarball" }));
        return true;
      }

      try {
        const tarballBuf = Buffer.from(parsed.tarball, "base64");
        if (tarballBuf.length === 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Tarball is empty" }));
          return true;
        }
        const metadata = await deps.installerChannelStore.setTarball(channel, tarballBuf, parsed.version);
        if (deps.logger) {
          deps.logger.logConfigReloaded(`Tarball uploaded to ${channel}: v${parsed.version} (${(tarballBuf.length / 1024).toFixed(0)} KB)`);
        }
        if (deps.batonEventEmitter) {
          deps.batonEventEmitter.emit({
            type: "admin_channel_change",
            repo: "__admin__",
            data: { channel, action: "upload", version: parsed.version },
          });
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, metadata }));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: message }));
      }
      return true;
    }

    // ── PUT /api/admin/channels/:channel/assign — reject invalid channel names
    const assignInvalidMatch = url.pathname.match(/^\/api\/admin\/channels\/([^/]+)\/assign$/);
    if (req.method === "PUT" && assignInvalidMatch && !["dev", "uat", "prod"].includes(assignInvalidMatch[1])) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Invalid channel "${assignInvalidMatch[1]}". Must be one of: dev, uat, prod` }));
      return true;
    }

    // ── PUT /api/admin/channels/:channel/assign — assign a registry version to a channel (Requirement 4.3, 9.3)
    const assignMatch = url.pathname.match(/^\/api\/admin\/channels\/(dev|uat|prod)\/assign$/);
    if (req.method === "PUT" && assignMatch) {
      const channel = assignMatch[1] as ChannelName;
      const body = await readBody(req);
      let parsed: { version: string };
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
        return true;
      }

      if (!parsed.version || typeof parsed.version !== "string") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing required field: version" }));
        return true;
      }

      if (!deps.bundleRegistry) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Bundle registry is not available (local store mode is not enabled)" }));
        return true;
      }

      if (deps.bundleRegistry.size === 0) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Bundle registry is empty — no bundles available to assign" }));
        return true;
      }

      const bundle = deps.bundleRegistry.get(parsed.version);
      if (!bundle) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Version "${parsed.version}" not found in bundle registry` }));
        return true;
      }

      try {
        await deps.installerChannelStore.setTarball(channel, bundle.tarball, parsed.version);

        // Update registry channel refs
        const allMetadata = await deps.installerChannelStore.getAllMetadata();
        const channelAssignments = new Map<ChannelName, string>();
        for (const [ch, meta] of allMetadata) {
          channelAssignments.set(ch, meta.version);
        }
        deps.bundleRegistry.updateChannelRefs(channelAssignments);

        if (deps.logger) {
          deps.logger.logConfigReloaded(`Channel ${channel} assigned to v${parsed.version} from bundle registry`);
        }
        if (deps.batonEventEmitter) {
          deps.batonEventEmitter.emit({
            type: "admin_channel_change",
            repo: "__admin__",
            data: { channel, action: "assign", version: parsed.version },
          });
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, channel, version: parsed.version }));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: message }));
      }
      return true;
    }

    // ── POST /api/admin/channels/promote (Requirements 4.5, 4.6)
    if (req.method === "POST" && url.pathname === "/api/admin/channels/promote") {
      const body = await readBody(req);
      let parsed: { source: string; destination: string };
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
        return true;
      }

      const source = parsed.source as ChannelName;
      const destination = parsed.destination as ChannelName;

      if (!VALID_CHANNELS.includes(source) || !VALID_CHANNELS.includes(destination)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid channel name. Must be one of: dev, uat, prod" }));
        return true;
      }

      try {
        const metadata = await deps.installerChannelStore.promote(source, destination);
        // Log SERVER entry (Requirement 4.6)
        if (deps.logger) {
          deps.logger.logConfigReloaded(`Channel promoted: ${source} → ${destination} (version: ${metadata.version})`);
        }
        // Emit admin_channel_change event (Requirement 10.3)
        if (deps.batonEventEmitter) {
          deps.batonEventEmitter.emit({
            type: "admin_channel_change",
            repo: "__admin__",
            data: { channel: destination, action: "promote", version: metadata.version },
          });
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, metadata }));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: message }));
      }
      return true;
    }

    // ── POST /api/admin/channels/rollback (Requirement 4.8)
    if (req.method === "POST" && url.pathname === "/api/admin/channels/rollback") {
      const body = await readBody(req);
      let parsed: { channel: string };
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
        return true;
      }

      const channel = parsed.channel as ChannelName;
      if (!VALID_CHANNELS.includes(channel)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid channel name. Must be one of: dev, uat, prod" }));
        return true;
      }

      try {
        const metadata = await deps.installerChannelStore.rollback(channel);
        if (deps.logger) {
          deps.logger.logConfigReloaded(`Channel rolled back: ${channel} to version ${metadata.version}`);
        }
        // Emit admin_channel_change event (Requirement 10.3)
        if (deps.batonEventEmitter) {
          deps.batonEventEmitter.emit({
            type: "admin_channel_change",
            repo: "__admin__",
            data: { channel, action: "rollback", version: metadata.version },
          });
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, metadata }));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: message }));
      }
      return true;
    }

    // ── GET /api/admin/users (Requirement 7.1)
    if (req.method === "GET" && url.pathname === "/api/admin/users") {
      if (!deps.getUsers) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ users: [] }));
        return true;
      }
      const users = await deps.getUsers();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ users }));
      return true;
    }

    // ── PUT /api/admin/users/:userId (Requirements 7.8, 7.9, 7.10)
    const usersMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (req.method === "PUT" && usersMatch) {
      const targetUserId = decodeURIComponent(usersMatch[1]);
      const body = await readBody(req);
      let parsed: { installerChannel?: string; admin?: boolean };
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
        return true;
      }

      // Check if user's admin status is env-sourced (Requirement 7.10)
      if (parsed.admin !== undefined) {
        const targetAdminList = deps.adminList ?? parseKonductorAdmins(process.env.KONDUCTOR_ADMINS);
        const targetInEnv = targetAdminList.includes(targetUserId.toLowerCase());
        if (targetInEnv) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Admin status is read-only (set by environment variable)" }));
          return true;
        }
      }

      if (!deps.updateUser) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "User management not available" }));
        return true;
      }

      const success = await deps.updateUser(targetUserId, parsed);
      if (!success) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `User "${targetUserId}" not found` }));
        return true;
      }

      // Emit admin_user_change event (Requirement 10.2)
      if (deps.batonEventEmitter) {
        deps.batonEventEmitter.emit({
          type: "admin_user_change",
          repo: "__admin__",
          data: { userId: targetUserId, changes: parsed as Record<string, unknown> },
        });
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true }));
      return true;
    }

    // ── GET /api/admin/install-commands (Requirements 5.1–5.4, 11.4)
    if (req.method === "GET" && url.pathname === "/api/admin/install-commands") {
      const externalUrl = process.env.KONDUCTOR_EXTERNAL_URL;
      const defaultChannel = (await deps.adminSettingsStore.get("defaultChannel") as ChannelName) ?? "prod";
      const data = buildInstallCommands(deps.port, deps.protocol, defaultChannel, externalUrl, deps.apiKey);
      // Include channel availability from the installer channel store
      // A channel is unavailable if it has no tarball OR if it's stale (zero-byte placeholder)
      const channelAvailability: Record<string, boolean> = {};
      for (const ch of VALID_CHANNELS) {
        const tarball = await deps.installerChannelStore.getTarball(ch);
        const metadata = await deps.installerChannelStore.getMetadata(ch);
        const isStale = metadata?.version?.startsWith("__stale__") ?? false;
        channelAvailability[ch] = tarball !== null && tarball.length > 0 && !isStale;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ...data, channelAvailability }));
      return true;
    }

    // ── POST /api/admin/bundles/rescan — trigger a rescan of the local store directory
    if (req.method === "POST" && url.pathname === "/api/admin/bundles/rescan") {
      if (!deps.bundleRegistry) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Bundle registry is not available (local store mode is not enabled)" }));
        return true;
      }

      try {
        const { added, removed } = await deps.bundleRegistry.rescan();
        if (deps.logger) {
          deps.logger.logConfigReloaded(
            `Bundle rescan: ${added.length} added, ${removed.length} removed` +
            (added.length > 0 ? ` — new: ${added.join(", ")}` : ""),
          );
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, added, removed }));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: message }));
      }
      return true;
    }

    // ── GET /api/admin/bundles — list all bundles in registry (Requirement 9.1)
    if (req.method === "GET" && url.pathname === "/api/admin/bundles") {
      if (!deps.bundleRegistry) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ bundles: [] }));
        return true;
      }
      const rawBundles = deps.bundleRegistry.list();
      // Map to API response shape per Requirement 9.1:
      // version, size, createdAt, author, summary, channels, hash
      const bundles = rawBundles.map((b) => ({
        version: b.version,
        size: b.fileSize,
        createdAt: b.createdAt,
        author: b.author,
        summary: b.summary,
        channels: b.channels,
        hash: b.hash,
      }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ bundles }));
      return true;
    }

    // ── DELETE /api/admin/bundles/:version — delete a bundle from registry (Requirement 9.2)
    const bundleDeleteMatch = url.pathname.match(/^\/api\/admin\/bundles\/(.+)$/);
    if (req.method === "DELETE" && bundleDeleteMatch) {
      const version = decodeURIComponent(bundleDeleteMatch[1]);

      if (!deps.bundleRegistry) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Bundle registry is not available (local store mode is not enabled)" }));
        return true;
      }

      if (!deps.bundleRegistry.has(version)) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Version "${version}" not found in bundle registry` }));
        return true;
      }

      try {
        const deleteFromDisk = process.env.KONDUCTOR_SERVE_CLIENT_BUNDLES_FROM_LOCAL_STORE === "true";
        const result = await deps.bundleRegistry.delete(version, deleteFromDisk);

        // If stale channels exist, clear them from InstallerChannelStore
        if (result.staleChannels.length > 0) {
          for (const channel of result.staleChannels) {
            // Mark channel as stale by removing its tarball entry
            // The channel store doesn't have a "clear" method, so we set a zero-byte placeholder
            // with a stale marker version
            await deps.installerChannelStore.setTarball(channel, Buffer.alloc(0), `__stale__:${version}`);
          }

          // Emit SSE events for each stale channel
          if (deps.batonEventEmitter) {
            for (const channel of result.staleChannels) {
              deps.batonEventEmitter.emit({
                type: "admin_channel_change",
                repo: "__admin__",
                data: { channel, action: "stale", deletedVersion: version },
              });
            }
          }
        }

        // Emit bundle_change event
        if (deps.batonEventEmitter) {
          deps.batonEventEmitter.emit({
            type: "bundle_change",
            repo: "__admin__",
            data: { action: "delete", version, staleChannels: result.staleChannels },
          });
        }

        if (deps.logger) {
          deps.logger.logConfigReloaded(
            `Bundle v${version} deleted from registry` +
            (result.staleChannels.length > 0 ? ` — channels now stale: ${result.staleChannels.join(", ")}` : ""),
          );
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, version, staleChannels: result.staleChannels }));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: message }));
      }
      return true;
    }

    // ── GET /api/admin/events — SSE stream (Requirements 10.1–10.4)
    if (req.method === "GET" && url.pathname === "/api/admin/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      res.write("data: {\"type\":\"connected\"}\n\n");

      if (deps.batonEventEmitter) {
        // Subscribe to all events (admin sees everything)
        const subscriptions: (() => void)[] = [];

        // We use a special "__admin__" channel for admin-specific events
        const unsubAdmin = deps.batonEventEmitter.subscribe("__admin__", (event) => {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        });
        subscriptions.push(unsubAdmin);

        req.on("close", () => {
          for (const unsub of subscriptions) {
            unsub();
          }
        });
      } else {
        // No event emitter — just keep connection open
        req.on("close", () => { /* cleanup */ });
      }
      return true;
    }

    // ── GET /api/admin/slack — global Slack auth status (Requirements 11.5, 6.1)
    if (req.method === "GET" && url.pathname === "/api/admin/slack") {
      if (!deps.slackSettingsManager) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ configured: false, source: "none", authMode: "bot_token" }));
        return true;
      }
      try {
        const token = await deps.slackSettingsManager.getBotToken();
        const source = process.env.SLACK_BOT_TOKEN ? "env" : "database";
        if (!token) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ configured: false, source: "none", authMode: "bot_token" }));
          return true;
        }
        const status = await deps.slackSettingsManager.getGlobalStatus();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          configured: status.configured,
          source,
          team: status.team,
          botUser: status.botUser,
          authMode: "bot_token",
        }));
      } catch {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to get Slack status" }));
      }
      return true;
    }

    // ── PUT /api/admin/slack — update bot token or OAuth credentials (Requirements 11.6, 6.2, 6.4, 6.5)
    if (req.method === "PUT" && url.pathname === "/api/admin/slack") {
      if (!deps.slackSettingsManager || !deps.slackNotifier) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Slack integration not available" }));
        return true;
      }

      const body = await readBody(req);
      let parsed: { botToken?: string; oauthClientId?: string; oauthClientSecret?: string };
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
        return true;
      }

      // Check if env var is set (read-only)
      if (process.env.SLACK_BOT_TOKEN) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Bot token is set via SLACK_BOT_TOKEN environment variable (read-only). Remove the env var to configure via dashboard." }));
        return true;
      }

      if (parsed.botToken) {
        // Validate token via auth.test (Requirement 6.4)
        try {
          // Temporarily store the token to validate
          await deps.slackSettingsManager.setBotToken(parsed.botToken);
          const validation = await deps.slackNotifier.validateToken();
          if (!validation.ok) {
            // Revert — clear the invalid token
            await deps.adminSettingsStore.set("slack:bot_token", "", "slack");
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `Token validation failed: ${validation.error}` }));
            return true;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: true,
            configured: true,
            team: validation.team,
            botUser: validation.botUser,
          }));
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: message }));
        }
        return true;
      }

      if (parsed.oauthClientId && parsed.oauthClientSecret) {
        // Store OAuth credentials (Requirement 6.9)
        try {
          await deps.adminSettingsStore.set("slack:oauth_client_id", parsed.oauthClientId, "slack");
          await deps.adminSettingsStore.set("slack:oauth_client_secret", parsed.oauthClientSecret, "slack");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, message: "OAuth credentials stored" }));
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: message }));
        }
        return true;
      }

      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Must provide botToken or oauthClientId + oauthClientSecret" }));
      return true;
    }

    // ── POST /api/admin/slack/test — send test message (Requirement 6.10)
    if (req.method === "POST" && url.pathname === "/api/admin/slack/test") {
      if (!deps.slackNotifier) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Slack integration not available" }));
        return true;
      }

      const body = await readBody(req);
      let parsed: { channel: string };
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
        return true;
      }

      if (!parsed.channel) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "channel is required" }));
        return true;
      }

      const result = await deps.slackNotifier.sendTestMessage(parsed.channel);
      if (result.ok) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
      } else {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: result.error ?? "Failed to send test message" }));
      }
      return true;
    }

    // Unmatched /api/admin/* route
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
    return true;
  }

  // Not an admin route
  return false;
}
