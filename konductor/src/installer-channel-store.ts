/**
 * InstallerChannelStore — Multi-channel installer tarball management.
 *
 * Manages three release channels (Dev, UAT, Prod) with promotion and
 * rollback support. In-memory backend stores tarballs and metadata
 * (lost on restart).
 *
 * Requirements: 4.5, 4.8, 9.1, 9.2, 9.3, 9.6
 */

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChannelName = "dev" | "uat" | "prod";

export const VALID_CHANNELS: readonly ChannelName[] = ["dev", "uat", "prod"];

export interface ChannelMetadata {
  channel: ChannelName;
  version: string;
  uploadTimestamp: string;   // ISO 8601
  tarballHash: string;       // SHA-256 hex
  previousVersion: string | null;
}

interface ChannelEntry {
  metadata: ChannelMetadata;
  tarball: Buffer;
  previousTarball: Buffer | null;
}

// ---------------------------------------------------------------------------
// InstallerChannelStore
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Effective Channel Resolution (Requirements 6.1–6.7, 8.1–8.4)
// ---------------------------------------------------------------------------

/** All valid channel values including the "latest" pseudo-channel. */
export type EffectiveChannel = ChannelName | "latest";

/** Valid override values: standard channels plus "latest". */
export const VALID_CHANNEL_OVERRIDES: readonly string[] = [...VALID_CHANNELS, "latest"];

/**
 * Determine the effective channel for a user.
 * Per-user override takes precedence over the global default.
 * Accepts "latest" as a valid override value (Requirement 8.1, 8.2).
 *
 * @param userOverride  The user's channel override, or null/undefined if none
 * @param globalDefault The global default channel (falls back to "prod")
 * @returns The effective channel name (may be "latest")
 */
export function resolveEffectiveChannel(
  userOverride: ChannelName | "latest" | null | undefined,
  globalDefault: ChannelName = "prod",
): EffectiveChannel {
  if (userOverride && VALID_CHANNEL_OVERRIDES.includes(userOverride)) {
    return userOverride as EffectiveChannel;
  }
  return VALID_CHANNELS.includes(globalDefault) ? globalDefault : "prod";
}

// ---------------------------------------------------------------------------
// InstallerChannelStore
// ---------------------------------------------------------------------------

export class InstallerChannelStore {
  private readonly channels = new Map<ChannelName, ChannelEntry>();

  /**
   * Get metadata for a single channel.
   * Returns null if the channel has no tarball assigned.
   */
  async getMetadata(channel: ChannelName): Promise<ChannelMetadata | null> {
    const entry = this.channels.get(channel);
    return entry?.metadata ?? null;
  }

  /**
   * Get metadata for all channels that have tarballs assigned.
   */
  async getAllMetadata(): Promise<Map<ChannelName, ChannelMetadata>> {
    const result = new Map<ChannelName, ChannelMetadata>();
    for (const [channel, entry] of this.channels) {
      result.set(channel, entry.metadata);
    }
    return result;
  }

  /**
   * Get the tarball buffer for a channel.
   * Returns null if the channel has no tarball assigned.
   */
  async getTarball(channel: ChannelName): Promise<Buffer | null> {
    const entry = this.channels.get(channel);
    return entry?.tarball ?? null;
  }

  /**
   * Get the most recently uploaded tarball across all channels.
   * Used for the "latest" pseudo-channel.
   * Returns null if no channels have tarballs.
   */
  async getLatestTarball(): Promise<{ tarball: Buffer; metadata: ChannelMetadata } | null> {
    let newest: { tarball: Buffer; metadata: ChannelMetadata } | null = null;
    for (const entry of this.channels.values()) {
      if (!newest || entry.metadata.uploadTimestamp > newest.metadata.uploadTimestamp) {
        newest = { tarball: entry.tarball, metadata: entry.metadata };
      }
    }
    return newest;
  }

  /**
   * Set (upload) a tarball for a channel directly.
   * Retains the previous tarball for rollback support (Requirement 9.6).
   */
  async setTarball(
    channel: ChannelName,
    tarball: Buffer,
    version: string,
  ): Promise<ChannelMetadata> {
    const hash = createHash("sha256").update(tarball).digest("hex");
    const existing = this.channels.get(channel);

    const metadata: ChannelMetadata = {
      channel,
      version,
      uploadTimestamp: new Date().toISOString(),
      tarballHash: hash,
      previousVersion: existing?.metadata.version ?? null,
    };

    this.channels.set(channel, {
      metadata,
      tarball: Buffer.from(tarball), // defensive copy
      previousTarball: existing?.tarball ?? null,
    });

    return metadata;
  }

  /**
   * Promote: copy the source channel's tarball to the destination channel.
   * Retains the destination's previous tarball for rollback (Requirement 9.6).
   *
   * Throws if the source channel has no tarball.
   */
  async promote(
    source: ChannelName,
    destination: ChannelName,
  ): Promise<ChannelMetadata> {
    const sourceEntry = this.channels.get(source);
    if (!sourceEntry) {
      throw new Error(`Source channel "${source}" has no tarball`);
    }

    const destEntry = this.channels.get(destination);
    const hash = sourceEntry.metadata.tarballHash;

    const metadata: ChannelMetadata = {
      channel: destination,
      version: sourceEntry.metadata.version,
      uploadTimestamp: new Date().toISOString(),
      tarballHash: hash,
      previousVersion: destEntry?.metadata.version ?? null,
    };

    this.channels.set(destination, {
      metadata,
      tarball: Buffer.from(sourceEntry.tarball), // copy
      previousTarball: destEntry?.tarball ?? null,
    });

    return metadata;
  }

  /**
   * Rollback: revert a channel to its previous tarball.
   *
   * Throws if the channel has no previous version available.
   */
  async rollback(channel: ChannelName): Promise<ChannelMetadata> {
    const entry = this.channels.get(channel);
    if (!entry) {
      throw new Error(`Channel "${channel}" has no tarball`);
    }
    if (!entry.previousTarball || !entry.metadata.previousVersion) {
      throw new Error(`No previous version available for rollback on channel "${channel}"`);
    }

    const hash = createHash("sha256").update(entry.previousTarball).digest("hex");

    const metadata: ChannelMetadata = {
      channel,
      version: entry.metadata.previousVersion,
      uploadTimestamp: new Date().toISOString(),
      tarballHash: hash,
      previousVersion: null, // only one level of rollback
    };

    this.channels.set(channel, {
      metadata,
      tarball: Buffer.from(entry.previousTarball),
      previousTarball: null,
    });

    return metadata;
  }
}
