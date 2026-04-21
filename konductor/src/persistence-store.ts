/**
 * PersistenceStore — JSON file-based persistence for work sessions.
 *
 * Uses atomic writes (write to temp file, then rename) to prevent
 * corruption from crashes or concurrent access. Validates structure
 * on load and backs up corrupted files before starting fresh.
 */

import { writeFile, readFile, rename, copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { IPersistenceStore, WorkSession } from "./types.js";

/**
 * Validates that a value looks like a WorkSession with the required fields
 * and correct types. Returns true only for structurally valid sessions.
 */
function isValidWorkSession(value: unknown): value is WorkSession {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.sessionId === "string" &&
    typeof obj.userId === "string" &&
    typeof obj.repo === "string" &&
    typeof obj.branch === "string" &&
    Array.isArray(obj.files) &&
    obj.files.every((f: unknown) => typeof f === "string") &&
    typeof obj.createdAt === "string" &&
    typeof obj.lastHeartbeat === "string"
  );
}

export class PersistenceStore implements IPersistenceStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /**
   * Persist sessions to disk using an atomic write strategy:
   * 1. Filter out passive sessions (github_pr, github_commit) — they are ephemeral
   * 2. Write JSON to a temporary file in the same directory
   * 3. Rename the temp file over the target (atomic on most filesystems)
   */
  async save(sessions: WorkSession[]): Promise<void> {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    const activeSessions = sessions.filter(
      (s) => !s.source || s.source === "active",
    );

    const tempPath = join(dir, `.sessions-${randomUUID()}.tmp`);
    const json = JSON.stringify(activeSessions, null, 2);

    await writeFile(tempPath, json, "utf-8");
    await rename(tempPath, this.filePath);
  }

  /**
   * Load sessions from disk. If the file is missing, returns an empty array.
   * If the file is corrupted (invalid JSON or invalid structure), backs up
   * the corrupted file and returns an empty array.
   */
  async load(): Promise<WorkSession[]> {
    if (!existsSync(this.filePath)) {
      return [];
    }

    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf-8");
    } catch {
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      await this.backupCorrupted();
      return [];
    }

    if (!Array.isArray(parsed)) {
      await this.backupCorrupted();
      return [];
    }

    const valid = parsed.filter(isValidWorkSession);
    if (valid.length !== parsed.length) {
      // Some entries were invalid — back up and keep only the valid ones
      await this.backupCorrupted();
    }

    return valid;
  }

  /**
   * Copy the corrupted file to a `.backup` path so it can be inspected later.
   */
  private async backupCorrupted(): Promise<void> {
    const backupPath = `${this.filePath}.backup`;
    try {
      await copyFile(this.filePath, backupPath);
    } catch {
      // If backup fails (e.g. permissions), we still continue with empty state
    }
  }
}
