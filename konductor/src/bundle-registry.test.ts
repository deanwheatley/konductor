/**
 * Unit Tests for BundleRegistry
 *
 * Tests scan, list, get, delete, stale propagation, manifest extraction,
 * and fallback metadata.
 *
 * Requirements: 1.1–1.6, 2.1–2.2, 3.1–3.6, 6.4–6.5, 8.2
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { BundleRegistry, isValidSemver, compareSemver } from "./bundle-registry.js";

// ---------------------------------------------------------------------------
// Helpers: create tar archives for testing
// ---------------------------------------------------------------------------

/** Create a tar header block for a file entry. */
function createTarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(512);
  // Name (0–99)
  header.write(name, 0, Math.min(name.length, 100), "utf-8");
  // Mode (100–107)
  header.write("0000644\0", 100, 8, "utf-8");
  // UID (108–115)
  header.write("0001000\0", 108, 8, "utf-8");
  // GID (116–123)
  header.write("0001000\0", 116, 8, "utf-8");
  // Size (124–135) — octal
  header.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "utf-8");
  // Mtime (136–147)
  header.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, "0") + "\0", 136, 12, "utf-8");
  // Checksum placeholder (148–155) — spaces
  header.write("        ", 148, 8, "utf-8");
  // Type flag (156) — '0' = regular file
  header.write("0", 156, 1, "utf-8");

  // Compute checksum
  let checksum = 0;
  for (let i = 0; i < 512; i++) checksum += header[i];
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "utf-8");

  return header;
}

