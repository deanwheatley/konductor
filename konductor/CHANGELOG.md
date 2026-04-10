# Changelog

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
