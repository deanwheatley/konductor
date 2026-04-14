/**
 * KonductorLogger — structured verbose logging for the Konductor MCP Server.
 *
 * When enabled via VERBOSE_LOGGING=true, the logger writes structured log
 * entries to stderr (LOG_TO_TERMINAL=true) and/or a file (LOG_TO_FILE=true,
 * LOG_FILENAME=<path>). All methods no-op when disabled, so there is zero
 * overhead when logging is off.
 */

import { appendFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogCategory = "CONN" | "SESSION" | "STATUS" | "CONFIG" | "SERVER" | "QUERY";

export interface LogEntry {
  timestamp: string;   // "2026-04-10 14:32:01"
  category: LogCategory;
  actor: string;       // "User: <userId>" or "System"
  message: string;
}

export interface LoggerOptions {
  enabled: boolean;
  toTerminal: boolean;
  toFile?: boolean;
  filePath?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_CATEGORIES: ReadonlySet<string> = new Set<LogCategory>([
  "CONN", "SESSION", "STATUS", "CONFIG", "SERVER", "QUERY",
]);

const LOG_LINE_REGEX = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] \[([A-Z]+)\] \[([^\]]+)\] (.+)$/;

// ---------------------------------------------------------------------------
// KonductorLogger
// ---------------------------------------------------------------------------

export class KonductorLogger {
  readonly enabled: boolean;
  private readonly toTerminal: boolean;
  private readonly toFile: boolean;
  private readonly filePath: string;

  constructor(options?: LoggerOptions) {
    if (options) {
      this.enabled = options.enabled;
      this.toTerminal = options.toTerminal;
      this.toFile = options.toFile ?? false;
      this.filePath = options.filePath ?? "konductor.log";
    } else {
      this.enabled = process.env.VERBOSE_LOGGING === "true";
      this.toTerminal = process.env.LOG_TO_TERMINAL === "true";
      this.toFile = process.env.LOG_TO_FILE === "true";
      this.filePath = process.env.LOG_FILENAME ?? "konductor.log";
    }
  }

  // ── Core formatting ─────────────────────────────────────────────────

  /** Format a LogEntry into the canonical `[TIMESTAMP] [CATEGORY] [ACTOR] message` string. */
  formatEntry(entry: LogEntry): string {
    return `[${entry.timestamp}] [${entry.category}] [${entry.actor}] ${entry.message}`;
  }

  /** Parse a formatted log line back into a LogEntry. Throws on malformed input. */
  parseEntry(line: string): LogEntry {
    const match = line.match(LOG_LINE_REGEX);
    if (!match) {
      throw new Error(`Malformed log entry: ${line}`);
    }
    const [, timestamp, category, actor, message] = match;
    if (!VALID_CATEGORIES.has(category)) {
      throw new Error(`Unknown log category: ${category}`);
    }
    return { timestamp, category: category as LogCategory, actor, message };
  }

  // ── Internal helpers ────────────────────────────────────────────────

