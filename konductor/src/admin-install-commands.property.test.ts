/**
 * Property-Based Tests for Admin Install Commands
 *
 * Uses fast-check to verify correctness properties from the design document.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { buildInstallCommands, buildSingleCommand } from "./admin-install-commands.js";
import type { ChannelName } from "./installer-channel-store.js";
import { VALID_CHANNELS } from "./installer-channel-store.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Arbitrary channel name. */
const channelArb = fc.constantFrom<ChannelName>("dev", "uat", "prod");

/** Arbitrary port number. */
const portArb = fc.integer({ min: 1, max: 65535 });

/** Arbitrary protocol. */
const protocolArb = fc.constantFrom<"http" | "https">("http", "https");

/** Arbitrary external URL (cloud mode). */
const externalUrlArb = fc.tuple(
  fc.constantFrom("http", "https"),
  fc.stringMatching(/^[a-z][a-z0-9-]{1,20}\.[a-z]{2,6}$/),
).map(([proto, domain]) => `${proto}://${domain}`);

/** Arbitrary server URL for single command testing. */
const serverUrlArb = fc.oneof(
  fc.tuple(protocolArb, portArb).map(([proto, port]) => `${proto}://localhost:${port}`),
  externalUrlArb,
);

// ---------------------------------------------------------------------------
// Property 8: Install command format
// **Feature: konductor-admin, Property 8: Install command format**
// **Validates: Requirements 5.2, 5.3, 5.4, 5.6, 5.7**
// ---------------------------------------------------------------------------

describe("Install Command Format — Property Tests", () => {
  /**
   * **Feature: konductor-admin, Property 8: Install command format**
   * **Validates: Requirements 5.2, 5.3, 5.4, 5.6, 5.7**
   *
   * For any server URL, channel name, and mode (local/cloud), the generated
   * install command SHALL match the format:
   * `npx <serverUrl>/bundle/installer-<channel>.tgz --server <serverUrl> --api-key YOUR_API_KEY`
   * and SHALL contain the placeholder `YOUR_API_KEY` (never a real key).
   */
  it("Property 8: single command matches required format", () => {
    fc.assert(
      fc.property(
        serverUrlArb,
        channelArb,
        (serverUrl, channel) => {
          const cmd = buildSingleCommand(serverUrl, channel);
          const base = serverUrl.replace(/\/+$/, "");

          // Must start with npx
          expect(cmd).toMatch(/^npx /);

          // Must contain the channel-specific tarball URL
          expect(cmd).toContain(`${base}/bundle/installer-${channel}.tgz`);

          // Must contain --server with the base URL
          expect(cmd).toContain(`--server ${base}`);

          // Must contain YOUR_API_KEY placeholder
          expect(cmd).toContain("--api-key YOUR_API_KEY");

          // Must NOT contain any real API key patterns (UUIDs, long hex strings)
          const afterApiKey = cmd.split("--api-key ")[1];
          expect(afterApiKey).toBe("YOUR_API_KEY");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("Property 8 (cont.): cloud mode produces single command per channel with external URL", () => {
    fc.assert(
      fc.property(
        portArb,
        protocolArb,
        channelArb,
        externalUrlArb,
        (port, protocol, defaultChannel, externalUrl) => {
          const result = buildInstallCommands(port, protocol, defaultChannel, externalUrl);

          expect(result.mode).toBe("cloud");
          expect(result.defaultChannel).toBe(defaultChannel);
          expect(result.channels).toHaveLength(VALID_CHANNELS.length);

          const base = externalUrl.replace(/\/+$/, "");
          for (const ch of result.channels) {
            // Cloud mode: cloudCommand set, local/remote not set
            expect(ch.cloudCommand).toBeDefined();
            expect(ch.localCommand).toBeUndefined();
            expect(ch.remoteCommand).toBeUndefined();

            // Command uses external URL
            expect(ch.cloudCommand).toContain(base);
            expect(ch.cloudCommand).toContain(`installer-${ch.channel}.tgz`);
            expect(ch.cloudCommand).toContain("YOUR_API_KEY");
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("Property 8 (cont.): local mode produces two commands per channel", () => {
    fc.assert(
      fc.property(
        portArb,
        protocolArb,
        channelArb,
        (port, protocol, defaultChannel) => {
          const result = buildInstallCommands(port, protocol, defaultChannel);

          expect(result.mode).toBe("local");
          expect(result.defaultChannel).toBe(defaultChannel);
          expect(result.channels).toHaveLength(VALID_CHANNELS.length);

          for (const ch of result.channels) {
            // Local mode: localCommand and remoteCommand set, cloudCommand not set
            expect(ch.localCommand).toBeDefined();
            expect(ch.remoteCommand).toBeDefined();
            expect(ch.cloudCommand).toBeUndefined();

            // Local command uses localhost
            expect(ch.localCommand).toContain(`localhost:${port}`);
            expect(ch.localCommand).toContain(`installer-${ch.channel}.tgz`);
            expect(ch.localCommand).toContain("YOUR_API_KEY");

            // Remote command uses some IP or hostname (not localhost)
            expect(ch.remoteCommand).toContain(`installer-${ch.channel}.tgz`);
            expect(ch.remoteCommand).toContain("YOUR_API_KEY");
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
