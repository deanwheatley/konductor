import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock child_process before importing platform.mjs
vi.mock("node:child_process", () => {
  const unrefFn = vi.fn();
  const spawnMock = vi.fn(() => ({ pid: 12345, unref: unrefFn }));
  const execSyncMock = vi.fn();
  return { spawn: spawnMock, execSync: execSyncMock, _unrefFn: unrefFn };
});

const { spawn, execSync, _unrefFn: unrefFn } = await import("node:child_process");
const { launchWatcher, killExistingWatcher } = await import("./platform.mjs");

describe("launchWatcher", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "platform-test-"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("spawns node with detached:true, stdio:'ignore' and calls unref", () => {
    // Create the watcher file so the existence check passes
    writeFileSync(join(tempDir, "konductor-watcher.mjs"), "// watcher");

    const result = launchWatcher(tempDir);

    expect(spawn).toHaveBeenCalledWith("node", ["konductor-watcher.mjs"], {
      cwd: tempDir,
      detached: true,
      stdio: "ignore",
    });
    expect(unrefFn).toHaveBeenCalled();
    expect(result.pid).toBe(12345);
  });

  it("returns undefined pid when watcher file does not exist", () => {
    const result = launchWatcher(tempDir);

    expect(spawn).not.toHaveBeenCalled();
    expect(result.pid).toBeUndefined();
  });

  it("returns undefined pid when spawn throws", () => {
    writeFileSync(join(tempDir, "konductor-watcher.mjs"), "// watcher");
    spawn.mockImplementationOnce(() => {
      throw new Error("spawn failed");
    });

    const result = launchWatcher(tempDir);

    expect(result.pid).toBeUndefined();
  });
});

describe("killExistingWatcher", () => {
  let tempDir;
  const originalPlatform = process.platform;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "platform-kill-"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("uses pkill on macOS/Linux", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });

    killExistingWatcher(tempDir);

    // Should call pkill for watcher and watchdog
    const calls = execSync.mock.calls.map((c) => c[0]);
    expect(calls).toContain('pkill -f "node.*konductor-watcher.mjs"');
    expect(calls).toContain('pkill -f "konductor-watchdog.sh"');
  });

  it("uses taskkill/wmic on Windows", () => {
    Object.defineProperty(process, "platform", { value: "win32" });

    killExistingWatcher(tempDir);

    const calls = execSync.mock.calls.map((c) => c[0]);
    // Should use taskkill or wmic, not pkill
    const hasTaskkill = calls.some((c) => c.includes("taskkill"));
    const hasWmic = calls.some((c) => c.includes("wmic"));
    expect(hasTaskkill || hasWmic).toBe(true);
    expect(calls.every((c) => !c.includes("pkill"))).toBe(true);
  });

  it("kills watchdog by PID from .konductor-watchdog.pid and cleans up the file", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    writeFileSync(join(tempDir, ".konductor-watchdog.pid"), "99999");

    killExistingWatcher(tempDir);

    const calls = execSync.mock.calls.map((c) => c[0]);
    expect(calls).toContain("kill 99999");
    // PID file should be removed
    expect(existsSync(join(tempDir, ".konductor-watchdog.pid"))).toBe(false);
  });

  it("handles missing .konductor-watchdog.pid gracefully", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });

    // Should not throw
    expect(() => killExistingWatcher(tempDir)).not.toThrow();
  });

  it("handles execSync failures gracefully (process not found)", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    execSync.mockImplementation(() => {
      throw new Error("No matching processes");
    });

    expect(() => killExistingWatcher(tempDir)).not.toThrow();
  });
});
