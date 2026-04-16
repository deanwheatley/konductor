# Changelog

## 0.2.0 — 2026-04-15

### Added

- **npx installer** (`konductor-setup`): cross-platform Node.js installer invoked via `npx konductor-setup`, replacing the manual copy-and-run bundle workflow
- CLI flags: `--global`, `--workspace`, `--server`, `--api-key`, `--check-update`, `--version`, `--help`
- Smart auto-mode detection: skips global setup when MCP config already exists
- Server bundle endpoints: `GET /bundle/manifest.json` and `GET /bundle/files/:path` serve the client bundle without authentication
- Embedded fallback: installer uses bundled files when the server is unreachable
- Client version checking: server compares `X-Konductor-Client-Version` header and returns `updateRequired` flag when outdated
- Auto-update via steering rule: agent runs `npx konductor-setup@latest --workspace` when server signals an update is needed
- `.konductor-version` file written to workspace root for version tracking
- File watcher reports client version to server on REST API calls
- Steering rule updated to use `npx konductor-setup` instead of `bash install.sh`

### Changed

- Bundle README updated to recommend npx installer, shell scripts retained as fallback
- Architecture section in README updated to document bundle endpoints

## 0.1.0 — 2026-04-10

### Added

- Core MCP server with four tools: `register_session`, `check_status`, `deregister_session`, `list_sessions`
- Graduated collision state model: Solo → Neighbors → Crossroads → Collision Course → Merge Hell
- SessionManager with in-memory store, heartbeat tracking, and stale session cleanup
- CollisionEvaluator as a pure function computing collision state from session overlap
- SummaryFormatter with deterministic human-readable output and round-trip parsing
- ConfigManager with YAML loading, defaults merging, and hot-reload via `fs.watch`
- PersistenceStore with atomic JSON file writes and corrupted file recovery
- Dual transport: stdio (local) and SSE with API key authentication (remote)
- Configurable heartbeat timeout and per-state messages via `konductor.yaml`
- Property-based tests (fast-check) covering all 11 correctness properties
- Unit tests for all components
- README with quick start, configuration reference, MCP tool reference, architecture, and troubleshooting
