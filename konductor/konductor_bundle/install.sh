#!/bin/bash
# Konductor Client Bundle Installer
#
# Usage:
#   bash install.sh              ← full setup (global + workspace)
#   bash install.sh --global     ← global MCP config + rules
#   bash install.sh --workspace  ← per-project: rules + hook + watcher
#
# If existing install detected, it is removed first (clean reinstall).
# User config (.konductor-watcher.env) is preserved.

set -e

BUNDLE_DIR="$(cd "$(dirname "$0")" && pwd)"

# Detect workspace root by walking up to find .git or .kiro
detect_workspace_root() {
  local dir="$(pwd)"
  while [ "$dir" != "/" ]; do
    if [ -d "$dir/.git" ] || [ -d "$dir/.kiro" ]; then
      echo "$dir"
      return
    fi
    dir="$(dirname "$dir")"
  done
  echo "$(pwd)"
}

WORKSPACE_ROOT="$(detect_workspace_root)"

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

# ── Global setup ─────────────────────────────────────────────────────

if [ "$do_global" = true ]; then
  echo "Global setup:"

  # Uninstall existing
  echo "  Cleaning previous install..."
  rm -f "$HOME/.kiro/steering/konductor-collision-awareness.md" 2>/dev/null
  rm -f "$HOME/.gemini/konductor-collision-awareness.md" 2>/dev/null

  # MCP config
  mkdir -p "$HOME/.kiro/settings"
  # Detect username for X-Konductor-User header
  KONDUCTOR_USER_HEADER=""
  if command -v gh &> /dev/null; then
    KONDUCTOR_USER_HEADER=$(gh api user --jq .login 2>/dev/null || true)
  fi
  if [ -z "$KONDUCTOR_USER_HEADER" ]; then
    KONDUCTOR_USER_HEADER=$(git config user.name 2>/dev/null || hostname 2>/dev/null || echo "unknown")
  fi

  if [ -f "$HOME/.kiro/settings/mcp.json" ]; then
    node -e "
      const fs = require('fs');
      const cfg = JSON.parse(fs.readFileSync('$HOME/.kiro/settings/mcp.json', 'utf-8'));
      cfg.mcpServers = cfg.mcpServers || {};
      cfg.mcpServers.konductor = {
        url: 'http://localhost:3010/sse',
        headers: { Authorization: 'Bearer YOUR_API_KEY', 'X-Konductor-User': '$KONDUCTOR_USER_HEADER' },
        autoApprove: ['register_session', 'check_status', 'deregister_session', 'list_sessions']
      };
      fs.writeFileSync('$HOME/.kiro/settings/mcp.json', JSON.stringify(cfg, null, 2) + '\n');
    " 2>/dev/null && echo "  ✅ MCP config updated (user: $KONDUCTOR_USER_HEADER)" || echo "  ⚠️  Could not update MCP config. See bundle README."
  else
    cp "$BUNDLE_DIR/kiro/settings/mcp.json" "$HOME/.kiro/settings/"
    echo "  ✅ MCP config installed"
  fi
  echo "     Edit ~/.kiro/settings/mcp.json to set your API key."

  # Kiro global steering rule
  mkdir -p "$HOME/.kiro/steering"
  cp "$BUNDLE_DIR/kiro/steering/konductor-collision-awareness.md" "$HOME/.kiro/steering/"
  echo "  ✅ Kiro global steering rule installed"

  # Antigravity global rule
  mkdir -p "$HOME/.gemini"
  cp "$BUNDLE_DIR/agent/rules/konductor-collision-awareness.md" "$HOME/.gemini/konductor-collision-awareness.md"
  echo "  ✅ Antigravity global rule installed"
  echo ""
fi

# ── Workspace setup ──────────────────────────────────────────────────

