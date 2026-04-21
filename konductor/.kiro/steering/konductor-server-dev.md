---
inclusion: always
---

# Konductor Server Development

This workspace contains the Konductor MCP Server source code. The user is the server operator/developer, NOT a client.

## Context

- This is the server-side codebase — we build, test, and run the Konductor MCP server here
- The server entry point is `konductor/src/index.ts`, built to `konductor/dist/index.js`
- Config lives in `konductor/.env.local` (env vars) and `konductor/konductor.yaml` (collision states, GitHub integration)
- TLS certs are in `konductor/certs/` (generated via mkcert)
- The client installer package is in `konductor-setup/`
- The client bundle (steering rules, hooks, watcher) is in `konductor/konductor_bundle/`

## Starting the Server

Use the startup script in the project root:

```bash
./start-konductor.sh          # Start with existing build
./start-konductor.sh --build  # Rebuild TypeScript first
./start-konductor.sh --http   # Force HTTP (no TLS)
```

The server must be started from the project root. It runs from `konductor/` so `.env.local` and `konductor.yaml` are found automatically.

The server runs in SSE mode when `KONDUCTOR_PORT` is set (default: 3010). It also opens an HTTP fallback on port+1 (3011) when TLS is enabled, since Kiro's Electron runtime doesn't trust mkcert CAs.

## CRITICAL: After Rebuilding, You MUST Restart the Server

The server runs from compiled JS in `konductor/dist/`. If you rebuild (`npm run build`) but don't restart the node process, the old code is still running. Always kill and restart after a build:

```bash
pkill -f "node.*dist/index.js"; sleep 1; ./start-konductor.sh
```

## CRITICAL: Baton Dashboard URL Handling

The Baton page's client-side JavaScript MUST use relative URLs for all API calls (`/api/repo/...`, `/api/github/...`). Never use absolute URLs with a hardcoded hostname.

Why: The server constructs `serverUrl` from `os.hostname()` (e.g. `https://LT-DWHEATLEY-2.local:3010`), but users may browse via `localhost`, `127.0.0.1`, or a LAN IP. If the page JS uses the hostname-based URL, the browser treats it as a different origin or the TLS cert doesn't match, causing fetch/EventSource failures and a "Disconnected" banner.

The fix is in `baton-page-builder.ts` — `apiBase` is set to `/api/repo/${repoShort}` (relative), not `${serverUrl}/api/repo/${repoShort}` (absolute).

## CRITICAL: TLS and the Baton Dashboard "Disconnected" Issue

When TLS is enabled (certs in `konductor/certs/`), the HTTPS server runs on port 3010 and an HTTP fallback on port 3011.

Browsers that don't trust the mkcert CA will show the Baton page (after clicking through the cert warning) but the SSE EventSource connection silently fails — there's no cert warning prompt for EventSource. This causes the "Disconnected" banner even though the page loaded fine.

Solutions (pick one):
1. Install the mkcert CA into the browser/OS trust store: `mkcert -install` (recommended)
2. Use the HTTP fallback: browse to `http://localhost:3011/repo/<name>` instead
3. Force HTTP mode: set `KONDUCTOR_PROTOCOL=http` in `.env.local` or use `./start-konductor.sh --http`

When debugging "Disconnected" issues, always check:
1. Is the server actually running? (`curl -sk https://localhost:3010/health`)
2. Are relative URLs in the served HTML? (`curl -sk https://localhost:3010/repo/<name> | grep API_BASE`)
3. Is the browser trusting the TLS cert? (try `http://localhost:3011/repo/<name>` as a control)

## Build & Test

```bash
npm run build --prefix konductor     # TypeScript compile
npm test --prefix konductor          # Unit tests (vitest)
npm run test:e2e --prefix konductor  # Playwright e2e tests
npm run lint --prefix konductor      # Type check only
```

## Key Architecture

- `index.ts` — Entry point, MCP tool registration, SSE/HTTP server, Baton dashboard routes
- `session-manager.ts` — Session CRUD with persistence
- `collision-evaluator.ts` — Graduated collision state model (solo → merge_hell)
- `query-engine.ts` — Query tools (who_is_active, risk_assessment, etc.)
- `config-manager.ts` — YAML config with hot-reload and file watching
- `logger.ts` — Structured logging with actor labels
- `github-poller.ts` / `commit-poller.ts` — GitHub integration (passive sessions from PRs/commits)
- `baton-*.ts` — Baton web dashboard (repo pages, auth, notifications, SSE events)
- `persistence-store.ts` — JSON file persistence for sessions
- `konductor_bundle/` — Client-side artifacts served to clients via `/bundle/` endpoints

## Important Rules

- The file watcher (`konductor-watcher.mjs`) is a CLIENT-side component — do not start it in this workspace
- The `konductor-setup` package is NOT published to npm — clients install via `npx <serverUrl>/bundle/installer.tgz`
- Logger actor labels: `SYSTEM` for server internals, `Transport: <id>` for anonymous SSE, `User: <name>` for identified users
- Steering rules exist in 4 sync locations: `steering/`, `.agent/rules/`, `konductor/konductor_bundle/kiro/steering/`, `konductor/konductor_bundle/agent/rules/`
- When modifying server code, always check `.kiro/specs/konductor-npx-installer/requirements.md` for affected requirements

## Do NOT

- Do not run Konductor client tools (register_session, check_status, etc.) against this workspace
- Do not start the file watcher in this workspace
- Do not treat the collision awareness steering rules as applicable here — those are for client workspaces

## Keep In Sync

When any of the following change, you MUST also update `start-konductor.sh` in the project root:
- Server startup flow (ports, TLS, env vars, fallback behavior)
- Client install command format (npx URL, flags, strict-ssl workaround)
- `.env.local` options that affect how the server starts
- Baton dashboard URL patterns
- Bundle/installer endpoint paths
