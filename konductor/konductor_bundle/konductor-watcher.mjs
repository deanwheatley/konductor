#!/usr/bin/env node
/**
 * konductor-watcher — Cross-platform file watcher + collision monitor.
 *
 * Reads server URL and API key from mcp.json (same config the IDE uses).
 * Reads watcher-specific settings from .konductor-watcher.env.
 * Auto-opens a terminal window if not running in one.
 * Watches config files for changes and hot-reloads.
 */
import { watch, readFileSync, existsSync, writeFileSync, appendFileSync, statSync, renameSync, unlinkSync } from "node:fs";
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
    logFile: env.KONDUCTOR_LOG_FILE !== undefined ? (env.KONDUCTOR_LOG_FILE ? resolve(env.KONDUCTOR_LOG_FILE) : "") : resolve(".konductor-watcher.log"),
    watchExtensions: new Set(
      (env.KONDUCTOR_WATCH_EXTENSIONS || "")
        .split(",").filter(e => e.trim()).map(e => `.${e.trim()}`),
    ),
    logToTerminal: (env.KONDUCTOR_LOG_TO_TERMINAL || "true").toLowerCase() === "true",
    logMaxSize: env.KONDUCTOR_LOG_MAX_SIZE ? parseFileSize(env.KONDUCTOR_LOG_MAX_SIZE) : 10 * 1024 * 1024,
    mcpPath: mcp.path,
    offlineQueueMax: parseInt(env.KONDUCTOR_OFFLINE_QUEUE_MAX || "100", 10),
  };
}

/** Parse a size string like "10MB", "500KB", "1GB" into bytes. */
function parseFileSize(s) {
  const m = s.trim().match(/^(\d+(?:\.\d+)?)\s*(KB|MB|GB)?$/i);
  if (!m) return 10 * 1024 * 1024;
  const n = parseFloat(m[1]);
  const unit = (m[2] || "B").toUpperCase();
  if (unit === "GB") return n * 1024 * 1024 * 1024;
  if (unit === "MB") return n * 1024 * 1024;
  if (unit === "KB") return n * 1024;
  return n;
}

/** Rotate log file if it exceeds maxSize. Three-file scheme: current → .backup → .tobedeleted */
function rotateLogIfNeeded(filePath, maxSize) {
  try {
    const size = statSync(filePath).size;
    if (size < maxSize) return;
    const backup = filePath + ".backup";
    const toDelete = filePath + ".tobedeleted";
    try { unlinkSync(toDelete); } catch {}
    try { renameSync(backup, toDelete); } catch {}
    try { renameSync(filePath, backup); } catch {}
  } catch {
    // File doesn't exist yet — nothing to rotate
  }
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
let currentBranch = envVars.KONDUCTOR_BRANCH || process.env.KONDUCTOR_BRANCH || git("git branch --show-current") || "unknown";
const REPO_SHORT = REPO.split("/").pop() || REPO;

// ── Branch detection (Req 7) ────────────────────────────────────────

/**
 * Re-read the current git branch. If the branch has changed, log the change
 * and clear pending files (new branch may have different file state).
 * Skipped when KONDUCTOR_BRANCH env override is set (static override).
 * Requirements: 7.1, 7.2, 7.3
 */
function refreshBranch() {
  if (envVars.KONDUCTOR_BRANCH || process.env.KONDUCTOR_BRANCH) return; // env override is static
  const newBranch = git("git branch --show-current") || "unknown";
  if (newBranch !== currentBranch) {
    log(`${FY}🔀 Branch changed: ${currentBranch} → ${newBranch}${R}`);
    termLog(`${FY}🔀 Branch changed: ${currentBranch} → ${newBranch}${R}`);
    currentBranch = newBranch;
    // Clear pending files — new branch may have different file state (Req 7.2)
    pendingFiles.clear();
  }
}
const DASHBOARD_URL = `${loadConfig().url}/repo/${REPO_SHORT}`;

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
  if (CFG.logFile) {
    try { rotateLogIfNeeded(CFG.logFile, CFG.logMaxSize); appendFileSync(CFG.logFile, `${localTs()} ${stripAnsi(m)}\n`); } catch {}
  }
}
function termLog(m) {
  if (CFG.logToTerminal) process.stderr.write(m + "\n");
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
            termLog(`${BGY}${FW}${B} 🔄 CONFIG CHANGED ${R} ${name} updated — reconnecting with new settings.`);
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
let lastUpdateVersion = ""; // Track which version we already updated to

// ── Collab request deduplication (Req 5.8) ──────────────────────────
// Track requestId → last-seen status so we only log new requests or status changes.
const seenCollabRequests = new Map(); // requestId → status

// ── Offline queue (Req 1) ───────────────────────────────────────────
const offlineQueue = new Set();  // cumulative unique file paths
let wasOffline = false;          // track offline→online transition

async function runAutoUpdate(serverVersion) {
  if (lastUpdateVersion === serverVersion) {
    debug(`Already updated to v${serverVersion}, skipping`);
    return;
  }
  lastUpdateVersion = serverVersion;

  const tgzUrl = `${CFG.url}/bundle/installer.tgz`;
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
    log(`  ${FY}Restarting watcher to load new code...${R}`);
    sep();

    // Self-restart to load the updated watcher code
    const { spawn: spawnChild } = await import("node:child_process");
    const child = spawnChild("node", ["konductor-watcher.mjs"], { cwd: process.cwd(), detached: true, stdio: "ignore" });
    child.unref();
    process.exit(0);
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
    if (!serverConnected) { serverConnected = true; disconnectWarningShown = false; log(""); log(`${BGG}${FW}${B} 🟢 RECONNECTED ${R} Konductor server is back online.`); termLog(`${BGG}${FW}${B} 🟢 RECONNECTED ${R} Konductor server is back online.`); sep(); }
    if (data.updateRequired && data.serverVersion) {
      log(`  ${FY}ℹ️  Server v${data.serverVersion} available (client: v${CLIENT_VERSION || "unknown"})${R}`);
      if (lastUpdateVersion !== data.serverVersion) {
        await runAutoUpdate(data.serverVersion);
      }
    }
    return data;
  } catch (e) { debug(`Error: ${e.message}`); if (serverConnected) { serverConnected = false; termLog(`${BGR}${FW}${B} ⚠️  DISCONNECTED ${R} Konductor server not reachable.`); } else { serverConnected = false; } return { error: "connection failed" }; }
}

