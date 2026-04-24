/**
 * FileSettingsBackend — JSON file-based persistence for admin settings.
 *
 * Implements ISettingsBackend with atomic writes (temp + rename) to prevent
 * corruption. Used when KONDUCTOR_STARTUP_LOCAL=true so that Baton dashboard
 * settings survive server restarts.
 *
 * Falls back gracefully: if the file is missing or corrupted, starts fresh
 * and backs up the corrupted file.
 */

import { writeFile, readFile, rename, copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ISettingsBackend, SettingsRecord } from "./settings-store.js";

export class FileSettingsBackend implements ISettingsBackend {
  private readonly filePath: string;
  private store = new Map<string, SettingsRecord>();
  private loaded = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;

  constructor(filePath: string, debounceMs = 500) {
    this.filePath = filePath;
    this.debounceMs = debounceMs;
  }

  async getSetting(key: string): Promise<string | null> {
    await this.ensureLoaded();
    const record = this.store.get(key);
    return record ? record.value : null;
  }

  async setSetting(key: string, value: string, category: string): Promise<void> {
    await this.ensureLoaded();
    this.store.set(key, {
      key,
      value,
      category,
      updatedAt: new Date().toISOString(),
    });
    this.scheduleSave();
  }

  async getAllSettings(category?: string): Promise<SettingsRecord[]> {
    await this.ensureLoaded();
    const records = [...this.store.values()];
    return category ? records.filter((r) => r.category === category) : records;
  }

  /** Flush any pending writes immediately. Call on graceful shutdown. */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.saveToDisk();
  }

  // ── Internal ────────────────────────────────────────────────────

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    await this.loadFromDisk();
  }

  private async loadFromDisk(): Promise<void> {
    if (!existsSync(this.filePath)) return;

    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf-8");
    } catch {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      await this.backupCorrupted();
      return;
    }

    if (!Array.isArray(parsed)) {
      await this.backupCorrupted();
      return;
    }

    for (const entry of parsed) {
      if (isValidRecord(entry)) {
        this.store.set(entry.key, entry);
      }
    }
  }

  private async saveToDisk(): Promise<void> {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    const records = [...this.store.values()];
    const tempPath = join(dir, `.settings-${randomUUID()}.tmp`);
    const json = JSON.stringify(records, null, 2);

    await writeFile(tempPath, json, "utf-8");
    await rename(tempPath, this.filePath);
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(async () => {
      this.saveTimer = null;
      try {
        await this.saveToDisk();
      } catch {
        // Best effort — next write will retry
      }
    }, this.debounceMs);
  }

  private async backupCorrupted(): Promise<void> {
    const backupPath = `${this.filePath}.backup`;
    try {
      await copyFile(this.filePath, backupPath);
    } catch {
      // If backup fails, continue with empty state
    }
  }
}

function isValidRecord(value: unknown): value is SettingsRecord {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.key === "string" &&
    typeof obj.value === "string" &&
    typeof obj.category === "string" &&
    typeof obj.updatedAt === "string"
  );
}
