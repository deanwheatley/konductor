# Implementation Plan

- [x] 1. Scaffold the `konductor-setup` npm package
  - Create `konductor-setup/` directory at the repo root with `package.json` (name: `konductor-setup`, version: `0.1.0`, type: `module`, bin entry, engines: `>=20.0.0`, zero dependencies)
  - Create `konductor-setup/bin/setup.mjs` with shebang, CLI arg parsing (`--global`, `--workspace`, `--server`, `--api-key`, `--check-update`, `--version`, `--help`), and stub calls to lib modules
  - Create stub files: `lib/installer.mjs`, `lib/bundle-fetcher.mjs`, `lib/workspace.mjs`, `lib/platform.mjs`
  - Copy the current `konductor_bundle/` contents into `konductor-setup/bundle/` as the embedded fallback
  - Verify `node bin/setup.mjs --help` prints usage and `--version` prints `0.1.0`
  - _Requirements: 1.1, 8.1, 8.4_

- [x] 2. Implement workspace utilities (`lib/workspace.mjs`)
  - [x] 2.1 Implement workspace root detection
    - Implement `detectWorkspaceRoot()` — walk up from `process.cwd()` looking for `.git` or `.kiro`, matching current `install.sh` behavior
    - _Requirements: 1.4_
  - [x] 2.2 Implement .gitignore management
    - Implement `updateGitignore(workspaceRoot)` — add Konductor runtime artifacts (`konductor-watcher.mjs`, `konductor-watcher-launcher.sh`, `konductor-watchdog.sh`, `.konductor-watcher.env`, `.konductor-watcher.log`, `.konductor-watchdog.pid`, `.konductor-version`) if not already present, with `# Konductor` header
    - _Requirements: 5.3_
  - [x] 2.3 Write unit tests for workspace utilities
    - Test workspace root detection with `.git` directory, `.kiro` directory, and fallback to cwd
    - Test .gitignore creation when file doesn't exist
    - Test .gitignore idempotency (running twice doesn't duplicate entries)
    - Test .gitignore preserves existing content
    - _Requirements: 1.4, 5.3_

- [x] 3. Implement platform utilities (`lib/platform.mjs`)
  - [x] 3.1 Implement watcher lifecycle
    - Implement `killExistingWatcher()` — `pkill -f "node.*konductor-watcher.mjs"` on macOS/Linux, `taskkill` equivalent on Windows; also kill watchdog process and clean up `.konductor-watchdog.pid`
    - Implement `launchWatcher(workspaceRoot)` — `spawn('node', ['konductor-watcher.mjs'], { cwd, detached: true, stdio: 'ignore' })` with `.unref()`, matching the invariant in `konductor-installer-invariants.md`
    - _Requirements: 5.1, 8.3_
  - [x] 3.2 Write unit tests for platform utilities
    - Mock `child_process.spawn`, verify detached + stdio:'ignore' + unref on all platforms
    - Mock `child_process.execSync`, verify correct kill command per platform
    - _Requirements: 5.1, 8.2, 8.3_

- [x] 4. Implement bundle fetcher (`lib/bundle-fetcher.mjs`)
  - [x] 4.1 Implement server fetch with embedded fallback
    - Implement `fetchBundle(serverUrl)` — fetch `GET ${serverUrl}/bundle/manifest.json` with 5s timeout, download each file to temp dir, fall back to `../bundle/` on any failure
    - Use only `node:http`/`node:https` (no dependencies)
    - Return `{ source, version, bundleDir }` — source is `"server"` or `"embedded"`
    - _Requirements: 2.1, 2.2, 2.3, 2.5_
  - [x] 4.2 Write unit tests for bundle fetcher
    - Mock HTTP responses: successful manifest + files → returns server source
    - Mock HTTP timeout → falls back to embedded, prints warning
    - Mock partial failure (manifest OK, file download fails) → falls back to embedded for all files
    - Mock non-200 status → falls back to embedded
    - Verify embedded fallback reads from correct `../bundle/` path
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 5. Checkpoint
  - Run all tests, verify the three lib modules work independently. Ask the user if questions arise.

- [x] 6. Implement core installer (`lib/installer.mjs`)
  - [x] 6.1 Implement global setup
    - Implement `installGlobal(bundleDir, apiKey?)` — MCP config merge/create in `~/.kiro/settings/mcp.json` (preserve existing non-placeholder API keys, write provided key or placeholder), global steering rule to `~/.kiro/steering/`, global agent rule to `~/.gemini/`
    - Clean previous global install artifacts before deploying (matching `install.sh` cleanup)
    - Detect username for `X-Konductor-User` header using priority chain: `gh api user --jq .login` → `git config user.name` → hostname
    - _Requirements: 1.1, 1.3, 3.1, 3.2, 3.3_
  - [x] 6.2 Implement workspace setup
    - Implement `installWorkspace(bundleDir, workspaceRoot, version)` — clean previous install, deploy steering rules to `.kiro/steering/`, hooks to `.kiro/hooks/`, agent rules to `.agent/rules/`, watcher + launcher + watchdog to workspace root, create `.konductor-watcher.env` if missing (preserve if exists), update `.gitignore`, write `.konductor-version`, launch watcher
    - File list and destinations must exactly match current `install.sh` behavior
    - _Requirements: 1.1, 5.1, 5.2, 5.3, 5.4, 5.5_
  - [x] 6.3 Implement auto-mode detection
    - Implement `detectMode()` — read `~/.kiro/settings/mcp.json`, check for `mcpServers.konductor` entry. If present, return `"workspace"`. If absent, return `"both"`.
    - _Requirements: 4.1, 4.2_
  - [x] 6.4 Implement `--check-update` flow
    - Implement `checkUpdate(serverUrl, workspaceRoot)` — read `.konductor-version` from workspace, fetch manifest from server, compare versions, print result
    - _Requirements: 6.1, 6.2, 6.3_
  - [x] 6.5 Write property test: API key preservation
    - **Property 3: API key handling preserves existing non-placeholder keys**
    - **Validates: Requirements 3.3**
    - Generate random existing MCP configs with non-placeholder API keys, run global setup without `--api-key`, verify key unchanged
  - [x] 6.6 Write property test: Auto-mode detection
    - **Property 4: Auto-mode correctly detects global config presence**
    - **Validates: Requirements 4.1, 4.2**
    - Generate random MCP configs (some with konductor entry, some without), verify correct mode returned
  - [x] 6.7 Write property test: Env file preservation
    - **Property 5: Env file preservation**
    - **Validates: Requirements 5.2**
    - Generate random `.konductor-watcher.env` contents, run workspace setup, verify file unchanged
  - [x] 6.8 Write unit tests for installer
    - Test global setup creates MCP config from scratch
    - Test global setup merges into existing MCP config
    - Test workspace setup deploys all expected files
    - Test workspace setup cleans previous install before deploying
    - Test workspace setup preserves `.konductor-watcher.env`
    - Test `.konductor-version` file is written with correct version
    - Test auto-mode with existing global config → workspace only
    - Test auto-mode without global config → both
    - _Requirements: 1.1, 1.2, 1.3, 3.1, 3.2, 4.1, 5.1, 5.2, 5.4, 5.5_

- [x] 7. Wire up CLI entry point (`bin/setup.mjs`)
  - Connect CLI arg parsing to `installer.mjs`, `bundle-fetcher.mjs`, `workspace.mjs`, `platform.mjs`
  - Implement the orchestration flow: parse args → detect workspace root → fetch bundle → determine mode → run install → print summary
  - Handle `--version` (print package version), `--check-update` (compare versions), `--help` (print usage)
  - Print summary on completion with installed locations and API key reminder
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 6.1_

- [x] 8. Checkpoint
  - Run all `konductor-setup` tests. Manually test `node bin/setup.mjs --workspace` in a temp directory and verify all files are deployed correctly. Ask the user if questions arise.

- [x] 9. Add server bundle endpoints
  - [x] 9.1 Implement bundle manifest and file serving
    - In `konductor/src/index.ts`, add `GET /bundle/manifest.json` route — build manifest at startup by walking `konductor_bundle/` recursively, cache the result, serve as JSON. No auth required.
    - Add `GET /bundle/files/:path` route — serve files from `konductor_bundle/`, reject path traversal (`..`), return 404 for missing files. No auth required.
    - Both routes go before the auth check in `startSseServer()` so they bypass API key validation
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
  - [x] 9.2 Write unit tests for bundle endpoints
    - Test `GET /bundle/manifest.json` returns valid JSON with `version` and `files` array
    - Test `GET /bundle/files/<valid-path>` returns file content with correct content-type
    - Test `GET /bundle/files/<nonexistent>` returns 404
    - Test `GET /bundle/files/../../etc/passwd` returns 400
    - Test bundle endpoints work without `Authorization` header
    - **Property 7: Bundle manifest lists all deployable files**
    - **Validates: Requirements 7.1, 7.2, 7.3**
    - **Property 8: Bundle endpoints reject path traversal**
    - **Validates: Requirements 7.5**
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 10. Add client version checking to the server
  - [x] 10.1 Implement version comparison logic
    - Add a `compareVersions(clientVersion, serverVersion)` utility — simple semver major.minor.patch comparison, returns `"outdated" | "current" | "newer"`
    - Read `X-Konductor-Client-Version` header on `POST /api/register` and `POST /api/status` — if outdated or missing, append `updateRequired: true` and `serverVersion` to response JSON
    - Accept optional `clientVersion` field in `register_session` and `check_status` MCP tool inputs — same logic, append to tool response
    - _Requirements: 9.1, 9.2, 9.3, 9.7_
  - [x] 10.2 Write tests for version checking
    - **Property 9: Version comparison triggers update correctly**
    - **Validates: Requirements 9.1, 9.2, 9.3**
    - Test REST `/api/register` with old version header → response includes `updateRequired: true`
    - Test REST `/api/register` with current version → no `updateRequired` in response
    - Test REST `/api/register` with no version header → `updateRequired: true`
    - Test MCP `register_session` with `clientVersion` field → same behavior
    - Test malformed version string → treated as outdated
    - _Requirements: 9.1, 9.2, 9.3, 9.7_

- [x] 11. Update the file watcher to report client version
  - Update `konductor-watcher.mjs` to read `.konductor-version` from workspace root at startup
  - Send `X-Konductor-Client-Version` header on all REST API calls (`/api/register`, `/api/status`)
  - If server responds with `updateRequired: true`, log a warning: `⚠️ Client outdated (v<current> → v<server>). Update will happen on next IDE session start.`
  - Update the embedded copy in `konductor-setup/bundle/` to match
  - _Requirements: 9.7_

- [x] 12. Checkpoint
  - Run all server tests (`vitest --run` in `konductor/`). Run all installer tests. Verify bundle endpoints return correct data. Ask the user if questions arise.

- [x] 13. Update steering rules
  - [x] 13.1 Update the setup command section
    - In `konductor-collision-awareness.md` (both global `steering/` and bundle copies), replace `bash konductor_bundle/install.sh` with `npx konductor-setup`. Add instructions for the agent to pass `--server` and `--api-key` when known from context.
    - _Requirements: 10.1, 10.2, 10.3_
  - [x] 13.2 Add auto-update logic to the automatic registration section
    - Add to the steering rule: after `register_session`, if response contains `updateRequired: true`, run `npx konductor-setup@latest --workspace --server <url>`. On success print `🔄 Konductor: Client updated to v<version>.` and re-register. On failure print warning. Only attempt once per session.
    - _Requirements: 9.4, 9.5, 9.6_

- [x] 14. Update documentation
  - Update `konductor/README.md` — add "Installation" section documenting `npx konductor-setup`, CLI flags, multi-project workflow, and auto-update behavior. Update architecture section to mention bundle endpoints.
  - Update `konductor/konductor_bundle/README.md` — note that the bundle is now served by the server and installed via npx, keep manual install instructions as fallback reference
  - Update `konductor/CHANGELOG.md` with a dated entry for the npx installer feature
  - _Requirements: 1.5, 6.1, 7.1_

- [x] 15. Final Checkpoint
  - Run all tests across both packages. Manually test the full flow: start server → `npx konductor-setup --server http://localhost:3010 --workspace` in a temp directory → verify files deployed → verify watcher running → verify `.konductor-version` written → verify `--check-update` reports current. Ask the user if questions arise.
