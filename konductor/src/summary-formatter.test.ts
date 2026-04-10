import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { SummaryFormatter } from "./summary-formatter.js";
import { CollisionState, SEVERITY } from "./types.js";
import type { CollisionResult, WorkSession } from "./types.js";

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
  .tuple(
    fc.stringMatching(/^[a-z]{1,8}$/),
    fc.stringMatching(/^[a-z0-9_-]{1,12}\.[a-z]{1,4}$/),
  )
  .map(([dir, file]) => `${dir}/${file}`);

const dirArb = fc.stringMatching(/^[a-z]{1,8}$/);

const timestampArb = fc
  .integer({ min: 1700000000000, max: 1800000000000 })
  .map((ms) => new Date(ms).toISOString());

function makeSession(overrides: Partial<WorkSession> & { userId: string; repo: string }): WorkSession {
  return {
    sessionId: overrides.sessionId ?? crypto.randomUUID(),
    userId: overrides.userId,
    repo: overrides.repo,
    branch: overrides.branch ?? "main",
    files: overrides.files ?? [],
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    lastHeartbeat: overrides.lastHeartbeat ?? new Date().toISOString(),
  };
}

/**
 * Generator for a valid CollisionResult with controlled content.
 * Ensures overlapping sessions, shared files, and shared directories
 * are consistent with the collision state.
 */
const collisionResultArb: fc.Arbitrary<CollisionResult> = fc
  .record({
    state: fc.constantFrom(
      CollisionState.Solo,
      CollisionState.Neighbors,
      CollisionState.Crossroads,
      CollisionState.CollisionCourse,
      CollisionState.MergeHell,
    ),
    queryingUser: userIdArb,
    repo: repoArb,
    overlappingUsers: fc.array(userIdArb, { minLength: 0, maxLength: 4 }),
    sharedFiles: fc.array(filePathArb, { minLength: 0, maxLength: 4 }),
    sharedDirs: fc.array(dirArb, { minLength: 0, maxLength: 3 }),
  })
  .map(({ state, queryingUser, repo, overlappingUsers, sharedFiles, sharedDirs }) => {
    // Ensure consistency: higher severity states have the required detail
    let users = overlappingUsers;
    let files = sharedFiles;
    let dirs = sharedDirs;

    if (state === CollisionState.Solo) {
      users = [];
      files = [];
      dirs = [];
    }
    if (SEVERITY[state] >= SEVERITY[CollisionState.Neighbors] && users.length === 0) {
      users = ["other_user"];
    }
    if (SEVERITY[state] >= SEVERITY[CollisionState.Crossroads] && dirs.length === 0) {
      dirs = ["src"];
    }
    if (SEVERITY[state] >= SEVERITY[CollisionState.CollisionCourse] && files.length === 0) {
      files = ["src/index.ts"];
    }

    const overlappingSessions: WorkSession[] = users.map((userId) =>
      makeSession({ userId, repo, branch: "main", files: [] }),
    );

    return {
      state,
      queryingUser,
      repo,
      overlappingSessions,
      sharedFiles: files,
      sharedDirectories: dirs,
      actions: [],
    } satisfies CollisionResult;
  });

const formatter = new SummaryFormatter();

// ---------------------------------------------------------------------------
// Property-Based Tests
// ---------------------------------------------------------------------------

