import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import fc from "fast-check";
import { SessionManager } from "./session-manager.js";
import { PersistenceStore } from "./persistence-store.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const userIdArb = fc.stringMatching(/^[a-z0-9_]{1,20}$/);

const repoArb = fc
  .tuple(
    fc.stringMatching(/^[a-z0-9]{1,10}$/),
    fc.stringMatching(/^[a-z0-9-]{1,15}$/),
  )
  .map(([owner, name]) => `${owner}/${name}`);

const branchArb = fc.stringMatching(/^[a-z0-9/_-]{1,20}$/);

const filePathArb = fc
  .array(
    fc.stringMatching(/^[a-z0-9._-]{1,12}$/),
    { minLength: 1, maxLength: 4 },
  )
  .map((parts) => parts.join("/"));

const fileListArb = fc.array(filePathArb, { minLength: 1, maxLength: 10 });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string;
const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes

async function createManager(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<SessionManager> {
  const storePath = join(tempDir, `sessions-${Date.now()}.json`);
  const store = new PersistenceStore(storePath);
  const manager = new SessionManager(store, () => timeoutMs);
  await manager.init();
  return manager;
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "konductor-sm-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Property-Based Tests
// ---------------------------------------------------------------------------

describe("SessionManager — Property Tests", () => {
  /**
   * **Feature: konductor-mcp-server, Property 1: Registration preserves session data**
   * **Validates: Requirements 1.1, 1.2**
   *
   * For any valid userId, repo, branch, and files, registering a session
   * and then retrieving it should produce a session whose fields match
   * the original registration inputs.
   */
  it("Property 1: Registration preserves session data", async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        repoArb,
        branchArb,
        fileListArb,
        async (userId, repo, branch, files) => {
          const manager = await createManager();
          const session = await manager.register(userId, repo, branch, files);

          expect(session.userId).toBe(userId);
          expect(session.repo).toBe(repo);
          expect(session.branch).toBe(branch);
          expect(session.files).toEqual(files);
          expect(session.sessionId).toBeTruthy();
          expect(session.createdAt).toBeTruthy();
          expect(session.lastHeartbeat).toBeTruthy();

          // Also verify it appears in active sessions
          const active = await manager.getActiveSessions(repo);
          const found = active.find((s) => s.sessionId === session.sessionId);
          expect(found).toBeDefined();
          expect(found!.userId).toBe(userId);
          expect(found!.repo).toBe(repo);
          expect(found!.branch).toBe(branch);
          expect(found!.files).toEqual(files);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Feature: konductor-mcp-server, Property 2: Session update reflects new files**
   * **Validates: Requirements 1.3**
   *
   * For any registered session and any new file list, updating the session's
   * files should produce a session whose files field matches the new list.
   */
  it("Property 2: Session update reflects new files", async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        repoArb,
        branchArb,
        fileListArb,
        fileListArb,
        async (userId, repo, branch, initialFiles, newFiles) => {
          const manager = await createManager();
          const session = await manager.register(userId, repo, branch, initialFiles);
          const updated = await manager.update(session.sessionId, newFiles);

          expect(updated.files).toEqual(newFiles);
          expect(updated.sessionId).toBe(session.sessionId);

          // Verify via getActiveSessions too
          const active = await manager.getActiveSessions(repo);
          const found = active.find((s) => s.sessionId === session.sessionId);
          expect(found!.files).toEqual(newFiles);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Feature: konductor-mcp-server, Property 3: Deregistration removes session**
   * **Validates: Requirements 1.4**
   *
   * For any registered session, deregistering it should remove it from
   * the active sessions list for that repository.
   */
  it("Property 3: Deregistration removes session", async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        repoArb,
        branchArb,
        fileListArb,
        async (userId, repo, branch, files) => {
          const manager = await createManager();
          const session = await manager.register(userId, repo, branch, files);

          const removed = await manager.deregister(session.sessionId);
          expect(removed).toBe(true);

          const active = await manager.getActiveSessions(repo);
          const found = active.find((s) => s.sessionId === session.sessionId);
          expect(found).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Feature: konductor-mcp-server, Property 4: Stale sessions are excluded from active queries**
   * **Validates: Requirements 1.5**
   *
   * For any set of sessions where some have a lastHeartbeat older than the
   * configured timeout, getActiveSessions should return only the fresh ones.
   */
  it("Property 4: Stale sessions are excluded from active queries", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            userId: userIdArb,
            branch: branchArb,
            files: fileListArb,
            stale: fc.boolean(),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        repoArb,
        async (sessionSpecs, repo) => {
          const timeoutMs = 60_000; // 1 minute
          const manager = await createManager(timeoutMs);

          // Deduplicate by userId to avoid the user+repo update behavior
          const uniqueSpecs = new Map(
            sessionSpecs.map((s) => [s.userId, s]),
          );

          const registered: Array<{ sessionId: string; stale: boolean }> = [];

          for (const [, spec] of uniqueSpecs) {
            const session = await manager.register(
              spec.userId,
              repo,
              spec.branch,
              spec.files,
            );

            if (spec.stale) {
              // Manually backdate the heartbeat to make it stale
              (session as any).lastHeartbeat = new Date(
                Date.now() - timeoutMs - 10_000,
              ).toISOString();
            }

            registered.push({
              sessionId: session.sessionId,
              stale: spec.stale,
            });
          }

          const active = await manager.getActiveSessions(repo);
          const activeIds = new Set(active.map((s) => s.sessionId));

          for (const reg of registered) {
            if (reg.stale) {
              expect(activeIds.has(reg.sessionId)).toBe(false);
            } else {
              expect(activeIds.has(reg.sessionId)).toBe(true);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Feature: konductor-mcp-server, Property 8: List sessions returns exactly the non-stale sessions for a repo**
   * **Validates: Requirements 5.5**
   *
   * For any set of sessions across multiple repos (some stale, some active),
   * getActiveSessions for a specific repo should return exactly the non-stale
   * sessions belonging to that repo.
   */
  it("Property 8: List sessions returns exactly the non-stale sessions for a repo", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            userId: userIdArb,
            repo: repoArb,
            branch: branchArb,
            files: fileListArb,
            stale: fc.boolean(),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        repoArb,
        async (sessionSpecs, targetRepo) => {
          const timeoutMs = 60_000;
          const manager = await createManager(timeoutMs);

          // Deduplicate by userId+repo to avoid update behavior
          const uniqueSpecs = new Map(
            sessionSpecs.map((s) => [`${s.userId}:${s.repo}`, s]),
          );

          const allRegistered: Array<{
            sessionId: string;
            repo: string;
            stale: boolean;
          }> = [];

          for (const [, spec] of uniqueSpecs) {
            const session = await manager.register(
              spec.userId,
              spec.repo,
              spec.branch,
              spec.files,
            );

            if (spec.stale) {
              (session as any).lastHeartbeat = new Date(
                Date.now() - timeoutMs - 10_000,
              ).toISOString();
            }

            allRegistered.push({
              sessionId: session.sessionId,
              repo: spec.repo,
              stale: spec.stale,
            });
          }

          const active = await manager.getActiveSessions(targetRepo);
          const activeIds = new Set(active.map((s) => s.sessionId));

          // Every returned session should be for targetRepo and non-stale
          for (const s of active) {
            expect(s.repo).toBe(targetRepo);
          }

          // Check that all non-stale sessions for targetRepo are included,
          // and all stale or wrong-repo sessions are excluded
          for (const reg of allRegistered) {
            if (reg.repo === targetRepo && !reg.stale) {
              expect(activeIds.has(reg.sessionId)).toBe(true);
            } else {
              expect(activeIds.has(reg.sessionId)).toBe(false);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Unit Tests
// ---------------------------------------------------------------------------

describe("SessionManager — Unit Tests", () => {
  it("register with duplicate user+repo updates existing session", async () => {
    const manager = await createManager();
    const first = await manager.register("alice", "org/repo", "main", ["a.ts"]);
    const second = await manager.register("alice", "org/repo", "feature", ["b.ts"]);

    // Should reuse the same session ID
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.branch).toBe("feature");
    expect(second.files).toEqual(["b.ts"]);

    // Only one session should exist
    const active = await manager.getActiveSessions("org/repo");
    expect(active).toHaveLength(1);
  });

  it("deregister with invalid session ID returns false", async () => {
    const manager = await createManager();
    const result = await manager.deregister("nonexistent-id");
    expect(result).toBe(false);
  });

  it("heartbeat refreshes the lastHeartbeat timestamp", async () => {
    const manager = await createManager();
    const session = await manager.register("bob", "org/repo", "main", ["x.ts"]);
    const originalHeartbeat = session.lastHeartbeat;

    // Small delay to ensure timestamp differs
    await new Promise((r) => setTimeout(r, 10));

    const refreshed = await manager.heartbeat(session.sessionId);
    expect(new Date(refreshed.lastHeartbeat).getTime()).toBeGreaterThan(
      new Date(originalHeartbeat).getTime(),
    );
  });

  it("update throws for nonexistent session", async () => {
    const manager = await createManager();
    await expect(manager.update("bad-id", ["a.ts"])).rejects.toThrow(
      "Session not found",
    );
  });

  it("heartbeat throws for nonexistent session", async () => {
    const manager = await createManager();
    await expect(manager.heartbeat("bad-id")).rejects.toThrow(
      "Session not found",
    );
  });

  it("cleanupStale removes only stale sessions", async () => {
    const timeoutMs = 50;
    const manager = await createManager(timeoutMs);

    const stale = await manager.register("alice", "org/repo", "main", ["a.ts"]);
    // Backdate the heartbeat
    (stale as any).lastHeartbeat = new Date(
      Date.now() - timeoutMs - 10_000,
    ).toISOString();

    await manager.register("bob", "org/repo", "main", ["b.ts"]);

    const removed = await manager.cleanupStale();
    expect(removed).toBe(1);

    const active = await manager.getActiveSessions("org/repo");
    expect(active).toHaveLength(1);
    expect(active[0].userId).toBe("bob");
  });
});