if [ "$do_workspace" = true ]; then
  echo "Workspace setup (root: $WORKSPACE_ROOT):"

  # Uninstall existing
  echo "  Cleaning previous install..."
  pkill -f "node.*konductor-watcher.mjs" 2>/dev/null || true
  # Kill watchdog if running
  if [ -f "$WORKSPACE_ROOT/.konductor-watchdog.pid" ]; then
    kill "$(cat "$WORKSPACE_ROOT/.konductor-watchdog.pid")" 2>/dev/null || true
    rm -f "$WORKSPACE_ROOT/.konductor-watchdog.pid"
  fi
  pkill -f "konductor-watchdog.sh" 2>/dev/null || true
  rm -f "$WORKSPACE_ROOT/.kiro/steering/konductor-collision-awareness.md" 2>/dev/null
  rm -f "$WORKSPACE_ROOT/.kiro/hooks/konductor-file-save.hook.md" 2>/dev/null
  rm -f "$WORKSPACE_ROOT/.kiro/hooks/konductor-session-start.hook.md" 2>/dev/null
  rm -f "$WORKSPACE_ROOT/.agent/rules/konductor-collision-awareness.md" 2>/dev/null
  rm -f "$WORKSPACE_ROOT/konductor-watcher.mjs" 2>/dev/null
  rm -f "$WORKSPACE_ROOT/konductor-watcher-launcher.sh" 2>/dev/null
  rm -f "$WORKSPACE_ROOT/konductor-watchdog.sh" 2>/dev/null
  rm -f "$WORKSPACE_ROOT/.konductor-watcher.log" 2>/dev/null
  rm -f "$WORKSPACE_ROOT/.konductor-watcher.pid" 2>/dev/null

  # Kiro steering rule
  mkdir -p "$WORKSPACE_ROOT/.kiro/steering"
  cp "$BUNDLE_DIR/kiro/steering/konductor-collision-awareness.md" "$WORKSPACE_ROOT/.kiro/steering/"
  echo "  ✅ Kiro steering rule installed"

  # Kiro hooks
  mkdir -p "$WORKSPACE_ROOT/.kiro/hooks"
  cp "$BUNDLE_DIR/kiro/hooks/konductor-file-save.hook.md" "$WORKSPACE_ROOT/.kiro/hooks/"
  cp "$BUNDLE_DIR/kiro/hooks/konductor-session-start.hook.md" "$WORKSPACE_ROOT/.kiro/hooks/"
  echo "  ✅ Kiro hooks installed"

  # Antigravity workspace rule
  mkdir -p "$WORKSPACE_ROOT/.agent/rules"
  cp "$BUNDLE_DIR/agent/rules/konductor-collision-awareness.md" "$WORKSPACE_ROOT/.agent/rules/"
  echo "  ✅ Antigravity workspace rule installed"

  # File watcher + launcher + watchdog
  cp "$BUNDLE_DIR/konductor-watcher.mjs" "$WORKSPACE_ROOT/konductor-watcher.mjs"
  cp "$BUNDLE_DIR/konductor-watcher-launcher.sh" "$WORKSPACE_ROOT/konductor-watcher-launcher.sh"
  chmod +x "$WORKSPACE_ROOT/konductor-watcher-launcher.sh"
  cp "$BUNDLE_DIR/konductor-watchdog.sh" "$WORKSPACE_ROOT/konductor-watchdog.sh"
  chmod +x "$WORKSPACE_ROOT/konductor-watchdog.sh"
  echo "  ✅ File watcher installed"

  # Watcher env config (preserve if exists)
  if [ ! -f "$WORKSPACE_ROOT/.konductor-watcher.env" ]; then
    cat > "$WORKSPACE_ROOT/.konductor-watcher.env" <<'ENVEOF'
# Konductor Watcher Configuration
# Server URL and API key are read from mcp.json automatically.
# Only watcher-specific settings go here.

KONDUCTOR_LOG_LEVEL=info
KONDUCTOR_LOG_TO_TERMINAL=true
KONDUCTOR_POLL_INTERVAL=10
# KONDUCTOR_LOG_FILE=.konductor-watcher.log
# KONDUCTOR_USER=
# KONDUCTOR_REPO=
# KONDUCTOR_BRANCH=

