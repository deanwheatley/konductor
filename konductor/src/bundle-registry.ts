/**
 * BundleRegistry — In-memory registry of installer bundles from the local store.
 *
 * Scans the `installers/` directory for versioned `.tgz` files, extracts metadata
 * from embedded `bundle-manifest.json`, and provides lookup/listing/deletion.
 *
 * Requirements: 1.1–1.6, 2.1–2.4, 3.1–3.6, 6.4–6.6, 8.2, 8.4
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import type { ChannelName } from "./installer-channel-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BundleManifest {
  version: string;
  createdAt: string;
  author?: string;
  summary?: string;
}

export interface BundleMetadata {
  version: string;
  createdAt: string;
  author: string;
  summary: string;
  hash: string;
  fileSize: number;
  filePath: string;
  channels: ChannelName[];
}

// ---------------------------------------------------------------------------
// Semver utilities (lightweight, no external dependency)
// ---------------------------------------------------------------------------

/** Regex for valid semver: MAJOR.MINOR.PATCH[-prerelease][+build] */
const SEMVER_REGEX = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\w.]+))?(?:\+([\w.]+))?$/;

export function isValidSemver(version: string): boolean {
  return SEMVER_REGEX.test(version);
}

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
  build: string[];
}

function parseSemver(version: string): ParsedSemver | null {
  const m = version.match(SEMVER_REGEX);
  if (!m) return null;
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2], 10),
    patch: parseInt(m[3], 10),
    prerelease: m[4] ? m[4].split(".") : [],
    build: m[5] ? m[5].split(".") : [],
  };
}

/**
 * Compare two semver strings. Returns negative if a < b, positive if a > b, 0 if equal.
 * Pre-release versions have lower precedence than the associated normal version.
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return 0;

  // Compare major.minor.patch
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  if (pa.patch !== pb.patch) return pa.patch - pb.patch;

  // Pre-release precedence: no prerelease > has prerelease
  if (pa.prerelease.length === 0 && pb.prerelease.length > 0) return 1;
  if (pa.prerelease.length > 0 && pb.prerelease.length === 0) return -1;

  // Compare prerelease identifiers
  const maxLen = Math.max(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < maxLen; i++) {
    if (i >= pa.prerelease.length) return -1; // fewer fields = lower precedence
    if (i >= pb.prerelease.length) return 1;

    const ai = pa.prerelease[i];
    const bi = pb.prerelease[i];
    const aNum = /^\d+$/.test(ai) ? parseInt(ai, 10) : NaN;
    const bNum = /^\d+$/.test(bi) ? parseInt(bi, 10) : NaN;

    if (!isNaN(aNum) && !isNaN(bNum)) {
      if (aNum !== bNum) return aNum - bNum;
    } else if (!isNaN(aNum)) {
      return -1; // numeric < string
    } else if (!isNaN(bNum)) {
      return 1;
    } else {
      const cmp = ai.localeCompare(bi);
      if (cmp !== 0) return cmp;
    }
  }

  return 0;
}

// ---------------------------------------------------------------------------
// Tar extraction utilities
// ---------------------------------------------------------------------------

/**
 * Extract a file from a tar archive (uncompressed).
 * Tar format: 512-byte header blocks followed by file data padded to 512 bytes.
 */
function extractFileFromTar(tarBuffer: Buffer, targetPath: string): Buffer | null {
  let offset = 0;
  while (offset < tarBuffer.length - 512) {
    // Read header
    const header = tarBuffer.subarray(offset, offset + 512);

    // Check for end-of-archive (two zero blocks)
    if (header.every((b) => b === 0)) break;

    // Extract filename (first 100 bytes, null-terminated)
    let name = header.subarray(0, 100).toString("utf-8").replace(/\0+$/, "");

    // Check for GNU/POSIX prefix (bytes 345-500)
    const prefix = header.subarray(345, 500).toString("utf-8").replace(/\0+$/, "");
    if (prefix) {
      name = `${prefix}/${name}`;
    }

    // Extract file size (octal, bytes 124-135)
    const sizeStr = header.subarray(124, 136).toString("utf-8").replace(/\0+$/, "").trim();
    const size = parseInt(sizeStr, 8) || 0;

    // Move past header
    offset += 512;

    // Check if this is the file we want
    if (name === targetPath || name.endsWith(`/${targetPath}`)) {
      return tarBuffer.subarray(offset, offset + size);
    }

    // Skip file data (padded to 512 bytes)
    offset += Math.ceil(size / 512) * 512;
  }
  return null;
}

/**
 * Extract `bundle-manifest.json` from a `.tgz` (gzipped tar) buffer.
 */
