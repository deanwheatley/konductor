/**
 * Unit Tests for MemoryHistoryStore — Edge Cases
 *
 * Validates: Requirements 1.1, 5.5, 8.1
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MemoryHistoryStore } from "./memory-history-store.js";
import type { HistoricalSession } from "./session-history-types.js";

function makeSession(overrides: Partial<HistoricalSession> = {}): HistoricalSession {
  return {
    sessionId: "sess-1",
    userId: "alice",
    repo: "org/repo",
    branch: "main",
    files: ["src/index.ts"],
    status: "active",
    createdAt: new Date().toISOString(),
    source: "active",
    ...overrides,
  };
}

describe("MemoryHistoryStore — Edge Cases", () => {
  let store: MemoryHistoryStore;
  beforeEach(() => { store = new MemoryHistoryStore(); });

  // --- Empty store operations ---

  it("getStaleOverlaps on empty store returns empty array", async () => {
    const result = await store.getStaleOverlaps("org/repo", ["src/index.ts"]);
    expect(result).toEqual([]);
  });

  it("purgeOlderThan on empty store returns 0", async () => {
    const result = await store.purgeOlderThan(new Date().toISOString());
    expect(result).toBe(0);
  });

  it("exportJson on empty store returns valid JSON with empty arrays", async () => {
    const json = await store.exportJson();
    const data = JSON.parse(json);
    expect(data.sessions).toEqual([]);
    expect(data.users).toEqual([]);
  });

  // --- Nonexistent session operations ---

  it("markExpired for nonexistent sessionId is a no-op", async () => {
    await store.markExpired("nonexistent", new Date().toISOString());
    const json = await store.exportJson();
    const data = JSON.parse(json);
    expect(data.sessions).toEqual([]);
  });

  it("markCommitted for nonexistent session returns count 0", async () => {
    const count = await store.markCommitted({ sessionId: "nonexistent" });
    expect(count).toBe(0);
  });

  it("updateFiles for nonexistent sessionId is a no-op", async () => {
    await store.updateFiles("nonexistent", ["src/new.ts"]);
    const json = await store.exportJson();
    const data = JSON.parse(json);
    expect(data.sessions).toEqual([]);
  });

  // --- importJson edge cases ---

  it("importJson with invalid JSON throws", async () => {
    await expect(store.importJson("not valid json")).rejects.toThrow();
  });

  it("importJson with mixed valid/invalid records imports only valid ones", async () => {
    const json = JSON.stringify({
      sessions: [
        makeSession({ sessionId: "valid-1" }),
        { noSessionId: true, userId: "bob" }, // missing sessionId
        { sessionId: "valid-2", userId: "carol", repo: "org/repo", status: "active" }, // valid
      ],
      users: [],
    });
    const count = await store.importJson(json);
    expect(count).toBe(2); // valid-1 and valid-2
  });

  // --- Bootstrap admin ---

  it("first user gets admin: true", async () => {
    await store.upsertUser("first-user", "org/repo");
    const user = await store.getUser("first-user");
    expect(user).not.toBeNull();
    expect(user!.admin).toBe(true);
  });

  it("second user gets admin: false", async () => {
    await store.upsertUser("first-user", "org/repo");
    await store.upsertUser("second-user", "org/repo");
    const user = await store.getUser("second-user");
    expect(user).not.toBeNull();
    expect(user!.admin).toBe(false);
  });
});
