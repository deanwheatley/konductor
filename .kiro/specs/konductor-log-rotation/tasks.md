# Tasks: Log Rotation

## Task 1: Add log rotation to client watcher [Implemented]

### Description
Add `parseFileSize()` and `rotateIfNeeded()` functions to `konductor-watcher.mjs`, read `KONDUCTOR_LOG_MAX_SIZE` from the watcher env config, and call rotation before each file write.

### Files to modify
- `konductor-watcher.mjs` — add rotation logic to the `log()` function

### Acceptance criteria
- Watcher rotates log files using the same three-file scheme as the server
- `KONDUCTOR_LOG_MAX_SIZE` is read from `.konductor-watcher.env`
- Default is 10MB when not configured
- Rotation is checked before each write, not on a timer

---

## Task 2: Add KONDUCTOR_LOG_MAX_SIZE to watcher env template [Implemented]

### Description
Add the `KONDUCTOR_LOG_MAX_SIZE` config option to `.konductor-watcher.env` (commented out with default) and document it in the startup banner.

### Files to modify
- `.konductor-watcher.env` — add commented config line
- `konductor-watcher.mjs` — show max size in startup banner

### Acceptance criteria
- Config option is visible in the env file with documentation
- Startup banner shows the configured max size

---

## Task 3: Add log rotation tests for server logger [Implemented]

### Description
Add unit tests for the `rotateIfNeeded()` method and `parseFileSize()` function in the server logger, covering the three-file rotation chain, size threshold, and edge cases.

### Files to modify
- `konductor/src/logger.test.ts` — add rotation-specific tests

### Acceptance criteria
- Tests verify rotation triggers at size limit
- Tests verify three-file chain (current → backup → tobedeleted)
- Tests verify `parseFileSize` handles KB, MB, GB, and plain bytes
- Tests verify default 10MB when env var is not set

---

## Task 4: Add KONDUCTOR_LOG_MAX_SIZE to server .env.local [Implemented]

### Description
Add the `KONDUCTOR_LOG_MAX_SIZE` option to the active `.env.local` file (it's already in `.env.local.example`).

### Files to modify
- `konductor/.env.local` — add config line

### Acceptance criteria
- Server .env.local has the log max size option documented

---

## Task 5: Update README with log rotation documentation [Implemented]

### Description
Add a Log Rotation section to the Konductor README documenting the configuration for both server and client.

### Files to modify
- `konductor/README.md` — add log rotation section

### Acceptance criteria
- README documents `KONDUCTOR_LOG_MAX_SIZE` for both server and client
- README explains the three-file rotation scheme
- README shows the size format (KB, MB, GB)

---

## Task 6: Admin page log rotation settings [Not Started — Depends on konductor-admin]

### Description
When the konductor-admin feature is implemented, expose `KONDUCTOR_LOG_MAX_SIZE` as a system setting in the System Settings panel. The admin-configured value should be persisted in the settings store and hot-reloadable, with environment variables taking precedence.

### Dependencies
- `konductor-admin` Requirement 2 (System Settings Panel)
- `konductor-admin` Requirement 9 (Settings Storage)

### Files to modify
- Admin page system settings panel (TBD — part of konductor-admin)
- `konductor/src/logger.ts` — add method to update maxFileSize at runtime

### Acceptance criteria
- Log max size is editable from the admin dashboard
- Changes apply without server restart
- Environment variable takes precedence over admin-configured value
- Setting is persisted in the settings store

---

## Task 7: Sync rotation logic to konductor_bundle [Implemented]

### Description
Ensure the `konductor-watcher.mjs` in the bundle directory matches the updated workspace watcher, and the `.konductor-watcher.env` template in the bundle includes the new config option.

### Files to modify
- `konductor/konductor_bundle/` — sync watcher and env template if they exist there

### Acceptance criteria
- Bundle watcher has the same rotation logic as the workspace watcher
- Bundle env template includes `KONDUCTOR_LOG_MAX_SIZE`