function extractManifestFromTgz(tgzBuffer: Buffer): BundleManifest | null {
  try {
    const tarBuffer = gunzipSync(tgzBuffer);
    const manifestData = extractFileFromTar(tarBuffer, "package/bundle-manifest.json");
    if (!manifestData) return null;
    const parsed = JSON.parse(manifestData.toString("utf-8"));
    if (typeof parsed.version !== "string") return null;
    return {
      version: parsed.version,
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : undefined,
      author: typeof parsed.author === "string" ? parsed.author : undefined,
      summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// BundleRegistry
// ---------------------------------------------------------------------------

export interface LogFn {
  (label: string, message: string): void;
}

export class BundleRegistry {
  private readonly bundles = new Map<string, { metadata: BundleMetadata; tarball: Buffer }>();
  private readonly log: LogFn | undefined;

  constructor(log?: LogFn) {
    this.log = log;
  }

  /**
   * Scan a directory for `installer-<semver>.tgz` files and populate the registry.
   * Creates the directory if it doesn't exist (Requirement 1.4).
   */
  async scanLocalStore(dir: string): Promise<void> {
    // Create directory if missing (Requirement 1.4)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      this.log?.(
        "SERVER",
        `Bundle registry: created ${dir}/ — place installer bundles here.\n` +
        `  Naming convention: installer-<semver>.tgz (e.g. installer-1.0.0.tgz, installer-2.1.0-beta.1.tgz)\n` +
        `  The server will discover bundles on next restart.`,
      );
      return;
    }

    const files = readdirSync(dir).filter((f) => f.endsWith(".tgz"));

    for (const file of files) {
      // Match installer-<version>.tgz pattern
      const match = file.match(/^installer-(.+)\.tgz$/);
      if (!match) {
        this.log?.("SERVER", `Bundle registry: ignoring ${file} — does not match installer-<version>.tgz pattern`);
        continue;
      }

      const versionFromFilename = match[1];

      // Skip channel-named files (handled by existing logic)
      if (["dev", "uat", "prod"].includes(versionFromFilename)) continue;

      // Validate semver (Requirement 1.2, 1.3)
      if (!isValidSemver(versionFromFilename)) {
        this.log?.("SERVER", `Bundle registry: skipping ${file} — invalid semver "${versionFromFilename}"`);
        continue;
      }

      // Check for duplicate versions (Requirement 3.2)
      if (this.bundles.has(versionFromFilename)) {
        this.log?.("SERVER", `Bundle registry: skipping duplicate ${file} — version ${versionFromFilename} already registered`);
        continue;
      }

      const filePath = join(dir, file);
      let tgzBuffer: Buffer;
      try {
        tgzBuffer = readFileSync(filePath);
      } catch (err) {
        this.log?.("SERVER", `Bundle registry: error reading ${file}: ${err instanceof Error ? err.message : err}`);
        continue;
      }

      // Extract manifest or use fallback metadata (Requirement 2.1, 2.2)
      const manifest = extractManifestFromTgz(tgzBuffer);
      if (!manifest) {
        this.log?.("SERVER", `Bundle registry: ${file} — no valid manifest found, using fallback metadata (filename version, file mtime)`);
      }

      let stat;
      try {
        stat = statSync(filePath);
      } catch {
        // Race condition: file was removed between readFileSync and statSync
        this.log?.("SERVER", `Bundle registry: error reading stats for ${file}, skipping`);
        continue;
      }

      const metadata: BundleMetadata = {
        version: manifest?.version ?? versionFromFilename,
        createdAt: manifest?.createdAt ?? stat.mtime.toISOString(),
        author: manifest?.author ?? "unknown",
        summary: manifest?.summary ?? "",
        hash: createHash("sha256").update(tgzBuffer).digest("hex"),
        fileSize: tgzBuffer.length,
        filePath,
        channels: [],
      };

      this.bundles.set(versionFromFilename, { metadata, tarball: tgzBuffer });

      // Log discovery (Requirement 1.6)
      this.log?.("SERVER", `Bundle registry: discovered v${versionFromFilename} (${(tgzBuffer.length / 1024).toFixed(0)} KB, created ${metadata.createdAt.slice(0, 10)})`);
    }
  }

  /**
   * List all bundles sorted by semver precedence (newest first).
   * Requirement 3.3
   */
  list(): BundleMetadata[] {
    const entries = Array.from(this.bundles.values()).map((e) => e.metadata);
    entries.sort((a, b) => compareSemver(b.version, a.version));
    return entries;
  }

  /**
   * Get a specific bundle by version.
   * Requirement 3.4
   */
  get(version: string): { metadata: BundleMetadata; tarball: Buffer } | null {
    return this.bundles.get(version) ?? null;
  }

  /**
   * Get the bundle with the most recent createdAt timestamp.
   * Requirement 8.2, 8.4
   */
  getLatest(): { metadata: BundleMetadata; tarball: Buffer } | null {
    let latest: { metadata: BundleMetadata; tarball: Buffer } | null = null;
    for (const entry of this.bundles.values()) {
      if (!latest || entry.metadata.createdAt > latest.metadata.createdAt) {
        latest = entry;
      }
    }
    return latest;
  }

  /**
   * Check if a version exists in the registry.
   */
  has(version: string): boolean {
    return this.bundles.has(version);
  }

  /**
   * Delete a bundle from the registry and optionally from disk.
   * Returns the list of channels that were referencing this version (now stale).
   * Requirement 6.4, 6.5
   */
  async delete(version: string, deleteFromDisk = true): Promise<{ deleted: boolean; staleChannels: ChannelName[] }> {
    const entry = this.bundles.get(version);
    if (!entry) return { deleted: false, staleChannels: [] };

    const staleChannels = [...entry.metadata.channels];

    // Remove from disk if requested (Requirement 6.5)
    if (deleteFromDisk && entry.metadata.filePath) {
      try {
        unlinkSync(entry.metadata.filePath);
      } catch {
        // Best effort — file may already be gone
      }
    }

    this.bundles.delete(version);
    return { deleted: true, staleChannels };
  }

  /**
   * Update channel references for all bundles based on current channel assignments.
   * Requirement 3.5
   */
  updateChannelRefs(channelAssignments: Map<ChannelName, string>): void {
    // Clear all existing channel refs
    for (const entry of this.bundles.values()) {
      entry.metadata.channels = [];
    }

    // Set refs based on current assignments
    for (const [channel, version] of channelAssignments) {
      const entry = this.bundles.get(version);
      if (entry) {
        entry.metadata.channels.push(channel);
      }
    }
  }

  /**
   * Get the number of bundles in the registry.
   */
  get size(): number {
    return this.bundles.size;
  }
}
