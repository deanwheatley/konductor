import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectWorkspaceRoot, updateGitignore } from "./workspace.mjs";

describe("detectWorkspaceRoot", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ws-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("finds workspace root via .git directory", () => {
    mkdirSync(join(tempDir, ".git"));
    const nested = join(tempDir, "a", "b", "c");
    mkdirSync(nested, { recursive: true });

    const root = detectWorkspaceRoot(nested);
    expect(root).toBe(tempDir);
  });

  it("finds workspace root via .kiro directory", () => {
    mkdirSync(join(tempDir, ".kiro"));
    const nested = join(tempDir, "src", "lib");
    mkdirSync(nested, { recursive: true });

    const root = detectWorkspaceRoot(nested);
    expect(root).toBe(tempDir);
  });

  it("prefers nearest marker when both .git and .kiro exist at different levels", () => {
    // .git at top level
    mkdirSync(join(tempDir, ".git"));
    // .kiro in a subdirectory (closer to startDir)
    const sub = join(tempDir, "sub");
    mkdirSync(join(sub, ".kiro"), { recursive: true });
    const nested = join(sub, "deep");
    mkdirSync(nested, { recursive: true });

    const root = detectWorkspaceRoot(nested);
    expect(root).toBe(sub);
  });

  it("falls back to startDir when no marker found", () => {
    // tempDir has no .git or .kiro
    const nested = join(tempDir, "a", "b");
    mkdirSync(nested, { recursive: true });

    const root = detectWorkspaceRoot(nested);
    expect(root).toBe(nested);
  });
});

describe("updateGitignore", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "gi-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates .gitignore with Konductor entries when file does not exist", () => {
    const count = updateGitignore(tempDir);

    expect(count).toBe(7);
    const content = readFileSync(join(tempDir, ".gitignore"), "utf-8");
    expect(content).toContain("# Konductor");
    expect(content).toContain("konductor-watcher.mjs");
    expect(content).toContain(".konductor-watcher.env");
    expect(content).toContain(".konductor-version");
  });

  it("is idempotent — running twice does not duplicate entries", () => {
    updateGitignore(tempDir);
    const first = readFileSync(join(tempDir, ".gitignore"), "utf-8");

    updateGitignore(tempDir);
    const second = readFileSync(join(tempDir, ".gitignore"), "utf-8");

    expect(second).toBe(first);
  });

  it("returns 0 when all entries already present", () => {
    updateGitignore(tempDir);
    const count = updateGitignore(tempDir);
    expect(count).toBe(0);
  });

  it("preserves existing .gitignore content", () => {
    const existing = "node_modules/\n.env\n";
    writeFileSync(join(tempDir, ".gitignore"), existing, "utf-8");

    updateGitignore(tempDir);

    const content = readFileSync(join(tempDir, ".gitignore"), "utf-8");
    expect(content).toContain("node_modules/");
    expect(content).toContain(".env");
    expect(content).toContain("konductor-watcher.mjs");
  });

  it("adds only missing entries when some already exist", () => {
    const existing = "# Konductor\nkonductor-watcher.mjs\n";
    writeFileSync(join(tempDir, ".gitignore"), existing, "utf-8");

    const count = updateGitignore(tempDir);

    expect(count).toBe(6); // 7 total minus 1 already present
    const content = readFileSync(join(tempDir, ".gitignore"), "utf-8");
    // Should not have duplicate header
    const headerCount = (content.match(/# Konductor/g) || []).length;
    expect(headerCount).toBe(1);
  });
});
