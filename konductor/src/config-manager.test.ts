import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import fc from "fast-check";
import { stringify as yamlStringify } from "yaml";
import { ConfigManager, DEFAULT_CONFIG } from "./config-manager.js";
import { CollisionState } from "./types.js";
import type { Action } from "./types.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Generates a non-empty message string. */
const messageArb = fc.stringMatching(/^[A-Za-z0-9 .,!?'-]{1,60}$/);

/** Generates a valid StateConfig-like raw object (YAML shape). */
const stateConfigRawArb = fc.record({
  message: messageArb,
  block_submissions: fc.boolean(),
});

/** Generates a valid raw YAML config object with all fields. */
const fullRawConfigArb = fc.record({
  heartbeat_timeout_seconds: fc.integer({ min: 1, max: 86400 }),
  states: fc.record({
    solo: stateConfigRawArb,
    neighbors: stateConfigRawArb,
    crossroads: stateConfigRawArb,
    collision_course: stateConfigRawArb,
    merge_hell: stateConfigRawArb,
  }),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "konductor-cfg-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Property-Based Tests
// ---------------------------------------------------------------------------

describe("ConfigManager — Property Tests", () => {
  /**
   * **Feature: konductor-mcp-server, Property 7: Configuration values are applied correctly**
   * **Validates: Requirements 4.2, 4.3**
   *
   * For any valid KonductorConfig with a custom heartbeat timeout and
   * state-specific actions, the ConfigManager should return the configured
   * timeout value, and getStateActions should return actions matching the
   * configured state messages and block settings.
   */
  it("Property 7: loaded config returns correct timeout and state actions", async () => {
    await fc.assert(
      fc.asyncProperty(fullRawConfigArb, async (rawConfig) => {
        const configPath = join(tempDir, `cfg-${Date.now()}-${Math.random()}.yaml`);
        await writeFile(configPath, yamlStringify(rawConfig), "utf-8");

        const mgr = new ConfigManager();
        await mgr.load(configPath);

        // Timeout must match the generated value
        expect(mgr.getTimeout()).toBe(rawConfig.heartbeat_timeout_seconds);

        // Check each state's actions
        const stateKeys: Array<[string, CollisionState]> = [
          ["solo", CollisionState.Solo],
          ["neighbors", CollisionState.Neighbors],
          ["crossroads", CollisionState.Crossroads],
          ["collision_course", CollisionState.CollisionCourse],
          ["merge_hell", CollisionState.MergeHell],
        ];

        for (const [yamlKey, stateEnum] of stateKeys) {
          const actions: Action[] = mgr.getStateActions(stateEnum);
          const rawState = rawConfig.states[yamlKey as keyof typeof rawConfig.states];

          // Should always have a warn action with the message
          const warnAction = actions.find((a) => a.type === "warn");
          expect(warnAction).toBeDefined();
          expect(warnAction!.message).toBe(rawState.message);

          // block action present only when block_submissions is true
          const blockAction = actions.find((a) => a.type === "block");
          if (rawState.block_submissions) {
            expect(blockAction).toBeDefined();
          } else {
            expect(blockAction).toBeUndefined();
          }
        }

        mgr.close();
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Unit Tests
// ---------------------------------------------------------------------------

describe("ConfigManager — Unit Tests", () => {
  it("uses defaults when config file does not exist", async () => {
    const mgr = new ConfigManager();
    const config = await mgr.load(join(tempDir, "nonexistent.yaml"));

    expect(config.heartbeatTimeoutSeconds).toBe(DEFAULT_CONFIG.heartbeatTimeoutSeconds);
    expect(mgr.getTimeout()).toBe(300);
    expect(config.states[CollisionState.Solo].message).toBe(
      DEFAULT_CONFIG.states[CollisionState.Solo].message,
    );
    mgr.close();
  });

  it("keeps previous config when YAML is invalid", async () => {
    const configPath = join(tempDir, "bad.yaml");

    // First load a valid config
    const validYaml = yamlStringify({ heartbeat_timeout_seconds: 120 });
    await writeFile(configPath, validYaml, "utf-8");

    const mgr = new ConfigManager();
    await mgr.load(configPath);
    expect(mgr.getTimeout()).toBe(120);

    // Now corrupt the file and reload
    await writeFile(configPath, "{{{{not: valid: yaml: [[[", "utf-8");
    await mgr.reload();

    // Should keep the previous valid config
    expect(mgr.getTimeout()).toBe(120);
    mgr.close();
  });

  it("merges partial config with defaults", async () => {
    const configPath = join(tempDir, "partial.yaml");
    const partialYaml = yamlStringify({
      heartbeat_timeout_seconds: 60,
      states: {
        solo: { message: "Custom solo message" },
      },
    });
    await writeFile(configPath, partialYaml, "utf-8");

    const mgr = new ConfigManager();
    const config = await mgr.load(configPath);

    // Custom values applied
    expect(config.heartbeatTimeoutSeconds).toBe(60);
    expect(config.states[CollisionState.Solo].message).toBe("Custom solo message");

    // Non-overridden states use defaults
    expect(config.states[CollisionState.Neighbors].message).toBe(
      DEFAULT_CONFIG.states[CollisionState.Neighbors].message,
    );
    expect(config.states[CollisionState.MergeHell].message).toBe(
      DEFAULT_CONFIG.states[CollisionState.MergeHell].message,
    );
    mgr.close();
  });
});
