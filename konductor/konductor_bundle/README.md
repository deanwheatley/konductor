# Konductor Client Bundle

Everything you need to add collision awareness to your Kiro workspaces. One-time global setup for the MCP connection, then a quick per-project install for the steering rule, hook, and file watcher.

## Super Quick Setup

1. Copy this `konductor_bundle` folder into your project root
2. Open Kiro and type:

> "See the konductor_bundle folder. Run the installer in that folder to setup konductor for this workspace."

## What's Included

```
konductor_bundle/
├── README.md                  ← You're reading this
├── install.sh                 ← Setup script for macOS/Linux
├── install.ps1                ← Setup script for Windows (PowerShell)
├── konductor-watcher.mjs      ← Cross-platform file watcher (Node.js)
├── kiro/
│   ├── settings/
│   │   └── mcp.json           ← MCP server connection (installed globally)
│   ├── steering/
│   │   └── konductor-collision-awareness.md  ← Agent behavior rules (per-project)
│   └── hooks/
│       └── konductor-file-save.hook.md       ← Auto-register on file save (per-project)
```

## Quick Start

### macOS / Linux

```bash
bash /path/to/konductor_bundle/install.sh          # full setup
bash /path/to/konductor_bundle/install.sh --global  # MCP config only (once per machine)
bash /path/to/konductor_bundle/install.sh --workspace  # per-project only
```

### Windows (PowerShell)

```powershell
.\install.ps1            # full setup
.\install.ps1 -Global    # MCP config only
.\install.ps1 -Workspace # per-project only
```

After install, edit `~/.kiro/settings/mcp.json` to set your server URL and API key.

### Start the file watcher

```bash
node konductor-watcher.mjs
```

Leave it running alongside your editor. It watches for file changes, registers them with the Konductor, and polls for collision state changes from other users.

## Three Layers of Coverage

| Layer | Covers | How |
|-------|--------|-----|
| Steering rule | Agent-driven file changes | Agent auto-registers before modifying files |
| File save hook | Editor saves during active chat | Hook triggers agent to register on save |
| File watcher | All file changes (no agent needed) | Watches filesystem + polls server for collisions |

## What You'll See

Notifications are color-coded by severity with per-user detail blocks:

```
 🟢 SOLO  on testrepo/main — "No other users active. You're clear."  14:45:06
  You updated: ./src/index.ts

 🟠 COLLISION COURSE  on testrepo/main — "bob modifying same files."  14:46:12
  You updated: ./src/index.ts
  Shared files: ./src/index.ts
  ⚠️  Coordinate with your team before continuing.
  ──────────────────────────────────────
  User: bob on testrepo/feature-x
  Files: ./src/index.ts
  ──────────────────────────────────────

 🔴 MERGE HELL  on testrepo/main — "Divergent changes with bob, tom."  14:47:30
  You updated: ./src/index.ts
  You updated: ./src/readme.md
  Conflicting files: ./src/index.ts, ./src/readme.md
  ⛔ CRITICAL — Coordinate immediately:
  ──────────────────────────────────────
  User: bob on testrepo/feature-x
  Files: ./src/index.ts
  ──────────────────────────────────────
  User: tom on testrepo/main
  Files: ./src/readme.md
  ──────────────────────────────────────
```

Set `KONDUCTOR_LOG_LEVEL=debug` to also see raw API calls and responses.

## Configuration

Edit `.konductor-watcher.env` in your project root:

```env
KONDUCTOR_URL=http://localhost:3010
KONDUCTOR_API_KEY=your-api-key
KONDUCTOR_LOG_LEVEL=info
KONDUCTOR_POLL_INTERVAL=10
# KONDUCTOR_LOG_FILE=konductor-client.log
# KONDUCTOR_USER=alice
# KONDUCTOR_REPO=acme/app
# KONDUCTOR_BRANCH=main
# KONDUCTOR_WATCH_EXTENSIONS=ts,tsx,js,jsx,py,java,go,rs,rb,json,yaml,yml,md,html,css
```

## REST API Endpoints

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| `/api/register` | POST | `{userId, repo, branch, files}` | Register or update a session |
| `/api/status` | POST | `{userId, repo}` | Check collision state with full overlap details |
| `/health` | GET | — | Health check |

## Collision States

| State | Severity | Color | What happens |
|-------|----------|-------|-------------|
| 🟢 Solo | 0 | Green | No other users active |
| 🟢 Neighbors | 1 | Green | Others in repo, different files |
| 🟡 Crossroads | 2 | Yellow | Others in same directories |
| 🟠 Collision Course | 3 | Orange | Same branch, same files |
| 🔴 Merge Hell | 4 | Red | Different branches, same files |

## Requirements

- Node.js 20+ (for the file watcher)
- Kiro IDE (for steering rule and hook)
- Konductor MCP server running (local or shared mode)
- Git repository (auto-detects user, repo, branch)
