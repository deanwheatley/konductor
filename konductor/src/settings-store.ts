/**
 * Settings Store — Interface and in-memory implementation for admin settings.
 *
 * Provides the settings operations described in the design document:
 * getSetting(), setSetting(), getAllSettings().
 *
 * The MemorySettingsBackend implements these using a JavaScript Map
 * (settings are lost on restart).
 *
 * Requirements: 11.1, 11.3
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SettingsRecord {
  key: string;
  value: string;       // JSON-encoded
  category: string;    // "system" | "client" | "freshness"
  updatedAt: string;   // ISO 8601
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface ISettingsBackend {
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string, category: string): Promise<void>;
  getAllSettings(category?: string): Promise<SettingsRecord[]>;
}

// ---------------------------------------------------------------------------
// In-Memory Implementation (Requirement 11.3)
// ---------------------------------------------------------------------------

export class MemorySettingsBackend implements ISettingsBackend {
  private readonly store = new Map<string, SettingsRecord>();

  async getSetting(key: string): Promise<string | null> {
    const record = this.store.get(key);
    return record ? record.value : null;
  }

  async setSetting(key: string, value: string, category: string): Promise<void> {
    this.store.set(key, {
      key,
      value,
      category,
      updatedAt: new Date().toISOString(),
    });
  }

  async getAllSettings(category?: string): Promise<SettingsRecord[]> {
    const records = [...this.store.values()];
    if (category) {
      return records.filter((r) => r.category === category);
    }
    return records;
  }
}