// ── Notification formatting ─────────────────────────────────────────

function rel(f) { return `./${f.replace(/^\.\//, "")}`; }

/**
 * Format a single LineRange for display: "line 10" or "lines 10-25"
 */
function fmtRange(r) {
  if (r.startLine === r.endLine) return `line ${r.startLine}`;
  return `lines ${r.startLine}-${r.endLine}`;
}

/**
 * Format multiple LineRanges: "lines 10-25, 40-50"
 */
function fmtRanges(ranges) {
  if (!ranges || ranges.length === 0) return "";
  if (ranges.length === 1) return fmtRange(ranges[0]);
  const parts = ranges.map(r => r.startLine === r.endLine ? `${r.startLine}` : `${r.startLine}-${r.endLine}`);
  return `lines ${parts.join(", ")}`;
}

/**
 * Print line overlap details for shared files (Requirements 4.1, 4.2)
 */
function printLineOverlapDetails(details, color) {
  if (!details || details.length === 0) return;
  for (const d of details) {
    const file = rel(d.file);
    if (d.lineOverlap === true) {
      const yours = fmtRanges(d.userRanges);
      const theirs = fmtRanges(d.otherRanges);
      const severity = d.overlapSeverity ? ` (${d.overlapSeverity})` : "";
      log(`  ${color}📍 ${file}: your ${yours} ↔ their ${theirs} — ${d.overlappingLines} overlapping lines${severity}${R}`);
    } else if (d.lineOverlap === false) {
      const yours = fmtRanges(d.userRanges);
      const theirs = fmtRanges(d.otherRanges);
      log(`  ${FG}📍 ${file}: your ${yours} ↔ their ${theirs} — no overlap${R}`);
    }
  }
}

function userBlock(s, color) {
  log(`  ${color}User: ${B}${s.userId}${R}${color} on ${REPO_SHORT}/${s.branch || "unknown"}${R}`);
  log(`  ${color}Files: ${R}${(s.files || []).map(rel).join(", ")}`);
}