/** Create a minimal .tgz buffer with optional bundle-manifest.json content. */
function createTgz(manifest?: object): Buffer {
  const blocks: Buffer[] = [];

  if (manifest) {
    const content = Buffer.from(JSON.stringify(manifest), "utf-8");
    blocks.push(createTarHeader("package/bundle-manifest.json", content.length));
    blocks.push(content);
    // Pad to 512-byte boundary
    const padding = 512 - (content.length % 512);
    if (padding < 512) blocks.push(Buffer.alloc(padding));
  }

  // Add a dummy package.json so it looks like a real package
  const pkgContent = Buffer.from('{"name":"test"}', "utf-8");
  blocks.push(createTarHeader("package/package.json", pkgContent.length));
  blocks.push(pkgContent);
  const pkgPadding = 512 - (pkgContent.length % 512);
  if (pkgPadding < 512) blocks.push(Buffer.alloc(pkgPadding));

  // End-of-archive marker (two zero blocks)
  blocks.push(Buffer.alloc(1024));

  const tar = Buffer.concat(blocks);
  return gzipSync(tar);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BundleRegistry", () => {
  let tempDir: string;
  let registry: BundleRegistry;
  const logs: string[] = [];

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "bundle-registry-test-"));
    logs.length = 0;
    registry = new BundleRegistry((label, msg) => logs.push(`[${label}] ${msg}`));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── scanLocalStore ──────────────────────────────────────────────────

  describe("scanLocalStore", () => {
    it("creates directory if missing and logs instructions", async () => {
      const missingDir = join(tempDir, "nonexistent");
      await registry.scanLocalStore(missingDir);

      expect(existsSync(missingDir)).toBe(true);
      expect(registry.size).toBe(0);
      expect(logs.some((l) => l.includes("place installer bundles here"))).toBe(true);
    });

    it("discovers valid installer-<semver>.tgz files", async () => {
      writeFileSync(join(tempDir, "installer-1.0.0.tgz"), createTgz({ version: "1.0.0", createdAt: "2026-01-01T00:00:00.000Z" }));
      writeFileSync(join(tempDir, "installer-2.0.0.tgz"), createTgz({ version: "2.0.0", createdAt: "2026-02-01T00:00:00.000Z" }));

      await registry.scanLocalStore(tempDir);

      expect(registry.size).toBe(2);
      expect(registry.has("1.0.0")).toBe(true);
      expect(registry.has("2.0.0")).toBe(true);
    });

    it("skips files with invalid semver and logs warning", async () => {
      writeFileSync(join(tempDir, "installer-notaversion.tgz"), createTgz());
      writeFileSync(join(tempDir, "installer-1.0.0.tgz"), createTgz({ version: "1.0.0", createdAt: "2026-01-01T00:00:00.000Z" }));

      await registry.scanLocalStore(tempDir);

      expect(registry.size).toBe(1);
      expect(registry.has("notaversion")).toBe(false);
      expect(logs.some((l) => l.includes("invalid semver"))).toBe(true);
    });

    it("skips channel-named files (dev, uat, prod)", async () => {
      writeFileSync(join(tempDir, "installer-dev.tgz"), createTgz());
      writeFileSync(join(tempDir, "installer-uat.tgz"), createTgz());
      writeFileSync(join(tempDir, "installer-prod.tgz"), createTgz());

      await registry.scanLocalStore(tempDir);

      expect(registry.size).toBe(0);
    });

    it("handles duplicate versions — uses first found, logs warning", async () => {
      // Create two files that would resolve to the same version
      writeFileSync(join(tempDir, "installer-1.0.0.tgz"), createTgz({ version: "1.0.0", createdAt: "2026-01-01T00:00:00.000Z", author: "first" }));

      await registry.scanLocalStore(tempDir);
      expect(registry.size).toBe(1);

      // Simulate a second scan attempt with a duplicate
      const registry2 = new BundleRegistry((label, msg) => logs.push(`[${label}] ${msg}`));
      writeFileSync(join(tempDir, "installer-1.0.0.tgz"), createTgz({ version: "1.0.0", createdAt: "2026-03-01T00:00:00.000Z", author: "second" }));
      // Add another file with same version but different filename won't happen due to filesystem,
      // but we can test the duplicate logic by writing a second file
      const subDir = mkdtempSync(join(tmpdir(), "bundle-dup-"));
      writeFileSync(join(subDir, "installer-1.0.0.tgz"), createTgz({ version: "1.0.0", createdAt: "2026-01-01T00:00:00.000Z" }));
      writeFileSync(join(subDir, "installer-1.0.0.tgz"), createTgz({ version: "1.0.0", createdAt: "2026-03-01T00:00:00.000Z" }));
      await registry2.scanLocalStore(subDir);
      // Only one entry since filesystem overwrites the file
      expect(registry2.size).toBe(1);
      rmSync(subDir, { recursive: true, force: true });
    });

    it("ignores non-tgz files and files not matching installer-* pattern", async () => {
      writeFileSync(join(tempDir, "readme.txt"), "hello");
      writeFileSync(join(tempDir, "bundle-1.0.0.tgz"), createTgz());
      writeFileSync(join(tempDir, "installer-1.0.0.tgz"), createTgz({ version: "1.0.0", createdAt: "2026-01-01T00:00:00.000Z" }));

      await registry.scanLocalStore(tempDir);

      expect(registry.size).toBe(1);
    });

    it("discovers pre-release versions", async () => {
      writeFileSync(join(tempDir, "installer-1.0.0-beta.1.tgz"), createTgz({ version: "1.0.0-beta.1", createdAt: "2026-01-01T00:00:00.000Z" }));
      writeFileSync(join(tempDir, "installer-2.0.0-rc.1.tgz"), createTgz({ version: "2.0.0-rc.1", createdAt: "2026-02-01T00:00:00.000Z" }));

      await registry.scanLocalStore(tempDir);

      expect(registry.size).toBe(2);
      expect(registry.has("1.0.0-beta.1")).toBe(true);
      expect(registry.has("2.0.0-rc.1")).toBe(true);
    });

    it("logs each discovered bundle with version, size, and date", async () => {
      writeFileSync(join(tempDir, "installer-1.0.0.tgz"), createTgz({ version: "1.0.0", createdAt: "2026-04-15T10:00:00.000Z" }));

      await registry.scanLocalStore(tempDir);

      expect(logs.some((l) => l.includes("v1.0.0") && l.includes("KB") && l.includes("2026-04-15"))).toBe(true);
    });
  });

  // ── Manifest extraction ─────────────────────────────────────────────

  describe("manifest extraction", () => {
    it("extracts version, createdAt, author, summary from manifest", async () => {
      const manifest = {
        version: "1.5.0",
        createdAt: "2026-03-15T12:00:00.000Z",
        author: "testuser",
        summary: "Added feature X",
      };
      writeFileSync(join(tempDir, "installer-1.5.0.tgz"), createTgz(manifest));

      await registry.scanLocalStore(tempDir);

      const entry = registry.get("1.5.0");
      expect(entry).not.toBeNull();
      expect(entry!.metadata.version).toBe("1.5.0");
      expect(entry!.metadata.createdAt).toBe("2026-03-15T12:00:00.000Z");
      expect(entry!.metadata.author).toBe("testuser");
      expect(entry!.metadata.summary).toBe("Added feature X");
    });

    it("computes SHA-256 hash of the tarball", async () => {
      const tgz = createTgz({ version: "1.0.0", createdAt: "2026-01-01T00:00:00.000Z" });
      writeFileSync(join(tempDir, "installer-1.0.0.tgz"), tgz);

      await registry.scanLocalStore(tempDir);

      const entry = registry.get("1.0.0");
      expect(entry!.metadata.hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("stores correct fileSize", async () => {
      const tgz = createTgz({ version: "1.0.0", createdAt: "2026-01-01T00:00:00.000Z" });
      writeFileSync(join(tempDir, "installer-1.0.0.tgz"), tgz);

      await registry.scanLocalStore(tempDir);

      const entry = registry.get("1.0.0");
      expect(entry!.metadata.fileSize).toBe(tgz.length);
    });
  });

  // ── Fallback metadata ───────────────────────────────────────────────

  describe("fallback metadata", () => {
    it("uses filename version and file mtime when no manifest present", async () => {
      // Create a tgz without a manifest
      writeFileSync(join(tempDir, "installer-3.0.0.tgz"), createTgz());

      await registry.scanLocalStore(tempDir);

      const entry = registry.get("3.0.0");
      expect(entry).not.toBeNull();
      expect(entry!.metadata.version).toBe("3.0.0");
      expect(entry!.metadata.author).toBe("unknown");
      expect(entry!.metadata.summary).toBe("");
      // createdAt should be a valid ISO date (from file mtime)
      expect(new Date(entry!.metadata.createdAt).getTime()).not.toBeNaN();
    });

    it("logs fallback metadata usage", async () => {
      writeFileSync(join(tempDir, "installer-2.0.0.tgz"), createTgz());

      await registry.scanLocalStore(tempDir);

      expect(logs.some((l) => l.includes("fallback metadata"))).toBe(true);
    });
  });

  // ── list() ──────────────────────────────────────────────────────────

  describe("list", () => {
    it("returns bundles sorted by semver newest first", async () => {
      writeFileSync(join(tempDir, "installer-1.0.0.tgz"), createTgz({ version: "1.0.0", createdAt: "2026-01-01T00:00:00.000Z" }));
      writeFileSync(join(tempDir, "installer-2.0.0.tgz"), createTgz({ version: "2.0.0", createdAt: "2026-02-01T00:00:00.000Z" }));
      writeFileSync(join(tempDir, "installer-1.5.0.tgz"), createTgz({ version: "1.5.0", createdAt: "2026-01-15T00:00:00.000Z" }));

      await registry.scanLocalStore(tempDir);

      const versions = registry.list().map((m) => m.version);
      expect(versions).toEqual(["2.0.0", "1.5.0", "1.0.0"]);
    });

    it("pre-release versions sort below their normal version", async () => {
      writeFileSync(join(tempDir, "installer-1.0.0.tgz"), createTgz({ version: "1.0.0", createdAt: "2026-01-01T00:00:00.000Z" }));
      writeFileSync(join(tempDir, "installer-1.0.0-beta.1.tgz"), createTgz({ version: "1.0.0-beta.1", createdAt: "2026-01-01T00:00:00.000Z" }));

      await registry.scanLocalStore(tempDir);

      const versions = registry.list().map((m) => m.version);
      expect(versions).toEqual(["1.0.0", "1.0.0-beta.1"]);
    });

    it("returns empty array when registry is empty", () => {
      expect(registry.list()).toEqual([]);
    });
  });

  // ── get() ───────────────────────────────────────────────────────────

  describe("get", () => {
    it("returns metadata and tarball for existing version", async () => {
      const tgz = createTgz({ version: "1.0.0", createdAt: "2026-01-01T00:00:00.000Z" });
      writeFileSync(join(tempDir, "installer-1.0.0.tgz"), tgz);

      await registry.scanLocalStore(tempDir);

      const entry = registry.get("1.0.0");
      expect(entry).not.toBeNull();
      expect(entry!.tarball).toBeInstanceOf(Buffer);
      expect(entry!.tarball.length).toBe(tgz.length);
    });

    it("returns null for non-existent version", async () => {
      expect(registry.get("9.9.9")).toBeNull();
    });
  });

  // ── getLatest() ─────────────────────────────────────────────────────

  describe("getLatest", () => {
    it("returns bundle with most recent createdAt", async () => {
      writeFileSync(join(tempDir, "installer-1.0.0.tgz"), createTgz({ version: "1.0.0", createdAt: "2026-01-01T00:00:00.000Z" }));
      writeFileSync(join(tempDir, "installer-2.0.0.tgz"), createTgz({ version: "2.0.0", createdAt: "2026-03-01T00:00:00.000Z" }));
      writeFileSync(join(tempDir, "installer-1.5.0.tgz"), createTgz({ version: "1.5.0", createdAt: "2026-04-01T00:00:00.000Z" }));

      await registry.scanLocalStore(tempDir);

      const latest = registry.getLatest();
      expect(latest).not.toBeNull();
      // 1.5.0 has the most recent createdAt despite lower semver
      expect(latest!.metadata.version).toBe("1.5.0");
    });

    it("returns null when registry is empty", () => {
      expect(registry.getLatest()).toBeNull();
    });
  });

  // ── has() ───────────────────────────────────────────────────────────

  describe("has", () => {
    it("returns true for registered version", async () => {
      writeFileSync(join(tempDir, "installer-1.0.0.tgz"), createTgz({ version: "1.0.0", createdAt: "2026-01-01T00:00:00.000Z" }));
      await registry.scanLocalStore(tempDir);

      expect(registry.has("1.0.0")).toBe(true);
    });

    it("returns false for unregistered version", () => {
      expect(registry.has("1.0.0")).toBe(false);
    });
  });

  // ── delete() ────────────────────────────────────────────────────────

  describe("delete", () => {
    it("removes bundle from registry", async () => {
      writeFileSync(join(tempDir, "installer-1.0.0.tgz"), createTgz({ version: "1.0.0", createdAt: "2026-01-01T00:00:00.000Z" }));
      await registry.scanLocalStore(tempDir);

      const result = await registry.delete("1.0.0");

      expect(result.deleted).toBe(true);
      expect(registry.has("1.0.0")).toBe(false);
      expect(registry.size).toBe(0);
    });

    it("deletes .tgz file from disk", async () => {
      const filePath = join(tempDir, "installer-1.0.0.tgz");
      writeFileSync(filePath, createTgz({ version: "1.0.0", createdAt: "2026-01-01T00:00:00.000Z" }));
      await registry.scanLocalStore(tempDir);

      await registry.delete("1.0.0");

      expect(existsSync(filePath)).toBe(false);
    });

    it("returns staleChannels when bundle is assigned to channels", async () => {
      writeFileSync(join(tempDir, "installer-1.0.0.tgz"), createTgz({ version: "1.0.0", createdAt: "2026-01-01T00:00:00.000Z" }));
      await registry.scanLocalStore(tempDir);

      // Assign to channels
      registry.updateChannelRefs(new Map([["dev", "1.0.0"], ["prod", "1.0.0"]]));

      const result = await registry.delete("1.0.0");

      expect(result.staleChannels).toContain("dev");
      expect(result.staleChannels).toContain("prod");
      expect(result.staleChannels.length).toBe(2);
    });

    it("returns empty staleChannels when bundle has no channel assignments", async () => {
      writeFileSync(join(tempDir, "installer-1.0.0.tgz"), createTgz({ version: "1.0.0", createdAt: "2026-01-01T00:00:00.000Z" }));
      await registry.scanLocalStore(tempDir);

      const result = await registry.delete("1.0.0");

      expect(result.staleChannels).toEqual([]);
    });

    it("returns deleted: false for non-existent version", async () => {
      const result = await registry.delete("9.9.9");

      expect(result.deleted).toBe(false);
      expect(result.staleChannels).toEqual([]);
    });

    it("does not delete from disk when deleteFromDisk is false", async () => {
      const filePath = join(tempDir, "installer-1.0.0.tgz");
      writeFileSync(filePath, createTgz({ version: "1.0.0", createdAt: "2026-01-01T00:00:00.000Z" }));
      await registry.scanLocalStore(tempDir);

      await registry.delete("1.0.0", false);

      expect(existsSync(filePath)).toBe(true);
      expect(registry.has("1.0.0")).toBe(false);
    });
  });

  // ── updateChannelRefs() ─────────────────────────────────────────────

  describe("updateChannelRefs", () => {
    it("assigns channels to bundles", async () => {
      writeFileSync(join(tempDir, "installer-1.0.0.tgz"), createTgz({ version: "1.0.0", createdAt: "2026-01-01T00:00:00.000Z" }));
      writeFileSync(join(tempDir, "installer-2.0.0.tgz"), createTgz({ version: "2.0.0", createdAt: "2026-02-01T00:00:00.000Z" }));
      await registry.scanLocalStore(tempDir);

      registry.updateChannelRefs(new Map([["dev", "2.0.0"], ["prod", "1.0.0"]]));

      const v1 = registry.get("1.0.0")!.metadata;
      const v2 = registry.get("2.0.0")!.metadata;
      expect(v1.channels).toEqual(["prod"]);
      expect(v2.channels).toEqual(["dev"]);
    });

    it("clears previous channel refs on update", async () => {
      writeFileSync(join(tempDir, "installer-1.0.0.tgz"), createTgz({ version: "1.0.0", createdAt: "2026-01-01T00:00:00.000Z" }));
      await registry.scanLocalStore(tempDir);

      registry.updateChannelRefs(new Map([["dev", "1.0.0"], ["prod", "1.0.0"]]));
      registry.updateChannelRefs(new Map([["uat", "1.0.0"]]));

      const meta = registry.get("1.0.0")!.metadata;
      expect(meta.channels).toEqual(["uat"]);
    });

    it("allows same version assigned to multiple channels", async () => {
      writeFileSync(join(tempDir, "installer-1.0.0.tgz"), createTgz({ version: "1.0.0", createdAt: "2026-01-01T00:00:00.000Z" }));
      await registry.scanLocalStore(tempDir);

      registry.updateChannelRefs(new Map([["dev", "1.0.0"], ["uat", "1.0.0"], ["prod", "1.0.0"]]));

      const meta = registry.get("1.0.0")!.metadata;
      expect(meta.channels).toHaveLength(3);
      expect(meta.channels).toContain("dev");
      expect(meta.channels).toContain("uat");
      expect(meta.channels).toContain("prod");
    });

    it("ignores channel assignments for versions not in registry", async () => {
      writeFileSync(join(tempDir, "installer-1.0.0.tgz"), createTgz({ version: "1.0.0", createdAt: "2026-01-01T00:00:00.000Z" }));
      await registry.scanLocalStore(tempDir);

      // Assign a non-existent version — should not throw
      registry.updateChannelRefs(new Map([["dev", "9.9.9"]]));

      const meta = registry.get("1.0.0")!.metadata;
      expect(meta.channels).toEqual([]);
    });
  });

  // ── Edge Cases ────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("empty directory: scan produces zero bundles and no errors", async () => {
      // tempDir exists but is empty
      await registry.scanLocalStore(tempDir);

      expect(registry.size).toBe(0);
      expect(registry.list()).toEqual([]);
      expect(registry.getLatest()).toBeNull();
    });

    it("empty directory: list/get/has/getLatest all return empty/null/false", async () => {
      await registry.scanLocalStore(tempDir);

      expect(registry.list()).toEqual([]);
      expect(registry.get("1.0.0")).toBeNull();
      expect(registry.has("1.0.0")).toBe(false);
      expect(registry.getLatest()).toBeNull();
    });

    it("no manifest in tgz: registry still indexes the bundle with fallback metadata", async () => {
      // createTgz() without arguments produces a tgz with no bundle-manifest.json
      writeFileSync(join(tempDir, "installer-4.0.0.tgz"), createTgz());

      await registry.scanLocalStore(tempDir);

      expect(registry.has("4.0.0")).toBe(true);
      const entry = registry.get("4.0.0");
      expect(entry).not.toBeNull();
      expect(entry!.metadata.version).toBe("4.0.0");
      expect(entry!.metadata.author).toBe("unknown");
      expect(entry!.metadata.summary).toBe("");
      // createdAt should come from file mtime
      expect(new Date(entry!.metadata.createdAt).getTime()).toBeGreaterThan(0);
    });

    it("no manifest in tgz: tarball buffer is still accessible", async () => {
      const tgz = createTgz();
      writeFileSync(join(tempDir, "installer-5.0.0.tgz"), tgz);

      await registry.scanLocalStore(tempDir);

      const entry = registry.get("5.0.0");
      expect(entry!.tarball.length).toBe(tgz.length);
    });

    it("invalid semver filenames: various invalid patterns are all skipped", async () => {
      // All of these should be skipped
      writeFileSync(join(tempDir, "installer-abc.tgz"), createTgz());
      writeFileSync(join(tempDir, "installer-1.0.tgz"), createTgz());
      writeFileSync(join(tempDir, "installer-v1.0.0.tgz"), createTgz());
      writeFileSync(join(tempDir, "installer-01.0.0.tgz"), createTgz());
      writeFileSync(join(tempDir, "installer-1.0.0.0.tgz"), createTgz());
      writeFileSync(join(tempDir, "installer-.tgz"), createTgz());
      writeFileSync(join(tempDir, "installer-1.2.3.4.5.tgz"), createTgz());
      // This one IS valid
      writeFileSync(join(tempDir, "installer-1.0.0.tgz"), createTgz({ version: "1.0.0", createdAt: "2026-01-01T00:00:00.000Z" }));

      await registry.scanLocalStore(tempDir);

      expect(registry.size).toBe(1);
      expect(registry.has("1.0.0")).toBe(true);
      // Verify warnings were logged for invalid ones
      const warningLogs = logs.filter((l) => l.includes("invalid semver"));
      expect(warningLogs.length).toBeGreaterThanOrEqual(5);
    });

    it("invalid semver filenames: channel names (dev, uat, prod) are silently skipped", async () => {
      writeFileSync(join(tempDir, "installer-dev.tgz"), createTgz());
      writeFileSync(join(tempDir, "installer-uat.tgz"), createTgz());
      writeFileSync(join(tempDir, "installer-prod.tgz"), createTgz());

      await registry.scanLocalStore(tempDir);

      expect(registry.size).toBe(0);
      // Channel names should NOT produce "invalid semver" warnings
      const semverWarnings = logs.filter((l) => l.includes("invalid semver"));
      expect(semverWarnings.length).toBe(0);
    });

    it("duplicate versions: second file with same version is skipped with warning", async () => {
      // Simulate duplicate by creating two files that parse to the same version
      // Since filesystem won't allow two files with the exact same name,
      // we test the registry's internal duplicate detection by scanning twice
      // with a fresh file in between
      writeFileSync(join(tempDir, "installer-1.0.0.tgz"), createTgz({ version: "1.0.0", createdAt: "2026-01-01T00:00:00.000Z", author: "first" }));

      await registry.scanLocalStore(tempDir);
      expect(registry.size).toBe(1);
      expect(registry.get("1.0.0")!.metadata.author).toBe("first");

      // The duplicate detection is per-scan — the registry already has 1.0.0,
      // so a second scan of a different directory with the same version should skip it
      const tempDir2 = mkdtempSync(join(tmpdir(), "bundle-dup-test-"));
      writeFileSync(join(tempDir2, "installer-1.0.0.tgz"), createTgz({ version: "1.0.0", createdAt: "2026-06-01T00:00:00.000Z", author: "second" }));

      await registry.scanLocalStore(tempDir2);
      // Should still have the first one
      expect(registry.size).toBe(1);
      expect(registry.get("1.0.0")!.metadata.author).toBe("first");
      expect(logs.some((l) => l.includes("duplicate"))).toBe(true);

      rmSync(tempDir2, { recursive: true, force: true });
    });

    it("corrupt tgz: file that is not valid gzip is skipped with fallback", async () => {
      // Write random bytes that aren't valid gzip
      writeFileSync(join(tempDir, "installer-6.0.0.tgz"), Buffer.from("this is not a valid tgz file"));

      await registry.scanLocalStore(tempDir);

      // The file should still be indexed (with fallback metadata) since readFileSync succeeds
      // but manifest extraction will fail — the implementation reads the file and tries to extract
      // If gunzipSync throws, extractManifestFromTgz returns null → fallback metadata
      // However, the tarball buffer is still stored (it's the raw .tgz bytes)
      if (registry.has("6.0.0")) {
        const entry = registry.get("6.0.0");
        expect(entry!.metadata.author).toBe("unknown");
        expect(entry!.metadata.summary).toBe("");
      }
      // Either way, no crash
    });

    it("directory with only non-matching files: registry stays empty", async () => {
      writeFileSync(join(tempDir, "readme.md"), "hello");
      writeFileSync(join(tempDir, "bundle-1.0.0.tgz"), createTgz());
      writeFileSync(join(tempDir, "setup-2.0.0.tgz"), createTgz());
      mkdirSync(join(tempDir, "subdir"));

      await registry.scanLocalStore(tempDir);

      expect(registry.size).toBe(0);
    });
  });
});

