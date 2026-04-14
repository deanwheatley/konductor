#!/usr/bin/env node
/**
 * konductor-watcher — Cross-platform file watcher + collision monitor.
 *
 * Watches for file changes, registers them with the Konductor server,
 * and polls for collision state changes. Prints color-coded notifications.
 *
 * Usage:
 *   node konductor-watcher.mjs
 *   KONDUCTOR_LOG_LEVEL=debug node konductor-watcher.mjs
 *
 * Config: .konductor-watcher.env (created by install.sh / install.ps1)
 */

import { watch, readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, relative, extname, join } from "node:path";
import { appendFileSync } from "node:fs";

// ── Load .konductor-watcher.env ─────────────────────────────────────

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(resolve(".konductor-watcher.env"));

// ── Config ──────────────────────────────────────────────────────────

const KONDUCTOR_URL = process.env.KONDUCTOR_URL || "http://localhost:3010";
const KONDUCTOR_API_KEY = process.env.KONDUCTOR_API_KEY || "";
const LOG_LEVEL = process.env.KONDUCTOR_LOG_LEVEL || "info";
const POLL_INTERVAL = parseInt(process.env.KONDUCTOR_POLL_INTERVAL || "10", 10) * 1000;
const LOG_FILE = process.env.KONDUCTOR_LOG_FILE || "";
const WATCH_EXTENSIONS = new Set(
  (process.env.KONDUCTOR_WATCH_EXTENSIONS || "ts,tsx,js,jsx,py,java,go,rs,rb,json,yaml,yml,md,html,css,scss,sql,sh")
    .split(",").map((e) => `.${e.trim()}`),
);

// Git context
function git(cmd) {
  try { return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim(); }
  catch { return ""; }
}