function notify(state, sessions, shared, files, overlappingDetails) {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  const ts = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  const others = sessions.filter(s => s.userId !== USER_ID);
  const names = others.map(s => s.userId).join(", ") || "none";
  const sf = shared.length ? shared.map(rel).join(", ") : "none";
  const ctx = `${REPO_SHORT}/${currentBranch}`;
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
    case "proximity":
      log(""); log(`${BGG}${FW}${B} 🟢 PROXIMITY ${R} on ${B}${ctx}${R} — ${FG}"${names} in same file, different sections."${R}  ${D}${ts}${R}`);
      printUpdated(FG); log(`  ${B}${FG}Shared files:${R} ${sf}`);
      if (overlappingDetails) { for (const od of overlappingDetails) printLineOverlapDetails(od.lineOverlapDetails, FG); }
      for (const s of others) userBlock(s, FG); sep(); break;
    case "collision_course":
      log(""); log(`${BGO}${FW}${B} 🟠 COLLISION COURSE ${R} on ${B}${ctx}${R} — ${FY}"${names} modifying same files."${R}  ${D}${ts}${R}`);
      printUpdated(FY); log(`  ${B}${FY}Shared files:${R} ${sf}`);
      if (overlappingDetails) { for (const od of overlappingDetails) printLineOverlapDetails(od.lineOverlapDetails, FY); }
      log(`  ${B}${FY}⚠️  Coordinate with your team.${R}`);
      log(`${D}  ──────────────────────────────────────${R}`);
      for (const s of others) { userBlock(s, FY); log(`${D}  ──────────────────────────────────────${R}`); } sep();
      termLog(`${BGO}${FW}${B} 🟠 COLLISION COURSE ${R} on ${B}${ctx}${R} — ${FY}${names} modifying same files.${R}`);
      termLog(`  ${B}${FY}Shared files:${R} ${sf}`);
      for (const s of others) termLog(`  ${FY}User: ${B}${s.userId}${R}${FY} on ${REPO_SHORT}/${s.branch || "unknown"}${R} — files: ${(s.files || []).map(rel).join(", ")}`);
      break;
    case "merge_hell":
      log(""); log(`${BGR}${FW}${B} 🔴 MERGE HELL ${R} on ${B}${ctx}${R} — ${FR}"Divergent changes with ${names}."${R}  ${D}${ts}${R}`);
      printUpdated(FR); log(`  ${B}${FR}Conflicting files:${R} ${sf}`);
      if (overlappingDetails) { for (const od of overlappingDetails) printLineOverlapDetails(od.lineOverlapDetails, FR); }
      log(`  ${BGR}${FW}${B} ⛔ CRITICAL — Coordinate immediately: ${R}`);
      log(`${D}  ──────────────────────────────────────${R}`);
      for (const s of others) { userBlock(s, FR); log(`${D}  ──────────────────────────────────────${R}`); } sep();
      termLog(`${BGR}${FW}${B} 🔴 MERGE HELL ${R} on ${B}${ctx}${R} — ${FR}Divergent changes with ${names}.${R}`);
      termLog(`  ${B}${FR}Conflicting files:${R} ${sf}`);
      termLog(`  ${BGR}${FW}${B} ⛔ CRITICAL — Coordinate immediately ${R}`);
      for (const s of others) termLog(`  ${FR}User: ${B}${s.userId}${R}${FR} on ${REPO_SHORT}/${s.branch || "unknown"}${R} — files: ${(s.files || []).map(rel).join(", ")}`);
      break;
    case "none": debug("No active session."); break;
    default: log(`${FG}🟢 State: ${state}${R}`); sep();
  }
}

// ── Collab request terminal notifications (Req 5.8, 5.5, 5.7) ──────

/**
 * Map collision state strings to display labels with emoji.
 */
function collisionLabel(state) {
  switch (state) {
    case "collision_course": return "🟠 Collision Course";
    case "merge_hell": return "🔴 Merge Hell";
    case "crossroads": return "🟡 Crossroads";
    case "proximity": return "🟢 Proximity";
    case "neighbors": return "🟢 Neighbors";
    case "solo": return "🟢 Solo";
    default: return state || "unknown";
  }
}

/**
 * Process pendingCollabRequests from a server response.
 * Logs new incoming requests (recipient) and status updates (initiator).
 * Deduplicates by requestId + status to avoid re-logging.
 */