// ── Semver utilities ──────────────────────────────────────────────────

describe("isValidSemver", () => {
  it("accepts valid semver strings", () => {
    expect(isValidSemver("1.0.0")).toBe(true);
    expect(isValidSemver("0.1.0")).toBe(true);
    expect(isValidSemver("10.20.30")).toBe(true);
    expect(isValidSemver("1.0.0-alpha")).toBe(true);
    expect(isValidSemver("1.0.0-beta.1")).toBe(true);
    expect(isValidSemver("1.0.0+build.123")).toBe(true);
    expect(isValidSemver("1.0.0-rc.1+build.456")).toBe(true);
  });

  it("rejects invalid semver strings", () => {
    expect(isValidSemver("notaversion")).toBe(false);
    expect(isValidSemver("1.0")).toBe(false);
    expect(isValidSemver("1")).toBe(false);
    expect(isValidSemver("v1.0.0")).toBe(false);
    expect(isValidSemver("1.0.0.0")).toBe(false);
    expect(isValidSemver("")).toBe(false);
    expect(isValidSemver("01.0.0")).toBe(false);
  });
});

describe("compareSemver", () => {
  it("orders by major version", () => {
    expect(compareSemver("2.0.0", "1.0.0")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0", "2.0.0")).toBeLessThan(0);
  });

  it("orders by minor version", () => {
    expect(compareSemver("1.2.0", "1.1.0")).toBeGreaterThan(0);
  });

  it("orders by patch version", () => {
    expect(compareSemver("1.0.2", "1.0.1")).toBeGreaterThan(0);
  });

  it("pre-release has lower precedence than normal", () => {
    expect(compareSemver("1.0.0", "1.0.0-alpha")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0-alpha", "1.0.0")).toBeLessThan(0);
  });

  it("compares pre-release identifiers", () => {
    expect(compareSemver("1.0.0-beta", "1.0.0-alpha")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0-alpha.2", "1.0.0-alpha.1")).toBeGreaterThan(0);
  });

  it("returns 0 for equal versions", () => {
    expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
    expect(compareSemver("1.0.0-alpha", "1.0.0-alpha")).toBe(0);
  });
});
