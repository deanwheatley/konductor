import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { SummaryFormatter } from "./summary-formatter.js";
import { CollisionState, SEVERITY } from "./types.js";
import type { CollisionResult, WorkSession, OverlappingSessionDetail, SessionSource } from "./types.js";

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
    source: overrides.source,
    prNumber: overrides.prNumber,
    prUrl: overrides.prUrl,
    prTargetBranch: overrides.prTargetBranch,
    prDraft: overrides.prDraft,
    prApproved: overrides.prApproved,
    commitDateRange: overrides.commitDateRange,
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
      overlappingDetails: [],
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
// Property-Based Tests — Source Attribution (Property 5)
// ---------------------------------------------------------------------------

describe("SummaryFormatter — Source Attribution Property Tests", () => {
  /**
   * **Feature: konductor-github, Property 5: Source attribution in all messages**
   * **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7**
   *
   * Every passive session in formatted output includes source type and metadata.
   * For any CollisionResult with overlappingDetails, each detail line in the
   * formatted output must contain source-specific identifiers:
   *   - active: user name and branch
   *   - github_pr: PR number
   *   - github_commit: branch and date range
   */
  it("Property 5: Source attribution in all messages", () => {
    /** Generator for a source-attributed overlapping detail */
    const sourceArb = fc.constantFrom("active" as SessionSource, "github_pr" as SessionSource, "github_commit" as SessionSource);

    const detailArb = fc.record({
      userId: userIdArb,
      repo: repoArb,
      branch: branchArb,
      files: fc.array(filePathArb, { minLength: 1, maxLength: 3 }),
      source: sourceArb,
      prNumber: fc.integer({ min: 1, max: 9999 }),
      prTargetBranch: branchArb,
    });

    const resultWithDetailsArb = fc.record({
      state: fc.constantFrom(
        CollisionState.Neighbors,
        CollisionState.Crossroads,
        CollisionState.CollisionCourse,
        CollisionState.MergeHell,
      ),
      queryingUser: userIdArb,
      repo: repoArb,
      details: fc.array(detailArb, { minLength: 1, maxLength: 4 }),
    }).map(({ state, queryingUser, repo, details }) => {
      const overlappingSessions: WorkSession[] = [];
      const overlappingDetails: OverlappingSessionDetail[] = [];

      for (const d of details) {
        // Ensure detail userId differs from queryingUser
        const userId = d.userId === queryingUser ? d.userId + "_other" : d.userId;
        const session = makeSession({
          userId,
          repo,
          branch: d.branch,
          files: d.files,
          source: d.source,
          ...(d.source === "github_pr" ? {
            prNumber: d.prNumber,
            prUrl: `https://github.com/${repo}/pull/${d.prNumber}`,
            prTargetBranch: d.prTargetBranch,
            prDraft: false,
            prApproved: false,
          } : {}),
          ...(d.source === "github_commit" ? {
            commitDateRange: { earliest: "Apr 15", latest: "Apr 16" },
          } : {}),
        });

        overlappingSessions.push(session);

        const detail: OverlappingSessionDetail = {
          session,
          source: d.source,
          sharedFiles: d.files.slice(0, 1),
          severity: state,
        };

        if (d.source === "github_pr") {
          detail.prNumber = d.prNumber;
          detail.prUrl = `https://github.com/${repo}/pull/${d.prNumber}`;
          detail.prTargetBranch = d.prTargetBranch;
          detail.prDraft = false;
          detail.prApproved = false;
        } else if (d.source === "github_commit") {
          detail.commitDateRange = { earliest: "Apr 15", latest: "Apr 16" };
        }

        overlappingDetails.push(detail);
      }

      return {
        state,
        queryingUser,
        repo,
        overlappingSessions,
        overlappingDetails,
        sharedFiles: details.flatMap((d) => d.files.slice(0, 1)),
        sharedDirectories: [],
        actions: [],
      } satisfies CollisionResult;
    });

    fc.assert(
      fc.property(resultWithDetailsArb, (result) => {
        const summary = formatter.format(result);
        const contextLines = summary.split("\n").slice(1).map((l) => l.trim());

        // Each overlapping detail should produce a context line
        expect(contextLines.length).toBe(result.overlappingDetails.length);

        // Sort details by userId to match the formatter's sort order
        const sortedDetails = [...result.overlappingDetails].sort((a, b) =>
          a.session.userId.localeCompare(b.session.userId),
        );

        for (let i = 0; i < sortedDetails.length; i++) {
          const detail = sortedDetails[i];
          const line = contextLines[i];

          // Every line must contain the user's name
          expect(line).toContain(detail.session.userId);

          // Source-specific attribution checks
          switch (detail.source) {
            case "active":
              expect(line).toContain(detail.session.branch);
              expect(line).toContain("actively editing");
              break;
            case "github_pr":
              expect(line).toContain(`PR #${detail.prNumber}`);
              break;
            case "github_commit":
              expect(line).toContain(detail.session.branch);
              expect(line).toContain("pushed commits");
              break;
          }
        }
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
      overlappingDetails: [],
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
      overlappingDetails: [],
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

// ---------------------------------------------------------------------------
// Source-Attributed Message Unit Tests (Requirements 4.1–4.7)
// ---------------------------------------------------------------------------

describe("SummaryFormatter — Source-Attributed Messages", () => {
  it("active-only collision produces correct message format (Req 4.1)", () => {
    const bobSession = makeSession({ userId: "bob", repo: "org/repo", branch: "feature-y", files: ["src/index.ts"] });
    const result: CollisionResult = {
      state: CollisionState.CollisionCourse,
      queryingUser: "alice",
      repo: "org/repo",
      overlappingSessions: [bobSession],
      overlappingDetails: [{
        session: bobSession,
        source: "active",
        sharedFiles: ["src/index.ts"],
        severity: CollisionState.CollisionCourse,
      }],
      sharedFiles: ["src/index.ts"],
      sharedDirectories: ["src"],
      actions: [],
    };

    const summary = formatter.format(result);

    expect(summary).toContain("🟠 Warning — bob is actively editing src/index.ts on feature-y.");
  });

  it("PR collision produces correct message format (Req 4.2)", () => {
    const prSession = makeSession({
      userId: "carol",
      repo: "org/repo",
      branch: "feature/carol",
      files: ["src/index.ts"],
      source: "github_pr",
      prNumber: 42,
      prUrl: "https://github.com/org/repo/pull/42",
      prTargetBranch: "main",
      prDraft: false,
      prApproved: false,
    });
    const result: CollisionResult = {
      state: CollisionState.CollisionCourse,
      queryingUser: "alice",
      repo: "org/repo",
      overlappingSessions: [prSession],
      overlappingDetails: [{
        session: prSession,
        source: "github_pr",
        sharedFiles: ["src/index.ts"],
        severity: CollisionState.CollisionCourse,
        prNumber: 42,
        prUrl: "https://github.com/org/repo/pull/42",
        prTargetBranch: "main",
        prDraft: false,
        prApproved: false,
      }],
      sharedFiles: ["src/index.ts"],
      sharedDirectories: ["src"],
      actions: [],
    };

    const summary = formatter.format(result);

    expect(summary).toContain("🟠 Warning — carol's PR #42 (https://github.com/org/repo/pull/42) modifies src/index.ts, targeting main.");
  });

  it("approved PR collision produces correct message format (Req 4.3)", () => {
    const prSession = makeSession({
      userId: "bob",
      repo: "org/repo",
      branch: "feature/bob",
      files: ["src/index.ts"],
      source: "github_pr",
      prNumber: 99,
      prUrl: "https://github.com/org/repo/pull/99",
      prTargetBranch: "main",
      prDraft: false,
      prApproved: true,
    });
    const result: CollisionResult = {
      state: CollisionState.MergeHell,
      queryingUser: "alice",
      repo: "org/repo",
      overlappingSessions: [prSession],
      overlappingDetails: [{
        session: prSession,
        source: "github_pr",
        sharedFiles: ["src/index.ts"],
        severity: CollisionState.MergeHell,
        prNumber: 99,
        prUrl: "https://github.com/org/repo/pull/99",
        prTargetBranch: "main",
        prDraft: false,
        prApproved: true,
      }],
      sharedFiles: ["src/index.ts"],
      sharedDirectories: ["src"],
      actions: [],
    };

    const summary = formatter.format(result);

    expect(summary).toContain("🔴 Critical — bob's PR #99 is approved and targets main. Merge is imminent.");
  });

  it("draft PR collision produces correct message format (Req 4.4)", () => {
    const prSession = makeSession({
      userId: "dave",
      repo: "org/repo",
      branch: "feature/dave",
      files: ["src/utils.ts"],
      source: "github_pr",
      prNumber: 7,
      prUrl: "https://github.com/org/repo/pull/7",
      prTargetBranch: "main",
      prDraft: true,
      prApproved: false,
    });
    const result: CollisionResult = {
      state: CollisionState.Crossroads,
      queryingUser: "alice",
      repo: "org/repo",
      overlappingSessions: [prSession],
      overlappingDetails: [{
        session: prSession,
        source: "github_pr",
        sharedFiles: ["src/utils.ts"],
        severity: CollisionState.Crossroads,
        prNumber: 7,
        prUrl: "https://github.com/org/repo/pull/7",
        prTargetBranch: "main",
        prDraft: true,
        prApproved: false,
      }],
      sharedFiles: [],
      sharedDirectories: ["src"],
      actions: [],
    };

    const summary = formatter.format(result);

    expect(summary).toContain("🟡 Heads up — dave has a draft PR #7 touching src/utils.ts. Low risk but worth tracking.");
  });

  it("commit collision produces correct message format (Req 4.5)", () => {
    const commitSession = makeSession({
      userId: "eve",
      repo: "org/repo",
      branch: "main",
      files: ["src/index.ts", "src/config.ts"],
      source: "github_commit",
      commitDateRange: { earliest: "Apr 15", latest: "Apr 16" },
    });
    const result: CollisionResult = {
      state: CollisionState.CollisionCourse,
      queryingUser: "alice",
      repo: "org/repo",
      overlappingSessions: [commitSession],
      overlappingDetails: [{
        session: commitSession,
        source: "github_commit",
        sharedFiles: ["src/index.ts"],
        severity: CollisionState.CollisionCourse,
        commitDateRange: { earliest: "Apr 15", latest: "Apr 16" },
      }],
      sharedFiles: ["src/index.ts"],
      sharedDirectories: ["src"],
      actions: [],
    };

    const summary = formatter.format(result);

    expect(summary).toContain("🟠 Warning — eve pushed commits to main (Apr 15–Apr 16) modifying src/index.ts.");
  });

  it("mixed-source collision produces separate context per source (Req 4.6)", () => {
    const bobSession = makeSession({ userId: "bob", repo: "org/repo", branch: "main", files: ["src/index.ts"] });
    const carolPr = makeSession({
      userId: "carol",
      repo: "org/repo",
      branch: "feature/carol",
      files: ["src/index.ts"],
      source: "github_pr",
      prNumber: 42,
      prUrl: "https://github.com/org/repo/pull/42",
      prTargetBranch: "main",
      prDraft: false,
      prApproved: false,
    });
    const result: CollisionResult = {
      state: CollisionState.MergeHell,
      queryingUser: "alice",
      repo: "org/repo",
      overlappingSessions: [bobSession, carolPr],
      overlappingDetails: [
        {
          session: bobSession,
          source: "active",
          sharedFiles: ["src/index.ts"],
          severity: CollisionState.CollisionCourse,
        },
        {
          session: carolPr,
          source: "github_pr",
          sharedFiles: ["src/index.ts"],
          severity: CollisionState.MergeHell,
          prNumber: 42,
          prUrl: "https://github.com/org/repo/pull/42",
          prTargetBranch: "main",
          prDraft: false,
          prApproved: false,
        },
      ],
      sharedFiles: ["src/index.ts"],
      sharedDirectories: ["src"],
      actions: [],
    };

    const summary = formatter.format(result);

    // Each source gets its own context line
    expect(summary).toContain("🟠 Warning — bob is actively editing src/index.ts on main.");
    expect(summary).toContain("🟠 Warning — carol's PR #42");
    // Both lines present
    const contextLines = summary.split("\n").filter((l) => l.trim().startsWith("🟠") || l.trim().startsWith("🔴") || l.trim().startsWith("🟡"));
    expect(contextLines).toHaveLength(2);
  });

  it("Merge Hell with mixed sources includes cross-branch explanation (Req 4.7)", () => {
    const bobSession = makeSession({ userId: "bob", repo: "org/repo", branch: "main", files: ["src/index.ts"] });
    const carolPr = makeSession({
      userId: "carol",
      repo: "org/repo",
      branch: "feature/carol",
      files: ["src/index.ts"],
      source: "github_pr",
      prNumber: 42,
      prUrl: "https://github.com/org/repo/pull/42",
      prTargetBranch: "develop",
      prDraft: false,
      prApproved: false,
    });
    const result: CollisionResult = {
      state: CollisionState.MergeHell,
      queryingUser: "alice",
      repo: "org/repo",
      overlappingSessions: [bobSession, carolPr],
      overlappingDetails: [
        {
          session: bobSession,
          source: "active",
          sharedFiles: ["src/index.ts"],
          severity: CollisionState.CollisionCourse,
        },
        {
          session: carolPr,
          source: "github_pr",
          sharedFiles: ["src/index.ts"],
          severity: CollisionState.MergeHell,
          prNumber: 42,
          prUrl: "https://github.com/org/repo/pull/42",
          prTargetBranch: "develop",
          prDraft: false,
          prApproved: false,
        },
      ],
      sharedFiles: ["src/index.ts"],
      sharedDirectories: ["src"],
      actions: [],
    };

    const mergeHellSummary = formatter.formatMergeHellContext(result);

    expect(mergeHellSummary).toContain("⚠️ Cross-branch conflict across");
    expect(mergeHellSummary).toContain("develop");
    expect(mergeHellSummary).toContain("feature/carol");
    expect(mergeHellSummary).toContain("main");
  });

  it("parse handles multi-line format (header + context lines)", () => {
    const bobSession = makeSession({ userId: "bob", repo: "org/repo", branch: "main", files: ["src/index.ts"] });
    const result: CollisionResult = {
      state: CollisionState.CollisionCourse,
      queryingUser: "alice",
      repo: "org/repo",
      overlappingSessions: [bobSession],
      overlappingDetails: [{
        session: bobSession,
        source: "active",
        sharedFiles: ["src/index.ts"],
        severity: CollisionState.CollisionCourse,
      }],
      sharedFiles: ["src/index.ts"],
      sharedDirectories: ["src"],
      actions: [],
    };

    const summary = formatter.format(result);
    // Should have multiple lines
    expect(summary.split("\n").length).toBeGreaterThan(1);

    // Parse should still work on the header line
    const parsed = formatter.parse(summary);
    expect(parsed.state).toBe(CollisionState.CollisionCourse);
    expect(parsed.queryingUser).toBe("alice");
    expect(parsed.repo).toBe("org/repo");
  });
});