function processCollabRequests(requests) {
  if (!requests || !Array.isArray(requests) || requests.length === 0) return;

  for (const req of requests) {
    const prevStatus = seenCollabRequests.get(req.requestId);

    // Skip if we already logged this exact requestId + status combo
    if (prevStatus === req.status) continue;

    seenCollabRequests.set(req.requestId, req.status);

    const files = (req.files || []).map(rel).join(", ") || "unknown files";

    // ── Incoming request: user is recipient, status is pending ──
    if (req.status === "pending" && req.recipient === USER_ID) {
      log(""); log(`${BGY}${FW}${B} 🤝 COLLAB REQUEST ${R} from ${B}${req.initiator}${R} — ${files} (${collisionLabel(req.collisionState)})`);
      log(`  ${FY}Say "konductor, accept collab from ${req.initiator}" in your IDE chat.${R}`);
      sep();
      termLog(`${BGY}${FW}${B} 🤝 COLLAB REQUEST ${R} from ${B}${req.initiator}${R} — ${files} (${collisionLabel(req.collisionState)})`);
      termLog(`  ${FY}Say "konductor, accept collab from ${req.initiator}" in your IDE chat.${R}`);
      continue;
    }

    // ── Status updates for requests the user initiated ──
    if (req.initiator === USER_ID) {
      switch (req.status) {
        case "accepted":
          log(""); log(`${BGG}${FW}${B} 🟢 COLLAB ACCEPTED ${R} ${B}${req.recipient}${R} accepted your collaboration request.`);
          sep();
          termLog(`${BGG}${FW}${B} 🟢 COLLAB ACCEPTED ${R} ${B}${req.recipient}${R} accepted your collaboration request.`);
          break;
        case "declined":
          log(""); log(`${FY}👋 COLLAB DECLINED${R} — ${B}${req.recipient}${R} declined your collaboration request.`);
          sep();
          termLog(`${FY}👋 COLLAB DECLINED${R} — ${B}${req.recipient}${R} declined your collaboration request.`);
          break;
        case "expired":
          log(""); log(`${FY}⏰ COLLAB EXPIRED${R} — Your request to ${B}${req.recipient}${R} expired. Say "konductor, live share with ${req.recipient}" to try again.`);
          sep();
          termLog(`${FY}⏰ COLLAB EXPIRED${R} — Your request to ${B}${req.recipient}${R} expired. Say "konductor, live share with ${req.recipient}" to try again.`);
          break;
        case "link_shared":
          log(""); log(`${BGG}${FW}${B} 🔗 LIVE SHARE LINK ${R} ${B}${req.recipient}${R} shared a link: ${req.shareLink || "(no URL)"}`);
          log(`  ${FG}Open it to join the session.${R}`);
          sep();
          termLog(`${BGG}${FW}${B} 🔗 LIVE SHARE LINK ${R} ${B}${req.recipient}${R} shared a link: ${req.shareLink || "(no URL)"}`);
          break;
      }
    }
  }
}

// ── Check + Register ────────────────────────────────────────────────

async function checkAndNotify(regState, changedFiles, overlappingDetails) {
  const res = await api("/api/status", { userId: USER_ID, repo: REPO });
  if (res.error) { debug(`Status error: ${res.error}`); return; }
  const state = res.collisionState || regState || "none";
  const sessions = (res.overlappingSessions || []).filter(s => s.userId !== USER_ID);
  const shared = res.sharedFiles || [];
  const sig = `${state}:${sessions.map(s => `${s.userId}:${s.branch}:${s.files.join(",")}`).join(";")}`;
  if (sig !== lastStateSig || changedFiles.length > 0) { lastStateSig = sig; notify(state, res.overlappingSessions || [], shared, changedFiles, overlappingDetails || null); }
  // Surface pending collab requests from /api/status (Req 5.8)
  processCollabRequests(res.pendingCollabRequests);
}

