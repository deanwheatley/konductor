#!/usr/bin/env node
/**
 * konductor-watcher — Cross-platform file watcher + collision monitor.
 *
 * Reads server URL and API key from mcp.json (same config the IDE uses).
 * Reads watcher-specific settings from .konductor-watcher.env.
 * Auto-opens a terminal window if not running in one.
 * Watches config files for changes and hot-reloads.
 */
import { watch, readFileSync, existsSync, writeFileSync, appendFileSync, statSync } from "node:fs";
import { execSync, spawn } from "node:child_process";
import { resolve, extname, join, basename } from "node:path";
import { homedir, platform } from "node:os";

// ── Self-launch into terminal if not in a TTY ──────────────────────
// The watcher runs in whatever process spawned it (IDE terminal, hook,
// or manual shell). No self-launch into a separate terminal window —
// that breaks IDE terminal integration.

// ── Config loading ──────────────────────────────────────────────────

const ENV_PATH = resolve(".konductor-watcher.env");
const MCP_PATHS = [
  resolve(".kiro", "settings", "mcp.json"),
  join(homedir(), ".kiro", "settings", "mcp.json"),
];

function loadEnvVars() {
  const vars = {};
  if (!existsSync(ENV_PATH)) return vars;
  for (const line of readFileSync(ENV_PATH, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    vars[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return vars;
}

function loadMcpConfig() {
  for (const p of MCP_PATHS) {
    if (!existsSync(p)) continue;
    try {
      const cfg = JSON.parse(readFileSync(p, "utf-8"));
      const k = cfg?.mcpServers?.konductor;
      if (k) {
        const url = k.url ? k.url.replace(/\/sse$/, "") : "";
        const auth = k.headers?.Authorization || "";
        const apiKey = auth.replace(/^Bearer\s+/i, "");
        return { url, apiKey, path: p };
      }
    } catch {}
  }
  return { url: "", apiKey: "", path: "" };
}

function loadConfig() {
  const env = loadEnvVars();
  const mcp = loadMcpConfig();
  return {
    url: env.KONDUCTOR_URL || mcp.url || "http://localhost:3010",
    apiKey: env.KONDUCTOR_API_KEY || mcp.apiKey || "",
    logLevel: env.KONDUCTOR_LOG_LEVEL || "info",
    pollInterval: parseInt(env.KONDUCTOR_POLL_INTERVAL || "10", 10) * 1000,
    logFile: env.KONDUCTOR_LOG_FILE ? resolve(env.KONDUCTOR_LOG_FILE) : "",
    terminalLogging: (env.KONDUCTOR_LOG_TO_TERMINAL || env.KONDUCTOR_TERMINAL_LOGGING || "true").toLowerCase() !== "false",
    watchExtensions: new Set(
      (env.KONDUCTOR_WATCH_EXTENSIONS || "")
        .split(",").filter(e => e.trim()).map(e => `.${e.trim()}`),
    ),
    mcpPath: mcp.path,
  };
}

let CFG = loadConfig();

// ── Git context ─────────────────────────────────────────────────────

function git(cmd) {
  try { return execSync(cmd, { encoding: "utf-8", stdio: ["pipe","pipe","pipe"] }).trim(); } catch { return ""; }
}

// Load env for user override
const envVars = loadEnvVars();
const USER_ID = envVars.KONDUCTOR_USER || process.env.KONDUCTOR_USER || (() => {
  const gh = git("gh api user --jq .login"); if (gh) return gh;
  const g = git("git config user.name"); if (g) return g;
  try { return execSync("hostname", { encoding: "utf-8", stdio: ["pipe","pipe","pipe"] }).trim(); } catch { return "unknown"; }
})();

// Persist resolved userId
if (!envVars.KONDUCTOR_USER && !process.env.KONDUCTOR_USER && USER_ID !== "unknown" && existsSync(ENV_PATH)) {
  try {
    let c = readFileSync(ENV_PATH, "utf-8");
    if (c.match(/^#\s*KONDUCTOR_USER\s*=/m)) c = c.replace(/^#\s*KONDUCTOR_USER\s*=.*$/m, `KONDUCTOR_USER=${USER_ID}`);
    else if (c.match(/^KONDUCTOR_USER\s*=\s*$/m)) c = c.replace(/^KONDUCTOR_USER\s*=\s*$/m, `KONDUCTOR_USER=${USER_ID}`);
    writeFileSync(ENV_PATH, c);
  } catch {}
}

const REPO = envVars.KONDUCTOR_REPO || process.env.KONDUCTOR_REPO || (() => { const u = git("git remote get-url origin"); const m = u.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/); return m ? m[1] : "unknown/unknown"; })();
const BRANCH = envVars.KONDUCTOR_BRANCH || process.env.KONDUCTOR_BRANCH || git("git branch --show-current") || "unknown";
const REPO_SHORT = REPO.split("/").pop() || REPO;

// ── Client version ──────────────────────────────────────────────────

const VERSION_PATH = resolve(".konductor-version");
let CLIENT_VERSION = "";
try {
  if (existsSync(VERSION_PATH)) CLIENT_VERSION = readFileSync(VERSION_PATH, "utf-8").trim();
} catch {}

// ── ANSI + Logging ──────────────────────────────────────────────────

const R="\x1b[0m",B="\x1b[1m",D="\x1b[2m",FW="\x1b[97m",FG="\x1b[32m",FY="\x1b[33m",FR="\x1b[31m",FC="\x1b[36m",FGR="\x1b[90m";
const BGG="\x1b[42m",BGY="\x1b[43m",BGO="\x1b[48;5;208m",BGR="\x1b[41m";

function stripAnsi(s) { return s.replace(/\x1b\[[0-9;]*m/g, ""); }
function localTs() {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function log(m) {
  if (CFG.terminalLogging) process.stdout.write(m + "\n");
  if (CFG.logFile) {
    try { appendFileSync(CFG.logFile, `${localTs()} ${stripAnsi(m)}\n`); } catch {}
  }
}
function debug(m) { if (CFG.logLevel === "debug") log(`${FGR}[DEBUG] ${m}${R}`); }
function sep() { log(`${D}────────────────────────────────────────────────${R}`); }

// ── Config file watching ────────────────────────────────────────────

function watchConfigFiles() {
  const filesToWatch = [ENV_PATH, ...MCP_PATHS].filter(existsSync);
  for (const f of filesToWatch) {
    try {
      let lastMtime = statSync(f).mtimeMs;
      watch(f, () => {
        try {
          const newMtime = statSync(f).mtimeMs;
          if (newMtime === lastMtime) return;
          lastMtime = newMtime;

          const oldUrl = CFG.url, oldKey = CFG.apiKey;
          CFG = loadConfig();
          const name = basename(f);

          if (oldUrl !== CFG.url || oldKey !== CFG.apiKey) {
            log(""); log(`${BGY}${FW}${B} 🔄 CONFIG CHANGED ${R} ${name} updated — reconnecting with new settings.`);
            log(`  ${FY}Server:${R} ${CFG.url}`);
            log(`  ${FY}API key:${R} ${CFG.apiKey ? "****" + CFG.apiKey.slice(-4) : "(not set)"}`);
            sep();
            serverConnected = true; disconnectWarningShown = false;
          } else {
            log(""); log(`${FG}🔄 Config updated:${R} ${name} — changes applied.`); sep();
          }
        } catch {}
      });
    } catch {}
  }
}

// ── API + State ─────────────────────────────────────────────────────

let sessionId = "", lastStateSig = "", serverConnected = true, disconnectWarningShown = false;
let updateAttempted = false;

async function runAutoUpdate(serverVersion) {
  if (updateAttempted) return;
  updateAttempted = true;

  const tgzUrl = `${CFG.url}/bundle/installer-${serverVersion}.tgz`;
  log(""); log(`${BGY}${FW}${B} 🔄 UPDATING ${R} Konductor client v${CLIENT_VERSION || "unknown"} → v${serverVersion}`);
  log(`  ${FY}Running:${R} npx --yes ${tgzUrl} --workspace --server ${CFG.url}`);
  sep();

  try {
    const output = execSync(`npx --yes ${tgzUrl} --workspace --server ${CFG.url}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 60000,
    });
    debug(`Update output: ${output}`);

    // Re-read version file
    try {
      if (existsSync(VERSION_PATH)) CLIENT_VERSION = readFileSync(VERSION_PATH, "utf-8").trim();
    } catch {}

    log(""); log(`${BGG}${FW}${B} ✅ UPDATED ${R} Konductor client is now v${CLIENT_VERSION || serverVersion}`);
    sep();
  } catch (e) {
    debug(`Update failed: ${e.message}`);
    log(""); log(`${BGR}${FW}${B} ⚠️  UPDATE FAILED ${R} Could not auto-update Konductor client.`);
    log(`  ${FR}Run manually:${R} npx ${tgzUrl} --workspace --server ${CFG.url}`);
    sep();
  }
}

async function api(endpoint, body) {
  debug(`POST ${CFG.url}${endpoint}`);
  const headers = { "Content-Type": "application/json" };
  if (CFG.apiKey) headers["Authorization"] = `Bearer ${CFG.apiKey}`;
  if (CLIENT_VERSION) headers["X-Konductor-Client-Version"] = CLIENT_VERSION;
  try {
    const res = await fetch(`${CFG.url}${endpoint}`, { method: "POST", headers, body: JSON.stringify(body) });
    const data = await res.json();
    debug(`Response: ${JSON.stringify(data)}`);
    if (!serverConnected) { serverConnected = true; disconnectWarningShown = false; log(""); log(`${BGG}${FW}${B} 🟢 RECONNECTED ${R} Konductor server is back online.`); sep(); }
    if (data.updateRequired && data.serverVersion && !updateAttempted) {
      await runAutoUpdate(data.serverVersion);
    }
    return data;
  } catch (e) { debug(`Error: ${e.message}`); serverConnected = false; return { error: "connection failed" }; }
}

// ── Notification formatting ─────────────────────────────────────────

function rel(f) { return `./${f.replace(/^\.\//, "")}`; }

function userBlock(s, color) {
  log(`  ${color}User: ${B}${s.userId}${R}${color} on ${REPO_SHORT}/${s.branch || "unknown"}${R}`);
  log(`  ${color}Files: ${R}${(s.files || []).map(rel).join(", ")}`);
}

function notify(state, sessions, shared, files) {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  const ts = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  const others = sessions.filter(s => s.userId !== USER_ID);
  const names = others.map(s => s.userId).join(", ") || "none";
  const sf = shared.length ? shared.map(rel).join(", ") : "none";
  const ctx = `${REPO_SHORT}/${BRANCH}`;
  const printUpdated = (c) => { for (const f of files) log(`  ${c}You updated:${R} ${rel(f)}`); };

  switch (state) {
    case "solo":
      log(""); log(`${BGG}${FW}${B} 🟢 SOLO ${R} on ${B}${ctx}${R} — ${FG}"No other users active."${R}  ${D}${ts}${R}`);
      printUpdated(FG); sep(); break;
    case "neighbors":
      log(""); log(`${BGG}${FW}${B} 🟢 NEIGHBORS ${R} on ${B}${ctx}${R} — ${FG}"${names} also in repo, different files."${R}  ${D}${ts}${R}`);
      printUpdated(FG); for (const s of others) userBlock(s, FG); sep(); break;
    case "crossroads":
      log(""); log(`${BGY}${FW}${B} 🟡 CROSSROADS ${R} on ${B}${ctx}${R} — ${FY}"${names} in same directories."${R}  ${D}${ts}${R}`);
      printUpdated(FY); for (const s of others) userBlock(s, FY); sep(); break;
    case "collision_course":
      log(""); log(`${BGO}${FW}${B} 🟠 COLLISION COURSE ${R} on ${B}${ctx}${R} — ${FY}"${names} modifying same files."${R}  ${D}${ts}${R}`);
      printUpdated(FY); log(`  ${B}${FY}Shared files:${R} ${sf}`); log(`  ${B}${FY}⚠️  Coordinate with your team.${R}`);
      log(`${D}  ──────────────────────────────────────${R}`);
      for (const s of others) { userBlock(s, FY); log(`${D}  ──────────────────────────────────────${R}`); } sep(); break;
    case "merge_hell":
      log(""); log(`${BGR}${FW}${B} 🔴 MERGE HELL ${R} on ${B}${ctx}${R} — ${FR}"Divergent changes with ${names}."${R}  ${D}${ts}${R}`);
      printUpdated(FR); log(`  ${B}${FR}Conflicting files:${R} ${sf}`); log(`  ${BGR}${FW}${B} ⛔ CRITICAL — Coordinate immediately: ${R}`);
      log(`${D}  ──────────────────────────────────────${R}`);
      for (const s of others) { userBlock(s, FR); log(`${D}  ──────────────────────────────────────${R}`); } sep(); break;
    case "none": debug("No active session."); break;
    default: log(`${FG}🟢 State: ${state}${R}`); sep();
  }
}

// ── Check + Register ────────────────────────────────────────────────

async function checkAndNotify(regState, changedFiles) {
  const res = await api("/api/status", { userId: USER_ID, repo: REPO });
  if (res.error) { debug(`Status error: ${res.error}`); return; }
  const state = res.collisionState || regState || "none";
  const sessions = (res.overlappingSessions || []).filter(s => s.userId !== USER_ID);
  const shared = res.sharedFiles || [];
  const sig = `${state}:${sessions.map(s => `${s.userId}:${s.branch}:${s.files.join(",")}`).join(";")}`;
  if (sig !== lastStateSig || changedFiles.length > 0) { lastStateSig = sig; notify(state, res.overlappingSessions || [], shared, changedFiles); }
}

async function registerFiles(files) {
  if (!files.length) return;
  const res = await api("/api/register", { userId: USER_ID, repo: REPO, branch: BRANCH, files });
  if (res.error) {
    const fl = files.map(rel).join(", ");
    if (!disconnectWarningShown) {
      const reason = !serverConnected ? `server not reachable at ${CFG.url}` : res.error;
      log(""); log(`${BGR}${FW}${B} ⚠️  DISCONNECTED ${R} ${reason}`);
      log(`  ${FR}Collision awareness is OFFLINE. Your changes are NOT being tracked.${R}`);
      log(`  ${FR}Untracked:${R} ${fl}`); log(`  ${D}Will notify when server is back.${R}`); sep();
      disconnectWarningShown = true;
    } else { log(`  ${FR}⚠️  Still disconnected.${R} Untracked: ${fl}`); }
    return;
  }
  // Clear disconnected state on success
  if (disconnectWarningShown) {
    disconnectWarningShown = false;
    log(""); log(`${BGG}${FW}${B} 🟢 RECONNECTED ${R} Konductor is back online.`); sep();
  }
  sessionId = res.sessionId || sessionId;
  await checkAndNotify(res.collisionState, files);
}

// ── File watcher ────────────────────────────────────────────────────

// ── Git-based file filtering ─────────────────────────────────────────

const ALWAYS_IGNORE = new Set([".git", "node_modules", "dist", ".kiro", ".agent", "__pycache__", ".next", ".venv", ".konductor-watcher.log"]);

function isGitIgnored(filepath) {
  try {
    execSync(`git check-ignore -q "${filepath}"`, { stdio: ["pipe", "pipe", "pipe"] });
    return true; // exit 0 = ignored
  } catch {
    return false; // exit 1 = not ignored
  }
}

// Cache git-ignore results to avoid spawning a process on every change
const ignoreCache = new Map();
function shouldIgnore(filename) {
  const parts = filename.split(/[/\\]/);
  if (parts.some(p => ALWAYS_IGNORE.has(p))) return true;
  if (parts[0] && parts[0].startsWith(".") && parts.length === 1) return true;
  if (CFG.watchExtensions.size > 0 && !CFG.watchExtensions.has(extname(filename))) {
    debug(`Skipped (extension filter): ${filename}`);
    return true;
  }
  if (ignoreCache.has(filename)) return ignoreCache.get(filename);
  const ignored = isGitIgnored(filename);
  ignoreCache.set(filename, ignored);
  if (ignored) debug(`Skipped (gitignored): ${filename}`);
  if (ignoreCache.size > 5000) ignoreCache.clear();
  return ignored;
}

const pendingFiles = new Set();
let debounceTimer = null;

function watchDir(dir) {
  try {
    watch(dir, { recursive: true }, (_, filename) => {
      if (!filename) return;
      if (shouldIgnore(filename)) return;
      pendingFiles.add(filename);
      debug(`File changed: ${filename}`);
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { const f = [...pendingFiles]; pendingFiles.clear(); debounceTimer = null; registerFiles(f); }, 500);
    });
  } catch (e) { log(`${BGR}${FW}${B} ⚠️  Watch error ${R} ${e.message}`); }
}

// ── Poller ───────────────────────────────────────────────────────────

setInterval(async () => {
  if (sessionId) { debug("Polling..."); await checkAndNotify("", []); }
  else if (!serverConnected) {
    try {
      const h = {};
      if (CFG.apiKey) h["Authorization"] = `Bearer ${CFG.apiKey}`;
      const r = await fetch(`${CFG.url}/health`, { headers: h });
      if (r.ok) { serverConnected = true; disconnectWarningShown = false; log(""); log(`${BGG}${FW}${B} 🟢 RECONNECTED ${R} Server is back online.`); sep(); }
    } catch {}
  }
}, CFG.pollInterval);

// ── Startup ─────────────────────────────────────────────────────────

log(""); log(`${B}${FC}  ╔═══════════════════════════════════════╗${R}`);
log(`${B}${FC}  ║       🔍 KONDUCTOR WATCHER           ║${R}`);
log(`${B}${FC}  ╚═══════════════════════════════════════╝${R}`); log("");
log(`  ${B}User:${R}      ${USER_ID}`);
log(`  ${B}Repo:${R}      ${REPO}`);
log(`  ${B}Branch:${R}    ${BRANCH}`);
log(`  ${B}Version:${R}   ${CLIENT_VERSION || "(not set)"}`);
log(`  ${B}Server:${R}    ${CFG.url}`);
log(`  ${B}API key:${R}   ${CFG.apiKey ? "****" + CFG.apiKey.slice(-4) : "(not set)"}`);
log(`  ${B}Log level:${R} ${CFG.logLevel}`);
log(`  ${B}Terminal:${R}  ${CFG.terminalLogging ? "on" : "off"}`);
log(`  ${B}Poll:${R}      every ${CFG.pollInterval / 1000}s`);
if (CFG.logFile) log(`  ${B}Log file:${R}  ${CFG.logFile}`);
if (CFG.mcpPath) log(`  ${B}MCP config:${R} ${CFG.mcpPath}`);
log(""); sep(); log(""); log(`  ${B}👀 Konductor is watching your project...${R}`); log("");

watchConfigFiles();
watchDir(".");
log(`  ${B}💬 Talk to Konductor in your IDE chat.${R}`);
log(`  ${B}   Type "konductor, help" to get started!${R}`);
log(""); sep();

// Initial version check on startup — triggers auto-update if server has a newer version
(async () => {
  try {
    const res = await api("/api/status", { userId: USER_ID, repo: REPO });
    if (res.error) {
      debug(`Startup check failed: ${res.error}`);
    } else {
      debug(`Startup check: state=${res.collisionState}`);
    }
  } catch (e) { debug(`Startup check error: ${e.message}`); }
})();
