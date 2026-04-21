/**
 * Admin Install Commands — Konductor Admin Dashboard
 *
 * Generates install commands for each installer channel, supporting
 * cloud mode (single external URL) and local mode (localhost + network IP).
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.6, 5.7, 5.8
 */

import { networkInterfaces } from "node:os";
import type { ChannelName } from "./installer-channel-store.js";
import { VALID_CHANNELS } from "./installer-channel-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChannelCommands {
  channel: ChannelName;
  localCommand?: string;   // only in local mode
  remoteCommand?: string;  // only in local mode
  cloudCommand?: string;   // only in cloud mode
}

export interface InstallCommandData {
  mode: "local" | "cloud";
  channels: ChannelCommands[];
  defaultChannel: ChannelName;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a single install command string.
 * Format: npx <serverUrl>/bundle/installer-<channel>.tgz --server <serverUrl> --api-key YOUR_API_KEY
 */
export function buildSingleCommand(serverUrl: string, channel: ChannelName): string {
  const base = serverUrl.replace(/\/+$/, "");
  return `npx ${base}/bundle/installer-${channel}.tgz --server ${base} --api-key YOUR_API_KEY`;
}

/**
 * Detect the first non-internal IPv4 address from network interfaces.
 * Returns null if none found.
 */
export function getNetworkIp(): string | null {
  const ifaces = networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    const addrs = ifaces[name];
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === "IPv4" && !addr.internal) {
        return addr.address;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Build install command data for all channels.
 *
 * @param port            Server port number
 * @param protocol        "http" or "https"
 * @param defaultChannel  The global default channel
 * @param externalUrl     KONDUCTOR_EXTERNAL_URL env var value (cloud mode when set)
 */
export function buildInstallCommands(
  port: number,
  protocol: "http" | "https",
  defaultChannel: ChannelName,
  externalUrl?: string,
): InstallCommandData {
  const isCloud = !!externalUrl;
  const mode: "local" | "cloud" = isCloud ? "cloud" : "local";

  const channels: ChannelCommands[] = VALID_CHANNELS.map((channel) => {
    if (isCloud) {
      const cloudBase = externalUrl!.replace(/\/+$/, "");
      return {
        channel,
        cloudCommand: buildSingleCommand(cloudBase, channel),
      };
    }

    // Local mode: localhost + network IP
    const localUrl = `${protocol}://localhost:${port}`;
    const networkIp = getNetworkIp();
    const remoteUrl = networkIp
      ? `${protocol}://${networkIp}:${port}`
      : localUrl; // fallback to localhost if no network IP

    return {
      channel,
      localCommand: buildSingleCommand(localUrl, channel),
      remoteCommand: buildSingleCommand(remoteUrl, channel),
    };
  });

  return { mode, channels, defaultChannel };
}
