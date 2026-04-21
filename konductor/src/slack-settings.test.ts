/**
 * Unit Tests for SlackSettingsManager
 *
 * Tests per-repo config read/write, default channel generation,
 * bot token precedence, channel name validation, and verbosity validation.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 5.3, 6.7
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemorySettingsBackend } from "./settings-store.js";
import { AdminSettingsStore } from "./admin-settings-store.js";
import {
  SlackSettingsManager,
  sanitizeChannelName,
  validateChannelName,
  validateVerbosity,
  shouldNotify,
} from "./slack-settings.js";
import { CollisionState } from "./types.js";

describe("SlackSettingsManager", () => {
  let backend: MemorySettingsBackend;
  let settingsStore: AdminSettingsStore;
  let manager: SlackSettingsManager;
  const originalEnv = process.env.SLACK_BOT_TOKEN;

  beforeEach(() => {
    backend = new MemorySettingsBackend();
    settingsStore = new AdminSettingsStore(backend);
    manager = new SlackSettingsManager(settingsStore);
    delete process.env.SLACK_BOT_TOKEN;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SLACK_BOT_TOKEN;
    } else {
      process.env.SLACK_BOT_TOKEN = originalEnv;
    }
  });

  // ── Per-repo config read/write round-trip ─────────────────────────

  describe("getRepoConfig / setRepoChannel / setRepoVerbosity", () => {
    it("returns defaults when no config is set", async () => {
      const config = await manager.getRepoConfig("org/my-project");
      expect(config.channel).toBe("konductor-alerts-my-project");
      expect(config.verbosity).toBe(2);
      expect(config.enabled).toBe(false); // no bot token
    });

    it("round-trips channel and verbosity", async () => {
      await manager.setRepoChannel("org/my-project", "custom-channel");
      await manager.setRepoVerbosity("org/my-project", 4);

      const config = await manager.getRepoConfig("org/my-project");
      expect(config.channel).toBe("custom-channel");
      expect(config.verbosity).toBe(4);
    });

    it("enabled is true when bot token is set and verbosity > 0", async () => {
      process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
      await manager.setRepoVerbosity("org/repo", 3);

      const config = await manager.getRepoConfig("org/repo");
      expect(config.enabled).toBe(true);
    });

    it("enabled is false when verbosity is 0 even with bot token", async () => {
      process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
      await manager.setRepoVerbosity("org/repo", 0);

      const config = await manager.getRepoConfig("org/repo");
      expect(config.enabled).toBe(false);
    });
  });

  // ── Default channel name generation ───────────────────────────────

  describe("default channel name generation", () => {
    it("sanitizes owner/repo format", async () => {
      const config = await manager.getRepoConfig("org/My-Project.v2");
      expect(config.channel).toBe("konductor-alerts-my-project-v2");
    });

    it("handles simple repo name", async () => {
      const config = await manager.getRepoConfig("simple-repo");
      expect(config.channel).toBe("konductor-alerts-simple-repo");
    });

    it("handles uppercase repo name", async () => {
      const config = await manager.getRepoConfig("org/UPPERCASE");
      expect(config.channel).toBe("konductor-alerts-uppercase");
    });

    it("handles repo with dots and underscores", async () => {
      const config = await manager.getRepoConfig("org/my_project.ts");
      expect(config.channel).toBe("konductor-alerts-my_project-ts");
    });
  });

  // ── Bot token source precedence ───────────────────────────────────

  describe("getBotToken", () => {
    it("returns env var when set", async () => {
      process.env.SLACK_BOT_TOKEN = "xoxb-env-token";
      await settingsStore.set("slack:bot_token", "xoxb-db-token", "slack");

      const token = await manager.getBotToken();
      expect(token).toBe("xoxb-env-token");
    });

    it("returns database token when env var not set", async () => {
      await settingsStore.set("slack:bot_token", "xoxb-db-token", "slack");

      const token = await manager.getBotToken();
      expect(token).toBe("xoxb-db-token");
    });

    it("returns null when neither is set", async () => {
      const token = await manager.getBotToken();
      expect(token).toBeNull();
    });

    it("ignores empty/whitespace env var", async () => {
      process.env.SLACK_BOT_TOKEN = "   ";
      await settingsStore.set("slack:bot_token", "xoxb-db-token", "slack");

      const token = await manager.getBotToken();
      expect(token).toBe("xoxb-db-token");
    });
  });

  // ── setBotToken ───────────────────────────────────────────────────

  describe("setBotToken", () => {
    it("persists token to settings store", async () => {
      await manager.setBotToken("xoxb-new-token");
      const stored = await settingsStore.get("slack:bot_token");
      expect(stored).toBe("xoxb-new-token");
    });
  });
});

// ── Channel name validation ─────────────────────────────────────────

describe("validateChannelName", () => {
  it("accepts valid channel names", () => {
    expect(validateChannelName("general")).toBe(true);
    expect(validateChannelName("my-channel")).toBe(true);
    expect(validateChannelName("my_channel")).toBe(true);
    expect(validateChannelName("channel123")).toBe(true);
    expect(validateChannelName("a")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(validateChannelName("")).toBe(false);
  });

  it("rejects names starting with hyphen", () => {
    expect(validateChannelName("-channel")).toBe(false);
  });

  it("rejects uppercase", () => {
    expect(validateChannelName("MyChannel")).toBe(false);
  });

  it("rejects special characters", () => {
    expect(validateChannelName("my channel")).toBe(false);
    expect(validateChannelName("my@channel")).toBe(false);
    expect(validateChannelName("#channel")).toBe(false);
  });

  it("rejects names over 80 chars", () => {
    expect(validateChannelName("a".repeat(81))).toBe(false);
  });

  it("accepts names exactly 80 chars", () => {
    expect(validateChannelName("a".repeat(80))).toBe(true);
  });
});

// ── Verbosity validation ────────────────────────────────────────────

describe("validateVerbosity", () => {
  it("accepts 0 through 5", () => {
    for (let i = 0; i <= 5; i++) {
      expect(validateVerbosity(i)).toBe(true);
    }
  });

  it("rejects negative numbers", () => {
    expect(validateVerbosity(-1)).toBe(false);
  });

  it("rejects numbers above 5", () => {
    expect(validateVerbosity(6)).toBe(false);
  });

  it("rejects non-integers", () => {
    expect(validateVerbosity(2.5)).toBe(false);
    expect(validateVerbosity(NaN)).toBe(false);
  });

  it("rejects non-numbers", () => {
    expect(validateVerbosity("3")).toBe(false);
    expect(validateVerbosity(null)).toBe(false);
    expect(validateVerbosity(undefined)).toBe(false);
  });
});

// ── sanitizeChannelName ─────────────────────────────────────────────

describe("sanitizeChannelName", () => {
  it("extracts repo name from owner/repo format", () => {
    expect(sanitizeChannelName("org/my-project")).toBe("my-project");
  });

  it("lowercases", () => {
    expect(sanitizeChannelName("UPPER")).toBe("upper");
  });

  it("replaces dots with hyphens", () => {
    expect(sanitizeChannelName("my.project")).toBe("my-project");
  });

  it("collapses consecutive hyphens", () => {
    expect(sanitizeChannelName("my---project")).toBe("my-project");
  });

  it("removes leading hyphens", () => {
    expect(sanitizeChannelName("---project")).toBe("project");
  });

  it("truncates to 80 chars", () => {
    const long = "a".repeat(100);
    expect(sanitizeChannelName(long).length).toBeLessThanOrEqual(80);
  });

  it("returns 'repo' for empty-after-sanitization input", () => {
    expect(sanitizeChannelName("!!!")).toBe("repo");
  });
});

// ── shouldNotify ────────────────────────────────────────────────────

describe("shouldNotify", () => {
  it("level 2 (default) notifies on collision_course and merge_hell", () => {
    expect(shouldNotify(CollisionState.CollisionCourse, 2)).toBe(true);
    expect(shouldNotify(CollisionState.MergeHell, 2)).toBe(true);
    expect(shouldNotify(CollisionState.Crossroads, 2)).toBe(false);
    expect(shouldNotify(CollisionState.Neighbors, 2)).toBe(false);
    expect(shouldNotify(CollisionState.Solo, 2)).toBe(false);
  });

  it("level 0 never notifies", () => {
    expect(shouldNotify(CollisionState.MergeHell, 0)).toBe(false);
  });

  it("level 5 always notifies", () => {
    expect(shouldNotify(CollisionState.Solo, 5)).toBe(true);
  });

  it("returns false for invalid verbosity", () => {
    expect(shouldNotify(CollisionState.MergeHell, 6)).toBe(false);
    expect(shouldNotify(CollisionState.MergeHell, -1)).toBe(false);
  });
});
