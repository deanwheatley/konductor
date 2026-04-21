/**
 * Unit Tests for SlackNotifier
 *
 * Tests the core notification logic including threshold checks,
 * de-escalation detection, error handling, and message formatting.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SlackNotifier, STATE_EMOJI, STATE_DISPLAY_NAME } from "./slack-notifier.js";
import { SlackStateTracker } from "./slack-state-tracker.js";
import { CollisionState } from "./types.js";
import type { CollisionResult, WorkSession } from "./types.js";
import type { ISlackSettingsManager, RepoSlackConfig } from "./slack-settings.js";
import type { KonductorLogger } from "./logger.js";
import type { CollabRequest } from "./collab-request-store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockLogger(): KonductorLogger {
  return {
    enabled: true,
    logConfigError: vi.fn(),
  } as unknown as KonductorLogger;
}

function createMockSettings(opts: {
  token?: string | null;
  verbosity?: number;
  channel?: string;
} = {}): ISlackSettingsManager {
  const { token = "xoxb-test-token", verbosity = 2, channel = "test-channel" } = opts;
  return {
    getBotToken: vi.fn(async () => token),
    getRepoConfig: vi.fn(async (_repo: string): Promise<RepoSlackConfig> => ({
      channel,
      verbosity,
      enabled: token !== null && verbosity > 0,
    })),
    setRepoChannel: vi.fn(async () => {}),
    setRepoVerbosity: vi.fn(async () => {}),
    getGlobalStatus: vi.fn(async () => ({ configured: token !== null })),
    setBotToken: vi.fn(async () => {}),
  };
}

function createCollisionResult(overrides: Partial<CollisionResult> = {}): CollisionResult {
  return {
    state: CollisionState.CollisionCourse,
    queryingUser: "alice",
    repo: "org/my-project",
    overlappingSessions: [
      {
        sessionId: "sess-1",
        userId: "bob",
        repo: "org/my-project",
        branch: "feature/auth",
        files: ["src/auth.ts", "src/types.ts"],
        createdAt: "2026-04-19T10:00:00Z",
        lastHeartbeat: "2026-04-19T10:30:00Z",
      } as WorkSession,
    ],
    overlappingDetails: [],
    sharedFiles: ["src/auth.ts", "src/types.ts"],
    sharedDirectories: ["src"],
    actions: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SlackNotifier", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("onCollisionEvaluated", () => {
    it("posts message when collision state meets verbosity threshold", async () => {
      const settings = createMockSettings({ verbosity: 2 });
      const tracker = new SlackStateTracker();
      const notifier = new SlackNotifier(settings, tracker, createMockLogger());

      const result = createCollisionResult({ state: CollisionState.CollisionCourse });
      await notifier.onCollisionEvaluated("org/my-project", result, "alice");

      expect(fetchMock).toHaveBeenCalledWith(
        "https://slack.com/api/chat.postMessage",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Authorization": "Bearer xoxb-test-token",
          }),
        }),
      );
    });

    it("skips when collision state is below verbosity threshold", async () => {
      const settings = createMockSettings({ verbosity: 2 });
      const tracker = new SlackStateTracker();
      const notifier = new SlackNotifier(settings, tracker, createMockLogger());

      const result = createCollisionResult({ state: CollisionState.Neighbors });
      await notifier.onCollisionEvaluated("org/my-project", result, "alice");

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("skips when bot token is missing", async () => {
      const settings = createMockSettings({ token: null });
      const tracker = new SlackStateTracker();
      const notifier = new SlackNotifier(settings, tracker, createMockLogger());

      const result = createCollisionResult({ state: CollisionState.MergeHell });
      await notifier.onCollisionEvaluated("org/my-project", result, "alice");

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("handles Slack API channel_not_found error gracefully", async () => {
      fetchMock.mockResolvedValue({
        json: async () => ({ ok: false, error: "channel_not_found" }),
      });

      const settings = createMockSettings({ verbosity: 2 });
      const tracker = new SlackStateTracker();
      const logger = createMockLogger();
      const notifier = new SlackNotifier(settings, tracker, logger);

      const result = createCollisionResult({ state: CollisionState.CollisionCourse });

      // Should not throw
      await expect(
        notifier.onCollisionEvaluated("org/my-project", result, "alice"),
      ).resolves.toBeUndefined();
    });

    it("handles Slack API rate limit error gracefully", async () => {
      fetchMock.mockResolvedValue({
        json: async () => ({ ok: false, error: "ratelimited" }),
      });

      const settings = createMockSettings({ verbosity: 2 });
      const tracker = new SlackStateTracker();
      const notifier = new SlackNotifier(settings, tracker, createMockLogger());

      const result = createCollisionResult({ state: CollisionState.CollisionCourse });

      await expect(
        notifier.onCollisionEvaluated("org/my-project", result, "alice"),
      ).resolves.toBeUndefined();
    });

    it("handles network errors gracefully", async () => {
      fetchMock.mockRejectedValue(new Error("Network error"));

      const settings = createMockSettings({ verbosity: 2 });
      const tracker = new SlackStateTracker();
      const notifier = new SlackNotifier(settings, tracker, createMockLogger());

      const result = createCollisionResult({ state: CollisionState.CollisionCourse });

      await expect(
        notifier.onCollisionEvaluated("org/my-project", result, "alice"),
      ).resolves.toBeUndefined();
    });

    it("sends de-escalation message when state drops below threshold", async () => {
      const settings = createMockSettings({ verbosity: 2 });
      const tracker = new SlackStateTracker();
      const notifier = new SlackNotifier(settings, tracker, createMockLogger());

      // First: set previous state above threshold
      tracker.setLastNotifiedState("org/my-project", CollisionState.CollisionCourse);

      // Now: state drops below threshold
      const result = createCollisionResult({ state: CollisionState.Neighbors });
      await notifier.onCollisionEvaluated("org/my-project", result, "alice");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      // De-escalation message should contain the resolution text
      const sectionBlock = body.blocks.find((b: { type: string }) => b.type === "section");
      expect(sectionBlock.text.text).toContain("✅ Collision resolved");
    });

    it("does not send de-escalation when previous state was already below threshold", async () => {
      const settings = createMockSettings({ verbosity: 2 });
      const tracker = new SlackStateTracker();
      const notifier = new SlackNotifier(settings, tracker, createMockLogger());

      // Previous state was below threshold (neighbors at verbosity 2 is below)
      tracker.setLastNotifiedState("org/my-project", CollisionState.Neighbors);

      // New state is also below threshold
      const result = createCollisionResult({ state: CollisionState.Solo });
      await notifier.onCollisionEvaluated("org/my-project", result, "alice");

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("buildEscalationMessage", () => {
    it("includes all required fields and footer", () => {
      const notifier = new SlackNotifier(createMockSettings(), new SlackStateTracker(), createMockLogger());
      const result = createCollisionResult();

      const message = notifier.buildEscalationMessage("org/my-project", result);

      // Header block with emoji and repo
      const header = message.blocks.find((b) => b.type === "header");
      expect(header).toBeDefined();
      expect(header!.text!.text).toContain("🟠");
      expect(header!.text!.text).toContain("org/my-project");

      // Section block with users, files, branches
      const section = message.blocks.find((b) => b.type === "section");
      expect(section).toBeDefined();
      expect(section!.text!.text).toContain("bob");
      expect(section!.text!.text).toContain("src/auth.ts");
      expect(section!.text!.text).toContain("feature/auth");

      // Context block with footer
      const context = message.blocks.find((b) => b.type === "context");
      expect(context).toBeDefined();
      expect(context!.elements![0].text).toBe("*konductor collision alert for org/my-project*");
    });

    it("maps emoji correctly for each collision state", () => {
      const notifier = new SlackNotifier(createMockSettings(), new SlackStateTracker(), createMockLogger());

      const states = [
        CollisionState.Solo,
        CollisionState.Neighbors,
        CollisionState.Crossroads,
        CollisionState.CollisionCourse,
        CollisionState.MergeHell,
      ];

      for (const state of states) {
        const result = createCollisionResult({ state });
        const message = notifier.buildEscalationMessage("org/repo", result);
        const header = message.blocks.find((b) => b.type === "header");
        const expectedEmoji = STATE_EMOJI[state as string];
        expect(header!.text!.text).toContain(expectedEmoji);
      }
    });
  });

  describe("buildDeescalationMessage", () => {
    it("contains resolution text with previous state emoji", () => {
      const notifier = new SlackNotifier(createMockSettings(), new SlackStateTracker(), createMockLogger());

      const message = notifier.buildDeescalationMessage("org/my-project", CollisionState.CollisionCourse);

      const section = message.blocks.find((b) => b.type === "section");
      expect(section!.text!.text).toContain("✅ Collision resolved on org/my-project");
      expect(section!.text!.text).toContain("🟠");
      expect(section!.text!.text).toContain("Collision Course");
    });

    it("contains footer context block", () => {
      const notifier = new SlackNotifier(createMockSettings(), new SlackStateTracker(), createMockLogger());

      const message = notifier.buildDeescalationMessage("org/my-project", CollisionState.MergeHell);

      const context = message.blocks.find((b) => b.type === "context");
      expect(context).toBeDefined();
      expect(context!.elements![0].text).toBe("*konductor collision alert for org/my-project*");
    });
  });

  describe("validateToken", () => {
    it("returns ok with team and botUser on success", async () => {
      fetchMock.mockResolvedValue({
        json: async () => ({ ok: true, team: "My Team", user: "konductor-bot" }),
      });

      const notifier = new SlackNotifier(createMockSettings(), new SlackStateTracker(), createMockLogger());
      const result = await notifier.validateToken();

      expect(result).toEqual({ ok: true, team: "My Team", botUser: "konductor-bot" });
    });

    it("returns error when token is not configured", async () => {
      const notifier = new SlackNotifier(createMockSettings({ token: null }), new SlackStateTracker(), createMockLogger());
      const result = await notifier.validateToken();

      expect(result).toEqual({ ok: false, error: "Bot token not configured" });
    });

    it("returns error on Slack API failure", async () => {
      fetchMock.mockResolvedValue({
        json: async () => ({ ok: false, error: "invalid_auth" }),
      });

      const notifier = new SlackNotifier(createMockSettings(), new SlackStateTracker(), createMockLogger());
      const result = await notifier.validateToken();

      expect(result).toEqual({ ok: false, error: "invalid_auth" });
    });
  });

  describe("isConfigured", () => {
    it("returns true when bot token is available", async () => {
      const notifier = new SlackNotifier(createMockSettings(), new SlackStateTracker(), createMockLogger());
      expect(await notifier.isConfigured()).toBe(true);
    });

    it("returns false when bot token is null", async () => {
      const notifier = new SlackNotifier(createMockSettings({ token: null }), new SlackStateTracker(), createMockLogger());
      expect(await notifier.isConfigured()).toBe(false);
    });
  });

  describe("sendTestMessage", () => {
    it("posts test message to specified channel", async () => {
      const notifier = new SlackNotifier(createMockSettings(), new SlackStateTracker(), createMockLogger());
      const result = await notifier.sendTestMessage("general");

      expect(result).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://slack.com/api/chat.postMessage",
        expect.objectContaining({ method: "POST" }),
      );

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.channel).toBe("general");
    });

    it("returns error when bot token is missing", async () => {
      const notifier = new SlackNotifier(createMockSettings({ token: null }), new SlackStateTracker(), createMockLogger());
      const result = await notifier.sendTestMessage("general");

      expect(result).toEqual({ ok: false, error: "Bot token not configured" });
    });
  });
});

// ---------------------------------------------------------------------------
// Collaboration Request Notification Tests (Requirements 4.1–4.5)
// ---------------------------------------------------------------------------

function createCollabRequest(overrides: Partial<CollabRequest> = {}): CollabRequest {
  return {
    requestId: "req-123",
    initiator: "alice",
    recipient: "bob",
    repo: "org/my-project",
    branch: "main",
    files: ["src/index.ts", "src/utils.ts"],
    collisionState: CollisionState.CollisionCourse,
    status: "pending",
    createdAt: "2026-04-21T10:00:00Z",
    updatedAt: "2026-04-21T10:00:00Z",
    ...overrides,
  };
}

describe("SlackNotifier — Collab Request Notifications", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);
    delete process.env.KONDUCTOR_COLLAB_SLACK_DM;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.KONDUCTOR_COLLAB_SLACK_DM;
  });

  describe("sendCollabRequest", () => {
    it("sends collab request message to repo channel", async () => {
      process.env.KONDUCTOR_COLLAB_SLACK_DM = "false";
      const notifier = new SlackNotifier(createMockSettings(), new SlackStateTracker(), createMockLogger());
      const request = createCollabRequest();

      const result = await notifier.sendCollabRequest("org/my-project", request);

      expect(result.ok).toBe(true);
      expect(result.slackConfigured).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://slack.com/api/chat.postMessage",
        expect.objectContaining({ method: "POST" }),
      );

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.channel).toBe("test-channel");
    });

    it("returns slackConfigured=false when no bot token", async () => {
      const notifier = new SlackNotifier(createMockSettings({ token: null }), new SlackStateTracker(), createMockLogger());
      const request = createCollabRequest();

      const result = await notifier.sendCollabRequest("org/my-project", request);

      expect(result.ok).toBe(false);
      expect(result.slackConfigured).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("skips when verbosity is 0", async () => {
      const notifier = new SlackNotifier(createMockSettings({ verbosity: 0 }), new SlackStateTracker(), createMockLogger());
      const request = createCollabRequest();

      const result = await notifier.sendCollabRequest("org/my-project", request);

      expect(result.ok).toBe(true);
      expect(result.slackConfigured).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("sends at verbosity 1", async () => {
      process.env.KONDUCTOR_COLLAB_SLACK_DM = "false";
      const notifier = new SlackNotifier(createMockSettings({ verbosity: 1 }), new SlackStateTracker(), createMockLogger());
      const request = createCollabRequest();

      const result = await notifier.sendCollabRequest("org/my-project", request);

      expect(result.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalled();
    });

    it("attempts DM when KONDUCTOR_COLLAB_SLACK_DM is true (default)", async () => {
      // Mock users.list → find bob, conversations.open → DM channel, chat.postMessage → ok
      fetchMock
        .mockResolvedValueOnce({
          json: async () => ({
            ok: true,
            members: [{ id: "U123", name: "bob", profile: { display_name: "bob" } }],
          }),
        })
        .mockResolvedValueOnce({
          json: async () => ({ ok: true, channel: { id: "D456" } }),
        })
        .mockResolvedValueOnce({
          json: async () => ({ ok: true }),
        });

      const notifier = new SlackNotifier(createMockSettings(), new SlackStateTracker(), createMockLogger());
      const request = createCollabRequest();

      const result = await notifier.sendCollabRequest("org/my-project", request);

      expect(result.ok).toBe(true);
      // Should have called users.list, conversations.open, chat.postMessage
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls[0][0]).toBe("https://slack.com/api/users.list");
      expect(fetchMock.mock.calls[1][0]).toBe("https://slack.com/api/conversations.open");
      expect(fetchMock.mock.calls[2][0]).toBe("https://slack.com/api/chat.postMessage");

      // DM channel should be used
      const body = JSON.parse(fetchMock.mock.calls[2][1].body);
      expect(body.channel).toBe("D456");
    });

    it("falls back to channel when DM fails", async () => {
      // Mock users.list → user not found
      fetchMock
        .mockResolvedValueOnce({
          json: async () => ({ ok: true, members: [] }),
        })
        .mockResolvedValueOnce({
          json: async () => ({ ok: true }),
        });

      const notifier = new SlackNotifier(createMockSettings(), new SlackStateTracker(), createMockLogger());
      const request = createCollabRequest();

      const result = await notifier.sendCollabRequest("org/my-project", request);

      expect(result.ok).toBe(true);
      // Second call should be chat.postMessage to channel
      const body = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(body.channel).toBe("test-channel");
    });

    it("skips DM when KONDUCTOR_COLLAB_SLACK_DM=false", async () => {
      process.env.KONDUCTOR_COLLAB_SLACK_DM = "false";
      const notifier = new SlackNotifier(createMockSettings(), new SlackStateTracker(), createMockLogger());
      const request = createCollabRequest();

      const result = await notifier.sendCollabRequest("org/my-project", request);

      expect(result.ok).toBe(true);
      // Should only call chat.postMessage (no users.list or conversations.open)
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe("https://slack.com/api/chat.postMessage");
    });
  });

  describe("sendCollabStatusUpdate", () => {
    it("sends accepted status update", async () => {
      process.env.KONDUCTOR_COLLAB_SLACK_DM = "false";
      const notifier = new SlackNotifier(createMockSettings(), new SlackStateTracker(), createMockLogger());
      const request = createCollabRequest({ status: "accepted" });

      const result = await notifier.sendCollabStatusUpdate("org/my-project", request);

      expect(result.ok).toBe(true);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      const header = body.blocks.find((b: any) => b.type === "header");
      expect(header.text.text).toContain("Accepted");
    });

    it("sends declined status update", async () => {
      process.env.KONDUCTOR_COLLAB_SLACK_DM = "false";
      const notifier = new SlackNotifier(createMockSettings(), new SlackStateTracker(), createMockLogger());
      const request = createCollabRequest({ status: "declined" });

      const result = await notifier.sendCollabStatusUpdate("org/my-project", request);

      expect(result.ok).toBe(true);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      const header = body.blocks.find((b: any) => b.type === "header");
      expect(header.text.text).toContain("Declined");
    });

    it("sends link_shared with clickable join link", async () => {
      process.env.KONDUCTOR_COLLAB_SLACK_DM = "false";
      const notifier = new SlackNotifier(createMockSettings(), new SlackStateTracker(), createMockLogger());
      const request = createCollabRequest({
        status: "link_shared",
        shareLink: "https://prod.liveshare.vsengsaas.visualstudio.com/join?abc123",
      });

      const result = await notifier.sendCollabStatusUpdate("org/my-project", request);

      expect(result.ok).toBe(true);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      const section = body.blocks.find((b: any) => b.type === "section");
      expect(section.text.text).toContain("liveshare");
      expect(section.text.text).toContain("Join Live Share Session");
    });

    it("returns error when no bot token", async () => {
      const notifier = new SlackNotifier(createMockSettings({ token: null }), new SlackStateTracker(), createMockLogger());
      const request = createCollabRequest({ status: "accepted" });

      const result = await notifier.sendCollabStatusUpdate("org/my-project", request);

      expect(result.ok).toBe(false);
      expect(result.error).toContain("not configured");
    });

    it("skips when verbosity is 0", async () => {
      const notifier = new SlackNotifier(createMockSettings({ verbosity: 0 }), new SlackStateTracker(), createMockLogger());
      const request = createCollabRequest({ status: "accepted" });

      const result = await notifier.sendCollabStatusUpdate("org/my-project", request);

      expect(result.ok).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("buildCollabRequestMessage", () => {
    it("includes initiator, recipient, repo, files, collision state, and call-to-action", () => {
      const notifier = new SlackNotifier(createMockSettings(), new SlackStateTracker(), createMockLogger());
      const request = createCollabRequest();

      const message = notifier.buildCollabRequestMessage("org/my-project", request);

      const header = message.blocks.find((b) => b.type === "header");
      expect(header!.text!.text).toContain("Collaboration Request");
      expect(header!.text!.text).toContain("org/my-project");

      const section = message.blocks.find((b) => b.type === "section");
      expect(section!.text!.text).toContain("alice");
      expect(section!.text!.text).toContain("bob");
      expect(section!.text!.text).toContain("src/index.ts");
      expect(section!.text!.text).toContain("Collision Course");
      expect(section!.text!.text).toContain("konductor, accept collab from alice");

      const context = message.blocks.find((b) => b.type === "context");
      expect(context!.elements![0].text).toContain("konductor collab request");
    });
  });

  describe("buildCollabStatusUpdateMessage", () => {
    it("builds accepted message", () => {
      const notifier = new SlackNotifier(createMockSettings(), new SlackStateTracker(), createMockLogger());
      const request = createCollabRequest({ status: "accepted" });

      const message = notifier.buildCollabStatusUpdateMessage("org/my-project", request);

      const header = message.blocks.find((b) => b.type === "header");
      expect(header!.text!.text).toContain("Accepted");

      const section = message.blocks.find((b) => b.type === "section");
      expect(section!.text!.text).toContain("bob");
      expect(section!.text!.text).toContain("accepted");
    });

    it("builds declined message", () => {
      const notifier = new SlackNotifier(createMockSettings(), new SlackStateTracker(), createMockLogger());
      const request = createCollabRequest({ status: "declined" });

      const message = notifier.buildCollabStatusUpdateMessage("org/my-project", request);

      const header = message.blocks.find((b) => b.type === "header");
      expect(header!.text!.text).toContain("Declined");
    });

    it("builds link_shared message with join link", () => {
      const notifier = new SlackNotifier(createMockSettings(), new SlackStateTracker(), createMockLogger());
      const request = createCollabRequest({
        status: "link_shared",
        shareLink: "https://prod.liveshare.vsengsaas.visualstudio.com/join?abc",
      });

      const message = notifier.buildCollabStatusUpdateMessage("org/my-project", request);

      const header = message.blocks.find((b) => b.type === "header");
      expect(header!.text!.text).toContain("Live Share Link Shared");

      const section = message.blocks.find((b) => b.type === "section");
      expect(section!.text!.text).toContain("liveshare");
      expect(section!.text!.text).toContain("Join Live Share Session");
    });
  });
});
