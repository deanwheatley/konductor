/**
 * LocalPersistence — JSON file persistence for in-memory Baton stores.
 *
 * When KONDUCTOR_STARTUP_LOCAL=true, this module persists NotificationStore,
 * QueryLogStore, and MemoryHistoryStore data to disk so they survive server
 * restarts. Uses debounced writes to avoid excessive I/O.
 *
 * Each store is saved to its own JSON file in the working directory.
 */

import { writeFile, readFile, rename, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { NotificationStore } from "./baton-notification-store.js";
import type { QueryLogStore } from "./baton-query-log.js";
import type { MemoryHistoryStore } from "./memory-history-store.js";
import type { KonductorLogger } from "./logger.js";

interface LocalPersistenceOptions {
  notificationStore: NotificationStore;
  queryLogStore: QueryLogStore;
  historyStore: MemoryHistoryStore;
  logger?: KonductorLogger;
  /** Directory to write persistence files into. Defaults to cwd. */
  dataDir?: string;
  /** Debounce interval in ms. Defaults to 2000. */
  debounceMs?: number;
}

export class LocalPersistence {
  private readonly notificationStore: NotificationStore;
  private readonly queryLogStore: QueryLogStore;
  private readonly historyStore: MemoryHistoryStore;
  private readonly logger?: KonductorLogger;
  private readonly dataDir: string;
  private readonly debounceMs: number;

  private notifTimer: ReturnType<typeof setTimeout> | null = null;
  private queryLogTimer: ReturnType<typeof setTimeout> | null = null;
  private historyTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly notifPath: string;
  private readonly queryLogPath: string;
  private readonly historyUsersPath: string;

  constructor(opts: LocalPersistenceOptions) {
    this.notificationStore = opts.notificationStore;
    this.queryLogStore = opts.queryLogStore;
    this.historyStore = opts.historyStore;
    this.logger = opts.logger;
    this.dataDir = opts.dataDir ?? process.cwd();
    this.debounceMs = opts.debounceMs ?? 2000;

    this.notifPath = join(this.dataDir, "notifications.json");
    this.queryLogPath = join(this.dataDir, "query-log.json");
    this.historyUsersPath = join(this.dataDir, "history-users.json");
  }

  // ── Load from disk on startup ──────────────────────────────────────

  async load(): Promise<void> {
    await this.loadNotifications();
    await this.loadQueryLog();
    await this.loadHistoryUsers();
  }

  private async loadNotifications(): Promise<void> {
    try {
      if (!existsSync(this.notifPath)) return;
      const raw = await readFile(this.notifPath, "utf-8");
      this.notificationStore.deserialize(raw);
      if (this.logger) {
        this.logger.logSystem("SERVER", `Loaded notifications from ${this.notifPath}`);
      }
    } catch (err) {
      if (this.logger) {
        this.logger.logSystem("SERVER", `Failed to load notifications: ${err}`);
      }
    }
  }

  private async loadQueryLog(): Promise<void> {
    try {
      if (!existsSync(this.queryLogPath)) return;
      const raw = await readFile(this.queryLogPath, "utf-8");
      const data = JSON.parse(raw) as Record<string, unknown[]>;
      // Re-add entries to the store
      for (const [_repo, entries] of Object.entries(data)) {
        if (Array.isArray(entries)) {
          for (const entry of entries) {
            this.queryLogStore.add(entry as any);
          }
        }
      }
      if (this.logger) {
        this.logger.logSystem("SERVER", `Loaded query log from ${this.queryLogPath}`);
      }
    } catch (err) {
      if (this.logger) {
        this.logger.logSystem("SERVER", `Failed to load query log: ${err}`);
      }
    }
  }

  private async loadHistoryUsers(): Promise<void> {
    try {
      if (!existsSync(this.historyUsersPath)) return;
      const raw = await readFile(this.historyUsersPath, "utf-8");
      const users = JSON.parse(raw) as Array<{ userId: string; repo: string; branch?: string; clientVersion?: string; ipAddress?: string }>;
      for (const u of users) {
        await this.historyStore.upsertUser(u.userId, u.repo, {
          branch: u.branch,
          clientVersion: u.clientVersion,
          ipAddress: u.ipAddress,
        });
      }
      if (this.logger) {
        this.logger.logSystem("SERVER", `Loaded ${users.length} user(s) from ${this.historyUsersPath}`);
      }
    } catch (err) {
      if (this.logger) {
        this.logger.logSystem("SERVER", `Failed to load history users: ${err}`);
      }
    }
  }

  // ── Save to disk (debounced) ───────────────────────────────────────

  /** Schedule a debounced save of the notification store. */
  saveNotifications(): void {
    if (this.notifTimer) return;
    this.notifTimer = setTimeout(async () => {
      this.notifTimer = null;
      await this.writeNotifications();
    }, this.debounceMs);
  }

  /** Schedule a debounced save of the query log store. */
  saveQueryLog(): void {
    if (this.queryLogTimer) return;
    this.queryLogTimer = setTimeout(async () => {
      this.queryLogTimer = null;
      await this.writeQueryLog();
    }, this.debounceMs);
  }

  /** Schedule a debounced save of the history users. */
  saveHistoryUsers(): void {
    if (this.historyTimer) return;
    this.historyTimer = setTimeout(async () => {
      this.historyTimer = null;
      await this.writeHistoryUsers();
    }, this.debounceMs);
  }

  /** Flush all pending writes immediately. Call on graceful shutdown. */
  async flush(): Promise<void> {
    if (this.notifTimer) { clearTimeout(this.notifTimer); this.notifTimer = null; }
    if (this.queryLogTimer) { clearTimeout(this.queryLogTimer); this.queryLogTimer = null; }
    if (this.historyTimer) { clearTimeout(this.historyTimer); this.historyTimer = null; }
    await Promise.all([
      this.writeNotifications(),
      this.writeQueryLog(),
      this.writeHistoryUsers(),
    ]);
  }

  // ── Atomic write helpers ───────────────────────────────────────────

  private async atomicWrite(filePath: string, data: string): Promise<void> {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    const tempPath = join(dir, `.${randomUUID()}.tmp`);
    await writeFile(tempPath, data, "utf-8");
    await rename(tempPath, filePath);
  }

  private async writeNotifications(): Promise<void> {
    try {
      const json = this.notificationStore.serialize();
      await this.atomicWrite(this.notifPath, json);
    } catch (err) {
      if (this.logger) {
        this.logger.logSystem("SERVER", `Failed to persist notifications: ${err}`);
      }
    }
  }

  private async writeQueryLog(): Promise<void> {
    try {
      // Build a repo-keyed object from the store
      const repos = this.queryLogStore.getKnownRepos();
      const data: Record<string, unknown[]> = {};
      for (const repo of repos) {
        data[repo] = this.queryLogStore.getEntries(repo);
      }
      await this.atomicWrite(this.queryLogPath, JSON.stringify(data, null, 2));
    } catch (err) {
      if (this.logger) {
        this.logger.logSystem("SERVER", `Failed to persist query log: ${err}`);
      }
    }
  }

  private async writeHistoryUsers(): Promise<void> {
    try {
      const users = await this.historyStore.getAllUsers();
      const data = users.map((u) => ({
        userId: u.userId,
        repo: u.lastRepo ?? "",
        branch: u.lastBranch ?? undefined,
        clientVersion: u.clientVersion ?? undefined,
        ipAddress: u.ipAddress ?? undefined,
      }));
      await this.atomicWrite(this.historyUsersPath, JSON.stringify(data, null, 2));
    } catch (err) {
      if (this.logger) {
        this.logger.logSystem("SERVER", `Failed to persist history users: ${err}`);
      }
    }
  }
}
