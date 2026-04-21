/**
 * SlackNotifier — Posts collision notifications to Slack channels.
 *
 * Handles:
 * - Escalation messages (collision state meets verbosity threshold)
 * - De-escalation messages (state drops below threshold)
 * - Test messages for config verification
 * - Token validation via auth.test
 *
 * All exceptions are caught internally and logged — never throws to callers.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 9.1, 9.2, 9.3
 */

import type { CollisionState, CollisionResult, OverlappingSessionDetail } from "./types.js";
import type { ISlackSettingsManager } from "./slack-settings.js";
import { shouldNotify } from "./slack-settings.js";
import type { ISlackStateTracker } from "./slack-state-tracker.js";
import type { KonductorLogger } from "./logger.js";
import { formatLineRanges } from "./line-range-formatter.js";
import type { SlackDebouncer } from "./slack-debouncer.js";
import type { CollabRequest } from "./collab-request-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ISlackNotifier {
  /** Called after collision evaluation. Posts to Slack if threshold met. */
  onCollisionEvaluated(repo: string, result: CollisionResult, triggeringUserId: string): Promise<void>;

  /** Post a test message to verify configuration. */
  sendTestMessage(channel: string): Promise<{ ok: boolean; error?: string }>;

  /** Validate the bot token by calling auth.test. */
  validateToken(): Promise<{ ok: boolean; team?: string; botUser?: string; error?: string }>;

  /** Check if Slack is configured (bot token available). */
  isConfigured(): Promise<boolean>;

  /** Build an escalation message (exposed for testing). */
  buildEscalationMessage(repo: string, result: CollisionResult): SlackMessage;

  /** Build a de-escalation message (exposed for testing). */
  buildDeescalationMessage(repo: string, previousState: CollisionState): SlackMessage;

  /** Send a Slack notification for a new collaboration request (Req 4.1, 4.2, 4.4, 4.5). */
  sendCollabRequest(repo: string, request: CollabRequest): Promise<{ ok: boolean; slackConfigured: boolean; error?: string }>;

  /** Send a Slack notification for a collab request status change (Req 4.3). */
  sendCollabStatusUpdate(repo: string, request: CollabRequest): Promise<{ ok: boolean; error?: string }>;

  /** Build a collab request message (exposed for testing). */
  buildCollabRequestMessage(repo: string, request: CollabRequest): SlackMessage;

  /** Build a collab status update message (exposed for testing). */
  buildCollabStatusUpdateMessage(repo: string, request: CollabRequest): SlackMessage;
}

export interface SlackBlock {
  type: string;
  text?: { type: string; text: string };
  elements?: Array<{ type: string; text: string }>;
}

export interface SlackMessage {
  channel: string;
  blocks: SlackBlock[];
}

// ---------------------------------------------------------------------------
// Emoji Mapping (Requirement 8.6)
// ---------------------------------------------------------------------------

export const STATE_EMOJI: Record<string, string> = {
  solo: "🟢",
  neighbors: "🟢",
  crossroads: "🟡",
  proximity: "🟢",
  collision_course: "🟠",
  merge_hell: "🔴",
};

export const STATE_DISPLAY_NAME: Record<string, string> = {
  solo: "Solo",
  neighbors: "Neighbors",
  crossroads: "Crossroads",
  proximity: "Proximity",
  collision_course: "Collision Course",
  merge_hell: "Merge Hell",
};

// ---------------------------------------------------------------------------
// SlackNotifier
// ---------------------------------------------------------------------------

export class SlackNotifier implements ISlackNotifier {
  private readonly settings: ISlackSettingsManager;
  private readonly stateTracker: ISlackStateTracker;
  private readonly logger: KonductorLogger;
  private readonly debouncer: SlackDebouncer | null;

  constructor(
    settings: ISlackSettingsManager,
    stateTracker: ISlackStateTracker,
    logger: KonductorLogger,
    debouncer?: SlackDebouncer,
  ) {
    this.settings = settings;
    this.stateTracker = stateTracker;
    this.logger = logger;
    this.debouncer = debouncer ?? null;
  }

