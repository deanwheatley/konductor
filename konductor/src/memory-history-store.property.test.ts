/**
 * Property-Based Tests for MemoryHistoryStore
 *
 * Uses fast-check to verify correctness properties from the design document.
 *
 * Validates: Requirements 1.1, 2.1–2.5, 3.1, 4.1–4.4, 5.2, 5.3, 6.1, 6.2, 7.1–7.3, 8.1, 8.2
 */

import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { MemoryHistoryStore } from "./memory-history-store.js";
import type { HistoricalSession } from "./session-history-types.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const userIdArb = fc.stringMatching(/^[a-z][a-z0-9_]{2,15}$/);
const repoArb = fc.stringMatching(/^[a-z][a-z0-9-]{1,15}\/[a-z][a-z0-9-]{1,15}$/);
const branchArb = fc.stringMatching(/^[a-z][a-z0-9/-]{2,20}$/);
const filePathArb = fc.stringMatching(/^src\/[a-z][a-z0-9-]{1,15}\.[a-z]{2,4}$/);

/** Generate a past ISO timestamp within a range of days ago. */
function isoTimestampArb(daysAgoMin = 0, daysAgoMax = 60): fc.Arbitrary<string> {
  const now = Date.now();
  return fc
    .integer({ min: daysAgoMin * 86400000, max: Math.max(daysAgoMax * 86400000, 1) })
    .map((ms) => new Date(now - ms).toISOString());
}

/** Generate a valid active HistoricalSession. */
const activeSessionArb: fc.Arbitrary<HistoricalSession> = fc.record({
  sessionId: fc.uuid(),
  userId: userIdArb,
  repo: repoArb,
  branch: branchArb,
  files: fc.array(filePathArb, { minLength: 1, maxLength: 5 }),
  status: fc.constant("active" as const),
  createdAt: isoTimestampArb(0, 30),
  source: fc.constant("active" as string | undefined),
});


// ---------------------------------------------------------------------------
// Property 1: Storage record/retrieve round-trip
// **Feature: konductor-long-term-memory, Property 1: Storage record/retrieve round-trip**
// **Validates: Requirements 1.1, 2.1**
// ---------------------------------------------------------------------------

describe("Storage record/retrieve round-trip — Property Tests", () => {
  /**
   * **Feature: konductor-long-term-memory, Property 1: Storage record/retrieve round-trip**
   * **Validates: Requirements 1.1, 2.1**
   *
   * For any valid HistoricalSession with status "active", recording it and
   * then querying via getRecentActivity should return an equivalent record.
   */
  it("Property 1: record then retrieve via getRecentActivity returns equivalent session", async () => {
    await fc.assert(
      fc.asyncProperty(activeSessionArb, async (session) => {
        const store = new MemoryHistoryStore();
        await store.record(session);

        const farPast = "1970-01-01T00:00:00.000Z";
        const farFuture = "2099-12-31T23:59:59.999Z";
        const results = await store.getRecentActivity(session.repo, farPast, farFuture);

        expect(results).toHaveLength(1);
        const retrieved = results[0];
        expect(retrieved.sessionId).toBe(session.sessionId);
        expect(retrieved.userId).toBe(session.userId);
        expect(retrieved.repo).toBe(session.repo);
        expect(retrieved.branch).toBe(session.branch);
        expect(retrieved.files).toEqual(session.files);
        expect(retrieved.status).toBe(session.status);
        expect(retrieved.createdAt).toBe(session.createdAt);
      }),
      { numRuns: 100 },
    );
  });
});


// ---------------------------------------------------------------------------
// Property 2: Session lifecycle status transitions
// **Feature: konductor-long-term-memory, Property 2: Session lifecycle status transitions**
// **Validates: Requirements 2.2, 2.3, 5.2**
// ---------------------------------------------------------------------------

