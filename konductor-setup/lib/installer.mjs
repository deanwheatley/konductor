/**
 * Core installer logic — global and workspace setup.
 * Replicates the exact behavior of install.sh / install.ps1 in pure Node.js.
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  chmodSync,
  rmSync,
} from "node:fs";
import { resolve, join, dirname } from "node:path";
import { homedir, hostname } from "node:os";
import { execSync } from "node:child_process";
import { killExistingWatcher, launchWatcher } from "./platform.mjs";
import { updateGitignore } from "./workspace.mjs";

/**
 * Detect the username for the X-Konductor-User header.
 * Priority: gh api user → git config user.name → hostname
 * @returns {string}
 */
export function detectUsername() {
  // Try GitHub CLI
  try {
    const ghUser = execSync("gh api user --jq .login", {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    })
      .toString()
      .trim();
    if (ghUser) return ghUser;
  } catch {
    // gh not available or failed
  }

  // Try git config
  try {
    const gitUser = execSync("git config user.name", {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 3000,
    })
      .toString()
      .trim();
    if (gitUser) return gitUser;
  } catch {
    // git not available or no user.name set
  }

  // Fallback to hostname
  try {
    return hostname() || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * The MCP config template for a fresh install.
 * Matches the structure in bundle/kiro/settings/mcp.json.
 */
function buildKonductorMcpEntry(serverUrl, apiKey, username) {
  // Kiro requires MCP SSE URLs to be https or localhost (http).
  // For HTTPS servers: use http://localhost on port+1 (HTTP fallback port)
  //   because Kiro's Electron runtime doesn't trust mkcert CAs.
  // For HTTP servers: use localhost directly.
  let sseUrl;
  try {
    const parsed = new URL(serverUrl);
    if (parsed.protocol === "https:") {
      const httpPort = parseInt(parsed.port || "3010", 10) + 1;
      sseUrl = `http://localhost:${httpPort}/sse`;
    } else {
      sseUrl = `http://localhost:${parsed.port || "3010"}/sse`;
    }
  } catch {
    sseUrl = "http://localhost:3010/sse";
  }
  return {
    url: sseUrl,
    headers: {
      Authorization: `Bearer ${apiKey || "YOUR_API_KEY"}`,
      "X-Konductor-User": username,
    },
    autoApprove: [
      "register_session",
      "check_status",
      "deregister_session",
      "list_sessions",
      "who_is_active",
      "who_overlaps",
      "user_activity",
      "risk_assessment",
      "repo_hotspots",
      "active_branches",
      "coordination_advice",
      "client_install_info",
      "client_update_check",
    ],
  };
}

/**
 * Read and parse a JSON file. Returns null if the file doesn't exist or is invalid.
 * @param {string} filePath
 * @returns {object|null}
 */
function readJsonSafe(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Write a JSON object to a file, creating parent directories as needed.
 * @param {string} filePath
 * @param {object} data
 */
function writeJson(filePath, data) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/**
 * Copy a file from bundleDir to destPath, creating parent directories as needed.
 * @param {string} bundleDir
 * @param {string} relativePath - path relative to bundleDir
 * @param {string} destPath - absolute destination path
 */
function deployFile(bundleDir, relativePath, destPath) {
  const src = resolve(bundleDir, relativePath);
  if (!existsSync(src)) {
    console.warn(`  ⚠️  Bundle file not found: ${relativePath}`);
    return false;
  }
  mkdirSync(dirname(destPath), { recursive: true });
  copyFileSync(src, destPath);
  return true;
}

/**
 * Perform global setup: MCP config, global steering rule, global agent rule.
 * Matches the "Global setup" section of install.sh.
 *
 * @param {string} bundleDir - absolute path to the bundle directory
 * @param {string} [apiKey] - API key to write; if omitted, preserves existing or writes placeholder
 */
export async function installGlobal(bundleDir, apiKey, serverUrl) {
  const home = homedir();
  const effectiveServerUrl = serverUrl || "http://localhost:3010";
  console.log("Global setup:");

  // Clean previous install artifacts
  console.log("  Cleaning previous install...");
  const globalSteeringPath = resolve(home, ".kiro", "steering", "konductor-collision-awareness.md");
  const globalAgentPath = resolve(home, ".gemini", "konductor-collision-awareness.md");
  try { rmSync(globalSteeringPath, { force: true }); } catch { /* ok */ }
  try { rmSync(globalAgentPath, { force: true }); } catch { /* ok */ }

  // Detect username
  const username = detectUsername();

  // MCP config — merge or create
  const mcpConfigPath = resolve(home, ".kiro", "settings", "mcp.json");

  if (existsSync(mcpConfigPath)) {
    const cfg = readJsonSafe(mcpConfigPath);
    if (cfg) {
      cfg.mcpServers = cfg.mcpServers || {};

      // Determine the API key to use
      let keyToWrite;
      if (apiKey) {
        // Explicit --api-key flag always wins
        keyToWrite = apiKey;
      } else if (
        cfg.mcpServers.konductor &&
        cfg.mcpServers.konductor.headers &&
        cfg.mcpServers.konductor.headers.Authorization
      ) {
        // Preserve existing non-placeholder key
        const existing = cfg.mcpServers.konductor.headers.Authorization;
        const existingKey = existing.replace(/^Bearer\s+/, "");
        keyToWrite = existingKey !== "YOUR_API_KEY" ? existingKey : undefined;
      }

      cfg.mcpServers.konductor = buildKonductorMcpEntry(effectiveServerUrl, keyToWrite, username);
      writeJson(mcpConfigPath, cfg);
      console.log(`  ✅ MCP config updated (user: ${username})`);
    } else {
      console.warn("  ⚠️  Could not parse existing MCP config — overwriting");
      writeJson(mcpConfigPath, {
        mcpServers: { konductor: buildKonductorMcpEntry(effectiveServerUrl, apiKey, username) },
      });
      console.log(`  ✅ MCP config created (user: ${username})`);
    }
  } else {
    // No existing config — create from scratch
    writeJson(mcpConfigPath, {
      mcpServers: { konductor: buildKonductorMcpEntry(effectiveServerUrl, apiKey, username) },
    });
    console.log(`  ✅ MCP config installed (user: ${username})`);
  }

  if (!apiKey) {
    console.log("     Edit ~/.kiro/settings/mcp.json to set your API key.");
  }

  // Global steering rule
  const steeringDest = resolve(home, ".kiro", "steering", "konductor-collision-awareness.md");
  if (deployFile(bundleDir, "kiro/steering/konductor-collision-awareness.md", steeringDest)) {
    console.log("  ✅ Kiro global steering rule installed");
  }

  // Global agent rule (Antigravity / Gemini)
  const agentDest = resolve(home, ".gemini", "konductor-collision-awareness.md");
  if (deployFile(bundleDir, "agent/rules/konductor-collision-awareness.md", agentDest)) {
    console.log("  ✅ Antigravity global rule installed");
  }

  console.log("");
}

/** Default .konductor-watcher.env content — matches install.sh exactly. */
const DEFAULT_WATCHER_ENV = `# Konductor Watcher Configuration
# Server URL and API key are read from mcp.json automatically.
# Only watcher-specific settings go here.

KONDUCTOR_LOG_LEVEL=info
KONDUCTOR_POLL_INTERVAL=10
KONDUCTOR_LOG_FILE=.konductor-watcher.log
# KONDUCTOR_USER=
# KONDUCTOR_REPO=
# KONDUCTOR_BRANCH=

# Log rotation: max log file size before rotation (default: 10MB).
# Supports KB, MB, GB suffixes. Rotation keeps at most 3 files:
# current, .backup, .tobedeleted
# KONDUCTOR_LOG_MAX_SIZE=10MB

# File filtering: by default, watches ALL files not in .gitignore.
# Set this to restrict to specific extensions (comma-separated, no dots).
# Leave empty or commented to watch everything git tracks.
# KONDUCTOR_WATCH_EXTENSIONS=
`;

/** Files to clean from workspace before deploying (matching install.sh). */
const WORKSPACE_CLEANUP_FILES = [
  ".kiro/steering/konductor-collision-awareness.md",
  ".kiro/hooks/konductor-file-save.hook.md",
  ".kiro/hooks/konductor-session-start.hook.md",
  ".agent/rules/konductor-collision-awareness.md",
  "konductor-watcher.mjs",
  "konductor-watcher-launcher.sh",
  "konductor-watchdog.sh",
  ".konductor-watcher.log",
  ".konductor-watcher.pid",
];

/**
 * Perform workspace setup: deploy steering rules, hooks, agent rules,
 * watcher + launcher + watchdog, create env file, update .gitignore, launch watcher.
 * Matches the "Workspace setup" section of install.sh.
 *
 * @param {string} bundleDir - absolute path to the bundle directory
 * @param {string} workspaceRoot - absolute path to the workspace root
 * @param {string} version - bundle version to write to .konductor-version
 */
export async function installWorkspace(bundleDir, workspaceRoot, version, serverUrl, apiKey) {
  console.log(`Workspace setup (root: ${workspaceRoot}):`);

  // Clean previous install
  console.log("  Cleaning previous install...");
  killExistingWatcher(workspaceRoot);

  for (const relPath of WORKSPACE_CLEANUP_FILES) {
    const fullPath = resolve(workspaceRoot, relPath);
    try { rmSync(fullPath, { force: true }); } catch { /* ok */ }
  }

  // Deploy steering rule
  const steeringDest = resolve(workspaceRoot, ".kiro", "steering", "konductor-collision-awareness.md");
  if (deployFile(bundleDir, "kiro/steering/konductor-collision-awareness.md", steeringDest)) {
    console.log("  ✅ Kiro steering rule installed");
  }

  // Deploy hooks
  const hooksDest = resolve(workspaceRoot, ".kiro", "hooks");
  mkdirSync(hooksDest, { recursive: true });
  deployFile(bundleDir, "kiro/hooks/konductor-file-save.hook.md",
    resolve(hooksDest, "konductor-file-save.hook.md"));
  deployFile(bundleDir, "kiro/hooks/konductor-session-start.hook.md",
    resolve(hooksDest, "konductor-session-start.hook.md"));
  console.log("  ✅ Kiro hooks installed");

  // Deploy agent rules
  const agentDest = resolve(workspaceRoot, ".agent", "rules", "konductor-collision-awareness.md");
  if (deployFile(bundleDir, "agent/rules/konductor-collision-awareness.md", agentDest)) {
    console.log("  ✅ Antigravity workspace rule installed");
    console.log("     ℹ️  Antigravity limitation: the file watcher and MCP server won't auto-start on project open.");
    console.log("        Send a message in chat to trigger the agent rule, or run: node konductor-watcher.mjs &");
  }

  // Deploy watcher + launcher + watchdog
  const watcherDest = resolve(workspaceRoot, "konductor-watcher.mjs");
  const launcherDest = resolve(workspaceRoot, "konductor-watcher-launcher.sh");
  const watchdogDest = resolve(workspaceRoot, "konductor-watchdog.sh");

  deployFile(bundleDir, "konductor-watcher.mjs", watcherDest);
  deployFile(bundleDir, "konductor-watcher-launcher.sh", launcherDest);
  deployFile(bundleDir, "konductor-watchdog.sh", watchdogDest);

  // Make shell scripts executable on non-Windows
  if (process.platform !== "win32") {
    try { chmodSync(launcherDest, 0o755); } catch { /* ok */ }
    try { chmodSync(watchdogDest, 0o755); } catch { /* ok */ }
  }
  console.log("  ✅ File watcher installed");

  // Create .konductor-watcher.env if missing (preserve if exists)
  // Always update KONDUCTOR_USER to the detected username
  const envPath = resolve(workspaceRoot, ".konductor-watcher.env");
  const detectedUser = detectUsername();
  const effectiveUrl = serverUrl || "http://localhost:3010";
  // For HTTPS servers, the watcher uses the HTTP fallback port (port+1)
  // because Node's fetch rejects self-signed/mkcert certs
  let watcherUrl = effectiveUrl;
  try {
    const parsed = new URL(effectiveUrl);
    if (parsed.protocol === "https:") {
      const httpPort = parseInt(parsed.port || "3010", 10) + 1;
      watcherUrl = `http://${parsed.hostname}:${httpPort}`;
    }
  } catch { /* use as-is */ }
  if (!existsSync(envPath)) {
    let envContent = DEFAULT_WATCHER_ENV.replace(
      "# KONDUCTOR_USER=",
      `KONDUCTOR_USER=${detectedUser}`,
    );
    // Add server URL so the watcher uses it for REST API calls
    envContent = `KONDUCTOR_URL=${watcherUrl}\n${envContent}`;
    writeFileSync(envPath, envContent, "utf-8");
    console.log(`  ✅ Watcher config created (.konductor-watcher.env) — user: ${detectedUser}`);
  } else {
    // Preserve the file but update the username and server URL
    let envContent = readFileSync(envPath, "utf-8");
    if (envContent.match(/^KONDUCTOR_USER\s*=.*$/m)) {
      envContent = envContent.replace(/^KONDUCTOR_USER\s*=.*$/m, `KONDUCTOR_USER=${detectedUser}`);
    } else if (envContent.match(/^#\s*KONDUCTOR_USER\s*=/m)) {
      envContent = envContent.replace(/^#\s*KONDUCTOR_USER\s*=.*$/m, `KONDUCTOR_USER=${detectedUser}`);
    }
    // Update or add KONDUCTOR_URL
    if (envContent.match(/^KONDUCTOR_URL\s*=.*$/m)) {
      envContent = envContent.replace(/^KONDUCTOR_URL\s*=.*$/m, `KONDUCTOR_URL=${watcherUrl}`);
    } else {
      envContent = `KONDUCTOR_URL=${watcherUrl}\n${envContent}`;
    }
    writeFileSync(envPath, envContent, "utf-8");
    console.log(`  ✅ Watcher config updated — user: ${detectedUser}, server: ${effectiveUrl}`);
  }

  // Update workspace MCP config (.kiro/settings/mcp.json)
  // This takes precedence over the global config, so we must ensure it has
  // the correct server URL, API key, and is not disabled.
  const effectiveServerUrl = serverUrl || "http://localhost:3010";
  const wsMcpPath = resolve(workspaceRoot, ".kiro", "settings", "mcp.json");
  const wsCfg = readJsonSafe(wsMcpPath) || { mcpServers: {} };
  wsCfg.mcpServers = wsCfg.mcpServers || {};

  // Determine API key: explicit flag > existing workspace key > existing global key > placeholder
  let wsKey = apiKey;
  if (!wsKey && wsCfg.mcpServers.konductor?.headers?.Authorization) {
    const existing = wsCfg.mcpServers.konductor.headers.Authorization.replace(/^Bearer\s+/, "");
    if (existing !== "YOUR_API_KEY") wsKey = existing;
  }

  let sseUrl;
  try {
    const parsed = new URL(effectiveServerUrl);
    if (parsed.protocol === "https:") {
      const httpPort = parseInt(parsed.port || "3010", 10) + 1;
      sseUrl = `http://localhost:${httpPort}/sse`;
    } else {
      sseUrl = `http://localhost:${parsed.port || "3010"}/sse`;
    }
  } catch {
    sseUrl = "http://localhost:3010/sse";
  }
  const username = detectUsername();
  wsCfg.mcpServers.konductor = {
    url: sseUrl,
    headers: {
      Authorization: `Bearer ${wsKey || "YOUR_API_KEY"}`,
      "X-Konductor-User": username,
    },
    autoApprove: [
      "register_session", "check_status", "deregister_session", "list_sessions",
      "who_is_active", "who_overlaps", "user_activity", "risk_assessment",
      "repo_hotspots", "active_branches", "coordination_advice",
      "client_install_info", "client_update_check",
    ],
  };
  writeJson(wsMcpPath, wsCfg);
  console.log(`  ✅ Workspace MCP config updated (${sseUrl})`);

  // Update .gitignore
  const added = updateGitignore(workspaceRoot);
  if (added > 0) {
    console.log(`  ✅ Added ${added} Konductor entries to .gitignore`);
  } else {
    console.log("  ⏭  .gitignore already has Konductor entries");
  }

  // Write .konductor-version
  const versionPath = resolve(workspaceRoot, ".konductor-version");
  writeFileSync(versionPath, version + "\n", "utf-8");
  console.log(`  ✅ Version file written (v${version})`);

  // Launch watcher
  const { pid } = launchWatcher(workspaceRoot);
  if (pid) {
    console.log(`  ✅ File watcher launched (PID: ${pid})`);
  }

  console.log("");
}

/**
 * Detect install mode based on existing global config.
 * If ~/.kiro/settings/mcp.json has a konductor entry, return "workspace" (global already done).
 * Otherwise return "both".
 *
 * @returns {"workspace" | "both"}
 */
export function detectMode() {
  const mcpConfigPath = resolve(homedir(), ".kiro", "settings", "mcp.json");
  const cfg = readJsonSafe(mcpConfigPath);

  if (cfg && cfg.mcpServers && cfg.mcpServers.konductor) {
    console.log("  Global config detected — running workspace setup only");
    return "workspace";
  }

  return "both";
}

/**
 * Compare two semver strings. Returns:
 *   -1 if a < b
 *    0 if a === b
 *    1 if a > b
 * @param {string} a
 * @param {string} b
 * @returns {-1 | 0 | 1}
 */
function compareSemver(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

/**
 * Check if an update is available by comparing the local .konductor-version
 * against the server's bundle manifest version.
 *
 * @param {string} serverUrl
 * @param {string} workspaceRoot
 */
export async function checkUpdate(serverUrl, workspaceRoot) {
  // Read local version
  const versionPath = resolve(workspaceRoot, ".konductor-version");
  let localVersion = null;
  try {
    localVersion = readFileSync(versionPath, "utf-8").trim();
  } catch {
    // File doesn't exist
  }

  if (!localVersion) {
    console.log("No .konductor-version file found — Konductor may not be installed in this workspace.");
    console.log('Run "npx konductor-setup" to install.');
    return;
  }

  // Fetch server manifest
  const { fetchBundle } = await import("./bundle-fetcher.mjs");
  const base = serverUrl.replace(/\/+$/, "");

  let serverVersion;
  try {
    // We only need the manifest, not the full download
    const http = await import(base.startsWith("https") ? "node:https" : "node:http");
    const res = await new Promise((resolve, reject) => {
      const client = http.default || http;
      const req = client.get(`${base}/bundle/manifest.json`, { timeout: 5000, rejectUnauthorized: false }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      });
      req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
      req.on("error", reject);
    });

    if (res.statusCode !== 200) {
      console.log(`Server returned ${res.statusCode} — cannot check for updates.`);
      return;
    }

    const manifest = JSON.parse(res.body.toString("utf-8"));
    serverVersion = manifest.version;
  } catch (err) {
    console.log(`Could not reach server (${err.message}) — cannot check for updates.`);
    return;
  }

  const cmp = compareSemver(localVersion, serverVersion);
  if (cmp < 0) {
    console.log(`Update available: v${localVersion} → v${serverVersion}`);
    console.log('Run "npx konductor-setup@latest --workspace" to update.');
  } else if (cmp === 0) {
    console.log(`Up to date (v${localVersion})`);
  } else {
    console.log(`Local version (v${localVersion}) is newer than server (v${serverVersion})`);
  }
}
