/**
 * Unit Tests for line-annotated notification messages.
 *
 * Tests:
 * - SummaryFormatter.formatDetailLine with lineOverlap true/false/null
 * - SlackNotifier.buildEscalationMessage with line range annotations
 * - Severity recommendation text in notifications
 * - Proximity state handling in shouldNotify
 *
 * Requirements: 3.5, 4.1, 4.2, 4.3, 4.4, 5.3, 5.4
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SummaryFormatter } from "./summary-formatter.js";
import { SlackNotifier, STATE_EMOJI, STATE_DISPLAY_NAME } from "./slack-notifier.js";
import { SlackStateTracker } from "./slack-state-tracker.js";
import { shouldNotify } from "./slack-settings.js";
import { CollisionState } from "./types.js";
import type {
  CollisionResult,
  WorkSession,
  OverlappingSessionDetail,
  LineOverlapDetail,
} from "./types.js";
import type { ISlackSettingsManager, RepoSlackConfig } from "./slack-settings.js";
import type { KonductorLogger } from "./logger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<WorkSession> & { userId: string; repo: string }): WorkSession {
  return {
    sessionId: overrides.sessionId ?? "test-session-id",
    branch: overrides.branch ?? "main",
    files: overrides.files ?? [],
    createdAt: overrides.createdAt ?? "2026-04-20T10:00:00Z",
    lastHeartbeat: overrides.lastHeartbeat ?? "2026-04-20T10:05:00Z",
    ...overrides,
  };
}

function createMockLogger(): KonductorLogger {
  return { enabled: true, logConfigError: vi.fn() } as unknown as KonductorLogger;
}

function createMockSettings(): ISlackSettingsManager {
  return {
    getBotToken: vi.fn(async () => "xoxb-test"),
    getRepoConfig: vi.fn(async (): Promise<RepoSlackConfig> => ({
      channel: "test-channel",
      verbosity: 2,
      enabled: true,
    })),
    setRepoChannel: vi.fn(async () => {}),
    setRepoVerbosity: vi.fn(async () => {}),
    getGlobalStatus: vi.fn(async () => ({ configured: true })),
    setBotToken: vi.fn(async () => {}),
  };
}

const formatter = new SummaryFormatter();

// ---------------------------------------------------------------------------
// SummaryFormatter.formatDetailLine — line-level context
// ---------------------------------------------------------------------------

describe("SummaryFormatter.formatDetailLine — line-level context", () => {
  it("includes 'same lines' context when lineOverlap is true (Req 4.1)", () => {
    const session = makeSession({ userId: "bob", repo: "org/app", branch: "feature-x", files: ["src/index.ts"] });
    const detail: OverlappingSessionDetail = {
      session,
      source: "active",
      sharedFiles: ["src/index.ts"],
      severity: CollisionState.CollisionCourse,
      lineOverlapDetails: [{
        file: "src/index.ts",
        lineOverlap: true,
        userRanges: [{ startLine: 15, endLine: 30 }],
        otherRanges: [{ startLine: 10, endLine: 25 }],
        overlappingLines: 11,
        overlapSeverity: "moderate",
      }],
    };

    const line = formatter.formatDetailLine(detail, CollisionState.CollisionCourse);

    expect(line).toContain("same lines");
    expect(line).toContain("your lines 15-30");
    expect(line).toContain("their lines 10-25");
    expect(line).toContain("src/index.ts");
  });

  it("includes 'different sections' context when lineOverlap is false (Req 4.2)", () => {
    const session = makeSession({ userId: "bob", repo: "org/app", branch: "feature-x", files: ["src/index.ts"] });
    const detail: OverlappingSessionDetail = {
      session,
      source: "active",
      sharedFiles: ["src/index.ts"],
      severity: CollisionState.Proximity,
      lineOverlapDetails: [{
        file: "src/index.ts",
        lineOverlap: false,
        userRanges: [{ startLine: 10, endLine: 25 }],
        otherRanges: [{ startLine: 100, endLine: 120 }],
        overlappingLines: 0,
        overlapSeverity: null,
      }],
    };

    const line = formatter.formatDetailLine(detail, CollisionState.Proximity);

    expect(line).toContain("different sections");
    expect(line).toContain("your lines 10-25");
    expect(line).toContain("their lines 100-120");
  });

  it("uses existing message when no line data (Req 4.3)", () => {
    const session = makeSession({ userId: "bob", repo: "org/app", branch: "feature-x", files: ["src/index.ts"] });
    const detail: OverlappingSessionDetail = {
      session,
      source: "active",
      sharedFiles: ["src/index.ts"],
      severity: CollisionState.CollisionCourse,
      // No lineOverlapDetails
    };

    const line = formatter.formatDetailLine(detail, CollisionState.CollisionCourse);

    expect(line).toContain("bob is actively editing");
    expect(line).not.toContain("same lines");
    expect(line).not.toContain("different sections");
  });

  it("uses existing message when lineOverlap is null", () => {
    const session = makeSession({ userId: "bob", repo: "org/app", branch: "feature-x", files: ["src/index.ts"] });
    const detail: OverlappingSessionDetail = {
      session,
      source: "active",
      sharedFiles: ["src/index.ts"],
      severity: CollisionState.CollisionCourse,
      lineOverlapDetails: [{
        file: "src/index.ts",
        lineOverlap: null,
        userRanges: [],
        otherRanges: [],
        overlappingLines: 0,
        overlapSeverity: null,
      }],
    };

    const line = formatter.formatDetailLine(detail, CollisionState.CollisionCourse);

    expect(line).toContain("bob is actively editing");
    expect(line).not.toContain("same lines");
    expect(line).not.toContain("different sections");
  });

  it("appends severity recommendation for 'severe' (Req 5.3)", () => {
    const session = makeSession({ userId: "bob", repo: "org/app", branch: "feature-x", files: ["src/index.ts"] });
    const detail: OverlappingSessionDetail = {
      session,
      source: "active",
      sharedFiles: ["src/index.ts"],
      severity: CollisionState.CollisionCourse,
      overlapSeverity: "severe",
      lineOverlapDetails: [{
        file: "src/index.ts",
        lineOverlap: true,
        userRanges: [{ startLine: 1, endLine: 50 }],
        otherRanges: [{ startLine: 1, endLine: 50 }],
        overlappingLines: 50,
        overlapSeverity: "severe",
      }],
    };

    const line = formatter.formatDetailLine(detail, CollisionState.CollisionCourse);

    expect(line).toContain("High merge conflict risk. Coordinate immediately.");
  });

  it("appends severity recommendation for 'minimal' (Req 5.4)", () => {
    const session = makeSession({ userId: "bob", repo: "org/app", branch: "feature-x", files: ["src/index.ts"] });
    const detail: OverlappingSessionDetail = {
      session,
      source: "active",
      sharedFiles: ["src/index.ts"],
      severity: CollisionState.CollisionCourse,
      overlapSeverity: "minimal",
      lineOverlapDetails: [{
        file: "src/index.ts",
        lineOverlap: true,
        userRanges: [{ startLine: 10, endLine: 12 }],
        otherRanges: [{ startLine: 11, endLine: 13 }],
        overlappingLines: 2,
        overlapSeverity: "minimal",
      }],
    };

    const line = formatter.formatDetailLine(detail, CollisionState.CollisionCourse);

    expect(line).toContain("Minor overlap — likely a quick merge resolution.");
  });

  it("does not append severity recommendation for 'moderate'", () => {
    const session = makeSession({ userId: "bob", repo: "org/app", branch: "feature-x", files: ["src/index.ts"] });
    const detail: OverlappingSessionDetail = {
      session,
      source: "active",
      sharedFiles: ["src/index.ts"],
      severity: CollisionState.CollisionCourse,
      overlapSeverity: "moderate",
    };

    const line = formatter.formatDetailLine(detail, CollisionState.CollisionCourse);

    expect(line).not.toContain("High merge conflict risk");
    expect(line).not.toContain("Minor overlap");
  });

  it("handles single-line range formatting", () => {
    const session = makeSession({ userId: "bob", repo: "org/app", branch: "feature-x", files: ["src/index.ts"] });
    const detail: OverlappingSessionDetail = {
      session,
      source: "active",
      sharedFiles: ["src/index.ts"],
      severity: CollisionState.CollisionCourse,
      lineOverlapDetails: [{
        file: "src/index.ts",
        lineOverlap: true,
        userRanges: [{ startLine: 10, endLine: 10 }],
        otherRanges: [{ startLine: 10, endLine: 10 }],
        overlappingLines: 1,
        overlapSeverity: "minimal",
      }],
    };

    const line = formatter.formatDetailLine(detail, CollisionState.CollisionCourse);

    expect(line).toContain("your line 10");
    expect(line).toContain("their line 10");
  });
});


// ---------------------------------------------------------------------------
// SlackNotifier.buildEscalationMessage — line range annotations
// ---------------------------------------------------------------------------

describe("SlackNotifier.buildEscalationMessage — line range annotations", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("includes line range annotations when lineOverlapDetails present (Req 4.4)", () => {
    const notifier = new SlackNotifier(createMockSettings(), new SlackStateTracker(), createMockLogger());
    const bobSession = makeSession({ userId: "bob", repo: "org/app", branch: "feature-y", files: ["src/index.ts"] });

    const result: CollisionResult = {
      state: CollisionState.CollisionCourse,
      queryingUser: "alice",
      repo: "org/app",
      overlappingSessions: [bobSession],
      overlappingDetails: [{
        session: bobSession,
        source: "active",
        sharedFiles: ["src/index.ts"],
        severity: CollisionState.CollisionCourse,
        lineOverlapDetails: [{
          file: "src/index.ts",
          lineOverlap: true,
          userRanges: [{ startLine: 10, endLine: 25 }],
          otherRanges: [{ startLine: 15, endLine: 30 }],
          overlappingLines: 11,
          overlapSeverity: "moderate",
        }],
      }],
      sharedFiles: ["src/index.ts"],
      sharedDirectories: ["src"],
      actions: [],
    };

    const message = notifier.buildEscalationMessage("org/app", result);
    const section = message.blocks.find((b) => b.type === "section");

    expect(section!.text!.text).toContain("src/index.ts");
    expect(section!.text!.text).toContain("lines 10-25");
    expect(section!.text!.text).toContain("lines 15-30");
    expect(section!.text!.text).toContain("overlap: 11 lines");
    expect(section!.text!.text).toContain("moderate");
  });

  it("shows 'no overlap' for non-overlapping line ranges", () => {
    const notifier = new SlackNotifier(createMockSettings(), new SlackStateTracker(), createMockLogger());
    const bobSession = makeSession({ userId: "bob", repo: "org/app", branch: "feature-y", files: ["src/index.ts"] });

    const result: CollisionResult = {
      state: CollisionState.Proximity,
      queryingUser: "alice",
      repo: "org/app",
      overlappingSessions: [bobSession],
      overlappingDetails: [{
        session: bobSession,
        source: "active",
        sharedFiles: ["src/index.ts"],
        severity: CollisionState.Proximity,
        lineOverlapDetails: [{
          file: "src/index.ts",
          lineOverlap: false,
          userRanges: [{ startLine: 10, endLine: 25 }],
          otherRanges: [{ startLine: 100, endLine: 120 }],
          overlappingLines: 0,
          overlapSeverity: null,
        }],
      }],
      sharedFiles: ["src/index.ts"],
      sharedDirectories: ["src"],
      actions: [],
    };

    const message = notifier.buildEscalationMessage("org/app", result);
    const section = message.blocks.find((b) => b.type === "section");

    expect(section!.text!.text).toContain("no overlap");
    expect(section!.text!.text).toContain("lines 10-25");
    expect(section!.text!.text).toContain("lines 100-120");
  });

  it("falls back to plain file list when no lineOverlapDetails", () => {
    const notifier = new SlackNotifier(createMockSettings(), new SlackStateTracker(), createMockLogger());
    const bobSession = makeSession({ userId: "bob", repo: "org/app", branch: "feature-y", files: ["src/index.ts"] });

    const result: CollisionResult = {
      state: CollisionState.CollisionCourse,
      queryingUser: "alice",
      repo: "org/app",
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

    const message = notifier.buildEscalationMessage("org/app", result);
    const section = message.blocks.find((b) => b.type === "section");

    expect(section!.text!.text).toContain("• `src/index.ts`");
    expect(section!.text!.text).not.toContain("overlap:");
  });

  it("includes severity recommendation for 'severe' (Req 5.3)", () => {
    const notifier = new SlackNotifier(createMockSettings(), new SlackStateTracker(), createMockLogger());
    const bobSession = makeSession({ userId: "bob", repo: "org/app", branch: "feature-y", files: ["src/index.ts"] });

    const result: CollisionResult = {
      state: CollisionState.CollisionCourse,
      queryingUser: "alice",
      repo: "org/app",
      overlappingSessions: [bobSession],
      overlappingDetails: [],
      sharedFiles: ["src/index.ts"],
      sharedDirectories: ["src"],
      actions: [],
      overlapSeverity: "severe",
    };

    const message = notifier.buildEscalationMessage("org/app", result);
    const section = message.blocks.find((b) => b.type === "section");

    expect(section!.text!.text).toContain("High merge conflict risk. Coordinate immediately.");
  });

  it("includes severity recommendation for 'minimal' (Req 5.4)", () => {
    const notifier = new SlackNotifier(createMockSettings(), new SlackStateTracker(), createMockLogger());
    const bobSession = makeSession({ userId: "bob", repo: "org/app", branch: "feature-y", files: ["src/index.ts"] });

    const result: CollisionResult = {
      state: CollisionState.CollisionCourse,
      queryingUser: "alice",
      repo: "org/app",
      overlappingSessions: [bobSession],
      overlappingDetails: [],
      sharedFiles: ["src/index.ts"],
      sharedDirectories: ["src"],
      actions: [],
      overlapSeverity: "minimal",
    };

    const message = notifier.buildEscalationMessage("org/app", result);
    const section = message.blocks.find((b) => b.type === "section");

    expect(section!.text!.text).toContain("Minor overlap — likely a quick merge resolution.");
  });

  it("includes Proximity state emoji and display name", () => {
    expect(STATE_EMOJI["proximity"]).toBe("🟢");
    expect(STATE_DISPLAY_NAME["proximity"]).toBe("Proximity");
  });
});

// ---------------------------------------------------------------------------
// shouldNotify — Proximity handling
// ---------------------------------------------------------------------------

describe("shouldNotify — Proximity state (Req 3.5)", () => {
  it("Proximity does NOT trigger at default verbosity (level 2)", () => {
    expect(shouldNotify(CollisionState.Proximity, 2)).toBe(false);
  });

  it("Proximity does NOT trigger at verbosity level 3", () => {
    expect(shouldNotify(CollisionState.Proximity, 3)).toBe(false);
  });

  it("Proximity triggers at verbosity level 4", () => {
    expect(shouldNotify(CollisionState.Proximity, 4)).toBe(true);
  });

  it("Proximity triggers at verbosity level 5", () => {
    expect(shouldNotify(CollisionState.Proximity, 5)).toBe(true);
  });

  it("Proximity does NOT trigger at verbosity level 0", () => {
    expect(shouldNotify(CollisionState.Proximity, 0)).toBe(false);
  });
});
