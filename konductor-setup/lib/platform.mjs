/**
 * Platform utilities — watcher lifecycle management.
 * Handles cross-platform process spawning and killing for the Konductor file watcher.
 */

import { spawn, execSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Kill any existing konductor-watcher.mjs and watchdog processes.
 * On macOS/Linux: uses pkill. On Windows: uses taskkill.
 * Also cleans up the .konductor-watchdog.pid file.
 *
 * @param {string} [workspaceRoot] — workspace root to find .konductor-watchdog.pid
 */
export function killExistingWatcher(workspaceRoot) {
  const isWindows = process.platform === "win32";

  // Kill the watcher process
  try {
    if (isWindows) {
      execSync('taskkill /F /FI "IMAGENAME eq node.exe" /FI "WINDOWTITLE eq *konductor-watcher*"', {
        stdio: "ignore",
      });
      // Also try wmic for more reliable matching
      execSync(
        'wmic process where "commandline like \'%konductor-watcher.mjs%\'" call terminate',
        { stdio: "ignore" }
      );
    } else {
      execSync('pkill -f "node.*konductor-watcher.mjs"', { stdio: "ignore" });
    }
  } catch {
    // Process not found — that's fine
  }

  // Kill the watchdog process
  if (workspaceRoot) {
    const pidFile = resolve(workspaceRoot, ".konductor-watchdog.pid");
    if (existsSync(pidFile)) {
      try {
        const pid = readFileSync(pidFile, "utf-8").trim();
        if (pid) {
          if (isWindows) {
            execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
          } else {
            execSync(`kill ${pid}`, { stdio: "ignore" });
          }
        }
      } catch {
        // Process already gone — that's fine
      }
      try {
        unlinkSync(pidFile);
      } catch {
        // File already removed
      }
    }
  }

  // Also kill watchdog by name on unix
  if (!isWindows) {
    try {
      execSync('pkill -f "konductor-watchdog.sh"', { stdio: "ignore" });
    } catch {
      // Not running
    }
  }
}

/**
 * Launch the file watcher as a detached background process.
 * Uses `spawn` with `detached: true` and `stdio: 'ignore'`, then calls `.unref()`
 * so the installer can exit without waiting for the watcher.
 *
 * @param {string} workspaceRoot — directory containing konductor-watcher.mjs
 * @returns {{ pid: number | undefined }} — the spawned process PID, or undefined if launch failed
 */
export function launchWatcher(workspaceRoot) {
  const watcherPath = resolve(workspaceRoot, "konductor-watcher.mjs");

  if (!existsSync(watcherPath)) {
    console.warn("  ⚠️  konductor-watcher.mjs not found — skipping watcher launch");
    return { pid: undefined };
  }

  try {
    const child = spawn("node", ["konductor-watcher.mjs"], {
      cwd: workspaceRoot,
      detached: true,
      stdio: "ignore",
    });

    child.unref();

    return { pid: child.pid };
  } catch (err) {
    console.warn(`  ⚠️  Failed to launch watcher: ${err.message}`);
    return { pid: undefined };
  }
}
