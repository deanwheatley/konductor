import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import fc from "fast-check";
import { stringify as yamlStringify } from "yaml";
import { ConfigManager, DEFAULT_CONFIG } from "./config-manager.js";
import { CollisionState } from "./types.js";
import type { Action, GitHubConfig } from "./types.js";

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


// ---------------------------------------------------------------------------
// GitHub Config Parsing Tests
// ---------------------------------------------------------------------------

describe("ConfigManager — GitHub Config Parsing", () => {
  it("returns undefined github config when section is absent", async () => {
    const configPath = join(tempDir, "no-github.yaml");
    await writeFile(
      configPath,
      yamlStringify({ heartbeat_timeout_seconds: 300 }),
      "utf-8",
    );

    const mgr = new ConfigManager();
    const config = await mgr.load(configPath);

    expect(config.github).toBeUndefined();
    expect(mgr.getGitHubConfig()).toBeUndefined();
    mgr.close();
  });

  it("parses a full github config with all fields", async () => {
    const configPath = join(tempDir, "full-github.yaml");
    await writeFile(
      configPath,
      yamlStringify({
        heartbeat_timeout_seconds: 300,
        github: {
          token_env: "MY_GH_TOKEN",
          poll_interval_seconds: 120,
          include_drafts: false,
          commit_lookback_hours: 48,
          repositories: [
            { repo: "org/repo-a", commit_branches: ["main", "develop"] },
            { repo: "org/repo-b" },
          ],
        },
      }),
      "utf-8",
    );

    const mgr = new ConfigManager();
    await mgr.load(configPath);
    const gh = mgr.getGitHubConfig();

    expect(gh).toBeDefined();
    expect(gh!.tokenEnv).toBe("MY_GH_TOKEN");
    expect(gh!.pollIntervalSeconds).toBe(120);
    expect(gh!.includeDrafts).toBe(false);
    expect(gh!.commitLookbackHours).toBe(48);
    expect(gh!.repositories).toHaveLength(2);
    expect(gh!.repositories[0].repo).toBe("org/repo-a");
    expect(gh!.repositories[0].commitBranches).toEqual(["main", "develop"]);
    expect(gh!.repositories[1].repo).toBe("org/repo-b");
    expect(gh!.repositories[1].commitBranches).toBeUndefined();
    mgr.close();
  });

  it("applies defaults for missing optional github fields", async () => {
    const configPath = join(tempDir, "partial-github.yaml");
    await writeFile(
      configPath,
      yamlStringify({
        github: {
          repositories: [{ repo: "org/repo-a" }],
        },
      }),
      "utf-8",
    );

    const mgr = new ConfigManager();
    await mgr.load(configPath);
    const gh = mgr.getGitHubConfig();

    expect(gh).toBeDefined();
    expect(gh!.tokenEnv).toBe("GITHUB_TOKEN");
    expect(gh!.pollIntervalSeconds).toBe(60);
    expect(gh!.includeDrafts).toBe(true);
    expect(gh!.commitLookbackHours).toBe(24);
    expect(gh!.repositories).toHaveLength(1);
    mgr.close();
  });

  it("returns undefined when github section has empty repositories", async () => {
    const configPath = join(tempDir, "empty-repos.yaml");
    await writeFile(
      configPath,
      yamlStringify({
        github: {
          token_env: "GH_TOKEN",
          repositories: [],
        },
      }),
      "utf-8",
    );

    const mgr = new ConfigManager();
    await mgr.load(configPath);

    expect(mgr.getGitHubConfig()).toBeUndefined();
    mgr.close();
  });

  it("returns undefined when github section has invalid repositories", async () => {
    const configPath = join(tempDir, "invalid-repos.yaml");
    await writeFile(
      configPath,
      yamlStringify({
        github: {
          repositories: [{ not_a_repo: true }, { repo: "" }],
        },
      }),
      "utf-8",
    );

    const mgr = new ConfigManager();
    await mgr.load(configPath);

    expect(mgr.getGitHubConfig()).toBeUndefined();
    mgr.close();
  });

  it("skips invalid repo entries but keeps valid ones", async () => {
    const configPath = join(tempDir, "mixed-repos.yaml");
    await writeFile(
      configPath,
      yamlStringify({
        github: {
          repositories: [
            { repo: "org/valid-repo" },
            { not_a_repo: true },
            { repo: "" },
            { repo: "org/another-valid" },
          ],
        },
      }),
      "utf-8",
    );

    const mgr = new ConfigManager();
    await mgr.load(configPath);
    const gh = mgr.getGitHubConfig();

    expect(gh).toBeDefined();
    expect(gh!.repositories).toHaveLength(2);
    expect(gh!.repositories[0].repo).toBe("org/valid-repo");
    expect(gh!.repositories[1].repo).toBe("org/another-valid");
    mgr.close();
  });

  it("returns undefined when github is not an object", async () => {
    const configPath = join(tempDir, "github-string.yaml");
    await writeFile(configPath, "github: true\n", "utf-8");

    const mgr = new ConfigManager();
    await mgr.load(configPath);

    expect(mgr.getGitHubConfig()).toBeUndefined();
    mgr.close();
  });

  it("fires onGitHubConfigChange when github config is added on reload", async () => {
    const configPath = join(tempDir, "hot-reload-gh.yaml");
    // Start without github
    await writeFile(
      configPath,
      yamlStringify({ heartbeat_timeout_seconds: 300 }),
      "utf-8",
    );

    const mgr = new ConfigManager();
    await mgr.load(configPath);
    expect(mgr.getGitHubConfig()).toBeUndefined();

    let callbackFired = false;
    let receivedConfig: GitHubConfig | undefined;
    mgr.onGitHubConfigChange((cfg) => {
      callbackFired = true;
      receivedConfig = cfg;
    });

    // Now add github section and reload
    await writeFile(
      configPath,
      yamlStringify({
        heartbeat_timeout_seconds: 300,
        github: {
          repositories: [{ repo: "org/repo" }],
        },
      }),
      "utf-8",
    );
    await mgr.reload();

    expect(callbackFired).toBe(true);
    expect(receivedConfig).toBeDefined();
    expect(receivedConfig!.repositories[0].repo).toBe("org/repo");
    mgr.close();
  });

  it("fires onGitHubConfigChange when github config is removed on reload", async () => {
    const configPath = join(tempDir, "hot-reload-remove.yaml");
    await writeFile(
      configPath,
      yamlStringify({
        github: { repositories: [{ repo: "org/repo" }] },
      }),
      "utf-8",
    );

    const mgr = new ConfigManager();
    await mgr.load(configPath);
    expect(mgr.getGitHubConfig()).toBeDefined();

    let callbackFired = false;
    mgr.onGitHubConfigChange(() => {
      callbackFired = true;
    });

    // Remove github section
    await writeFile(
      configPath,
      yamlStringify({ heartbeat_timeout_seconds: 300 }),
      "utf-8",
    );
    await mgr.reload();

    expect(callbackFired).toBe(true);
    expect(mgr.getGitHubConfig()).toBeUndefined();
    mgr.close();
  });

  it("does NOT fire onGitHubConfigChange when github config is unchanged", async () => {
    const configPath = join(tempDir, "hot-reload-same.yaml");
    const yamlContent = yamlStringify({
      heartbeat_timeout_seconds: 300,
      github: { repositories: [{ repo: "org/repo" }] },
    });
    await writeFile(configPath, yamlContent, "utf-8");

    const mgr = new ConfigManager();
    await mgr.load(configPath);

    let callbackFired = false;
    mgr.onGitHubConfigChange(() => {
      callbackFired = true;
    });

    // Reload with same content (only timeout changes)
    await writeFile(
      configPath,
      yamlStringify({
        heartbeat_timeout_seconds: 600,
        github: { repositories: [{ repo: "org/repo" }] },
      }),
      "utf-8",
    );
    await mgr.reload();

    expect(callbackFired).toBe(false);
    expect(mgr.getTimeout()).toBe(600);
    mgr.close();
  });
});
