/**
 * Unit tests for installer.mjs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

// Mock os.homedir and child_process before importing installer
vi.mock("node:os", async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    homedir: vi.fn(() => original.homedir()),
    hostname: original.hostname,
  };
});

vi.mock("node:child_process", () => ({
  execSync: vi.fn(() => {
    throw new Error("mocked");
  }),
  spawn: vi.fn(() => ({ pid: 42, unref: vi.fn() })),
}));

const os = await import("node:os");
const { installGlobal, installWorkspace, detectMode } = await import(
  "./installer.mjs"
);

// Path to the real embedded bundle
const bundleDir = resolve(
  new URL(".", import.meta.url).pathname,
  "..",
  "bundle"
);

describe("installGlobal", () => {
  let fakeHome;

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), "inst-global-"));
    os.homedir.mockReturnValue(fakeHome);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("creates MCP config from scratch when none exists", async () => {
    await installGlobal(bundleDir, "test-key-123");

    const mcpPath = join(fakeHome, ".kiro", "settings", "mcp.json");
    expect(existsSync(mcpPath)).toBe(true);

    const cfg = JSON.parse(readFileSync(mcpPath, "utf-8"));
    expect(cfg.mcpServers.konductor).toBeDefined();
    expect(cfg.mcpServers.konductor.headers.Authorization).toBe(
      "Bearer test-key-123"
    );
    expect(cfg.mcpServers.konductor.url).toBe("http://localhost:3010/sse");
  });

  it("writes placeholder when no --api-key provided and no existing config", async () => {
    await installGlobal(bundleDir, undefined);

    const mcpPath = join(fakeHome, ".kiro", "settings", "mcp.json");
    const cfg = JSON.parse(readFileSync(mcpPath, "utf-8"));
    expect(cfg.mcpServers.konductor.headers.Authorization).toBe(
      "Bearer YOUR_API_KEY"
    );
  });

  it("merges into existing MCP config preserving other servers", async () => {
    const mcpDir = join(fakeHome, ".kiro", "settings");
    mkdirSync(mcpDir, { recursive: true });
    writeFileSync(
      join(mcpDir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          "other-server": { url: "http://other:8080" },
        },
      }),
      "utf-8"
    );

    await installGlobal(bundleDir, "my-key");

    const cfg = JSON.parse(readFileSync(join(mcpDir, "mcp.json"), "utf-8"));
    expect(cfg.mcpServers["other-server"]).toBeDefined();
    expect(cfg.mcpServers.konductor).toBeDefined();
    expect(cfg.mcpServers.konductor.headers.Authorization).toBe(
      "Bearer my-key"
    );
  });

  it("preserves existing non-placeholder API key when no --api-key", async () => {
    const mcpDir = join(fakeHome, ".kiro", "settings");
    mkdirSync(mcpDir, { recursive: true });
    writeFileSync(
      join(mcpDir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          konductor: {
            url: "http://localhost:3010/sse",
            headers: { Authorization: "Bearer real-secret-key" },
          },
        },
      }),
      "utf-8"
    );

    await installGlobal(bundleDir, undefined);

    const cfg = JSON.parse(readFileSync(join(mcpDir, "mcp.json"), "utf-8"));
    expect(cfg.mcpServers.konductor.headers.Authorization).toBe(
      "Bearer real-secret-key"
    );
  });

  it("overwrites existing key when --api-key is explicitly provided", async () => {
    const mcpDir = join(fakeHome, ".kiro", "settings");
    mkdirSync(mcpDir, { recursive: true });
    writeFileSync(
      join(mcpDir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          konductor: {
            url: "http://localhost:3010/sse",
            headers: { Authorization: "Bearer old-key" },
          },
        },
      }),
      "utf-8"
    );

    await installGlobal(bundleDir, "new-key");

    const cfg = JSON.parse(readFileSync(join(mcpDir, "mcp.json"), "utf-8"));
    expect(cfg.mcpServers.konductor.headers.Authorization).toBe(
      "Bearer new-key"
    );
  });

  it("deploys global steering rule", async () => {
    await installGlobal(bundleDir, undefined);

    const steeringPath = join(
      fakeHome,
      ".kiro",
      "steering",
      "konductor-collision-awareness.md"
    );
    expect(existsSync(steeringPath)).toBe(true);
  });

  it("deploys global agent rule to ~/.gemini/", async () => {
    await installGlobal(bundleDir, undefined);

    const agentPath = join(
      fakeHome,
      ".gemini",
      "konductor-collision-awareness.md"
    );
    expect(existsSync(agentPath)).toBe(true);
  });

  it("cleans previous global install artifacts before deploying", async () => {
    // Create old artifacts
    const steeringDir = join(fakeHome, ".kiro", "steering");
    const geminiDir = join(fakeHome, ".gemini");
    mkdirSync(steeringDir, { recursive: true });
    mkdirSync(geminiDir, { recursive: true });
    writeFileSync(
      join(steeringDir, "konductor-collision-awareness.md"),
      "old content"
    );
    writeFileSync(
      join(geminiDir, "konductor-collision-awareness.md"),
      "old content"
    );

    await installGlobal(bundleDir, undefined);

    // Files should exist but with new content (from bundle)
    const steeringContent = readFileSync(
      join(steeringDir, "konductor-collision-awareness.md"),
      "utf-8"
    );
    expect(steeringContent).not.toBe("old content");
  });
});

describe("installWorkspace", () => {
  let fakeWorkspace;

  beforeEach(() => {
    fakeWorkspace = mkdtempSync(join(tmpdir(), "inst-ws-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(fakeWorkspace, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("deploys all expected files", async () => {
    await installWorkspace(bundleDir, fakeWorkspace, "0.1.0");

    // Steering rule
    expect(
      existsSync(
        join(
          fakeWorkspace,
          ".kiro",
          "steering",
          "konductor-collision-awareness.md"
        )
      )
    ).toBe(true);

    // Hooks
    expect(
      existsSync(
        join(fakeWorkspace, ".kiro", "hooks", "konductor-file-save.hook.md")
      )
    ).toBe(true);
    expect(
      existsSync(
        join(
          fakeWorkspace,
          ".kiro",
          "hooks",
          "konductor-session-start.hook.md"
        )
      )
    ).toBe(true);

    // Agent rules
    expect(
      existsSync(
        join(
          fakeWorkspace,
          ".agent",
          "rules",
          "konductor-collision-awareness.md"
        )
      )
    ).toBe(true);

    // Watcher files
    expect(existsSync(join(fakeWorkspace, "konductor-watcher.mjs"))).toBe(
      true
    );
    expect(
      existsSync(join(fakeWorkspace, "konductor-watcher-launcher.sh"))
    ).toBe(true);
    expect(existsSync(join(fakeWorkspace, "konductor-watchdog.sh"))).toBe(
      true
    );
  });

  it("cleans previous install before deploying", async () => {
    // Create old artifacts
    mkdirSync(join(fakeWorkspace, ".kiro", "steering"), { recursive: true });
    writeFileSync(
      join(
        fakeWorkspace,
        ".kiro",
        "steering",
        "konductor-collision-awareness.md"
      ),
      "old"
    );
    writeFileSync(join(fakeWorkspace, "konductor-watcher.mjs"), "old watcher");

    await installWorkspace(bundleDir, fakeWorkspace, "0.2.0");

    // Files should have new content
    const content = readFileSync(
      join(fakeWorkspace, "konductor-watcher.mjs"),
      "utf-8"
    );
    expect(content).not.toBe("old watcher");
  });

  it("preserves existing .konductor-watcher.env", async () => {
    const envContent = "KONDUCTOR_LOG_LEVEL=debug\nKONDUKTOR_USER=alice\n";
    writeFileSync(
      join(fakeWorkspace, ".konductor-watcher.env"),
      envContent,
      "utf-8"
    );

    await installWorkspace(bundleDir, fakeWorkspace, "0.1.0");

    const result = readFileSync(
      join(fakeWorkspace, ".konductor-watcher.env"),
      "utf-8"
    );
    expect(result).toBe(envContent);
  });

  it("creates .konductor-watcher.env when it does not exist", async () => {
    await installWorkspace(bundleDir, fakeWorkspace, "0.1.0");

    expect(existsSync(join(fakeWorkspace, ".konductor-watcher.env"))).toBe(
      true
    );
    const content = readFileSync(
      join(fakeWorkspace, ".konductor-watcher.env"),
      "utf-8"
    );
    expect(content).toContain("KONDUCTOR_LOG_LEVEL");
  });

  it("writes .konductor-version with correct version", async () => {
    await installWorkspace(bundleDir, fakeWorkspace, "1.2.3");

    const version = readFileSync(
      join(fakeWorkspace, ".konductor-version"),
      "utf-8"
    );
    expect(version.trim()).toBe("1.2.3");
  });

  it("updates .gitignore with Konductor entries", async () => {
    await installWorkspace(bundleDir, fakeWorkspace, "0.1.0");

    const gitignore = readFileSync(
      join(fakeWorkspace, ".gitignore"),
      "utf-8"
    );
    expect(gitignore).toContain("konductor-watcher.mjs");
    expect(gitignore).toContain(".konductor-version");
  });
});

describe("detectMode", () => {
  let fakeHome;

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), "inst-mode-"));
    os.homedir.mockReturnValue(fakeHome);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns "workspace" when global config has konductor entry', () => {
    const mcpDir = join(fakeHome, ".kiro", "settings");
    mkdirSync(mcpDir, { recursive: true });
    writeFileSync(
      join(mcpDir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          konductor: { url: "http://localhost:3010/sse" },
        },
      }),
      "utf-8"
    );

    expect(detectMode()).toBe("workspace");
  });

  it('returns "both" when global config has no konductor entry', () => {
    const mcpDir = join(fakeHome, ".kiro", "settings");
    mkdirSync(mcpDir, { recursive: true });
    writeFileSync(
      join(mcpDir, "mcp.json"),
      JSON.stringify({ mcpServers: { other: {} } }),
      "utf-8"
    );

    expect(detectMode()).toBe("both");
  });

  it('returns "both" when no mcp.json exists', () => {
    expect(detectMode()).toBe("both");
  });
});