describe("Session lifecycle status transitions — Property Tests", () => {
  /**
   * **Feature: konductor-long-term-memory, Property 2: Session lifecycle status transitions**
   * **Validates: Requirements 2.2, 2.3, 5.2**
   */
  it("Property 2: lifecycle transitions preserve original fields and set correct status/timestamps", async () => {
    await fc.assert(
      fc.asyncProperty(activeSessionArb, isoTimestampArb(0, 1), async (session, expiredAt) => {
        const store = new MemoryHistoryStore();
        await store.record(session);

        // Mark expired
        await store.markExpired(session.sessionId, expiredAt);
        const afterExpire = await store.getRecentActivity(session.repo, "1970-01-01T00:00:00.000Z", "2099-12-31T23:59:59.999Z");
        expect(afterExpire).toHaveLength(1);
        expect(afterExpire[0].status).toBe("expired");
        expect(afterExpire[0].expiredAt).toBe(expiredAt);
        expect(afterExpire[0].sessionId).toBe(session.sessionId);
        expect(afterExpire[0].userId).toBe(session.userId);
        expect(afterExpire[0].repo).toBe(session.repo);
        expect(afterExpire[0].branch).toBe(session.branch);
        expect(afterExpire[0].files).toEqual(session.files);
        expect(afterExpire[0].createdAt).toBe(session.createdAt);

        // Mark committed
        await store.markCommitted({ sessionId: session.sessionId });
        const afterCommit = await store.getRecentActivity(session.repo, "1970-01-01T00:00:00.000Z", "2099-12-31T23:59:59.999Z");
        expect(afterCommit).toHaveLength(1);
        expect(afterCommit[0].status).toBe("committed");
        expect(afterCommit[0].committedAt).toBeDefined();
        expect(afterCommit[0].sessionId).toBe(session.sessionId);
        expect(afterCommit[0].userId).toBe(session.userId);
        expect(afterCommit[0].createdAt).toBe(session.createdAt);
      }),
      { numRuns: 100 },
    );
  });
});


// ---------------------------------------------------------------------------
// Property 3: File list updates are recorded
// **Feature: konductor-long-term-memory, Property 3: File list updates are recorded**
// **Validates: Requirements 2.4**
// ---------------------------------------------------------------------------

