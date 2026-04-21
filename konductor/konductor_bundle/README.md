# Konductor Client Bundle

Collision awareness for Kiro and Antigravity IDEs. One installer, both platforms.

## Recommended: npx Installer

The bundle is now served directly by the Konductor server and installed via `npx`. This is the recommended approach — it always fetches the latest version matching your server.

```bash
npx konductor-setup --server http://your-server:3010 --api-key YOUR_KEY
```

See the main [Konductor README](../README.md) for full CLI flags and multi-project workflow.

The npx installer downloads the bundle from `GET /bundle/manifest.json` and `GET /bundle/files/:path` on the Konductor server. If the server is unreachable, it falls back to the bundle files embedded in the npm package.

## Manual Install (Fallback)

If `npx` is not available or you prefer manual installation, the shell scripts still work:

macOS / Linux:
```bash
bash konductor_bundle/install.sh
```

Windows (PowerShell):
```powershell
.\konductor_bundle\install.ps1
```

The installer handles everything: MCP config, steering/rules, hooks, file watcher (auto-launched), and config. Reinstalls cleanly — user config is preserved.

## What Gets Installed

| Location | File | IDE |
|----------|------|-----|
| `~/.kiro/settings/mcp.json` | MCP server connection | Kiro |
| `~/.kiro/steering/` | Global collision awareness rule | Kiro |
| `~/.gemini/` | Global collision awareness rule | Antigravity |
| `.kiro/steering/` | Workspace collision awareness rule | Kiro |
| `.kiro/hooks/` | File save + session start hooks | Kiro |
| `.agent/rules/` | Workspace collision awareness rule | Antigravity |
| `konductor-watcher.mjs` | Cross-platform file watcher (Node.js) | Both |
| `konductor-watchdog.sh` | Watchdog (restarts watcher if it dies) | Both |
| `.konductor-watcher.env` | Watcher config (log level, poll interval) | Both |
| `.konductor-version` | Deployed bundle version (for auto-update) | Both |

## File Filtering

The watcher tracks ALL files by default, using `.gitignore` to determine what to skip. This means:

- `.txt`, `.csv`, `.xml`, `.py`, `.ts` — all tracked automatically
- `node_modules/`, `dist/`, build artifacts — skipped (gitignored)
- `.git/`, `.kiro/`, `.agent/` — always skipped

Set `KONDUCTOR_LOG_LEVEL=debug` to see which files are being skipped and why.

To restrict to specific extensions instead, set in `.konductor-watcher.env`:
```env
KONDUCTOR_WATCH_EXTENSIONS=ts,py,js
```

## Configuration

Server URL and API key are read from `mcp.json` automatically. Only watcher-specific settings go in `.konductor-watcher.env`:

```env
KONDUCTOR_LOG_LEVEL=info          # "info" or "debug" (debug shows skipped files)
KONDUCTOR_LOG_TO_TERMINAL=true
KONDUCTOR_POLL_INTERVAL=10        # seconds between collision polls
# KONDUCTOR_LOG_FILE=.konductor-watcher.log
# KONDUCTOR_LOG_MAX_SIZE=10MB     # max log file size before rotation (KB/MB/GB)
# KONDUCTOR_WATCH_EXTENSIONS=     # empty = watch all, or comma-separated list
```

## Requirements

- Node.js 20+ (for the file watcher)
- Kiro IDE and/or Antigravity IDE
- Konductor MCP server running
- Git repository
