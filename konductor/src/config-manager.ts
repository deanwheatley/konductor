/**
 * ConfigManager — YAML configuration loading with hot-reload.
 *
 * Loads collision state rules and heartbeat timeout from a YAML config
 * file. Watches the file for changes and hot-reloads without requiring
 * a server restart. Falls back to built-in defaults when the config
 * file is missing or invalid.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { watch, type FSWatcher } from "node:fs";
import { parse as parseYaml } from "yaml";
import {
  CollisionState,
  type IConfigManager,
  type KonductorConfig,
  type StateConfig,
  type Action,
  type GitHubConfig,
  type GitHubRepoConfig,
} from "./types.js";
import type { KonductorLogger } from "./logger.js";

/** Built-in defaults used when config file is missing or incomplete. */
export const DEFAULT_CONFIG: KonductorConfig = {
  heartbeatTimeoutSeconds: 300,
  states: {
    [CollisionState.Solo]: {
      message: "You're the only one here. Go wild.",
    },
    [CollisionState.Neighbors]: {
      message: "Others are in this repo, but touching different files.",
    },
    [CollisionState.Crossroads]: {
      message: "Heads up — others are working in the same directories.",
    },
    [CollisionState.Proximity]: {
      message: "Same file as others, but different sections — no line overlap.",
    },
    [CollisionState.CollisionCourse]: {
      message: "Warning — someone is modifying the same files as you.",
    },
    [CollisionState.MergeHell]: {
      message:
        "Critical — multiple divergent changes on the same files.",
      blockSubmissions: false,
    },
  },
};

/**
 * Validate and coerce a raw parsed object into a StateConfig.
 * Returns undefined if the value is not a valid state config shape.
 */
function toStateConfig(raw: unknown): StateConfig | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.message !== "string") return undefined;
  const cfg: StateConfig = { message: obj.message };
  if (typeof obj.block_submissions === "boolean") {
    cfg.blockSubmissions = obj.block_submissions;
  } else if (typeof obj.blockSubmissions === "boolean") {
    cfg.blockSubmissions = obj.blockSubmissions;
  }
  return cfg;
}

/** Map from YAML snake_case keys to CollisionState enum values. */
const STATE_KEY_MAP: Record<string, CollisionState> = {
  solo: CollisionState.Solo,
  neighbors: CollisionState.Neighbors,
  crossroads: CollisionState.Crossroads,
  proximity: CollisionState.Proximity,
  collision_course: CollisionState.CollisionCourse,
  merge_hell: CollisionState.MergeHell,
};

/**
 * Parse a raw YAML `github` section into a GitHubConfig.
 * Returns undefined if the section is missing or structurally invalid.
 */
function parseGitHubConfig(raw: unknown): GitHubConfig | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const obj = raw as Record<string, unknown>;

  // repositories is required and must be a non-empty array
  if (!Array.isArray(obj.repositories) || obj.repositories.length === 0) {
    return undefined;
  }

  const repositories: GitHubRepoConfig[] = [];
  for (const entry of obj.repositories) {
    if (typeof entry !== "object" || entry === null) continue;
    const r = entry as Record<string, unknown>;
    if (typeof r.repo !== "string" || r.repo.length === 0) continue;
    const repoConfig: GitHubRepoConfig = { repo: r.repo };
    if (Array.isArray(r.commit_branches)) {
      const branches = r.commit_branches.filter(
        (b: unknown): b is string => typeof b === "string" && b.length > 0,
      );
      if (branches.length > 0) {
        repoConfig.commitBranches = branches;
      }
    }
    repositories.push(repoConfig);
  }

  if (repositories.length === 0) return undefined;

  const tokenEnv =
    typeof obj.token_env === "string" && obj.token_env.length > 0
      ? obj.token_env
      : "GITHUB_TOKEN";

  const pollIntervalSeconds =
    typeof obj.poll_interval_seconds === "number" && obj.poll_interval_seconds > 0
      ? obj.poll_interval_seconds
      : 60;

  const includeDrafts =
    typeof obj.include_drafts === "boolean" ? obj.include_drafts : true;

  const commitLookbackHours =
    typeof obj.commit_lookback_hours === "number" && obj.commit_lookback_hours > 0
      ? obj.commit_lookback_hours
      : 24;

  return {
    tokenEnv,
    pollIntervalSeconds,
    includeDrafts,
    commitLookbackHours,
    repositories,
  };
}

/**
 * Merge a raw parsed YAML object with the built-in defaults.
 * Missing or invalid fields fall back to defaults.
 */
function mergeWithDefaults(raw: unknown): KonductorConfig {
  if (typeof raw !== "object" || raw === null) {
    return { ...DEFAULT_CONFIG };
  }

  const obj = raw as Record<string, unknown>;

  const timeout =
    typeof obj.heartbeat_timeout_seconds === "number" &&
    obj.heartbeat_timeout_seconds > 0
      ? obj.heartbeat_timeout_seconds
      : DEFAULT_CONFIG.heartbeatTimeoutSeconds;

  const states = { ...DEFAULT_CONFIG.states };

  if (typeof obj.states === "object" && obj.states !== null) {
    const rawStates = obj.states as Record<string, unknown>;
    for (const [key, value] of Object.entries(rawStates)) {
      const stateEnum = STATE_KEY_MAP[key];
      if (stateEnum !== undefined) {
        const parsed = toStateConfig(value);
        if (parsed) {
          states[stateEnum] = parsed;
        }
      }
    }
  }

  return { heartbeatTimeoutSeconds: timeout, states, github: parseGitHubConfig(obj.github) };
}