describe("File list updates — Property Tests", () => {
  /**
   * **Feature: konductor-long-term-memory, Property 3: File list updates are recorded**
   * **Validates: Requirements 2.4**
   */
  it("Property 3: updateFiles replaces the file list", async () => {
    await fc.assert(
      fc.asyncProperty(
        activeSessionArb,
        fc.array(filePathArb, { minLength: 1, maxLength: 5 }),
        async (session, newFiles) => {
          const store = new MemoryHistoryStore();
          await store.record(session);
          await store.updateFiles(session.sessionId, newFiles);

          const results = await store.getRecentActivity(session.repo, "1970-01-01T00:00:00.000Z", "2099-12-31T23:59:59.999Z");
          expect(results).toHaveLength(1);
          expect(results[0].files).toEqual(newFiles);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: Passive sessions excluded from history
// **Feature: konductor-long-term-memory, Property 4: Passive sessions excluded from history**
// **Validates: Requirements 2.5**
// ---------------------------------------------------------------------------

describe("Passive session exclusion — Property Tests", () => {
  /**
   * **Feature: konductor-long-term-memory, Property 4: Passive sessions excluded from history**
   * **Validates: Requirements 2.5**
   */
  it("Property 4: passive sessions are not stored", async () => {
    await fc.assert(
      fc.asyncProperty(
        activeSessionArb,
        fc.constantFrom("github_pr", "github_commit"),
        async (session, source) => {
          const store = new MemoryHistoryStore();
          const passiveSession: HistoricalSession = { ...session, source };
          await store.record(passiveSession);

          const results = await store.getRecentActivity(session.repo, "1970-01-01T00:00:00.000Z", "2099-12-31T23:59:59.999Z");
          expect(results).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ---------------------------------------------------------------------------
// Property 5: Purge removes only sessions older than retention
// **Feature: konductor-long-term-memory, Property 5: Purge removes only sessions older than retention**
// **Validates: Requirements 3.1**
// ---------------------------------------------------------------------------

describe("Purge correctness — Property Tests", () => {
  /**
   * **Feature: konductor-long-term-memory, Property 5: Purge removes only sessions older than retention**
   * **Validates: Requirements 3.1**
   */
  it("Property 5: purge removes only expired sessions older than cutoff", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(activeSessionArb, { minLength: 1, maxLength: 10 }),
        async (sessions) => {
          const store = new MemoryHistoryStore();
          const now = Date.now();
          const cutoff = new Date(now - 7 * 86400000).toISOString(); // 7 days ago

          for (let i = 0; i < sessions.length; i++) {
            const s = { ...sessions[i], sessionId: `sess-${i}` };
            await store.record(s);
            if (i % 3 === 0) {
              // Expire with old timestamp (before cutoff)
              const oldTs = new Date(now - 14 * 86400000).toISOString();
              await store.markExpired(s.sessionId, oldTs);
            } else if (i % 3 === 1) {
              // Expire with recent timestamp (after cutoff)
              const recentTs = new Date(now - 1 * 86400000).toISOString();
              await store.markExpired(s.sessionId, recentTs);
            }
            // i % 3 === 2: leave as active
          }

          const expectedOldExpired = sessions.filter((_, i) => i % 3 === 0).length;
          const purged = await store.purgeOlderThan(cutoff);
          expect(purged).toBe(expectedOldExpired);

          // Verify remaining: recently expired + active only
          const allRepos = [...new Set(sessions.map((s) => s.repo))];
          for (const repo of allRepos) {
            const remaining = await store.getRecentActivity(repo, "1970-01-01T00:00:00.000Z", "2099-12-31T23:59:59.999Z");
            for (const r of remaining) {
              if (r.status === "expired") {
                expect(r.expiredAt! >= cutoff).toBe(true);
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ---------------------------------------------------------------------------
// Property 6: Stale overlap detection correctness
// **Feature: konductor-long-term-memory, Property 6: Stale overlap detection correctness**
// **Validates: Requirements 4.1, 4.2, 4.3**
// ---------------------------------------------------------------------------

describe("Stale overlap detection — Property Tests", () => {
  /**
   * **Feature: konductor-long-term-memory, Property 6: Stale overlap detection correctness**
   * **Validates: Requirements 4.1, 4.2, 4.3**
   */
  it("Property 6: stale overlaps returns exactly expired sessions with file overlap", async () => {
    const fixedRepo = "test/repo";

    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            sessionId: fc.uuid(),
            userId: userIdArb,
            repo: fc.constant(fixedRepo),
            branch: branchArb,
            files: fc.array(filePathArb, { minLength: 1, maxLength: 3 }),
            status: fc.constant("active" as const),
            createdAt: isoTimestampArb(0, 30),
            source: fc.constant("active" as string | undefined),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        fc.array(filePathArb, { minLength: 1, maxLength: 3 }),
        async (sessions, queryFiles) => {
          const store = new MemoryHistoryStore();
          const now = new Date().toISOString();

          for (let i = 0; i < sessions.length; i++) {
            await store.record(sessions[i]);
            if (i % 2 === 0) {
              await store.markExpired(sessions[i].sessionId, now);
            }
          }

          const overlaps = await store.getStaleOverlaps(fixedRepo, queryFiles);
          const queryFileSet = new Set(queryFiles);

          // Every returned session must be expired and have file overlap
          for (const o of overlaps) {
            expect(o.status).toBe("expired");
            expect(o.files.some((f) => queryFileSet.has(f))).toBe(true);
          }

          // Every expired session with file overlap must be in the result
          const overlapIds = new Set(overlaps.map((o) => o.sessionId));
          for (let i = 0; i < sessions.length; i++) {
            if (i % 2 === 0) {
              const hasOverlap = sessions[i].files.some((f) => queryFileSet.has(f));
              if (hasOverlap) {
                expect(overlapIds.has(sessions[i].sessionId)).toBe(true);
              } else {
                expect(overlapIds.has(sessions[i].sessionId)).toBe(false);
              }
            } else {
              expect(overlapIds.has(sessions[i].sessionId)).toBe(false);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: Committed sessions excluded from stale overlaps
// **Feature: konductor-long-term-memory, Property 7: Committed sessions excluded from stale overlaps**
// **Validates: Requirements 4.4, 5.3**
// ---------------------------------------------------------------------------

describe("Committed session exclusion from stale overlaps — Property Tests", () => {
  /**
   * **Feature: konductor-long-term-memory, Property 7: Committed sessions excluded from stale overlaps**
   * **Validates: Requirements 4.4, 5.3**
   */
  it("Property 7: committed sessions never appear in stale overlaps", async () => {
    const fixedRepo = "test/repo";
    const sharedFile = "src/shared.ts";

    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            sessionId: fc.uuid(),
            userId: userIdArb,
            repo: fc.constant(fixedRepo),
            branch: branchArb,
            files: fc.constant([sharedFile] as string[]),
            status: fc.constant("active" as const),
            createdAt: isoTimestampArb(0, 30),
            source: fc.constant("active" as string | undefined),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        async (sessions) => {
          const store = new MemoryHistoryStore();
          const now = new Date().toISOString();

          for (const s of sessions) {
            await store.record(s);
            await store.markExpired(s.sessionId, now);
            await store.markCommitted({ sessionId: s.sessionId });
          }

          const overlaps = await store.getStaleOverlaps(fixedRepo, [sharedFile]);
          expect(overlaps).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ---------------------------------------------------------------------------
// Property 8: Recent activity returns sessions in time range
// **Feature: konductor-long-term-memory, Property 8: Recent activity returns sessions in time range**
// **Validates: Requirements 6.1**
// ---------------------------------------------------------------------------

describe("Recent activity time range — Property Tests", () => {
  /**
   * **Feature: konductor-long-term-memory, Property 8: Recent activity returns sessions in time range**
   * **Validates: Requirements 6.1**
   */
  it("Property 8: recent activity returns correct subset for time range", async () => {
    const fixedRepo = "test/repo";

    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            sessionId: fc.uuid(),
            userId: userIdArb,
            repo: fc.constant(fixedRepo),
            branch: branchArb,
            files: fc.array(filePathArb, { minLength: 1, maxLength: 3 }),
            status: fc.constant("active" as const),
            createdAt: isoTimestampArb(0, 60),
            source: fc.constant("active" as string | undefined),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        async (sessions) => {
          const store = new MemoryHistoryStore();
          for (const s of sessions) {
            await store.record(s);
          }

          const now = Date.now();
          const since = new Date(now - 20 * 86400000).toISOString();
          const until = new Date(now - 10 * 86400000).toISOString();

          const results = await store.getRecentActivity(fixedRepo, since, until);

          // Every returned session must have createdAt or expiredAt in range
          for (const r of results) {
            const createdInRange = r.createdAt >= since && r.createdAt <= until;
            const expiredInRange = r.expiredAt ? r.expiredAt >= since && r.expiredAt <= until : false;
            expect(createdInRange || expiredInRange).toBe(true);
          }

          // Every session with createdAt in range must be returned
          const resultIds = new Set(results.map((r) => r.sessionId));
          for (const s of sessions) {
            const createdInRange = s.createdAt >= since && s.createdAt <= until;
            if (createdInRange) {
              expect(resultIds.has(s.sessionId)).toBe(true);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 9: File history returns correct sessions
// **Feature: konductor-long-term-memory, Property 9: File history returns correct sessions**
// **Validates: Requirements 6.2**
// ---------------------------------------------------------------------------

describe("File history — Property Tests", () => {
  /**
   * **Feature: konductor-long-term-memory, Property 9: File history returns correct sessions**
   * **Validates: Requirements 6.2**
   */
  it("Property 9: file history returns sessions containing the queried file in time range", async () => {
    const fixedRepo = "test/repo";
    const targetFile = "src/target.ts";

    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            sessionId: fc.uuid(),
            userId: userIdArb,
            repo: fc.constant(fixedRepo),
            branch: branchArb,
            files: fc.oneof(
              fc.constant([targetFile] as string[]),
              fc.constant([targetFile, "src/other.ts"] as string[]),
              fc.array(filePathArb, { minLength: 1, maxLength: 3 }),
            ),
            status: fc.constant("active" as const),
            createdAt: isoTimestampArb(0, 60),
            source: fc.constant("active" as string | undefined),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        async (sessions) => {
          const store = new MemoryHistoryStore();
          for (const s of sessions) {
            await store.record(s);
          }

          const results = await store.getFileHistory(fixedRepo, targetFile, "1970-01-01T00:00:00.000Z", "2099-12-31T23:59:59.999Z");

          // Every returned session must contain the target file
          for (const r of results) {
            expect(r.files).toContain(targetFile);
          }

          // Every session with the target file must be returned
          const resultIds = new Set(results.map((r) => r.sessionId));
          for (const s of sessions) {
            if (s.files.includes(targetFile)) {
              expect(resultIds.has(s.sessionId)).toBe(true);
            } else {
              expect(resultIds.has(s.sessionId)).toBe(false);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ---------------------------------------------------------------------------
// Property 10: JSON export/import round-trip
// **Feature: konductor-long-term-memory, Property 10: JSON export/import round-trip**
// **Validates: Requirements 7.1, 7.2, 7.3**
// ---------------------------------------------------------------------------

describe("JSON export/import round-trip — Property Tests", () => {
  /**
   * **Feature: konductor-long-term-memory, Property 10: JSON export/import round-trip**
   * **Validates: Requirements 7.1, 7.2, 7.3**
   */
  it("Property 10: export then import produces equivalent sessions", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(activeSessionArb, { minLength: 1, maxLength: 8 }),
        async (sessions) => {
          const store1 = new MemoryHistoryStore();
          for (const s of sessions) {
            await store1.record(s);
          }

          const json = await store1.exportJson();
          const store2 = new MemoryHistoryStore();
          const imported = await store2.importJson(json);

          expect(imported).toBe(sessions.length);

          // Verify each session is present in the new store
          for (const s of sessions) {
            const results = await store2.getRecentActivity(s.repo, "1970-01-01T00:00:00.000Z", "2099-12-31T23:59:59.999Z");
            const found = results.find((r) => r.sessionId === s.sessionId);
            expect(found).toBeDefined();
            expect(found!.userId).toBe(s.userId);
            expect(found!.repo).toBe(s.repo);
            expect(found!.branch).toBe(s.branch);
            expect(found!.files).toEqual(s.files);
            expect(found!.status).toBe(s.status);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 11: User record upsert consistency
// **Feature: konductor-long-term-memory, Property 11: User record upsert consistency**
// **Validates: Requirements 8.1, 8.2**
// ---------------------------------------------------------------------------

describe("User record upsert consistency — Property Tests", () => {
  /**
   * **Feature: konductor-long-term-memory, Property 11: User record upsert consistency**
   * **Validates: Requirements 8.1, 8.2**
   */
  it("Property 11: upsert accumulates repos and updates timestamps correctly", async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        fc.array(repoArb, { minLength: 1, maxLength: 5 }),
        async (userId, repos) => {
          const store = new MemoryHistoryStore();

          for (const repo of repos) {
            await store.upsertUser(userId, repo);
          }

          const user = await store.getUser(userId);
          expect(user).not.toBeNull();
          expect(user!.userId).toBe(userId);

          // firstSeen should be <= lastSeen
          expect(user!.firstSeen <= user!.lastSeen).toBe(true);

          // All unique repos should be in reposAccessed
          const uniqueRepos = [...new Set(repos)];
          const accessedRepos = user!.reposAccessed.map((r) => r.repo);
          for (const repo of uniqueRepos) {
            expect(accessedRepos).toContain(repo);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
