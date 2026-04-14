#!/bin/bash
# Konductor Client Bundle Installer
#
# Usage:
#   bash install.sh              ← full setup (global MCP config + workspace files)
#   bash install.sh --global     ← one-time: install MCP config to ~/.kiro/settings/
#   bash install.sh --workspace  ← per-project: install steering rule + hook + watcher
#
# Run --global once on your machine, then --workspace in each project.
# Running with no flags does both.

set -e

BUNDLE_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE_ROOT="."

do_global=false
do_workspace=false

if [ $# -eq 0 ]; then
  do_global=true
  do_workspace=true
else
  for arg in "$@"; do
    case "$arg" in
      --global)    do_global=true ;;
      --workspace) do_workspace=true ;;
      *) echo "Usage: bash install.sh [--global] [--workspace]"; exit 1 ;;
    esac
  done
fi

# ── Global setup (once per machine) ──────────────────────────────────

if [ "$do_global" = true ]; then
  echo "Global setup (~/.kiro/settings/mcp.json):"
  mkdir -p "$HOME/.kiro/settings"
  if [ -f "$HOME/.kiro/settings/mcp.json" ]; then
    if grep -q '"konductor"' "$HOME/.kiro/settings/mcp.json" 2>/dev/null; then
      echo "  ⏭  Konductor already configured in global MCP config"
    else
      echo "  ⚠️  Global MCP config exists but doesn't include konductor."
      echo "     Add the konductor entry manually. See bundle README for config."
    fi
  else
    cp "$BUNDLE_DIR/kiro/settings/mcp.json" "$HOME/.kiro/settings/"
    echo "  ✅ MCP config installed at ~/.kiro/settings/mcp.json"
    echo "     Edit it to set your server URL and API key."
  fi

  # Global steering rule (applies to all workspaces)
  mkdir -p "$HOME/.kiro/steering"
  if [ -f "$HOME/.kiro/steering/konductor-collision-awareness.md" ]; then
    echo "  ⏭  Global steering rule already exists, skipping"
  else
    cp "$BUNDLE_DIR/kiro/steering/konductor-collision-awareness.md" "$HOME/.kiro/steering/"
    echo "  ✅ Global steering rule installed (applies to all workspaces)"
  fi
  echo ""
fi

# ── Workspace setup (once per project) ───────────────────────────────

if [ "$do_workspace" = true ]; then
  echo "Workspace setup (.kiro/ in current directory):"

  # Steering rule
  mkdir -p "$WORKSPACE_ROOT/.kiro/steering"
  if [ -f "$WORKSPACE_ROOT/.kiro/steering/konductor-collision-awareness.md" ]; then
    echo "  ⏭  Steering rule already exists, skipping"
  else
    cp "$BUNDLE_DIR/kiro/steering/konductor-collision-awareness.md" "$WORKSPACE_ROOT/.kiro/steering/"
    echo "  ✅ Steering rule installed"
  fi

  # Hook
  mkdir -p "$WORKSPACE_ROOT/.kiro/hooks"
  if [ -f "$WORKSPACE_ROOT/.kiro/hooks/konductor-file-save.hook.md" ]; then
    echo "  ⏭  Hook already exists, skipping"
  else
    cp "$BUNDLE_DIR/kiro/hooks/konductor-file-save.hook.md" "$WORKSPACE_ROOT/.kiro/hooks/"
    echo "  ✅ File save hook installed"
  fi

  # Node.js file watcher
  if [ -f "$WORKSPACE_ROOT/konductor-watcher.mjs" ]; then
    echo "  ⏭  File watcher already exists, skipping"
  else
    cp "$BUNDLE_DIR/konductor-watcher.mjs" "$WORKSPACE_ROOT/konductor-watcher.mjs"
    echo "  ✅ File watcher installed (node konductor-watcher.mjs)"
  fi

  # Watcher env config
  if [ -f "$WORKSPACE_ROOT/.konductor-watcher.env" ]; then
    echo "  ⏭  Watcher config already exists, skipping"
  else
    cat > "$WORKSPACE_ROOT/.konductor-watcher.env" <<'ENVEOF'
# Konductor Watcher Configuration
# Edit these values to match your Konductor server setup.

KONDUCTOR_URL=http://localhost:3010
KONDUCTOR_API_KEY=

# Log level: "info" for color-coded notifications only, "debug" for all API traffic
KONDUCTOR_LOG_LEVEL=info

# How often (seconds) to poll the server for collision state changes from other users
KONDUCTOR_POLL_INTERVAL=10

# Optional: write logs to a file in addition to the terminal (leave empty to disable)
# KONDUCTOR_LOG_FILE=konductor-client.log

# Override git-detected values (leave commented to auto-detect)
# KONDUCTOR_USER=
# KONDUCTOR_REPO=
# KONDUCTOR_BRANCH=

# File extensions to watch (comma-separated)
# KONDUCTOR_WATCH_EXTENSIONS=ts,tsx,js,jsx,py,java,go,rs,rb,json,yaml,yml,md,html,css
ENVEOF
    echo "  ✅ Watcher config installed (.konductor-watcher.env — edit to set API key)"
  fi
  echo ""
fi

echo "Done!"
if [ "$do_global" = true ] && [ "$do_workspace" = true ]; then
  echo "  Global:    ~/.kiro/settings/mcp.json (edit to set URL + API key)"
  echo "  Workspace: .kiro/steering/, .kiro/hooks/, and konductor-watcher.mjs"
  echo ""
  echo "  To start the file watcher: node konductor-watcher.mjs"
  echo ""
  echo "For additional projects, just run: bash install.sh --workspace"
fi