  /**
   * Called after collision evaluation. Posts to Slack if threshold met.
   * Never throws — all errors are caught and logged.
   *
   * Requirements: 1.1, 1.6, 1.7, 9.1, 9.2, 9.3
   */
  async onCollisionEvaluated(repo: string, result: CollisionResult, _triggeringUserId: string): Promise<void> {
    try {
      const token = await this.settings.getBotToken();
      if (!token) {
        return; // Not configured — silent skip (Requirement 1.6)
      }

      const config = await this.settings.getRepoConfig(repo);
      if (config.verbosity === 0) {
        return; // Disabled for this repo
      }

      const currentState = result.state as CollisionState;
      const meetsThreshold = shouldNotify(currentState, config.verbosity);
      const previousState = this.stateTracker.getLastNotifiedState(repo);
      const previousMeetsThreshold = previousState !== null && shouldNotify(previousState, config.verbosity);

      if (meetsThreshold || (previousMeetsThreshold && !meetsThreshold)) {
        // Determine what to send
        const sendNotification = async () => {
          const token = await this.settings.getBotToken();
          if (!token) return;
          const config = await this.settings.getRepoConfig(repo);

          const currentState = result.state as CollisionState;
          const meetsThreshold = shouldNotify(currentState, config.verbosity);
          const previousState = this.stateTracker.getLastNotifiedState(repo);
          const previousMeetsThreshold = previousState !== null && shouldNotify(previousState, config.verbosity);

          if (meetsThreshold) {
            const message = this.buildEscalationMessage(repo, result);
            message.channel = config.channel;
            await this.postMessage(token, message);
            this.stateTracker.setLastNotifiedState(repo, currentState);
          } else if (previousMeetsThreshold && !meetsThreshold) {
            const message = this.buildDeescalationMessage(repo, previousState!);
            message.channel = config.channel;
            await this.postMessage(token, message);
            this.stateTracker.setLastNotifiedState(repo, currentState);
          }
        };

        if (this.debouncer) {
          // Debounced path: schedule through debouncer (Requirements 4.1, 4.2, 4.3)
          this.debouncer.schedule(repo, result, _triggeringUserId, async () => {
            try {
              await sendNotification();
            } catch (err) {
              if (this.logger.enabled) {
                this.logger.logConfigError(`Debounced Slack notification failed for ${repo}: ${err instanceof Error ? err.message : String(err)}`);
              }
            }
          });
        } else {
          // Immediate path: no debouncer configured
          await sendNotification();
        }
      }
      // If neither condition met, no message is sent
    } catch (err) {
      // Never throw — log and continue (Requirement 1.7)
      if (this.logger.enabled) {
        this.logger.logConfigError(`Slack notification failed for ${repo}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /**
   * Post a test message to verify configuration.
   *
   * Requirement 6.10
   */
  async sendTestMessage(channel: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const token = await this.settings.getBotToken();
      if (!token) {
        return { ok: false, error: "Bot token not configured" };
      }

      const message: SlackMessage = {
        channel,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "🔔 Konductor Slack integration test message.\nIf you see this, the integration is working correctly.",
            },
          },
          {
            type: "context",
            elements: [
              { type: "mrkdwn", text: "*konductor collision alert — test message*" },
            ],
          },
        ],
      };

      return await this.postMessage(token, message);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Validate the bot token by calling auth.test.
   *
   * Requirement 6.4
   */
  async validateToken(): Promise<{ ok: boolean; team?: string; botUser?: string; error?: string }> {
    try {
      const token = await this.settings.getBotToken();
      if (!token) {
        return { ok: false, error: "Bot token not configured" };
      }

      const response = await fetch("https://slack.com/api/auth.test", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      const data = await response.json() as { ok: boolean; team?: string; user?: string; error?: string };

      if (data.ok) {
        return { ok: true, team: data.team, botUser: data.user };
      }
      return { ok: false, error: data.error ?? "Unknown error" };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Check if Slack is configured (bot token available).
   */
  async isConfigured(): Promise<boolean> {
    const token = await this.settings.getBotToken();
    return token !== null;
  }

  /**
   * Build an escalation message with Block Kit format.
   *
   * Requirements: 8.1, 8.2, 8.3, 8.4, 8.6
   * Line range annotations per Requirement 4.4
   */
  buildEscalationMessage(repo: string, result: CollisionResult): SlackMessage {
    const state = result.state as string;
    const emoji = STATE_EMOJI[state] ?? "⚪";
    const displayName = STATE_DISPLAY_NAME[state] ?? state;

    // Collect involved users
    const users = result.overlappingSessions
      .map((s) => s.userId)
      .filter((u, i, arr) => arr.indexOf(u) === i);

    // Collect branches
    const branches = result.overlappingSessions
      .map((s) => s.branch)
      .filter((b, i, arr) => arr.indexOf(b) === i);

    // Build section text
    const parts: string[] = [];
    if (users.length > 0) {
      parts.push(`${users.join(" and ")} are modifying the same files:`);
    }

    // Include line range annotations when available (Requirement 4.4)
    if (result.overlappingDetails.length > 0 && this.hasLineOverlapDetails(result)) {
      parts.push(this.formatSharedFilesWithLineRanges(result));
    } else if (result.sharedFiles.length > 0) {
      parts.push(result.sharedFiles.map((f) => `• \`${f}\``).join("\n"));
    }

    if (branches.length > 0) {
      parts.push(`\nBranch: \`${branches.join("`, `")}\``);
    }

    // Append severity recommendation (Requirements 5.3, 5.4)
    if (result.overlapSeverity === "severe") {
      parts.push("\nHigh merge conflict risk. Coordinate immediately.");
    } else if (result.overlapSeverity === "minimal") {
      parts.push("\nMinor overlap — likely a quick merge resolution.");
    }

    const sectionText = parts.join("\n") || `Collision detected in ${repo}`;

    return {
      channel: "", // Set by caller
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: `${emoji} ${displayName} — ${repo}` },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: sectionText },
        },
        {
          type: "context",
          elements: [
            { type: "mrkdwn", text: `*konductor collision alert for ${repo}*` },
          ],
        },
      ],
    };
  }

  /**
   * Build a de-escalation message.
   *
   * Requirements: 8.5, 9.2
   */
  buildDeescalationMessage(repo: string, previousState: CollisionState): SlackMessage {
    const prevStateStr = previousState as string;
    const emoji = STATE_EMOJI[prevStateStr] ?? "⚪";
    const displayName = STATE_DISPLAY_NAME[prevStateStr] ?? prevStateStr;

    return {
      channel: "", // Set by caller
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `✅ Collision resolved on ${repo} — previously ${emoji} ${displayName}`,
          },
        },
        {
          type: "context",
          elements: [
            { type: "mrkdwn", text: `*konductor collision alert for ${repo}*` },
          ],
        },
      ],
    };
  }

  // ---------------------------------------------------------------------------
  // Collaboration Request Notifications (Requirements 4.1–4.5, 11.1)
  // ---------------------------------------------------------------------------

  /**
   * Send a Slack notification for a new collaboration request.
   *
   * - Respects verbosity ≥ 1 (Req 4.4)
   * - Attempts DM when KONDUCTOR_COLLAB_SLACK_DM=true (Req 11.1, 4.1)
   * - Falls back to channel when DM fails or is disabled
   * - Returns { slackConfigured: false } when Slack is not set up (Req 4.5)
   *
   * Requirements: 4.1, 4.2, 4.4, 4.5
   */
  async sendCollabRequest(repo: string, request: CollabRequest): Promise<{ ok: boolean; slackConfigured: boolean; error?: string }> {
    try {
      const token = await this.settings.getBotToken();
      if (!token) {
        return { ok: false, slackConfigured: false, error: "Slack not configured" };
      }

      const config = await this.settings.getRepoConfig(repo);
      if (config.verbosity < 1) {
        return { ok: true, slackConfigured: true }; // Silently skip — below threshold
      }

      const message = this.buildCollabRequestMessage(repo, request);
      message.channel = config.channel;

      // Attempt DM if enabled (Req 11.1)
      if (this.isCollabSlackDmEnabled()) {
        const dmResult = await this.sendDmToUser(token, request.recipient, message);
        if (dmResult.ok) {
          return { ok: true, slackConfigured: true };
        }
        // DM failed — fall back to channel
        if (this.logger.enabled) {
          this.logger.logConfigError(`Slack DM to ${request.recipient} failed (${dmResult.error}), falling back to channel`);
        }
      }

      // Send to channel
      const result = await this.postMessage(token, message);
      return { ok: result.ok, slackConfigured: true, error: result.error };
    } catch (err) {
      if (this.logger.enabled) {
        this.logger.logConfigError(`Slack collab request notification failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      return { ok: false, slackConfigured: true, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Send a Slack notification for a collab request status change.
   *
   * Handles: accepted, declined, link_shared.
   * For link_shared: includes clickable join link.
   *
   * Requirements: 4.3
   */
  async sendCollabStatusUpdate(repo: string, request: CollabRequest): Promise<{ ok: boolean; error?: string }> {
    try {
      const token = await this.settings.getBotToken();
      if (!token) {
        return { ok: false, error: "Slack not configured" };
      }

      const config = await this.settings.getRepoConfig(repo);
      if (config.verbosity < 1) {
        return { ok: true }; // Below threshold
      }

      const message = this.buildCollabStatusUpdateMessage(repo, request);
      message.channel = config.channel;

      // For link_shared, also attempt DM to initiator (they need the link)
      if (request.status === "link_shared" && this.isCollabSlackDmEnabled()) {
        const dmResult = await this.sendDmToUser(token, request.initiator, message);
        if (dmResult.ok) {
          return { ok: true };
        }
        // Fall back to channel
      }

      // For accepted/declined, DM the initiator
      if ((request.status === "accepted" || request.status === "declined") && this.isCollabSlackDmEnabled()) {
        const dmResult = await this.sendDmToUser(token, request.initiator, message);
        if (dmResult.ok) {
          return { ok: true };
        }
        // Fall back to channel
      }

      const result = await this.postMessage(token, message);
      return { ok: result.ok, error: result.error };
    } catch (err) {
      if (this.logger.enabled) {
        this.logger.logConfigError(`Slack collab status update failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Build a Block Kit message for a new collaboration request.
   *
   * Requirements: 4.1, 4.2
   */
  buildCollabRequestMessage(repo: string, request: CollabRequest): SlackMessage {
    const stateEmoji = STATE_EMOJI[request.collisionState as string] ?? "⚪";
    const stateDisplay = STATE_DISPLAY_NAME[request.collisionState as string] ?? String(request.collisionState);

    const filesText = request.files.map((f) => `• \`${f}\``).join("\n");

    const sectionText = [
      `*${request.initiator}* wants to pair with *${request.recipient}* on \`${repo}\``,
      "",
      `*Collision:* ${stateEmoji} ${stateDisplay}`,
      `*Branch:* \`${request.branch}\``,
      `*Files:*`,
      filesText,
      "",
      `Open your IDE and say \`konductor, accept collab from ${request.initiator}\``,
    ].join("\n");

    return {
      channel: "", // Set by caller
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: `🤝 Collaboration Request — ${repo}` },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: sectionText },
        },
        {
          type: "context",
          elements: [
            { type: "mrkdwn", text: `*konductor collab request for ${repo}*` },
          ],
        },
      ],
    };
  }

  /**
   * Build a Block Kit message for a collab request status update.
   *
   * Requirements: 4.3
   */
  buildCollabStatusUpdateMessage(repo: string, request: CollabRequest): SlackMessage {
    let headerText: string;
    let sectionText: string;

    switch (request.status) {
      case "accepted":
        headerText = `🟢 Collaboration Accepted — ${repo}`;
        sectionText = `*${request.recipient}* accepted the collaboration request from *${request.initiator}* on \`${repo}\`.\n\nStart a Live Share session and say \`konductor, share link <url>\` to send it to ${request.initiator}.`;
        break;
      case "declined":
        headerText = `👋 Collaboration Declined — ${repo}`;
        sectionText = `*${request.recipient}* declined the collaboration request from *${request.initiator}* on \`${repo}\`.`;
        break;
      case "link_shared":
        headerText = `🔗 Live Share Link Shared — ${repo}`;
        sectionText = `*${request.recipient}* shared a Live Share link for \`${repo}\`:\n\n<${request.shareLink}|Join Live Share Session>`;
        break;
      default:
        headerText = `📋 Collaboration Update — ${repo}`;
        sectionText = `Collaboration request status changed to *${request.status}* on \`${repo}\`.`;
    }

    return {
      channel: "", // Set by caller
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: headerText },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: sectionText },
        },
        {
          type: "context",
          elements: [
            { type: "mrkdwn", text: `*konductor collab request for ${repo}*` },
          ],
        },
      ],
    };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Check if DM delivery is enabled for collab requests.
   * Reads KONDUCTOR_COLLAB_SLACK_DM env var (default: true).
   *
   * Requirement 11.1
   */
  private isCollabSlackDmEnabled(): boolean {
    const val = process.env.KONDUCTOR_COLLAB_SLACK_DM;
    if (val === undefined || val === "") return true; // Default: true
    return val !== "false";
  }

  /**
   * Attempt to send a DM to a user by looking up their Slack user ID.
   * Uses users.list to find the user by display name, then conversations.open for DM.
   *
   * Returns { ok: false } if user not found or DM fails — caller should fall back to channel.
   */
  private async sendDmToUser(token: string, username: string, message: SlackMessage): Promise<{ ok: boolean; error?: string }> {
    try {
      // Look up user by name via users.list (paginated, but we check first page)
      const usersResponse = await fetch("https://slack.com/api/users.list", {
        method: "GET",
        headers: { "Authorization": `Bearer ${token}` },
      });
      const usersData = await usersResponse.json() as {
        ok: boolean;
        members?: Array<{ id: string; name: string; real_name?: string; profile?: { display_name?: string } }>;
        error?: string;
      };

      if (!usersData.ok || !usersData.members) {
        return { ok: false, error: usersData.error ?? "Failed to list users" };
      }

      // Find user by name, display_name, or real_name (case-insensitive)
      const lowerUsername = username.toLowerCase();
      const slackUser = usersData.members.find(
        (m) =>
          m.name?.toLowerCase() === lowerUsername ||
          m.profile?.display_name?.toLowerCase() === lowerUsername ||
          m.real_name?.toLowerCase() === lowerUsername,
      );

      if (!slackUser) {
        return { ok: false, error: `User "${username}" not found in Slack workspace` };
      }

      // Open DM conversation
      const convResponse = await fetch("https://slack.com/api/conversations.open", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ users: slackUser.id }),
      });
      const convData = await convResponse.json() as {
        ok: boolean;
        channel?: { id: string };
        error?: string;
      };

      if (!convData.ok || !convData.channel) {
        return { ok: false, error: convData.error ?? "Failed to open DM" };
      }

      // Send message to DM channel
      const dmMessage = { ...message, channel: convData.channel.id };
      return await this.postMessage(token, dmMessage);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Check if any overlapping detail has line overlap information.
   */
  private hasLineOverlapDetails(result: CollisionResult): boolean {
    return result.overlappingDetails.some(
      (d) => d.lineOverlapDetails && d.lineOverlapDetails.length > 0,
    );
  }

  /**
   * Format shared files with line range annotations for Slack.
   * Format: • `src/index.ts` lines 10-25 ↔ lines 15-30 (overlap: 11 lines — moderate)
   *
   * Requirement 4.4
   */
  private formatSharedFilesWithLineRanges(result: CollisionResult): string {
    const fileAnnotations = new Map<string, string>();

    // Collect line annotations from all overlapping details
    for (const detail of result.overlappingDetails) {
      if (!detail.lineOverlapDetails) continue;
      for (const lod of detail.lineOverlapDetails) {
        if (lod.lineOverlap === null) continue;
        const userRangesStr = formatLineRanges(lod.userRanges);
        const otherRangesStr = formatLineRanges(lod.otherRanges);

        if (lod.lineOverlap === true) {
          const severityStr = lod.overlapSeverity ? ` — ${lod.overlapSeverity}` : "";
          fileAnnotations.set(
            lod.file,
            `• \`${lod.file}\` ${userRangesStr} ↔ ${otherRangesStr} (overlap: ${lod.overlappingLines} lines${severityStr})`,
          );
        } else {
          fileAnnotations.set(
            lod.file,
            `• \`${lod.file}\` ${userRangesStr} ↔ ${otherRangesStr} (no overlap)`,
          );
        }
      }
    }

    // Include files without line data as plain entries
    for (const file of result.sharedFiles) {
      if (!fileAnnotations.has(file)) {
        fileAnnotations.set(file, `• \`${file}\``);
      }
    }

    return [...fileAnnotations.values()].join("\n");
  }

  /**
   * Post a message to Slack via chat.postMessage.
   * Returns { ok: true } on success, { ok: false, error } on failure.
   *
   * Requirements: 1.2, 1.7
   */
  private async postMessage(token: string, message: SlackMessage): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel: message.channel,
          blocks: message.blocks,
        }),
      });

      const data = await response.json() as { ok: boolean; error?: string };

      if (!data.ok) {
        if (this.logger.enabled) {
          this.logger.logConfigError(`Slack API error: ${data.error}`);
        }
        return { ok: false, error: data.error };
      }

      return { ok: true };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (this.logger.enabled) {
        this.logger.logConfigError(`Slack post failed: ${errorMsg}`);
      }
      return { ok: false, error: errorMsg };
    }
  }
}
