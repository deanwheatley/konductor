import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { QueryLogEntry } from "./baton-types.js";
import { QueryLogStore } from "./baton-query-log.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const timestampArb = fc
  .integer({ min: 1700000000000, max: 1800000000000 })
  .map((ms) => new Date(ms).toISOString());

const safeIdArb = fc.stringMatching(/^[a-z0-9_]{1,15}$/);

const branchArb = fc.stringMatching(/^[a-z0-9/_-]{1,20}$/);

const repoArb = fc
  .tuple(
    fc.stringMatching(/^[a-z0-9]{1,10}$/),
    fc.stringMatching(/^[a-z0-9-]{1,15}$/),
  )
  .map(([owner, name]) => `${owner}/${name}`);

const queryTypeArb = fc.constantFrom(
  "who_is_active",
  "who_overlaps",
  "risk_assessment",
  "repo_hotspots",
  "active_branches",
  "coordination_advice",
);

const parametersArb = fc.oneof(
  fc.constant({} as Record<string, unknown>),
  fc.record({ repo: repoArb }).map((r) => r as Record<string, unknown>),
  fc
    .record({ repo: repoArb, userId: safeIdArb })
    .map((r) => r as Record<string, unknown>),
);

const queryLogEntryArb: fc.Arbitrary<QueryLogEntry> = fc.record({
  id: fc.uuid(),
  repo: repoArb,
  timestamp: timestampArb,
  userId: safeIdArb,
  branch: branchArb,
  queryType: queryTypeArb,
  parameters: parametersArb,
});

/** Generate a list of entries all sharing the same repo. */
function entriesForRepoArb(repo: string, minLen = 1, maxLen = 20) {
  return fc.array(queryLogEntryArb, { minLength: minLen, maxLength: maxLen }).map(
    (list) => list.map((e) => ({ ...e, repo })),
  );
}

// ---------------------------------------------------------------------------
// Property-Based Tests
// ---------------------------------------------------------------------------

describe("QueryLogStore — Property Tests", () => {
  /**
   * **Feature: konductor-baton, Property 6: Query log entry addition and retrieval**
   * **Validates: Requirements 4.1, 4.2**
   *
   * For any QueryLogEntry added to the QueryLogStore for a given repo,
   * the entry should be retrievable from getEntries(repo) and should
   * contain the original timestamp, userId, queryType, and parameters.
   */
  it("Property 6: Query log entry addition and retrieval", () => {
    fc.assert(
      fc.property(
        repoArb,
        entriesForRepoArb("placeholder", 1, 20),
        (repo, entries) => {
          const store = new QueryLogStore();
          const repoEntries = entries.map((e) => ({ ...e, repo }));

          for (const entry of repoEntries) {
            store.add(entry);
          }

          const retrieved = store.getEntries(repo);

          // All added entries should be retrievable
          expect(retrieved.length).toBe(repoEntries.length);

          // Each retrieved entry should match the original fields
          for (let i = 0; i < repoEntries.length; i++) {
            const orig = repoEntries[i];
            const got = retrieved[i];

            expect(got.id).toBe(orig.id);
            expect(got.repo).toBe(orig.repo);
            expect(got.timestamp).toBe(orig.timestamp);
            expect(got.userId).toBe(orig.userId);
            expect(got.branch).toBe(orig.branch);
            expect(got.queryType).toBe(orig.queryType);
            expect(got.parameters).toEqual(orig.parameters);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Entries for different repos should be isolated.
   */
  it("Property 6 (supplemental): entries are isolated by repo", () => {
    fc.assert(
      fc.property(
        repoArb,
        repoArb,
        queryLogEntryArb,
        (repoA, repoB, entry) => {
          // Skip if repos collide — we want two distinct repos
          fc.pre(repoA !== repoB);

          const store = new QueryLogStore();
          store.add({ ...entry, repo: repoA });

          expect(store.getEntries(repoA).length).toBe(1);
          expect(store.getEntries(repoB).length).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Ring buffer eviction: when more than 1000 entries are added for a repo,
   * only the most recent 1000 should be retained, and the oldest should be evicted.
   */
  it("Property 6 (supplemental): ring buffer evicts oldest entries beyond 1000", () => {
    const store = new QueryLogStore();
    const repo = "test/ring-buffer";
    const totalEntries = 1005;

    const entries: QueryLogEntry[] = [];
    for (let i = 0; i < totalEntries; i++) {
      entries.push({
        id: `entry-${String(i).padStart(5, "0")}`,
        repo,
        timestamp: new Date(1700000000000 + i * 1000).toISOString(),
        userId: "user1",
        branch: "main",
        queryType: "who_is_active",
        parameters: {},
      });
    }

    for (const e of entries) {
      store.add(e);
    }

    const retrieved = store.getEntries(repo);
    expect(retrieved.length).toBe(1000);

    // Oldest 5 entries should have been evicted
    expect(retrieved[0].id).toBe("entry-00005");
    // Most recent entry should be last
    expect(retrieved[retrieved.length - 1].id).toBe("entry-01004");
  });
});
