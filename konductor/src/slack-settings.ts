/**
 * SlackSettingsManager — Per-repo Slack configuration and bot token management.
 *
 * Handles:
 * - Per-repo channel and verbosity settings (read/write via AdminSettingsStore)
 * - Bot token resolution (env var takes precedence over database)
 * - Channel name sanitization and validation
 * - Verbosity threshold filtering (shouldNotify)
 * - Global Slack status (token validation via auth.test)
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 5.1, 5.2, 5.3, 6.5, 6.7, 11.3
 */

import type { AdminSettingsStore } from "./admin-settings-store.js";
import type { CollisionState } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RepoSlackConfig {
  channel: string;
  verbosity: number;
  enabled: boolean;
}

export interface SlackGlobalStatus {
  configured: boolean;
  team?: string;
  botUser?: string;
}

export interface ISlackSettingsManager {
  getRepoConfig(repo: string): Promise<RepoSlackConfig>;
  setRepoChannel(repo: string, channel: string): Promise<void>;
  setRepoVerbosity(repo: string, verbosity: number): Promise<void>;
  getGlobalStatus(): Promise<SlackGlobalStatus>;
  getBotToken(): Promise<string | null>;
  setBotToken(token: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Verbosity Threshold Mapping (Requirement 5.2)
// ---------------------------------------------------------------------------

export const VERBOSITY_THRESHOLD: Record<number, CollisionState[]> = {
  0: [],
  1: ["merge_hell" as CollisionState],
  2: ["collision_course" as CollisionState, "merge_hell" as CollisionState],
  3: ["crossroads" as CollisionState, "collision_course" as CollisionState, "merge_hell" as CollisionState],
  4: ["neighbors" as CollisionState, "crossroads" as CollisionState, "proximity" as CollisionState, "collision_course" as CollisionState, "merge_hell" as CollisionState],
  5: ["solo" as CollisionState, "neighbors" as CollisionState, "crossroads" as CollisionState, "proximity" as CollisionState, "collision_course" as CollisionState, "merge_hell" as CollisionState],
};

/**
 * Determine if a collision state should trigger a Slack notification
 * at the given verbosity level.
 *
 * Requirements: 5.1, 5.2
 */
export function shouldNotify(state: CollisionState, verbosity: number): boolean {
  const states = VERBOSITY_THRESHOLD[verbosity];
  if (!states) return false;
  return states.includes(state);
}

// ---------------------------------------------------------------------------
// Channel Name Utilities (Requirement 2.2)
// ---------------------------------------------------------------------------

/**
 * Sanitize a repository name into a valid Slack channel name.
 *
 * Rules (per Slack API):
 * - Lowercase only
 * - Only letters, numbers, hyphens, underscores
 * - No leading hyphens
 * - Max 80 characters
 * - Replace non-allowed chars with `-`
 * - Collapse consecutive hyphens
 * - Trim leading/trailing hyphens
 */
export function sanitizeChannelName(repoName: string): string {
  // Extract just the repo name if in owner/repo format
  const parts = repoName.split("/");
  const name = parts[parts.length - 1] || repoName;

  let sanitized = name
    .toLowerCase()
    // Replace non-allowed characters with hyphen
    .replace(/[^a-z0-9_-]/g, "-")
    // Collapse consecutive hyphens
    .replace(/-{2,}/g, "-")
    // Remove leading hyphens
    .replace(/^-+/, "")
    // Remove trailing hyphens
    .replace(/-+$/, "");

  // Truncate to 80 chars
  if (sanitized.length > 80) {
    sanitized = sanitized.slice(0, 80);
    // Remove trailing hyphen after truncation
    sanitized = sanitized.replace(/-+$/, "");
  }

  // If empty after sanitization, use a fallback
  if (sanitized.length === 0) {
    sanitized = "repo";
  }

  return sanitized;
}

/**
 * Validate a Slack channel name against Slack's naming rules.
 *
 * Valid: lowercase letters, numbers, hyphens, underscores.
 * Length: 1–80 characters. No leading hyphen.
 *
 * Requirement 11.3
 */
export function validateChannelName(name: string): boolean {
  if (typeof name !== "string") return false;
  if (name.length === 0 || name.length > 80) return false;
  if (name.startsWith("-")) return false;
  return /^[a-z0-9_][a-z0-9_-]*$/.test(name);
}

/**
 * Validate a verbosity level (integer 0–5).
 *
 * Requirement 11.3
 */
export function validateVerbosity(n: unknown): boolean {
  if (typeof n !== "number") return false;
  if (!Number.isInteger(n)) return false;
  return n >= 0 && n <= 5;
}

// ---------------------------------------------------------------------------
// SlackSettingsManager
// ---------------------------------------------------------------------------

export class SlackSettingsManager implements ISlackSettingsManager {
  private readonly settingsStore: AdminSettingsStore;

  constructor(settingsStore: AdminSettingsStore) {
    this.settingsStore = settingsStore;
  }

  /**
   * Get the Slack configuration for a repo.
   * Applies defaults: channel = konductor-alerts-<sanitized_repo>, verbosity = 2.
   *
   * Requirement 2.1, 2.2, 2.3
   */
  async getRepoConfig(repo: string): Promise<RepoSlackConfig> {
    const channelKey = `slack:${repo}:channel`;
    const verbosityKey = `slack:${repo}:verbosity`;

    const storedChannel = await this.settingsStore.get(channelKey) as string | undefined;
    const storedVerbosity = await this.settingsStore.get(verbosityKey) as number | undefined;

    const defaultChannel = `konductor-alerts-${sanitizeChannelName(repo)}`;
    const channel = storedChannel ?? defaultChannel;
    const verbosity = storedVerbosity ?? 2;

    const token = await this.getBotToken();
    const enabled = token !== null && verbosity > 0;

    return { channel, verbosity, enabled };
  }

  /**
   * Set the Slack channel for a repo.
   * Validates the channel name before persisting.
   *
   * Requirement 2.1, 11.3
   */
  async setRepoChannel(repo: string, channel: string): Promise<void> {
    if (!validateChannelName(channel)) {
      throw new Error(`Invalid Slack channel name: "${channel}". Must be lowercase, alphanumeric/hyphens/underscores, 1-80 chars, no leading hyphen.`);
    }
    await this.settingsStore.set(`slack:${repo}:channel`, channel, "slack");
  }

  /**
   * Set the verbosity level for a repo.
   * Validates the range (0–5) before persisting.
   *
   * Requirement 5.1, 11.3
   */
  async setRepoVerbosity(repo: string, verbosity: number): Promise<void> {
    if (!validateVerbosity(verbosity)) {
      throw new Error(`Invalid verbosity level: ${verbosity}. Must be an integer 0–5.`);
    }
    await this.settingsStore.set(`slack:${repo}:verbosity`, verbosity, "slack");
  }

  /**
   * Get the bot token. Environment variable takes precedence over database.
   *
   * Requirement 6.7
   */
  async getBotToken(): Promise<string | null> {
    // Env var takes precedence
    const envToken = process.env.SLACK_BOT_TOKEN;
    if (envToken && envToken.trim().length > 0) {
      return envToken.trim();
    }

    // Fall back to database
    const dbToken = await this.settingsStore.get("slack:bot_token") as string | undefined;
    return dbToken ?? null;
  }

  /**
   * Store the bot token in the settings store.
   *
   * Requirement 6.5
   */
  async setBotToken(token: string): Promise<void> {
    await this.settingsStore.set("slack:bot_token", token, "slack");
  }

  /**
   * Get global Slack status by validating the bot token via auth.test.
   *
   * Requirement 6.1
   */
  async getGlobalStatus(): Promise<SlackGlobalStatus> {
    const token = await this.getBotToken();
    if (!token) {
      return { configured: false };
    }

    try {
      const response = await fetch("https://slack.com/api/auth.test", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      const data = await response.json() as { ok: boolean; team?: string; user?: string; error?: string };

      if (data.ok) {
        return {
          configured: true,
          team: data.team,
          botUser: data.user,
        };
      }

      return { configured: false };
    } catch {
      return { configured: false };
    }
  }
}
