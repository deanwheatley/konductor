---
name: Konductor Session Start
description: Ensures the Konductor file watcher is running when a Kiro session starts. Launches it as a detached background process if not already running.
trigger:
  type: onSessionStart
action:
  type: runCommand
  command: |
    node -e "
    const { execSync, spawn } = require('child_process');
    const fs = require('fs');
    const path = require('path');

    // Check if watcher is already running
    try {
      const r = execSync('pgrep -f konductor-watcher.mjs', {encoding:'utf-8',stdio:['pipe','pipe','pipe']});
      if (r.trim()) { process.stderr.write('Konductor: Watcher already running.\n'); process.exit(0); }
    } catch {}

    // Find the watcher script
    const wp = path.resolve('konductor-watcher.mjs');
    if (!fs.existsSync(wp)) {
      process.stderr.write('⚠️ Konductor: konductor-watcher.mjs not found. Run \"konductor, setup\" to install.\n');
      process.exit(0);
    }

    // Launch watcher as a detached background process.
    // CRITICAL: The hook command MUST exit quickly. The watcher runs independently.
    // The watcher's self-launch logic (TTY detection) will open a terminal window
    // for its output. Setting KONDUCTOR_NO_RELAUNCH=1 would keep it headless.
    const c = spawn('node', [wp], {cwd:process.cwd(), detached:true, stdio:'ignore'});
    c.unref();
    process.stderr.write('Konductor: File watcher started.\n');

    // Restart watchdog too (monitors watcher and relaunches if it crashes)
    try { execSync('pkill -f konductor-watchdog.sh', {stdio:'ignore'}); } catch {}
    const wd = path.resolve('konductor-watchdog.sh');
    if (fs.existsSync(wd)) {
      const w = spawn('bash', [wd, process.cwd()], {detached:true, stdio:'ignore'});
      w.unref();
    }
    "
---
