/**
 * AdminSettingsStore — Typed wrapper over ISettingsBackend with JSON
 * serialization and source tracking.
 *
 * Serializes values to JSON strings for storage, deserializes on retrieval.
 * Tracks setting source: "env" | "database" | "default".
 * Merges database settings with env vars (env takes precedence).
 *
 * Requirements: 3.2, 3.4, 11.2, 11.4, 12.1, 12.2, 12.3
 */

import type { ISettingsBackend, SettingsRecord } from "./settings-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SettingSource = "env" | "database" | "default";

export interface SettingWithSource {
  key: string;
  value: unknown;
  source: SettingSource;
  category: string;
}

// ---------------------------------------------------------------------------
// AdminSettingsStore
// ---------------------------------------------------------------------------

export class AdminSettingsStore {
  private readonly backend: ISettingsBackend;
  private readonly envOverrides: Map<string, unknown>;
  private readonly defaults: Map<string, { value: unknown; category: string }>;

  /**
   * @param backend      The persistence backend (memory or SQLite).
   * @param envOverrides Key-value pairs from environment variables that
   *                     take precedence over database values.
   * @param defaults     Default values for known settings.
   */
  constructor(
    backend: ISettingsBackend,
    envOverrides?: Map<string, unknown>,
    defaults?: Map<string, { value: unknown; category: string }>,
  ) {
    this.backend = backend;
    this.envOverrides = envOverrides ?? new Map();
    this.defaults = defaults ?? new Map();
  }

  /**
   * Get a setting value. Resolution order:
   * 1. Environment variable override (highest precedence)
   * 2. Database value
   * 3. Default value
   * Returns undefined if the key is unknown.
   */
  async get(key: string): Promise<unknown> {
    if (this.envOverrides.has(key)) {
      return this.envOverrides.get(key);
    }

    const raw = await this.backend.getSetting(key);
    if (raw !== null) {
      return JSON.parse(raw);
    }

    const def = this.defaults.get(key);
    return def?.value;
  }

  /**
   * Set a setting value. Serializes to JSON for storage.
   * Throws if the key is overridden by an environment variable.
   */
  async set(key: string, value: unknown, category: string): Promise<void> {
    if (this.envOverrides.has(key)) {
      throw new Error(`Setting "${key}" is read-only (set by environment variable)`);
    }
    const serialized = JSON.stringify(value);
    await this.backend.setSetting(key, serialized, category);
  }

  /**
   * Get the source of a setting's current value.
   */
  getSource(key: string): SettingSource {
    if (this.envOverrides.has(key)) return "env";
    // We can't synchronously check the backend, so this is a best-effort
    // check. For accurate source info, use getAllWithSource().
    if (this.defaults.has(key)) return "default";
    return "database";
  }

  /**
   * Get all settings merged from all sources, with source tracking.
   * Env overrides take precedence, then database, then defaults.
   */
  async getAllWithSource(category?: string): Promise<SettingWithSource[]> {
    const result = new Map<string, SettingWithSource>();

    // 1. Start with defaults
    for (const [key, def] of this.defaults) {
      if (category && def.category !== category) continue;
      result.set(key, {
        key,
        value: def.value,
        source: "default",
        category: def.category,
      });
    }

    // 2. Layer database values on top
    const dbRecords = await this.backend.getAllSettings(category);
    for (const record of dbRecords) {
      result.set(record.key, {
        key: record.key,
        value: JSON.parse(record.value),
        source: "database",
        category: record.category,
      });
    }

    // 3. Layer env overrides on top (highest precedence)
    for (const [key, value] of this.envOverrides) {
      const existing = result.get(key);
      const cat = existing?.category ?? "system";
      if (category && cat !== category) continue;
      result.set(key, {
        key,
        value,
        source: "env",
        category: cat,
      });
    }

    return [...result.values()];
  }
}
