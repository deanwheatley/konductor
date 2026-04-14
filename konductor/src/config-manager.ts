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
  collision_course: CollisionState.CollisionCourse,
  merge_hell: CollisionState.MergeHell,
};

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

  return { heartbeatTimeoutSeconds: timeout, states };
}

export class ConfigManager implements IConfigManager {
  private config: KonductorConfig = { ...DEFAULT_CONFIG };
  private configPath: string = "";
  private watcher: FSWatcher | null = null;
  private changeCallbacks: Array<(config: KonductorConfig) => void> = [];
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

    try {
      const raw = await readFile(this.configPath, "utf-8");
      const parsed = parseYaml(raw);
      this.config = mergeWithDefaults(parsed);

      if (this.logger) {
        const changes: string[] = [];
        if (this.config.heartbeatTimeoutSeconds !== previousTimeout) {
          changes.push(`timeout ${previousTimeout}s → ${this.config.heartbeatTimeoutSeconds}s`);
        }
        this.logger.logConfigReloaded(changes.length > 0 ? changes.join(", ") : "no value changes detected");
      }

      for (const cb of this.changeCallbacks) {
        cb(this.config);
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

  /** Stop watching the config file. Call this on shutdown. */
  close(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}
