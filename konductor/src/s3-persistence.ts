/**
 * S3Persistence — cloud persistence for in-memory Baton stores.
 *
 * When KONDUCTOR_S3_BUCKET is set, this module replaces LocalPersistence
 * and persists NotificationStore, QueryLogStore, and MemoryHistoryStore
 * data to S3 so they survive container restarts and deploys.
 *
 * Uses periodic flush (default 30s) and graceful shutdown flush on SIGTERM.
 */

import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import type { NotificationStore } from "./baton-notification-store.js";
import type { QueryLogStore } from "./baton-query-log.js";
import type { MemoryHistoryStore } from "./memory-history-store.js";
import type { KonductorLogger } from "./logger.js";

export interface S3PersistenceConfig {
  bucketName: string;
  prefix?: string;
  flushIntervalMs?: number;
}

export interface S3PersistenceStores {
  notificationStore: NotificationStore;
  queryLogStore: QueryLogStore;
  historyStore: MemoryHistoryStore;
  logger?: KonductorLogger;
}

export class S3Persistence {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly flushIntervalMs: number;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  private notificationStore!: NotificationStore;
  private queryLogStore!: QueryLogStore;
  private historyStore!: MemoryHistoryStore;
  private logger?: KonductorLogger;

  private dirty = new Set<string>();

  constructor(config: S3PersistenceConfig) {
    this.s3 = new S3Client({});
    this.bucket = config.bucketName;
    this.prefix = config.prefix ?? "konductor/";
    this.flushIntervalMs = config.flushIntervalMs ?? 30_000;
  }

  /** Wire up the in-memory stores. Must be called before load(). */
  setStores(stores: S3PersistenceStores): void {
    this.notificationStore = stores.notificationStore;
    this.queryLogStore = stores.queryLogStore;
    this.historyStore = stores.historyStore;
    this.logger = stores.logger;
  }

  private key(name: string): string {
    return `${this.prefix}${name}`;
  }

  private async getObject(name: string): Promise<string | null> {
    try {
      const resp = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.key(name) }),
      );
      return (await resp.Body?.transformToString("utf-8")) ?? null;
    } catch (err: any) {
      if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  private async putObject(name: string, data: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(name),
        Body: data,
        ContentType: "application/json",
      }),
    );
  }

  // ── Load from S3 on startup ────────────────────────────────────────

  async load(): Promise<void> {
    await Promise.all([
      this.loadNotifications(),
      this.loadQueryLog(),
      this.loadHistoryUsers(),
    ]);
  }

  private async loadNotifications(): Promise<void> {
    try {
      const raw = await this.getObject("notifications.json");
      if (raw) {
        this.notificationStore.deserialize(raw);
        this.log("Loaded notifications from S3");
      }
    } catch (err) {
      this.log(`Failed to load notifications from S3: ${err}`);
    }
  }

  private async loadQueryLog(): Promise<void> {
    try {
      const raw = await this.getObject("query-log.json");
      if (raw) {
        const data = JSON.parse(raw) as Record<string, unknown[]>;
        for (const [_repo, entries] of Object.entries(data)) {
          if (Array.isArray(entries)) {
            for (const entry of entries) {
              this.queryLogStore.add(entry as any);
            }
          }
        }
        this.log("Loaded query log from S3");
      }
    } catch (err) {
      this.log(`Failed to load query log from S3: ${err}`);
    }
  }

  private async loadHistoryUsers(): Promise<void> {
    try {
      const raw = await this.getObject("history-users.json");
      if (raw) {
        const users = JSON.parse(raw) as Array<{
          userId: string;
          repo: string;
          branch?: string;
          clientVersion?: string;
          ipAddress?: string;
        }>;
        for (const u of users) {
          await this.historyStore.upsertUser(u.userId, u.repo, {
            branch: u.branch,
            clientVersion: u.clientVersion,
            ipAddress: u.ipAddress,
          });
        }
        this.log(`Loaded ${users.length} user(s) from S3`);
      }
    } catch (err) {
      this.log(`Failed to load history users from S3: ${err}`);
    }
  }

  // ── Mark dirty and flush ───────────────────────────────────────────

  markDirty(store: "notifications" | "queryLog" | "historyUsers"): void {
    this.dirty.add(store);
  }

  startPeriodicFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => this.log(`Periodic flush error: ${err}`));
    }, this.flushIntervalMs);
  }

  async flush(): Promise<void> {
    const tasks: Promise<void>[] = [];
    if (this.dirty.has("notifications")) {
      this.dirty.delete("notifications");
      tasks.push(this.writeNotifications());
    }
    if (this.dirty.has("queryLog")) {
      this.dirty.delete("queryLog");
      tasks.push(this.writeQueryLog());
    }
    if (this.dirty.has("historyUsers")) {
      this.dirty.delete("historyUsers");
      tasks.push(this.writeHistoryUsers());
    }
    if (tasks.length > 0) {
      await Promise.all(tasks);
    }
  }

  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    // Force-flush everything on shutdown regardless of dirty flags
    this.dirty.add("notifications");
    this.dirty.add("queryLog");
    this.dirty.add("historyUsers");
    await this.flush();
    this.log("S3 persistence shutdown complete");
  }

  // ── Write helpers ──────────────────────────────────────────────────

  private async writeNotifications(): Promise<void> {
    try {
      const json = this.notificationStore.serialize();
      await this.putObject("notifications.json", json);
    } catch (err) {
      this.log(`Failed to persist notifications to S3: ${err}`);
      this.dirty.add("notifications");
    }
  }

  private async writeQueryLog(): Promise<void> {
    try {
      const repos = this.queryLogStore.getKnownRepos();
      const data: Record<string, unknown[]> = {};
      for (const repo of repos) {
        data[repo] = this.queryLogStore.getEntries(repo);
      }
      await this.putObject("query-log.json", JSON.stringify(data, null, 2));
    } catch (err) {
      this.log(`Failed to persist query log to S3: ${err}`);
      this.dirty.add("queryLog");
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
      await this.putObject("history-users.json", JSON.stringify(data, null, 2));
    } catch (err) {
      this.log(`Failed to persist history users to S3: ${err}`);
      this.dirty.add("historyUsers");
    }
  }

  private log(msg: string): void {
    if (this.logger) {
      this.logger.logSystem("SERVER", `[S3] ${msg}`);
    }
  }
}