async function registerFiles(files) {
  if (!files.length) return;
  // Build FileChange[] with line ranges for each file (Requirements 1.1, 1.2)
  const fileChanges = files.map(f => {
    const ranges = getLineRanges(f);
    return ranges ? { path: f, lineRanges: ranges } : { path: f };
  });
  const res = await api("/api/register", { userId: USER_ID, repo: REPO, branch: currentBranch, files: fileChanges });
  if (res.error) {
    // ── Offline queue: store files instead of dropping them (Req 1.1, 1.4, 1.5, 1.6, 1.7) ──
    wasOffline = true;
    for (const f of files) {
      if (offlineQueue.size >= CFG.offlineQueueMax) {
        // FIFO eviction: remove oldest (first inserted) — Set preserves insertion order
        const oldest = offlineQueue.values().next().value;
        offlineQueue.delete(oldest);
        log(`  ${FY}⚠️  Offline queue full (max: ${CFG.offlineQueueMax}). Oldest events discarded.${R}`);
      }
      offlineQueue.add(f);
    }
    log(`  ${FY}📦 ${offlineQueue.size} file changes queued while offline. Will report on reconnection.${R}`);

    const fl = files.map(rel).join(", ");
    if (!disconnectWarningShown) {
      const reason = !serverConnected ? `server not reachable at ${CFG.url}` : res.error;
      log(""); log(`${BGR}${FW}${B} ⚠️  DISCONNECTED ${R} ${reason}`);
      log(`  ${FR}Collision awareness is OFFLINE. Your changes are NOT being tracked.${R}`);
      log(`  ${FR}Untracked:${R} ${fl}`); log(`  ${D}Will notify when server is back.${R}`); sep();
      termLog(`${BGR}${FW}${B} ⚠️  DISCONNECTED ${R} ${reason}`);
      termLog(`  ${FR}Collision awareness is OFFLINE. Your changes are NOT being tracked.${R}`);
      disconnectWarningShown = true;
    } else { log(`  ${FR}⚠️  Still disconnected.${R} Untracked: ${fl}`); }
    return;
  }
  // Clear disconnected state on success
  if (disconnectWarningShown) {
    disconnectWarningShown = false;
    log(""); log(`${BGG}${FW}${B} 🟢 RECONNECTED ${R} Konductor is back online.`);
    log(`  ${B}Dashboard:${R} ${DASHBOARD_URL}`); sep();
    termLog(`${BGG}${FW}${B} 🟢 RECONNECTED ${R} Konductor is back online.`);
  }
  // ── Offline replay: send cumulative queue on reconnection (Req 1.2, 1.3, 5.1, 5.2, 5.3) ──
  if (wasOffline && offlineQueue.size > 0) {
    const queuedFiles = [...offlineQueue];
    const queuedCount = queuedFiles.length;
    offlineQueue.clear();
    wasOffline = false;
    // Build file changes for queued files
    const queuedFileChanges = queuedFiles.map(f => {
      const ranges = getLineRanges(f);
      return ranges ? { path: f, lineRanges: ranges } : { path: f };
    });
    // Merge current files with queued files (union) in a single registration
    const allFiles = [...new Set([...files, ...queuedFiles])];
    const allFileChanges = allFiles.map(f => {
      const ranges = getLineRanges(f);
      return ranges ? { path: f, lineRanges: ranges } : { path: f };
    });
    const replayRes = await api("/api/register", { userId: USER_ID, repo: REPO, branch: currentBranch, files: allFileChanges });
    if (!replayRes.error) {
      log(""); log(`${BGG}${FW}${B} 🟢 SYNCED ${R} Reconnected. Synced ${queuedCount} offline changes.`);
      termLog(`${BGG}${FW}${B} 🟢 SYNCED ${R} Reconnected. Synced ${queuedCount} offline changes.`);
      sep();
      sessionId = replayRes.sessionId || sessionId;
      // Surface pending collab requests from /api/register replay (Req 5.8)
      processCollabRequests(replayRes.pendingCollabRequests);
      await checkAndNotify(replayRes.collisionState, allFiles, replayRes.overlappingDetails || null);
      return;
    }
    // If replay fails, re-queue everything
    for (const f of queuedFiles) offlineQueue.add(f);
    wasOffline = true;
  } else {
    wasOffline = false;
  }
  sessionId = res.sessionId || sessionId;
  // Surface pending collab requests from /api/register (Req 5.8)
  processCollabRequests(res.pendingCollabRequests);
  await checkAndNotify(res.collisionState, files, res.overlappingDetails || null);
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

// ── Line range extraction ────────────────────────────────────────────

/**
 * Extract modified line ranges from git diff for a given file.
 * Parses @@ hunk headers from `git diff --unified=0` output.
 * Returns undefined when git diff fails or produces no hunks (new/binary/untracked files).
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5
 */
function getLineRanges(filepath) {
  try {
    const diff = execSync(
      `git diff --unified=0 -- "${filepath}"`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );
    const ranges = [];
    for (const line of diff.split("\n")) {
      // Parse @@ -a,b +c,d @@ hunk headers to extract added line ranges
      const match = line.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@/);
      if (match) {
        const start = parseInt(match[1], 10);
        const count = match[2] !== undefined ? parseInt(match[2], 10) : 1;
        if (count > 0) {
          ranges.push({ startLine: start, endLine: start + count - 1 });
        }
      }
    }
    return ranges.length > 0 ? ranges : undefined;
  } catch {
    return undefined; // Fallback: no line data (Req 1.3)
  }
}