  private now(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  private userActor(userId: string): string {
    return `User: ${userId}`;
  }

  private write(entry: LogEntry): void {
    if (!this.enabled) return;
    const line = this.formatEntry(entry);
    if (this.toTerminal) {
      process.stderr.write(line + "\n");
    }
    if (this.toFile) {
      try {
        appendFileSync(this.filePath, line + "\n");
      } catch {
        // Logging should never crash the server
      }
    }
  }

  private log(category: LogCategory, actor: string, message: string): void {
    if (!this.enabled) return;
    this.write({ timestamp: this.now(), category, actor, message });
  }

  // ── Connection events ───────────────────────────────────────────────

  logConnection(userId: string, ip: string, hostname?: string): void {
    const host = hostname ? ` (${hostname})` : "";
    this.log("CONN", this.userActor(userId), `Connected via SSE from ${ip}${host}`);
  }

  logAuthentication(userId: string): void {
    this.log("CONN", this.userActor(userId), "Authenticated with valid API key");
  }

  logDisconnection(userId: string): void {
    this.log("CONN", this.userActor(userId), "Disconnected");
  }

  logAuthRejection(ip: string, reason: string): void {
    this.log("CONN", "System", `Auth rejected from ${ip}: ${reason}`);
  }

  // ── Session events ──────────────────────────────────────────────────

  logSessionRegistered(userId: string, sessionId: string, repo: string, branch: string, files: string[]): void {
    this.log("SESSION", this.userActor(userId),
      `Registered session ${sessionId} on ${repo}#${branch} with files: ${files.join(", ")}`);
  }

  logSessionUpdated(userId: string, sessionId: string, files: string[], branch?: string): void {
    const branchInfo = branch ? ` on #${branch}` : "";
    this.log("SESSION", this.userActor(userId),
      `Updated session ${sessionId}${branchInfo} files: ${files.join(", ")}`);
  }

  logSessionDeregistered(userId: string, sessionId: string): void {
    this.log("SESSION", this.userActor(userId), `Deregistered session ${sessionId}`);
  }

  logStaleCleanup(count: number, timeoutSeconds: number): void {
    this.log("SESSION", "System", `Cleaned up ${count} stale sessions (timeout: ${timeoutSeconds}s)`);
  }

  // ── Status events (collision evaluation results) ─────────────────

  logCollisionState(
    userId: string, repo: string, state: string,
    overlappingUsers: string[], sharedFiles: string[], branches: string[],
    userFiles?: string[], userBranch?: string,
  ): void {
    let msg = `${state} in ${repo}`;
    if (userBranch) {
      msg += `#${userBranch}`;
    }
    if (userFiles && userFiles.length > 0) {
      msg += ` | files: ${userFiles.join(", ")}`;
    }
    if (overlappingUsers.length > 0) {
      msg += ` | overlapping: ${overlappingUsers.join(", ")}`;
    }
    if (sharedFiles.length > 0) {
      msg += ` | shared files: ${sharedFiles.join(", ")}`;
    }
    if (branches.length > 0) {
      msg += ` | branches: ${branches.join(", ")}`;
    }
    this.log("STATUS", this.userActor(userId), msg);
  }

  logCollisionAction(actionType: string, affectedUsers: string[], repo: string): void {
    this.log("STATUS", "System",
      `Action: ${actionType} for ${affectedUsers.join(", ")} in ${repo}`);
  }

  // ── Config events ───────────────────────────────────────────────────

  logConfigLoaded(filePath: string, timeoutSeconds: number): void {
    this.log("CONFIG", "System", `Loaded config from ${filePath} (timeout: ${timeoutSeconds}s)`);
  }

  logConfigReloaded(changes: string): void {
    this.log("CONFIG", "System", `Config reloaded: ${changes}`);
  }

  logConfigError(reason: string): void {
    this.log("CONFIG", "System", `Config error: ${reason} — retaining previous config`);
  }

  // ── Server events ───────────────────────────────────────────────────

  logServerStart(transport: string, port?: number): void {
    const portInfo = port !== undefined ? ` on port ${port}` : "";
    this.log("SERVER", "System",
      `Started with ${transport} transport${portInfo}, verbose logging enabled`);
  }

  logSessionsRestored(count: number): void {
    this.log("SERVER", "System", `Restored ${count} sessions from persistent storage`);
  }

  logHealthCheck(ip: string): void {
    this.log("SERVER", "System", `Health check from ${ip}`);
  }

  // ── Query events ────────────────────────────────────────────────────

  logCheckStatus(userId: string, repo: string, state: string, files?: string[], branch?: string): void {
    let msg = `check_status on ${repo}`;
    if (branch) {
      msg += `#${branch}`;
    }
    msg += `: ${state}`;
    if (files && files.length > 0) {
      msg += ` | files: ${files.join(", ")}`;
    }
    this.log("QUERY", this.userActor(userId), msg);
  }

  logListSessions(repo: string, count: number): void {
    this.log("QUERY", "System", `list_sessions on ${repo}: ${count} active sessions`);
  }
}