/**
 * Shallow-compare two GitHubConfig values for equality.
 * Used to detect whether the github section changed on reload.
 */
function githubConfigEqual(
  a: GitHubConfig | undefined,
  b: GitHubConfig | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (
    a.tokenEnv !== b.tokenEnv ||
    a.pollIntervalSeconds !== b.pollIntervalSeconds ||
    a.includeDrafts !== b.includeDrafts ||
    a.commitLookbackHours !== b.commitLookbackHours ||
    a.repositories.length !== b.repositories.length
  ) {
    return false;
  }
  for (let i = 0; i < a.repositories.length; i++) {
    const ra = a.repositories[i];
    const rb = b.repositories[i];
    if (ra.repo !== rb.repo) return false;
    const ba = ra.commitBranches ?? [];
    const bb = rb.commitBranches ?? [];
    if (ba.length !== bb.length || ba.some((v, j) => v !== bb[j])) return false;
  }
  return true;
}

export class ConfigManager implements IConfigManager {
  private config: KonductorConfig = { ...DEFAULT_CONFIG };
  private configPath: string = "";
  private watcher: FSWatcher | null = null;
  private changeCallbacks: Array<(config: KonductorConfig) => void> = [];
  private githubChangeCallbacks: Array<(config: GitHubConfig | undefined) => void> = [];
  private readonly logger?: KonductorLogger;

  constructor(logger?: KonductorLogger) {
    this.logger = logger;
  }

  /**
   * Load configuration from a YAML file. If the file is missing or
   * contains invalid YAML, built-in defaults are used.
   */
  async load(configPath: string): Promise<KonductorConfig> {
    this.configPath = configPath;

    if (!existsSync(configPath)) {
      this.config = { ...DEFAULT_CONFIG };
      if (this.logger) {
        this.logger.logConfigLoaded(configPath, this.config.heartbeatTimeoutSeconds);
      }
      return this.config;
    }

    try {
      const raw = await readFile(configPath, "utf-8");
      const parsed = parseYaml(raw);
      this.config = mergeWithDefaults(parsed);
    } catch {
      // Invalid YAML or read error — keep defaults
      this.config = { ...DEFAULT_CONFIG };
      if (this.logger) {
        this.logger.logConfigError("Failed to parse config file");
      }
    }

    if (this.logger) {
      this.logger.logConfigLoaded(configPath, this.config.heartbeatTimeoutSeconds);
    }

    return this.config;
  }

  /**
   * Re-read the config file. If the file is now invalid, the previous
   * valid config is kept.
   */
  async reload(): Promise<KonductorConfig> {
    if (!this.configPath) {
      return this.config;
    }

    if (!existsSync(this.configPath)) {
      // File was removed — keep current config
      return this.config;
    }

    const previousTimeout = this.config.heartbeatTimeoutSeconds;
    const previousGitHub = this.config.github;

    try {
      const raw = await readFile(this.configPath, "utf-8");
      const parsed = parseYaml(raw);
      this.config = mergeWithDefaults(parsed);

      if (this.logger) {
        const changes: string[] = [];
        if (this.config.heartbeatTimeoutSeconds !== previousTimeout) {
          changes.push(`timeout ${previousTimeout}s → ${this.config.heartbeatTimeoutSeconds}s`);
        }
        const ghChanged = !githubConfigEqual(previousGitHub, this.config.github);
        if (ghChanged) {
          changes.push("github config changed");
        }
        this.logger.logConfigReloaded(changes.length > 0 ? changes.join(", ") : "no value changes detected");
      }

      for (const cb of this.changeCallbacks) {
        cb(this.config);
      }

      if (!githubConfigEqual(previousGitHub, this.config.github)) {
        for (const cb of this.githubChangeCallbacks) {
          cb(this.config.github);
        }
      }
    } catch {
      // Invalid YAML — keep previous config
      if (this.logger) {
        this.logger.logConfigError("Failed to parse config on reload");
      }
    }

    return this.config;
  }

  /** Return the configured heartbeat timeout in seconds. */
  getTimeout(): number {
    return this.config.heartbeatTimeoutSeconds;
  }

  /** Return the GitHub integration config, or undefined if not configured. */
  getGitHubConfig(): GitHubConfig | undefined {
    return this.config.github;
  }

  /**
   * Return the actions configured for a given collision state.
   * Derives actions from the state config's message and blockSubmissions fields.
   */
  getStateActions(state: CollisionState): Action[] {
    const stateConfig = this.config.states[state];
    if (!stateConfig) return [];

    const actions: Action[] = [];

    if (stateConfig.message) {
      actions.push({ type: "warn", message: stateConfig.message });
    }

    if (stateConfig.blockSubmissions) {
      actions.push({
        type: "block",
        message: `Submissions blocked: ${stateConfig.message}`,
      });
    }

    return actions;
  }

  /**
   * Watch the config file for changes and trigger hot-reload.
   * Calls all registered callbacks after a successful reload.
   */
  onConfigChange(callback: (config: KonductorConfig) => void): void {
    this.changeCallbacks.push(callback);

    // Start watching if not already
    if (this.watcher === null && this.configPath) {
      try {
        this.watcher = watch(this.configPath, async (eventType) => {
          if (eventType === "change") {
            await this.reload();
          }
        });
      } catch {
        // fs.watch may not be available in all environments
      }
    }
  }

  /**
   * Register a callback that fires only when the GitHub config section changes.
   * Useful for pollers that need to restart when repos/intervals change.
   */
  onGitHubConfigChange(callback: (config: GitHubConfig | undefined) => void): void {
    this.githubChangeCallbacks.push(callback);
  }

  /** Stop watching the config file. Call this on shutdown. */
  close(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}
