/**
 * Property-Based Tests for BundleRegistry
 *
 * Uses fast-check to verify correctness properties 1–5 from the design document.
 * Each property runs a minimum of 100 iterations.
 *
 * Requirements: 1.1–1.3, 3.1–3.5, 4.1, 4.3, 6.4, 7.1, 8.2, 8.4, 10.1, 10.2
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { BundleRegistry, isValidSemver, compareSemver } from "./bundle-registry.js";
import { InstallerChannelStore } from "./installer-channel-store.js";
import type { ChannelName } from "./installer-channel-store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, Math.min(name.length, 100), "utf-8");
  header.write("0000644\0", 100, 8, "utf-8");
  header.write("0001000\0", 108, 8, "utf-8");
  header.write("0001000\0", 116, 8, "utf-8");
  header.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "utf-8");
  header.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, "0") + "\0", 136, 12, "utf-8");
  header.write("        ", 148, 8, "utf-8");
  header.write("0", 156, 1, "utf-8");
  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += header[i];
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "utf-8");
  return header;
}

function createTgz(manifest?: object): Buffer {
  const blocks: Buffer[] = [];
  if (manifest) {
    const content = Buffer.from(JSON.stringify(manifest), "utf-8");
    blocks.push(createTarHeader("package/bundle-manifest.json", content.length));
    blocks.push(content);
    const padding = 512 - (content.length % 512);
    if (padding < 512) blocks.push(Buffer.alloc(padding));
  }
  const pkgContent = Buffer.from('{"name":"test"}', "utf-8");
  blocks.push(createTarHeader("package/package.json", pkgContent.length));
  blocks.push(pkgContent);
  const pkgPadding = 512 - (pkgContent.length % 512);
  if (pkgPadding < 512) blocks.push(Buffer.alloc(pkgPadding));
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Arbitrary valid semver version (no pre-release for simplicity in some tests). */
const semverArb = fc.tuple(
  fc.integer({ min: 0, max: 50 }),
  fc.integer({ min: 0, max: 50 }),
  fc.integer({ min: 0, max: 50 }),
).map(([major, minor, patch]) => `${major}.${minor}.${patch}`);

/** Arbitrary pre-release tag. */
const prereleaseArb = fc.oneof(
  fc.constant(""),
  fc.tuple(
    fc.constantFrom("alpha", "beta", "rc"),
    fc.integer({ min: 1, max: 20 }),
  ).map(([tag, n]) => `-${tag}.${n}`),
);

/** Arbitrary semver with optional pre-release. */
const semverWithPrereleaseArb = fc.tuple(semverArb, prereleaseArb).map(
  ([ver, pre]) => `${ver}${pre}`,
);

/** Arbitrary set of unique valid semver versions (1–10 versions). */
const uniqueVersionSetArb = fc.uniqueArray(semverWithPrereleaseArb, {
  minLength: 1,
  maxLength: 10,
  comparator: (a, b) => a === b,
});

/** Arbitrary ISO 8601 timestamp within a reasonable range. */
const isoTimestampArb = fc.integer({
  min: new Date("2024-01-01T00:00:00.000Z").getTime(),
  max: new Date("2027-12-31T23:59:59.999Z").getTime(),
}).map((ms) => new Date(ms).toISOString());

/** Arbitrary channel name. */
const channelArb = fc.constantFrom<ChannelName>("dev", "uat", "prod");

/** Arbitrary invalid semver string. */
const invalidSemverArb = fc.oneof(
  fc.constant("notaversion"),
  fc.constant("v1.0.0"),
  fc.constant("1.0"),
  fc.constant("1"),
  fc.constant("01.0.0"),
  fc.constant("1.0.0.0"),
  fc.constant(""),
  fc.string({ minLength: 1, maxLength: 10 }).filter(
    (s: string) => !isValidSemver(s) && !/[/\\\0\s]/.test(s) && s.length > 0,
  ),
);

// ---------------------------------------------------------------------------
// Property 1: Registry scan completeness
// **Feature: konductor-local-bundle-store, Property 1: Registry scan completeness**
// **Validates: Requirements 1.1, 1.2, 1.3, 3.1, 3.2**
// ---------------------------------------------------------------------------

