import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import fc from "fast-check";
import { PersistenceStore } from "./persistence-store.js";
import type { WorkSession } from "./types.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Generates a valid owner/repo string. */
const repoArb = fc
  .tuple(
    fc.stringMatching(/^[a-z0-9]{1,10}$/),
    fc.stringMatching(/^[a-z0-9-]{1,15}$/),
  )
  .map(([owner, name]) => `${owner}/${name}`);

/** Generates a forward-slash relative file path. */
const filePathArb = fc
  .array(
    fc.stringMatching(/^[a-z0-9._-]{1,12}$/),
    { minLength: 1, maxLength: 4 },
  )
  .map((parts) => parts.join("/"));

/** Generates a valid WorkSession. */
const workSessionArb: fc.Arbitrary<WorkSession> = fc
  .record({
    sessionId: fc.uuid(),
    userId: fc.stringMatching(/^[a-z0-9_]{1,20}$/),
    repo: repoArb,
    branch: fc.stringMatching(/^[a-z0-9/_-]{1,20}$/),
    files: fc.array(filePathArb, { minLength: 1, maxLength: 10 }),
    createdAt: fc.integer({ min: 1577836800000, max: 1893456000000 }).map((ms) => new Date(ms).toISOString()),
    lastHeartbeat: fc.integer({ min: 1577836800000, max: 1893456000000 }).map((ms) => new Date(ms).toISOString()),
  });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string;
let storePath: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "konductor-test-"));
  storePath = join(tempDir, "sessions.json");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Property-Based Tests
// ---------------------------------------------------------------------------

describe("PersistenceStore — Property Tests", () => {
  /**
   * **Feature: konductor-mcp-server, Property 9: Work session serialization round-trip**
   * **Validates: Requirements 6.5**
   *
   * For any list of valid WorkSession objects, saving them to disk and
   * loading them back should produce an equivalent list.
   */
  it("Property 9: save then load produces equivalent sessions (round-trip)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(workSessionArb, { minLength: 0, maxLength: 20 }),
        async (sessions) => {
          const store = new PersistenceStore(storePath);
          await store.save(sessions);
          const loaded = await store.load();

          expect(loaded).toEqual(sessions);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ---------------------------------------------------------------------------
// Unit Tests
// ---------------------------------------------------------------------------

describe("PersistenceStore — Unit Tests", () => {
  it("returns empty array when file does not exist", async () => {
    const store = new PersistenceStore(join(tempDir, "nonexistent.json"));
    const sessions = await store.load();
    expect(sessions).toEqual([]);
  });

  it("returns empty array and backs up corrupted JSON", async () => {
    await writeFile(storePath, "NOT VALID JSON {{{", "utf-8");
    const store = new PersistenceStore(storePath);
    const sessions = await store.load();

    expect(sessions).toEqual([]);
    // Backup file should exist
    const backup = await readFile(`${storePath}.backup`, "utf-8");
    expect(backup).toBe("NOT VALID JSON {{{");
  });

  it("returns empty array and backs up when file contains non-array JSON", async () => {
    await writeFile(storePath, JSON.stringify({ not: "an array" }), "utf-8");
    const store = new PersistenceStore(storePath);
    const sessions = await store.load();
    expect(sessions).toEqual([]);
  });

  it("filters out invalid session entries and backs up", async () => {
    const validSession: WorkSession = {
      sessionId: "00000000-0000-0000-0000-000000000001",
      userId: "alice",
      repo: "org/repo",
      branch: "main",
      files: ["src/index.ts"],
      createdAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
    };
    const invalidEntry = { sessionId: "bad", userId: 123 }; // missing fields, wrong types

    await writeFile(storePath, JSON.stringify([validSession, invalidEntry]), "utf-8");
    const store = new PersistenceStore(storePath);
    const sessions = await store.load();

    expect(sessions).toHaveLength(1);
    expect(sessions[0].userId).toBe("alice");
  });

  it("atomic write: file contains valid JSON after save", async () => {
    const store = new PersistenceStore(storePath);
    const session: WorkSession = {
      sessionId: "00000000-0000-0000-0000-000000000002",
      userId: "bob",
      repo: "org/repo",
      branch: "feature",
      files: ["README.md"],
      createdAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
    };

    await store.save([session]);

    const raw = await readFile(storePath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].userId).toBe("bob");
  });

  it("excludes passive PR sessions from persistence", async () => {
    const store = new PersistenceStore(storePath);
    const activeSession: WorkSession = {
      sessionId: "00000000-0000-0000-0000-000000000010",
      userId: "alice",
      repo: "org/repo",
      branch: "main",
      files: ["src/index.ts"],
      createdAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
    };
    const prSession: WorkSession = {
      sessionId: "00000000-0000-0000-0000-000000000011",
      userId: "bob",
      repo: "org/repo",
      branch: "feature-x",
      files: ["src/utils.ts"],
      createdAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      source: "github_pr",
      prNumber: 42,
      prUrl: "https://github.com/org/repo/pull/42",
      prTargetBranch: "main",
    };

    await store.save([activeSession, prSession]);

    const raw = await readFile(storePath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].userId).toBe("alice");
  });

  it("excludes passive commit sessions from persistence", async () => {
    const store = new PersistenceStore(storePath);
    const activeSession: WorkSession = {
      sessionId: "00000000-0000-0000-0000-000000000020",
      userId: "alice",
      repo: "org/repo",
      branch: "main",
      files: ["src/index.ts"],
      createdAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
    };
    const commitSession: WorkSession = {
      sessionId: "00000000-0000-0000-0000-000000000021",
      userId: "carol",
      repo: "org/repo",
      branch: "main",
      files: ["src/api.ts"],
      createdAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      source: "github_commit",
      commitDateRange: { earliest: "2026-04-15T00:00:00Z", latest: "2026-04-16T00:00:00Z" },
    };

    await store.save([activeSession, commitSession]);

    const raw = await readFile(storePath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].userId).toBe("alice");
  });

  it("persists sessions with source=active", async () => {
    const store = new PersistenceStore(storePath);
    const session: WorkSession = {
      sessionId: "00000000-0000-0000-0000-000000000030",
      userId: "dave",
      repo: "org/repo",
      branch: "main",
      files: ["src/index.ts"],
      createdAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      source: "active",
    };

    await store.save([session]);

    const raw = await readFile(storePath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].userId).toBe("dave");
  });

  it("persists sessions with no source field (backward compatible)", async () => {
    const store = new PersistenceStore(storePath);
    const session: WorkSession = {
      sessionId: "00000000-0000-0000-0000-000000000040",
      userId: "eve",
      repo: "org/repo",
      branch: "main",
      files: ["src/index.ts"],
      createdAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
    };

    await store.save([session]);

    const raw = await readFile(storePath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].userId).toBe("eve");
  });
});
