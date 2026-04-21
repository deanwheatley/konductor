#!/usr/bin/env bash
# Start the Konductor MCP Server (SSE mode)
# Usage: ./start-konductor.sh [--build] [--http]
#
# Options:
#   --build   Run TypeScript build before starting
#   --http    Force HTTP even if TLS certs exist

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
KONDUCTOR_DIR="$SCRIPT_DIR/konductor"

# Parse flags
BUILD=false
FORCE_HTTP=false
for arg in "$@"; do
  case "$arg" in
    --build) BUILD=true ;;
    --http)  FORCE_HTTP=true ;;
    *)       echo "Unknown option: $arg"; echo "Usage: $0 [--build] [--http]"; exit 1 ;;
  esac
done

# Check Node.js version
NODE_VERSION=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)
if [ -z "$NODE_VERSION" ] || [ "$NODE_VERSION" -lt 20 ]; then
  echo "❌ Node.js 20+ required (found: $(node -v 2>/dev/null || echo 'none'))"
  exit 1
fi

# Install deps if needed
if [ ! -d "$KONDUCTOR_DIR/node_modules" ]; then
  echo "📦 Installing dependencies..."
  npm install --prefix "$KONDUCTOR_DIR"
fi

# Build if requested or if dist is missing
if [ "$BUILD" = true ] || [ ! -f "$KONDUCTOR_DIR/dist/index.js" ]; then
  echo "🔨 Building TypeScript..."
  npm run build --prefix "$KONDUCTOR_DIR"
fi

# Export HTTP override if requested
if [ "$FORCE_HTTP" = true ]; then
  export KONDUCTOR_PROTOCOL=http
fi

# Show config summary
source "$KONDUCTOR_DIR/.env.local" 2>/dev/null || true
PORT="${KONDUCTOR_PORT:-3010}"
PROTO="https"
if [ "$FORCE_HTTP" = true ] || [ ! -f "$KONDUCTOR_DIR/certs/key.pem" ]; then
  PROTO="http"
fi

echo ""
echo "🚀 Starting Konductor MCP Server"
echo "   Transport: SSE"
echo "   URL:       $PROTO://localhost:$PORT"
echo "   Health:    $PROTO://localhost:$PORT/health"
echo "   Admin:     $PROTO://localhost:$PORT/admin"
echo "   Login:     $PROTO://localhost:$PORT/login"
if [ -n "${KONDUCTOR_API_KEY:-}" ]; then
  echo "   API Key:   ${KONDUCTOR_API_KEY:0:6}..."
fi

# Show Baton dashboard links for repos with persisted sessions
SESSIONS_FILE="$KONDUCTOR_DIR/sessions.json"
if [ -f "$SESSIONS_FILE" ]; then
  # Extract unique repo names (the part after the slash in owner/repo)
  REPOS=$(node -e "
    const s = require('$SESSIONS_FILE');
    const names = [...new Set(s.map(x => x.repo.split('/').pop()))];
    names.sort();
    names.forEach(n => console.log(n));
  " 2>/dev/null)
  if [ -n "$REPOS" ]; then
    echo ""
    echo "📊 Baton dashboards:"
    while IFS= read -r repo; do
      echo "   $PROTO://localhost:$PORT/repo/$repo"
    done <<< "$REPOS"
  fi
fi

# Show client install command
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "YOUR_IP")
API_KEY_FLAG=""
if [ -n "${KONDUCTOR_API_KEY:-}" ]; then
  API_KEY_FLAG=" --api-key ${KONDUCTOR_API_KEY}"
fi
echo ""
echo "📋 Client install (run from any project directory):"
echo ""
if [ "$PROTO" = "https" ]; then
  echo "   Local:   npm config set strict-ssl false && npx $PROTO://localhost:$PORT/bundle/installer.tgz --server $PROTO://localhost:$PORT$API_KEY_FLAG; npm config set strict-ssl true"
  if [ "$LAN_IP" != "YOUR_IP" ]; then
    echo "   Remote:  npm config set strict-ssl false && npx $PROTO://$LAN_IP:$PORT/bundle/installer.tgz --server $PROTO://$LAN_IP:$PORT$API_KEY_FLAG; npm config set strict-ssl true"
  fi
else
  echo "   Local:   npx $PROTO://localhost:$PORT/bundle/installer.tgz --server $PROTO://localhost:$PORT$API_KEY_FLAG"
  if [ "$LAN_IP" != "YOUR_IP" ]; then
    echo "   Remote:  npx $PROTO://$LAN_IP:$PORT/bundle/installer.tgz --server $PROTO://$LAN_IP:$PORT$API_KEY_FLAG"
  fi
fi

echo ""

# Start the server from the konductor directory (so .env.local and konductor.yaml are found)
cd "$KONDUCTOR_DIR"
exec node dist/index.js