describe("Registry Scan Completeness — Property Tests", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "bundle-prop1-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * **Feature: konductor-local-bundle-store, Property 1: Registry scan completeness**
   * **Validates: Requirements 1.1, 1.2, 1.3, 3.1, 3.2**
   *
   * For any set of validly-named .tgz files in the installers/ directory,
   * scanning the directory SHALL produce a registry containing exactly one
   * entry per unique semver version, with no entries for files with invalid
   * semver names.
   */
  it("Property 1: scan produces exactly one entry per unique valid semver, none for invalid", async () => {
    await fc.assert(
      fc.asyncProperty(
        uniqueVersionSetArb,
        fc.array(invalidSemverArb, { minLength: 0, maxLength: 3 }),
        async (validVersions, invalidVersions) => {
          // Clean temp dir for each run
          const dir = mkdtempSync(join(tmpdir(), "prop1-run-"));

          try {
            // Write valid bundles
            for (const version of validVersions) {
              const manifest = { version, createdAt: new Date().toISOString() };
              writeFileSync(join(dir, `installer-${version}.tgz`), createTgz(manifest));
            }

            // Write invalid bundles
            for (const invalid of invalidVersions) {
              writeFileSync(join(dir, `installer-${invalid}.tgz`), createTgz());
            }

            const registry = new BundleRegistry();
            await registry.scanLocalStore(dir);

            // Registry size equals number of unique valid versions
            expect(registry.size).toBe(validVersions.length);

            // Every valid version is present
            for (const version of validVersions) {
              expect(registry.has(version)).toBe(true);
            }

            // No invalid version is present
            for (const invalid of invalidVersions) {
              expect(registry.has(invalid)).toBe(false);
            }
          } finally {
            rmSync(dir, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: Semver ordering
// **Feature: konductor-local-bundle-store, Property 2: Semver ordering**
// **Validates: Requirements 3.3, 4.1**
// ---------------------------------------------------------------------------

describe("Semver Ordering — Property Tests", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "bundle-prop2-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * **Feature: konductor-local-bundle-store, Property 2: Semver ordering**
   * **Validates: Requirements 3.3, 4.1**
   *
   * For any set of bundle versions in the registry, listing them SHALL produce
   * a sequence ordered by semver precedence (newest first), where pre-release
   * versions have lower precedence than the associated normal version.
   */
  it("Property 2: list() returns versions in descending semver order", async () => {
    await fc.assert(
      fc.asyncProperty(
        uniqueVersionSetArb,
        async (versions) => {
          const dir = mkdtempSync(join(tmpdir(), "prop2-run-"));

          try {
            for (const version of versions) {
              const manifest = { version, createdAt: new Date().toISOString() };
              writeFileSync(join(dir, `installer-${version}.tgz`), createTgz(manifest));
            }

            const registry = new BundleRegistry();
            await registry.scanLocalStore(dir);

            const listed = registry.list().map((m) => m.version);

            // Verify ordering: each adjacent pair should satisfy compareSemver(a, b) >= 0
            for (let i = 0; i < listed.length - 1; i++) {
              const cmp = compareSemver(listed[i], listed[i + 1]);
              expect(cmp).toBeGreaterThanOrEqual(0);
            }
          } finally {
            rmSync(dir, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: Channel assignment round-trip
// **Feature: konductor-local-bundle-store, Property 3: Channel assignment round-trip**
// **Validates: Requirements 4.3, 10.1, 10.2**
// ---------------------------------------------------------------------------

describe("Channel Assignment Round-Trip — Property Tests", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "bundle-prop3-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * **Feature: konductor-local-bundle-store, Property 3: Channel assignment round-trip**
   * **Validates: Requirements 4.3, 10.1, 10.2**
   *
   * For any valid version in the registry and any channel name, assigning the
   * version to the channel and then requesting the channel's tarball SHALL
   * produce a tarball identical to the registry's stored tarball for that version.
   */
  it("Property 3: assigning a registry version to a channel produces identical tarball on read-back", async () => {
    await fc.assert(
      fc.asyncProperty(
        semverArb,
        channelArb,
        async (version, channel) => {
          const dir = mkdtempSync(join(tmpdir(), "prop3-run-"));

          try {
            const manifest = { version, createdAt: new Date().toISOString() };
            const tgzBuffer = createTgz(manifest);
            writeFileSync(join(dir, `installer-${version}.tgz`), tgzBuffer);

            const registry = new BundleRegistry();
            await registry.scanLocalStore(dir);

            const entry = registry.get(version);
            expect(entry).not.toBeNull();

            // Assign to channel via InstallerChannelStore
            const channelStore = new InstallerChannelStore();
            await channelStore.setTarball(channel, entry!.tarball, version);

            // Read back from channel
            const channelTarball = await channelStore.getTarball(channel);

            expect(channelTarball).not.toBeNull();
            expect(Buffer.compare(channelTarball!, entry!.tarball)).toBe(0);
          } finally {
            rmSync(dir, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: Deletion stale propagation
// **Feature: konductor-local-bundle-store, Property 4: Deletion stale propagation**
// **Validates: Requirements 6.4, 7.1**
// ---------------------------------------------------------------------------

describe("Deletion Stale Propagation — Property Tests", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "bundle-prop4-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * **Feature: konductor-local-bundle-store, Property 4: Deletion stale propagation**
   * **Validates: Requirements 6.4, 7.1**
   *
   * For any bundle version assigned to N channels, deleting the bundle SHALL
   * result in exactly N channels entering the stale state, and zero channels
   * remaining with a valid tarball referencing the deleted version.
   */
  it("Property 4: deleting a bundle returns exactly the channels that referenced it", async () => {
    await fc.assert(
      fc.asyncProperty(
        semverArb,
        fc.uniqueArray(channelArb, { minLength: 0, maxLength: 3 }),
        async (version, assignedChannels) => {
          const dir = mkdtempSync(join(tmpdir(), "prop4-run-"));

          try {
            const manifest = { version, createdAt: new Date().toISOString() };
            writeFileSync(join(dir, `installer-${version}.tgz`), createTgz(manifest));

            const registry = new BundleRegistry();
            await registry.scanLocalStore(dir);

            // Assign version to the selected channels
            const assignments = new Map<ChannelName, string>();
            for (const ch of assignedChannels) {
              assignments.set(ch, version);
            }
            registry.updateChannelRefs(assignments);

            // Delete the bundle (don't delete from disk to avoid race)
            const result = await registry.delete(version, false);

            // Stale channels should be exactly the assigned channels
            expect(result.deleted).toBe(true);
            expect(result.staleChannels.length).toBe(assignedChannels.length);
            for (const ch of assignedChannels) {
              expect(result.staleChannels).toContain(ch);
            }

            // Bundle should no longer exist in registry
            expect(registry.has(version)).toBe(false);
          } finally {
            rmSync(dir, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5: Latest resolution
// **Feature: konductor-local-bundle-store, Property 5: Latest resolution**
// **Validates: Requirements 8.2, 8.4**
// ---------------------------------------------------------------------------

describe("Latest Resolution — Property Tests", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "bundle-prop5-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * **Feature: konductor-local-bundle-store, Property 5: Latest resolution**
   * **Validates: Requirements 8.2, 8.4**
   *
   * For any non-empty registry, the "Latest" pseudo-channel SHALL resolve to
   * the bundle with the most recent createdAt timestamp, regardless of semver
   * ordering.
   */
  it("Property 5: getLatest() returns the bundle with the most recent createdAt", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(semverArb, { minLength: 1, maxLength: 8, comparator: (a, b) => a === b }),
        fc.array(isoTimestampArb, { minLength: 1, maxLength: 8 }),
        async (versions, timestamps) => {
          // Ensure we have enough timestamps for all versions
          const usedTimestamps = versions.map((_, i) => timestamps[i % timestamps.length]);

          const dir = mkdtempSync(join(tmpdir(), "prop5-run-"));

          try {
            for (let i = 0; i < versions.length; i++) {
              const manifest = { version: versions[i], createdAt: usedTimestamps[i] };
              writeFileSync(join(dir, `installer-${versions[i]}.tgz`), createTgz(manifest));
            }

            const registry = new BundleRegistry();
            await registry.scanLocalStore(dir);

            const latest = registry.getLatest();
            expect(latest).not.toBeNull();

            // Find the expected latest (most recent createdAt)
            let expectedVersion = versions[0];
            let maxTimestamp = usedTimestamps[0];
            for (let i = 1; i < versions.length; i++) {
              if (usedTimestamps[i] > maxTimestamp) {
                maxTimestamp = usedTimestamps[i];
                expectedVersion = versions[i];
              }
            }

            expect(latest!.metadata.createdAt).toBe(maxTimestamp);
          } finally {
            rmSync(dir, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