// ── File watcher ────────────────────────────────────────────────────

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
  refreshBranch(); // Check for branch changes on every poll cycle (Req 7.3)
  if (sessionId) { debug("Polling..."); await checkAndNotify("", [], null); }
  else if (!serverConnected) {
    try {
      const h = {};
      if (CFG.apiKey) h["Authorization"] = `Bearer ${CFG.apiKey}`;
      const r = await fetch(`${CFG.url}/health`, { headers: h });
      if (r.ok) {
        serverConnected = true; disconnectWarningShown = false;
        log(""); log(`${BGG}${FW}${B} 🟢 RECONNECTED ${R} Server is back online.`);
        termLog(`${BGG}${FW}${B} 🟢 RECONNECTED ${R} Server is back online.`); sep();
        // Replay offline queue on reconnection (Req 1.2, 1.3, 5.2)
        if (offlineQueue.size > 0) {
          const queuedFiles = [...offlineQueue];
          const queuedCount = queuedFiles.length;
          offlineQueue.clear();
          wasOffline = false;
          await registerFiles(queuedFiles);
          log(`  ${FG}📦 Synced ${queuedCount} offline changes.${R}`);
        }
      }
    } catch {}
  } else if (!lastUpdateVersion) {
    // No active session but connected — still check for updates
    debug("Polling for version check...");
    await api("/api/status", { userId: USER_ID, repo: REPO });
  }
}, CFG.pollInterval);

// ── Startup ─────────────────────────────────────────────────────────

log(""); log(`${B}${FC}  ╔═══════════════════════════════════════╗${R}`);
log(`${B}${FC}  ║       🔍 KONDUCTOR WATCHER v0.3.1    ║${R}`);
log(`${B}${FC}  ╚═══════════════════════════════════════╝${R}`); log("");
log(`  ${B}User:${R}      ${USER_ID}`);
log(`  ${B}Repo:${R}      ${REPO}`);
log(`  ${B}Branch:${R}    ${currentBranch}`);
log(`  ${B}Version:${R}   ${CLIENT_VERSION || "(not set)"}`);
log(`  ${B}Server:${R}    ${CFG.url}`);
log(`  ${B}Dashboard:${R} ${DASHBOARD_URL}`);
log(`  ${B}GitHub:${R}    https://github.com/${REPO}`);
log(`  ${B}API key:${R}   ${CFG.apiKey ? "****" + CFG.apiKey.slice(-4) : "(not set)"}`);
log(`  ${B}Log level:${R} ${CFG.logLevel}`);
log(`  ${B}Poll:${R}      every ${CFG.pollInterval / 1000}s`);
if (CFG.logFile) log(`  ${B}Log file:${R}  ${CFG.logFile}`);
if (CFG.logFile) log(`  ${B}Max size:${R}  ${Math.round(CFG.logMaxSize / 1024 / 1024)}MB (rotation enabled)`);
if (CFG.mcpPath) log(`  ${B}MCP config:${R} ${CFG.mcpPath}`);
log(`  ${B}Offline Q:${R} max ${CFG.offlineQueueMax} events`);
log(""); sep(); log(""); log(`  ${B}👀 Konductor is watching your project...${R}`); log("");

watchConfigFiles();
watchDir(".");
log(`  ${B}💬 Talk to Konductor in your IDE chat.${R}`);
log(`  ${B}   Type "konductor, help" to get started!${R}`);
log(""); sep();
termLog(`${BGG}${FW}${B} 🟢 KONDUCTOR ${R} File watcher started — watching ${B}${REPO_SHORT}${R} on ${B}${currentBranch}${R}`);

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