# File filtering: by default, watches ALL files not in .gitignore.
# Set this to restrict to specific extensions (comma-separated, no dots).
# Leave empty or commented to watch everything git tracks.
# KONDUCTOR_WATCH_EXTENSIONS=
ENVEOF
    echo "  ✅ Watcher config created (.konductor-watcher.env — edit to set API key)"
  else
    echo "  ⏭  Watcher config preserved (.konductor-watcher.env)"
  fi

  # Add Konductor runtime artifacts to .gitignore
  GITIGNORE="$WORKSPACE_ROOT/.gitignore"
  KONDUCTOR_IGNORES=(
    "konductor-watcher.mjs"
    "konductor-watcher-launcher.sh"
    "konductor-watchdog.sh"
    ".konductor-watcher.env"
    ".konductor-watcher.log"
    ".konductor-watchdog.pid"
  )
  touch "$GITIGNORE"
  added=0
  for entry in "${KONDUCTOR_IGNORES[@]}"; do
    if ! grep -qxF "$entry" "$GITIGNORE"; then
      # Add a Konductor header comment before the first entry we add
      if [ "$added" -eq 0 ] && ! grep -qF "# Konductor" "$GITIGNORE"; then
        echo "" >> "$GITIGNORE"
        echo "# Konductor (auto-added by installer)" >> "$GITIGNORE"
      fi
      echo "$entry" >> "$GITIGNORE"
      added=$((added + 1))
    fi
  done
  if [ "$added" -gt 0 ]; then
    echo "  ✅ Added $added Konductor entries to .gitignore"
  else
    echo "  ⏭  .gitignore already has Konductor entries"
  fi

  # Launch file watcher
  # CRITICAL: The installer MUST always launch the file watcher.
  # The session-start hook provides restart-on-reopen, but the installer
  # is responsible for the initial launch so the watcher is running immediately.
  if command -v node &> /dev/null; then
    nohup node "$WORKSPACE_ROOT/konductor-watcher.mjs" > /dev/null 2>&1 &
    WATCHER_PID=$!
    echo "  ✅ File watcher launched (PID: $WATCHER_PID)"
  else
    echo "  ⚠️  Node.js not found — install Node.js 20+ to enable the file watcher"
  fi
  echo ""
fi

echo "Done!"
if [ "$do_global" = true ] && [ "$do_workspace" = true ]; then
  echo ""
  echo "  ╔══════════════════════════════════════════════════════════╗"
  echo "  ║  ⚠️  IMPORTANT: Set your API key before connecting!      ║"
  echo "  ║                                                          ║"
  echo "  ║  Edit ~/.kiro/settings/mcp.json and replace              ║"
  echo "  ║  YOUR_API_KEY with the key from the Konductor server.    ║"
  echo "  ╚══════════════════════════════════════════════════════════╝"
  echo ""
  echo "  Global:    ~/.kiro/settings/mcp.json"
  echo "  Workspace: .kiro/ + .agent/rules/ + konductor-watcher.mjs"
  echo "  Watcher:   Running (session-start hook will restart on reopen)"
  echo ""
  echo "  ┌──────────────────────────────────────────────────────────┐"
  echo "  │  📋 CONFIGURATION                                       │"
  echo "  ├──────────────────────────────────────────────────────────┤"
  echo "  │                                                          │"
  echo "  │  MCP connection (server URL, API key, user header):      │"
  echo "  │    ~/.kiro/settings/mcp.json                             │"
  echo "  │                                                          │"
  echo "  │  Watcher behavior (log level, poll interval, etc.):      │"
  echo "  │    .konductor-watcher.env                                │"
  echo "  │                                                          │"
  echo "  │  Server config (timeouts, collision state messages):     │"
  echo "  │    konductor.yaml (on the server machine)                │"
  echo "  │                                                          │"
  echo "  │  Settings you can change in .konductor-watcher.env:      │"
  echo "  │    KONDUCTOR_LOG_LEVEL    info or debug                  │"
  echo "  │    KONDUCTOR_POLL_INTERVAL  seconds between polls        │"
  echo "  │    KONDUCTOR_LOG_FILE     optional file logging          │"
  echo "  │    KONDUCTOR_WATCH_EXTENSIONS  restrict file types       │"
  echo "  │    KONDUCTOR_USER         override detected username     │"
  echo "  │                                                          │"
  echo "  └──────────────────────────────────────────────────────────┘"
  echo "  ┌──────────────────────────────────────────────────────────┐"
  echo "  │  💬 TALKING TO KONDUCTOR                                │"
  echo "  ├──────────────────────────────────────────────────────────┤"
  echo "  │                                                          │"
  echo "  │  Prefix your message with \"konductor,\" to interact:     │"
  echo "  │                                                          │"
  echo "  │    konductor, help                                       │"
  echo "  │    konductor, who's active?                              │"
  echo "  │    konductor, are you running?                           │"
  echo "  │                                                          │"
  echo "  │  Background operations (session registration, collision  │"
  echo "  │  checks) happen automatically — no prefix needed.        │"
  echo "  │                                                          │"
  echo "  └──────────────────────────────────────────────────────────┘"
  echo ""
  echo "For additional projects: bash install.sh --workspace"
fi