describe("SummaryFormatter — Property Tests", () => {
  /**
   * **Feature: konductor-mcp-server, Property 10: Summary content completeness**
   * **Validates: Requirements 7.1, 7.3**
   *
   * For any CollisionResult, the formatted summary should contain the collision
   * state name and the querying user. For results at "Collision Course" or
   * "Merge Hell" severity, the summary should additionally contain the names
   * of overlapping users and the shared file paths.
   */
  it("Property 10: Summary content completeness", () => {
    fc.assert(
      fc.property(collisionResultArb, (result) => {
        const summary = formatter.format(result);

        // Summary always contains the state name
        expect(summary).toContain(result.state === CollisionState.Solo ? "SOLO" :
          result.state === CollisionState.Neighbors ? "NEIGHBORS" :
          result.state === CollisionState.Crossroads ? "CROSSROADS" :
          result.state === CollisionState.CollisionCourse ? "COLLISION_COURSE" :
          "MERGE_HELL");

        // Summary always contains the querying user
        expect(summary).toContain(`user:${result.queryingUser}`);

        // At Collision Course or Merge Hell: must contain overlapping users and shared files
        if (SEVERITY[result.state] >= SEVERITY[CollisionState.CollisionCourse]) {
          const uniqueUsers = [...new Set(result.overlappingSessions.map((s) => s.userId))];
          for (const user of uniqueUsers) {
            expect(summary).toContain(user);
          }
          for (const file of result.sharedFiles) {
            expect(summary).toContain(file);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Feature: konductor-mcp-server, Property 11: Summary format round-trip**
   * **Validates: Requirements 7.4**
   *
   * For any valid CollisionResult, formatting the result into a summary string
   * and then parsing that string back should produce a CollisionResult with
   * equivalent state, queryingUser, repo, overlapping user IDs, and sharedFiles.
   */
  it("Property 11: Summary format round-trip", () => {
    fc.assert(
      fc.property(collisionResultArb, (result) => {
        const summary = formatter.format(result);
        const parsed = formatter.parse(summary);

        // State round-trips exactly
        expect(parsed.state).toBe(result.state);

        // Querying user round-trips exactly
        expect(parsed.queryingUser).toBe(result.queryingUser);

        // Repo round-trips exactly
        expect(parsed.repo).toBe(result.repo);

        // Overlapping user IDs round-trip (sorted, deduplicated)
        const originalUsers = [...new Set(result.overlappingSessions.map((s) => s.userId))].sort();
        const parsedUsers = parsed.overlappingSessions.map((s) => s.userId).sort();
        expect(parsedUsers).toEqual(originalUsers);

        // Shared files round-trip (sorted)
        expect([...parsed.sharedFiles].sort()).toEqual([...result.sharedFiles].sort());

        // Shared directories round-trip (sorted)
        expect([...parsed.sharedDirectories].sort()).toEqual([...result.sharedDirectories].sort());
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Unit Tests
// ---------------------------------------------------------------------------

describe("SummaryFormatter — Unit Tests", () => {
  it("Solo summary contains state and user, no overlaps/files/dirs", () => {
    const result: CollisionResult = {
      state: CollisionState.Solo,
      queryingUser: "alice",
      repo: "org/repo",
      overlappingSessions: [],
      sharedFiles: [],
      sharedDirectories: [],
      actions: [],
    };

    const summary = formatter.format(result);

    expect(summary).toBe("[SOLO] | repo:org/repo | user:alice");
    expect(summary).not.toContain("overlaps:");
    expect(summary).not.toContain("files:");
    expect(summary).not.toContain("dirs:");
  });

  it("Merge Hell summary includes all users and files", () => {
    const result: CollisionResult = {
      state: CollisionState.MergeHell,
      queryingUser: "alice",
      repo: "org/repo",
      overlappingSessions: [
        makeSession({ userId: "bob", repo: "org/repo" }),
        makeSession({ userId: "carol", repo: "org/repo" }),
      ],
      sharedFiles: ["src/index.ts", "src/utils.ts"],
      sharedDirectories: ["src"],
      actions: [],
    };

    const summary = formatter.format(result);

    expect(summary).toContain("[MERGE_HELL]");
    expect(summary).toContain("user:alice");
    expect(summary).toContain("overlaps:bob,carol");
    expect(summary).toContain("files:src/index.ts,src/utils.ts");
    expect(summary).toContain("dirs:src");
  });

  it("parse throws on malformed input — too few segments", () => {
    expect(() => formatter.parse("[SOLO]")).toThrow("Malformed summary");
  });

  it("parse throws on malformed input — invalid state", () => {
    expect(() => formatter.parse("[INVALID] | repo:org/repo | user:alice")).toThrow("unknown state");
  });

  it("parse throws on malformed input — missing repo", () => {
    expect(() => formatter.parse("[SOLO] | user:alice | overlaps:bob")).toThrow("missing repo");
  });

  it("parse throws on malformed input — missing user", () => {
    expect(() => formatter.parse("[SOLO] | repo:org/repo | overlaps:bob")).toThrow("missing user");
  });
});
