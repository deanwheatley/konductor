/**
 * SessionManager — CRUD operations on work sessions with persistence.
 *
 * Maintains an in-memory Map of sessions keyed by sessionId, delegates
 * durable storage to an IPersistenceStore. Supports heartbeat tracking
 * and stale session cleanup based on a configurable timeout.
 */

import { randomUUID } from "node:crypto";
import type {
  ISessionManager,
  IPersistenceStore,
  WorkSession,
} from "./types.js";

export class SessionManager implements ISessionManager {
  private sessions: Map<string, WorkSession> = new Map();
  private readonly store: IPersistenceStore;
  private readonly timeoutMs: () => number;

  /**
   * @param store        Persistence backend for durable session storage.
   * @param timeoutMs    Function returning the stale-session timeout in milliseconds.
   *                     Using a function so it can reflect hot-reloaded config.
   */
  constructor(store: IPersistenceStore, timeoutMs: () => number) {
    this.store = store;
    this.timeoutMs = timeoutMs;
  }

  /** Load existing sessions from the persistence store into memory. */
  async init(): Promise<void> {
    const loaded = await this.store.load();
    for (const session of loaded) {
      this.sessions.set(session.sessionId, session);
    }
  }

  /**
   * Register a new work session. If a session already exists for the same
   * user + repo combination, it is replaced (updated) rather than duplicated.
   */
  async register(
    userId: string,
    repo: string,
    branch: string,
    files: string[],
  ): Promise<WorkSession> {
    // Check for existing session with same user+repo — update it instead
    for (const existing of this.sessions.values()) {
      if (existing.userId === userId && existing.repo === repo) {
        existing.branch = branch;
        existing.files = files;
        existing.lastHeartbeat = new Date().toISOString();
        await this.persist();
        return existing;
      }
    }

    const now = new Date().toISOString();
    const session: WorkSession = {
      sessionId: randomUUID(),
      userId,
      repo,
      branch,
      files,
      createdAt: now,
      lastHeartbeat: now,
    };

    this.sessions.set(session.sessionId, session);
    await this.persist();
    return session;
  }

  /** Update the file list for an existing session and refresh its heartbeat. */
  async update(sessionId: string, files: string[]): Promise<WorkSession> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    session.files = files;
    session.lastHeartbeat = new Date().toISOString();
    await this.persist();
    return session;
  }

  /** Remove a session by ID. Returns true if the session existed. */
  async deregister(sessionId: string): Promise<boolean> {
    const existed = this.sessions.delete(sessionId);
    if (existed) {
      await this.persist();
    }
    return existed;
  }

  /** Refresh the heartbeat timestamp for a session. */
  async heartbeat(sessionId: string): Promise<WorkSession> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    session.lastHeartbeat = new Date().toISOString();
    await this.persist();
    return session;
  }

  /**
   * Return all active (non-stale) sessions for a given repository.
   * A session is stale if its lastHeartbeat is older than the configured timeout.
   */
  async getActiveSessions(repo: string): Promise<WorkSession[]> {
    const cutoff = Date.now() - this.timeoutMs();
    const active: WorkSession[] = [];
    for (const session of this.sessions.values()) {
      if (
        session.repo === repo &&
        new Date(session.lastHeartbeat).getTime() > cutoff
      ) {
        active.push(session);
      }
    }
    return active;
  }

  /**
   * Remove all sessions whose lastHeartbeat is older than the timeout.
   * Returns the number of sessions removed.
   */
  async cleanupStale(): Promise<number> {
    const cutoff = Date.now() - this.timeoutMs();
    let removed = 0;
    for (const [id, session] of this.sessions) {
      if (new Date(session.lastHeartbeat).getTime() <= cutoff) {
        this.sessions.delete(id);
        removed++;
      }
    }
    if (removed > 0) {
      await this.persist();
    }
    return removed;
  }

  /** Flush current in-memory sessions to the persistence store. */
  private async persist(): Promise<void> {
    await this.store.save([...this.sessions.values()]);
  }
}
