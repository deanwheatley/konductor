# Changelog

## 0.5.0 — 2026-04-20

### Added

- **Line-Level Collision Detection**: the collision evaluator now distinguishes between "same file, different sections" (Proximity) and "same file, same lines" (Collision Course) when line range data is available
- New `Proximity` collision state (severity 2.5): same file as another user but non-overlapping line ranges — does not pause the agent, does not trigger Slack at default verbosity
- File watcher reports modified line ranges via `git diff --unified=0` hunk headers alongside file paths
- Server accepts extended file format: `files` parameter supports `FileChange[]` objects with optional `lineRanges` in addition to plain `string[]`
- Merge severity assessment: `minimal` (1–5 lines), `moderate` (6–20 lines), `severe` (21+ lines or >50% overlap) — included in `risk_assessment` responses and Slack notifications
- Line-level context in collision messages: Collision Course and Merge Hell notifications include specific line ranges when available
- `line-range-utils.ts`: core helpers for range overlap detection, line counting, and severity computation
- `line-range-formatter.ts`: human-readable line range display and JSON round-trip serialization
- Property-based tests (fast-check) for overlap symmetry, severity thresholds, serialization round-trip, backward compatibility, Proximity state behavior, and mixed format normalization
- Steering rules updated with Proximity state handling and line-level collision message context
- README updated with line-level collision detection documentation

### Changed

- Collision states table now includes Proximity between Crossroads and Collision Course
- `CollisionEvaluator.evaluate()` checks line ranges before escalating to Collision Course
- `register_session` and `/api/register` accept mixed arrays of strings and `FileChange` objects
- `SummaryFormatter` and `SlackNotifier` include line range annotations when available
- `risk_assessment`, `who_overlaps`, and `repo_hotspots` query tools include line overlap context

## 0.4.0 — 2026-04-17

### Added

- **GitHub Integration**: passive collision detection from open PRs and recent commits
- `GitHubPoller`: polls GitHub API for open pull requests, creates PR-based passive sessions with changed files, draft/approved status, and target branch metadata
- `CommitPoller`: polls configured branches for recent commits within a lookback window, creates commit-based passive sessions grouped by author
- `DeduplicationFilter`: prevents self-collision, PR-supersedes-commits, and active-supersedes-passive redundancy
- Mixed session collision evaluation: `CollisionEvaluator` now considers active, PR, and commit sessions together with severity weighting (approved PR escalates, draft de-escalates)
- Source-attributed collision messages: `SummaryFormatter` generates per-source context lines (live session, PR, approved PR, draft PR, commits, mixed, Merge Hell)
- Enhanced query tools: `who_is_active`, `who_overlaps`, `repo_hotspots`, `coordination_advice`, `risk_assessment`, `active_branches`, `user_activity` all include passive session data with source attribution
- Baton dashboard: Open PRs table and Repo History table replace "Coming Soon" placeholders, with real-time SSE updates for PR/commit changes
- Baton notifications and health status include passive session collision context
- GitHub configuration in `konductor.yaml`: `token_env`, `poll_interval_seconds`, `include_drafts`, `commit_lookback_hours`, per-repo `commit_branches`
- Hot-reload support for GitHub config changes via `ConfigManager`
- `GITHUB` log category with structured logging for poll cycles, session lifecycle, and API errors
- Graceful degradation: GitHub API errors are logged and retried without disrupting active session tracking
- Property-based tests (fast-check) for source-agnostic overlap, PR lifecycle, self-collision suppression, severity monotonicity, source attribution, deduplication, graceful degradation, and Baton SSE events
- README updated with GitHub integration configuration, example YAML, and collision message examples

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
