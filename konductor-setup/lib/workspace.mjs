/**
 * Workspace utilities — root detection and .gitignore management.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

/**
 * Walk up from `startDir` (defaults to process.cwd()) looking for `.git` or `.kiro`.
 * Returns the first directory containing either marker, or falls back to `startDir`.
 */
export function detectWorkspaceRoot(startDir = process.cwd()) {
  let dir = resolve(startDir);

  while (true) {
    if (existsSync(resolve(dir, ".git")) || existsSync(resolve(dir, ".kiro"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }

  return resolve(startDir);
}

const KONDUCTOR_HEADER = "# Konductor (auto-added by installer)";

const KONDUCTOR_IGNORES = [
  "konductor-watcher.mjs",
  "konductor-watcher-launcher.sh",
  "konductor-watchdog.sh",
  ".konductor-watcher.env",
  ".konductor-watcher.log",
  ".konductor-watcher.pid",
  ".konductor-watchdog.pid",
  ".konductor-version",
];

/**
 * Add Konductor runtime artifacts to .gitignore if not already present.
 * Creates the file if it doesn't exist. Preserves existing content.
 * Idempotent — running twice won't duplicate entries.
 */
export function updateGitignore(workspaceRoot) {
  const gitignorePath = resolve(workspaceRoot, ".gitignore");

  let existing = "";
  if (existsSync(gitignorePath)) {
    existing = readFileSync(gitignorePath, "utf-8");
  }

  const lines = existing.split("\n");
  const lineSet = new Set(lines.map((l) => l.trim()));

  const toAdd = KONDUCTOR_IGNORES.filter((entry) => !lineSet.has(entry));

  if (toAdd.length === 0) return 0;

  let append = "";

  // Add header if not already present
  if (!existing.includes("# Konductor")) {
    // Ensure blank line before header if file has content
    if (existing.length > 0 && !existing.endsWith("\n\n") && !existing.endsWith("\n")) {
      append += "\n";
    }
    append += "\n" + KONDUCTOR_HEADER + "\n";
  }

  append += toAdd.join("\n") + "\n";

  writeFileSync(gitignorePath, existing + append, "utf-8");

  return toAdd.length;
}
