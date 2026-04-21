/**
 * Property-Based Tests for AdminSettingsStore
 *
 * Uses fast-check to verify correctness properties from the design document.
 */

import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { MemorySettingsBackend } from "./settings-store.js";
import { AdminSettingsStore } from "./admin-settings-store.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Arbitrary JSON-serializable value (the domain of settings values).
 * Excludes -0 since JSON.stringify(-0) === "0" — a known JSON limitation.
 */
const jsonValueArb: fc.Arbitrary<unknown> = fc.jsonValue().filter(
  (v) => !isNegativeZero(v),
);

/** Check if a value is or deeply contains -0. */
function isNegativeZero(v: unknown): boolean {
  if (typeof v === "number") return Object.is(v, -0);
  if (Array.isArray(v)) return v.some(isNegativeZero);
  if (v !== null && typeof v === "object") return Object.values(v).some(isNegativeZero);
  return false;
}

/** Arbitrary setting key. */
const settingKeyArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_.]{0,30}$/);

/** Arbitrary category. */
const categoryArb = fc.constantFrom("system", "client", "freshness");

// ---------------------------------------------------------------------------
// Property 3: Settings serialization round-trip
// **Feature: konductor-admin, Property 3: Settings serialization round-trip**
// **Validates: Requirements 11.2, 12.3**
// ---------------------------------------------------------------------------

describe("Settings Serialization Round-Trip — Property Tests", () => {
  let backend: MemorySettingsBackend;
  let store: AdminSettingsStore;

  beforeEach(() => {
    backend = new MemorySettingsBackend();
    store = new AdminSettingsStore(backend);
  });

  /**
   * **Feature: konductor-admin, Property 3: Settings serialization round-trip**
   * **Validates: Requirements 11.2, 12.3**
   *
   * For any JSON-serializable value (string, number, boolean, null, array,
   * object), serializing the value to a JSON string and then deserializing
   * it back SHALL produce a value equivalent to the original.
   */
  it("Property 3: set then get produces equivalent value for any JSON-serializable value", async () => {
    await fc.assert(
      fc.asyncProperty(
        settingKeyArb,
        jsonValueArb,
        categoryArb,
        async (key, value, category) => {
          const freshBackend = new MemorySettingsBackend();
          const freshStore = new AdminSettingsStore(freshBackend);

          await freshStore.set(key, value, category);
          const retrieved = await freshStore.get(key);

          // Round-trip: the retrieved value must be deeply equal to the original
          expect(retrieved).toEqual(value);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: Settings source precedence
// **Feature: konductor-admin, Property 4: Settings source precedence**
// **Validates: Requirements 3.4, 11.4**
// ---------------------------------------------------------------------------

describe("Settings Source Precedence — Property Tests", () => {
  /**
   * **Feature: konductor-admin, Property 4: Settings source precedence**
   * **Validates: Requirements 3.4, 11.4**
   *
   * For any set of database settings and environment variables, merging
   * them SHALL produce a result where environment variable values take
   * precedence for overlapping keys, and database-only keys are preserved
   * unchanged.
   */
  it("Property 4: env overrides take precedence over database values for overlapping keys", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate a set of database settings
        fc.array(
          fc.tuple(settingKeyArb, jsonValueArb, categoryArb),
          { minLength: 1, maxLength: 10 },
        ),
        // Generate a set of env overrides (some keys may overlap with db)
        fc.array(
          fc.tuple(settingKeyArb, jsonValueArb),
          { minLength: 1, maxLength: 5 },
        ),
        async (dbSettings, envEntries) => {
          const backend = new MemorySettingsBackend();

          // Populate database
          for (const [key, value, category] of dbSettings) {
            await backend.setSetting(key, JSON.stringify(value), category);
          }

          // Build env overrides map
          const envOverrides = new Map<string, unknown>();
          for (const [key, value] of envEntries) {
            envOverrides.set(key, value);
          }

          const store = new AdminSettingsStore(backend, envOverrides);

          // For every env override key, the store must return the env value
          for (const [key, envValue] of envOverrides) {
            const retrieved = await store.get(key);
            expect(retrieved).toEqual(envValue);
          }

          // For every db-only key (not in env), the store must return the db value.
          // When duplicate keys exist in dbSettings, the last write wins.
          const lastDbValue = new Map<string, unknown>();
          for (const [key, value] of dbSettings) {
            lastDbValue.set(key, value);
          }
          for (const [key, value] of lastDbValue) {
            if (!envOverrides.has(key)) {
              const retrieved = await store.get(key);
              expect(retrieved).toEqual(value);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("Property 4 (cont.): getAllWithSource reports correct source for each setting", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.tuple(settingKeyArb, jsonValueArb, categoryArb),
          { minLength: 1, maxLength: 5 },
        ),
        fc.array(
          fc.tuple(settingKeyArb, jsonValueArb),
          { minLength: 1, maxLength: 3 },
        ),
        async (dbSettings, envEntries) => {
          const backend = new MemorySettingsBackend();

          for (const [key, value, category] of dbSettings) {
            await backend.setSetting(key, JSON.stringify(value), category);
          }

          const envOverrides = new Map<string, unknown>();
          for (const [key, value] of envEntries) {
            envOverrides.set(key, value);
          }

          const store = new AdminSettingsStore(backend, envOverrides);
          const all = await store.getAllWithSource();

          // Every env-overridden key must have source "env"
          for (const setting of all) {
            if (envOverrides.has(setting.key)) {
              expect(setting.source).toBe("env");
              expect(setting.value).toEqual(envOverrides.get(setting.key));
            }
          }

          // Every db-only key must have source "database"
          for (const setting of all) {
            if (!envOverrides.has(setting.key)) {
              expect(setting.source).toBe("database");
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
