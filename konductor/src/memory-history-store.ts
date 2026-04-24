/**
 * MemoryHistoryStore — In-memory implementation of ISessionHistoryStore.
 *
 * All data is lost on restart. This is the storage backend for the
 * current phase; a future phase will add SQLite.
 *
 * Requirements: 1.1, 2.1–2.5, 3.1, 4.1, 5.2, 6.1–6.3, 7.1–7.3, 8.1–8.4
 */

import type {
  ISessionHistoryStore,
  HistoricalSession,
  UserRecord,
} from "./session-history-types.js";

export class MemoryHistoryStore implements ISessionHistoryStore {
  private readonly sessions = new Map<string, HistoricalSession>();
  private readonly users = new Map<string, UserRecord>();
  private readonly settings = new Map<string, { key: string; value: string; category: string; updatedAt: string }>();

  // ── Lifecycle ─────────────────────────────────────────────────────

  async record(session: HistoricalSession): Promise<void> {
    // Filter out passive sessions (Req 2.5)
    if (session.source === "github_pr" || session.source === "github_commit") return;
    this.sessions.set(session.sessionId, { ...session });
  }

  async markExpired(sessionId: string, expiredAt: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.status = "expired";
    s.expiredAt = expiredAt;
  }

  async markCommitted(params: { sessionId?: string; userId?: string; repo?: string }): Promise<number> {
    let count = 0;
    const now = new Date().toISOString();
    for (const s of this.sessions.values()) {
      if (params.sessionId && s.sessionId === params.sessionId) {
        s.status = "committed";
        s.committedAt = now;
        count++;
      } else if (params.userId && params.repo && s.userId === params.userId && s.repo === params.repo && s.status === "expired") {
        s.status = "committed";
        s.committedAt = now;
        count++;
      }
    }
    return count;
  }

  async updateFiles(sessionId: string, files: string[]): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.files = [...files];
  }

  // ── Queries ───────────────────────────────────────────────────────

  async getStaleOverlaps(repo: string, files: string[]): Promise<HistoricalSession[]> {
    const fileSet = new Set(files);
    const results: HistoricalSession[] = [];
    for (const s of this.sessions.values()) {
      if (s.repo !== repo || s.status !== "expired") continue;
      if (s.files.some(f => fileSet.has(f))) {
        results.push({ ...s });
      }
    }
    return results;
  }

  async getRecentActivity(repo: string, since: string, until: string): Promise<HistoricalSession[]> {
    const results: HistoricalSession[] = [];
    for (const s of this.sessions.values()) {
      if (s.repo !== repo) continue;
      const inRange = (s.createdAt >= since && s.createdAt <= until) ||
                      (s.expiredAt && s.expiredAt >= since && s.expiredAt <= until);
      if (inRange) results.push({ ...s });
    }
    return results;
  }

  async getFileHistory(repo: string, filePath: string, since: string, until: string): Promise<HistoricalSession[]> {
    const results: HistoricalSession[] = [];
    for (const s of this.sessions.values()) {
      if (s.repo !== repo) continue;
      if (!s.files.includes(filePath)) continue;
      if (s.createdAt >= since && s.createdAt <= until) results.push({ ...s });
    }
    return results;
  }

  async getCollisionTimeline(userId: string, repo: string, since: string, until: string): Promise<HistoricalSession[]> {
    const results: HistoricalSession[] = [];
    for (const s of this.sessions.values()) {
      if (s.userId !== userId || s.repo !== repo) continue;
      if (s.createdAt >= since && s.createdAt <= until) results.push({ ...s });
    }
    return results;
  }

  // ── Maintenance ───────────────────────────────────────────────────

  async purgeOlderThan(cutoffDate: string): Promise<number> {
    let count = 0;
    for (const [id, s] of this.sessions) {
      if (s.status !== "active" && s.expiredAt && s.expiredAt < cutoffDate) {
        this.sessions.delete(id);
        count++;
      }
    }
    return count;
  }

  async exportJson(): Promise<string> {
    return JSON.stringify({
      sessions: [...this.sessions.values()],
      users: [...this.users.values()],
    });
  }

  async importJson(json: string): Promise<number> {
    const data = JSON.parse(json);
    let count = 0;
    if (Array.isArray(data.sessions)) {
      for (const s of data.sessions) {
        if (s.sessionId && s.userId && s.repo && s.status) {
          this.sessions.set(s.sessionId, s);
          count++;
        }
      }
    }
    if (Array.isArray(data.users)) {
      for (const u of data.users) {
        if (u.userId) this.users.set(u.userId, u);
      }
    }
    return count;
  }

  // ── User Records ──────────────────────────────────────────────────

  async upsertUser(userId: string, repo: string, extras?: { branch?: string; clientVersion?: string; ipAddress?: string }): Promise<void> {
    const now = new Date().toISOString();
    const existing = this.users.get(userId);
    if (existing) {
      existing.lastSeen = now;
      if (extras?.clientVersion) existing.clientVersion = extras.clientVersion;
      if (extras?.branch) existing.lastBranch = extras.branch;
      if (extras?.ipAddress) existing.ipAddress = extras.ipAddress;
      existing.lastRepo = repo;
      const repoEntry = existing.reposAccessed.find(r => r.repo === repo);
      if (repoEntry) {
        repoEntry.lastAccessed = now;
      } else {
        existing.reposAccessed.push({ repo, lastAccessed: now });
      }
    } else {
      // Bootstrap admin: first user gets admin: true (Req 8.4)
      const isFirstUser = this.users.size === 0;
      this.users.set(userId, {
        userId,
        firstSeen: now,
        lastSeen: now,
        reposAccessed: [{ repo, lastAccessed: now }],
        admin: isFirstUser,
        installerChannel: null,
        settings: {},
        clientVersion: extras?.clientVersion ?? null,
        lastRepo: repo,
        lastBranch: extras?.branch ?? null,
        ipAddress: extras?.ipAddress ?? null,
      });
    }
  }

  async getUser(userId: string): Promise<UserRecord | null> {
    return this.users.get(userId) ?? null;
  }

  async getAllUsers(): Promise<UserRecord[]> {
    return [...this.users.values()];
  }

  async updateUser(userId: string, updates: { installerChannel?: string; admin?: boolean }): Promise<boolean> {
    const user = this.users.get(userId);
    if (!user) return false;
    if (updates.installerChannel !== undefined) user.installerChannel = updates.installerChannel;
    if (updates.admin !== undefined) user.admin = updates.admin;
    return true;
  }

  // ── Settings ──────────────────────────────────────────────────────

  async getSetting(key: string): Promise<string | null> {
    return this.settings.get(key)?.value ?? null;
  }

  async setSetting(key: string, value: string, category: string): Promise<void> {
    this.settings.set(key, { key, value, category, updatedAt: new Date().toISOString() });
  }

  async getAllSettings(category?: string): Promise<Array<{ key: string; value: string; category: string; updatedAt: string }>> {
    const all = [...this.settings.values()];
    return category ? all.filter(s => s.category === category) : all;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  async close(): Promise<void> {
    this.sessions.clear();
    this.users.clear();
    this.settings.clear();
  }
}
