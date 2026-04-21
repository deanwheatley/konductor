/**
 * Property-Based Tests for InstallerChannelStore
 *
 * Uses fast-check to verify correctness properties from the design document.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { InstallerChannelStore, VALID_CHANNELS } from "./installer-channel-store.js";
import type { ChannelName } from "./installer-channel-store.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Arbitrary channel name. */
const channelArb = fc.constantFrom<ChannelName>("dev", "uat", "prod");

/** Arbitrary pair of distinct channels (source, destination). */
const channelPairArb = fc.tuple(channelArb, channelArb).filter(
  ([src, dst]) => src !== dst,
);

/** Arbitrary tarball (non-empty byte buffer). */
const tarballArb = fc.uint8Array({ minLength: 1, maxLength: 512 }).map(
  (arr) => Buffer.from(arr),
);

/** Arbitrary semver-like version string. */
const versionArb = fc.tuple(
  fc.integer({ min: 0, max: 99 }),
  fc.integer({ min: 0, max: 99 }),
  fc.integer({ min: 0, max: 99 }),
).map(([major, minor, patch]) => `${major}.${minor}.${patch}`);

// ---------------------------------------------------------------------------
// Property 5: Channel promotion round-trip
// **Feature: konductor-admin, Property 5: Channel promotion round-trip**
// **Validates: Requirements 4.5, 9.4**
// ---------------------------------------------------------------------------

describe("Channel Promotion Round-Trip — Property Tests", () => {
  /**
   * **Feature: konductor-admin, Property 5: Channel promotion round-trip**
   * **Validates: Requirements 4.5, 9.4**
   *
   * For any installer tarball (arbitrary byte sequence), promoting it from
   * a source channel to a destination channel and then reading the
   * destination channel's tarball SHALL produce a byte sequence identical
   * to the original.
   */
  it("Property 5: promoting a tarball and reading it back produces identical bytes", async () => {
    await fc.assert(
      fc.asyncProperty(
        channelPairArb,
        tarballArb,
        versionArb,
        async ([source, destination], tarball, version) => {
          const store = new InstallerChannelStore();

          // Set tarball on source channel
          await store.setTarball(source, tarball, version);

          // Promote source → destination
          await store.promote(source, destination);

          // Read back from destination
          const result = await store.getTarball(destination);

          expect(result).not.toBeNull();
          expect(Buffer.compare(result!, tarball)).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 6: Channel rollback restores previous version
// **Feature: konductor-admin, Property 6: Channel rollback restores previous version**
// **Validates: Requirements 4.8, 9.7**
// ---------------------------------------------------------------------------

describe("Channel Rollback Restores Previous Version — Property Tests", () => {
  /**
   * **Feature: konductor-admin, Property 6: Channel rollback restores previous version**
   * **Validates: Requirements 4.8, 9.7**
   *
   * For any two installer tarballs A and B, if tarball A is set on a channel,
   * then tarball B is promoted to that channel, then a rollback is performed,
   * the channel's tarball SHALL be identical to tarball A.
   */
  it("Property 6: rollback after promotion restores the previous tarball", async () => {
    await fc.assert(
      fc.asyncProperty(
        channelPairArb,
        tarballArb,
        versionArb,
        tarballArb,
        versionArb,
        async ([source, destination], tarballA, versionA, tarballB, versionB) => {
          const store = new InstallerChannelStore();

          // Set tarball A on the destination channel
          await store.setTarball(destination, tarballA, versionA);

          // Set tarball B on the source channel, then promote to destination
          await store.setTarball(source, tarballB, versionB);
          await store.promote(source, destination);

          // Rollback the destination channel
          await store.rollback(destination);

          // Read back — should be tarball A
          const result = await store.getTarball(destination);

          expect(result).not.toBeNull();
          expect(Buffer.compare(result!, tarballA)).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: Effective channel resolution
// **Feature: konductor-admin, Property 7: Effective channel resolution**
// **Validates: Requirements 6.1**
// ---------------------------------------------------------------------------

import { resolveEffectiveChannel } from "./installer-channel-store.js";

describe("Effective Channel Resolution — Property Tests", () => {
  /**
   * **Feature: konductor-admin, Property 7: Effective channel resolution**
   * **Validates: Requirements 6.1**
   *
   * For any user record with an optional installer channel override and a
   * global default channel setting, the effective channel SHALL equal the
   * per-user override when set, and the global default otherwise.
   */
  it("Property 7: per-user override takes precedence over global default", () => {
    fc.assert(
      fc.property(
        // User override: either a valid channel or null
        fc.oneof(channelArb, fc.constant(null as ChannelName | null)),
        // Global default channel
        channelArb,
        (userOverride, globalDefault) => {
          const result = resolveEffectiveChannel(userOverride, globalDefault);

          if (userOverride !== null) {
            // Per-user override takes precedence
            expect(result).toBe(userOverride);
          } else {
            // Falls back to global default
            expect(result).toBe(globalDefault);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("Property 7 (cont.): result is always a valid channel name", () => {
    fc.assert(
      fc.property(
        fc.oneof(channelArb, fc.constant(null as ChannelName | null), fc.constant(undefined)),
        fc.oneof(channelArb, fc.constant(undefined)),
        (userOverride, globalDefault) => {
          const result = resolveEffectiveChannel(
            userOverride as ChannelName | null | undefined,
            globalDefault as ChannelName | undefined,
          );
          expect(VALID_CHANNELS).toContain(result);
        },
      ),
      { numRuns: 100 },
    );
  });
});