const USER_ID = process.env.KONDUCTOR_USER || (() => {
  // 1. Try GitHub CLI for actual GitHub username
  const ghUser = git("gh api user --jq .login");
  if (ghUser) return ghUser;
  // 2. Fall back to git config user.name
  const gitUser = git("git config user.name");
  if (gitUser) return gitUser;
  // 3. Fall back to system hostname
  try { return execSync("hostname", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim(); }
  catch { return "unknown"; }
})();

// Persist resolved userId back to .konductor-watcher.env so it's reused next time
if (!process.env.KONDUCTOR_USER && USER_ID !== "unknown") {
  const envPath = resolve(".konductor-watcher.env");
  if (existsSync(envPath)) {
    try {
      let content = readFileSync(envPath, "utf-8");
      if (content.match(/^#\s*KONDUCTOR_USER\s*=/m)) {
        content = content.replace(/^#\s*KONDUCTOR_USER\s*=.*$/m, `KONDUCTOR_USER=${USER_ID}`);
      } else if (content.match(/^KONDUCTOR_USER\s*=\s*$/m)) {
        content = content.replace(/^KONDUCTOR_USER\s*=\s*$/m, `KONDUCTOR_USER=${USER_ID}`);
      }
      const { writeFileSync } = await import("node:fs");
      writeFileSync(envPath, content);
    } catch { /* best effort */ }
  }
}

const REPO = process.env.KONDUCTOR_REPO || (() => {
  const url = git("git remote get-url origin");
  const m = url.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  return m ? m[1] : "unknown/unknown";
})();
const BRANCH = process.env.KONDUCTOR_BRANCH || git("git branch --show-current") || "unknown";

// ── ANSI colors ─────────────────────────────────────────────────────

const R = "\x1b[0m";
const B = "\x1b[1m";
const D = "\x1b[2m";
const FW = "\x1b[97m";
const FG = "\x1b[32m";
const FY = "\x1b[33m";
const FR = "\x1b[31m";
const FC = "\x1b[36m";
const FGR = "\x1b[90m";
const BGG = "\x1b[42m";
const BGY = "\x1b[43m";
const BGO = "\x1b[48;5;208m";
const BGR = "\x1b[41m";

// ── Logging ─────────────────────────────────────────────────────────

function stripAnsi(s) { return s.replace(/\x1b\[[0-9;]*m/g, ""); }

function log(msg) {
  process.stdout.write(msg + "\n");
  if (LOG_FILE) {
    const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
    appendFileSync(LOG_FILE, `${ts} ${stripAnsi(msg)}\n`);
  }
}

function debug(msg) {
  if (LOG_LEVEL === "debug") log(`${FGR}[DEBUG] ${msg}${R}`);
}

function sep() { log(`${D}────────────────────────────────────────────────${R}`); }

// ── API ─────────────────────────────────────────────────────────────

async function api(endpoint, body) {
  debug(`POST ${KONDUCTOR_URL}${endpoint}`);
  debug(`Body: ${JSON.stringify(body)}`);
  const headers = { "Content-Type": "application/json" };
  if (KONDUCTOR_API_KEY) headers["Authorization"] = `Bearer ${KONDUCTOR_API_KEY}`;
  try {
    const res = await fetch(`${KONDUCTOR_URL}${endpoint}`, {
      method: "POST", headers, body: JSON.stringify(body),
    });
    const data = await res.json();
    debug(`Response: ${JSON.stringify(data)}`);
    return data;
  } catch (e) {
    debug(`Error: ${e.message}`);
    return { error: "connection failed" };
  }
}

// ── State ───────────────────────────────────────────────────────────

let sessionId = "";
let lastStateSig = "";

// ── Short repo name (last segment) ──────────────────────────────────

const REPO_SHORT = REPO.split("/").pop() || REPO;

// ── Notification formatting ─────────────────────────────────────────

function rel(f) { return `./${f.replace(/^\.\//, "")}`; }

function userBlock(session, color) {
  const branch = session.branch || "unknown";
  const files = (session.files || []).map(rel).join(", ");
  log(`  ${color}User: ${B}${session.userId}${R}${color} on ${REPO_SHORT}/${branch}${R}`);
  log(`  ${color}Files: ${R}${files}`);
}

function notify(state, overlappingSessions, shared, files) {
  const ts = new Date().toTimeString().slice(0, 8);
  const others = overlappingSessions.filter((s) => s.userId !== USER_ID);
  const names = others.map((s) => s.userId).join(", ") || "none";
  const sf = shared.length ? shared.map(rel).join(", ") : "none";
  const ctx = `${REPO_SHORT}/${BRANCH}`;

  // Print each updated file on its own line
  const printUpdated = (color) => {
    if (files.length === 0) return;
    for (const f of files) {
      log(`  ${color}You updated:${R} ${rel(f)}`);
    }
  };

  switch (state) {
    case "solo":
      log(""); log(`${BGG}${FW}${B} 🟢 SOLO ${R} on ${B}${ctx}${R} — ${FG}"No other users active. You're clear."${R}  ${D}${ts}${R}`);
      printUpdated(FG); sep(); break;

    case "neighbors":
      log(""); log(`${BGG}${FW}${B} 🟢 NEIGHBORS ${R} on ${B}${ctx}${R} — ${FG}"${names} also in repo, different files."${R}  ${D}${ts}${R}`);
      printUpdated(FG);
      for (const s of others) { userBlock(s, FG); }
      sep(); break;

    case "crossroads":
      log(""); log(`${BGY}${FW}${B} 🟡 CROSSROADS ${R} on ${B}${ctx}${R} — ${FY}"${names} working in same directories."${R}  ${D}${ts}${R}`);
      printUpdated(FY);
      for (const s of others) { userBlock(s, FY); }
      sep(); break;

    case "collision_course":
      log(""); log(`${BGO}${FW}${B} 🟠 COLLISION COURSE ${R} on ${B}${ctx}${R} — ${FY}"${names} modifying same files."${R}  ${D}${ts}${R}`);
      printUpdated(FY);
      log(`  ${B}${FY}Shared files:${R} ${sf}`);
      log(`  ${B}${FY}⚠️  Coordinate with your team before continuing.${R}`);
      log(`${D}  ──────────────────────────────────────${R}`);
      for (const s of others) { userBlock(s, FY); log(`${D}  ──────────────────────────────────────${R}`); }
      sep(); break;

    case "merge_hell":
      log(""); log(`${BGR}${FW}${B} 🔴 MERGE HELL ${R} on ${B}${ctx}${R} — ${FR}"Divergent changes with ${names}."${R}  ${D}${ts}${R}`);
      printUpdated(FR);
      log(`  ${B}${FR}Conflicting files:${R} ${sf}`);
      log(`  ${BGR}${FW}${B} ⛔ CRITICAL — Coordinate immediately: ${R}`);
      log(`${D}  ──────────────────────────────────────${R}`);
      for (const s of others) { userBlock(s, FR); log(`${D}  ──────────────────────────────────────${R}`); }
      sep(); break;

    case "none":
      debug("No active session for this user."); break;
    default:
      log(`${FG}🟢 [Konductor] State: ${state}${R}`); sep();
  }
}

// ── Check status and notify ─────────────────────────────────────────

async function checkAndNotify(regState, changedFiles) {
  const res = await api("/api/status", { userId: USER_ID, repo: REPO });
  if (res.error) { debug(`Status error: ${res.error}`); return; }

  const state = res.collisionState || regState || "none";
  const sessions = (res.overlappingSessions || []).filter((s) => s.userId !== USER_ID);
  const shared = res.sharedFiles || [];

  const sig = `${state}:${sessions.map((s) => `${s.userId}:${s.branch}:${s.files.join(",")}`).join(";")}`;
  if (sig !== lastStateSig || changedFiles.length > 0) {
    lastStateSig = sig;
    notify(state, sessions, shared, changedFiles);
  }
}

// ── Register files ──────────────────────────────────────────────────

async function registerFiles(files) {
  if (files.length === 0) return;
  const res = await api("/api/register", { userId: USER_ID, repo: REPO, branch: BRANCH, files });
  if (res.error) {
    log(`${BGR}${FW}${B} ⚠️  ERROR ${R} ${res.error}`);
    return;
  }
  sessionId = res.sessionId || sessionId;
  await checkAndNotify(res.collisionState, files);
}

// ── File watcher ────────────────────────────────────────────────────

const IGNORE = new Set([".git", "node_modules", "dist", ".kiro", "__pycache__", ".next", ".venv"]);
const pendingFiles = new Set();
let debounceTimer = null;

function watchDir(dir) {
  try {
    watch(dir, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      // Check ignored dirs
      const parts = filename.split(/[/\\]/);
      if (parts.some((p) => IGNORE.has(p))) return;
      // Check extension
      const ext = extname(filename);
      if (!WATCH_EXTENSIONS.has(ext)) return;

      pendingFiles.add(filename);
      debug(`File changed: ${filename}`);

      // Debounce: batch changes over 500ms
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const files = [...pendingFiles];
        pendingFiles.clear();
        debounceTimer = null;
        registerFiles(files);
      }, 500);
    });
  } catch (e) {
    log(`${BGR}${FW}${B} ⚠️  Watch error ${R} ${e.message}`);
  }
}

// ── Poller ───────────────────────────────────────────────────────────

setInterval(() => {
  if (sessionId) {
    debug("Polling status...");
    checkAndNotify("", []);
  }
}, POLL_INTERVAL);

// ── Startup ─────────────────────────────────────────────────────────

log("");
log(`${B}${FC}  ╔═══════════════════════════════════════╗${R}`);
log(`${B}${FC}  ║       🔍 KONDUCTOR WATCHER           ║${R}`);
log(`${B}${FC}  ╚═══════════════════════════════════════╝${R}`);
log("");
log(`  ${B}User:${R}      ${USER_ID}`);
log(`  ${B}Repo:${R}      ${REPO}`);
log(`  ${B}Branch:${R}    ${BRANCH}`);
log(`  ${B}Server:${R}    ${KONDUCTOR_URL}`);
log(`  ${B}Log level:${R} ${LOG_LEVEL}`);
log(`  ${B}Poll:${R}      every ${POLL_INTERVAL / 1000}s`);
if (LOG_FILE) log(`  ${B}Log file:${R}  ${LOG_FILE}`);
log("");
sep();
log("");
log(`  ${B}👀 Watching for file changes...${R}`);
log("");
sep();

watchDir(".");
