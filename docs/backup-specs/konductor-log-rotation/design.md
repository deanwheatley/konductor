# Design: Log Rotation

## Overview

Adds configurable log rotation to both the Konductor MCP server and the client file watcher to prevent unbounded log file growth. The rotation uses a simple three-file scheme: current → backup → tobedeleted.

## Architecture

### Rotation Strategy

Both server and client use the same rotation algorithm:

1. Before each log write, check the current file size
2. If size >= `maxFileSize`:
   - Delete `<name>.tobedeleted` if it exists
   - Rename `<name>.backup` → `<name>.tobedeleted`
   - Rename `<name>` → `<name>.backup`
3. Write to the (now empty) `<name>`

This keeps at most 3 files on disk (current + backup + tobedeleted) and caps total disk usage at ~3× the max size.

### Server-Side (KonductorLogger)

Already implemented in `logger.ts`:
- `rotateIfNeeded()` method called before each `appendFileSync`
- `parseFileSize()` parses human-readable sizes ("10MB", "500KB", "1GB")
- `maxFileSize` configurable via `LoggerOptions` or `KONDUCTOR_LOG_MAX_SIZE` env var
- Default: 10MB

### Client-Side (konductor-watcher.mjs)

Needs implementation:
- Add `rotateIfNeeded(filePath, maxSize)` function
- Call it before each `appendFileSync` in the `log()` function
- Read `KONDUCTOR_LOG_MAX_SIZE` from `.konductor-watcher.env`
- Default: 10MB
- Reuse the same `parseFileSize` logic as the server

### Admin Page Integration (Future — konductor-admin)

The admin dashboard (Requirement 2 of konductor-admin spec) will expose `KONDUCTOR_LOG_MAX_SIZE` as a system setting. When modified via the admin page:
- The value is persisted in the settings store
- The logger picks up the new value on next write (hot-reload)
- Environment variable takes precedence over admin-configured value

This is tracked as a task dependency on the konductor-admin feature.

## Configuration

### Server (.env.local)

| Variable | Default | Description |
|----------|---------|-------------|
| `KONDUCTOR_LOG_MAX_SIZE` | `10MB` | Max log file size before rotation |

### Client (.konductor-watcher.env)

| Variable | Default | Description |
|----------|---------|-------------|
| `KONDUCTOR_LOG_MAX_SIZE` | `10MB` | Max watcher log file size before rotation |

### Size Format

Accepts: `<number>KB`, `<number>MB`, `<number>GB`, or plain `<number>` (bytes).
Case-insensitive. Examples: `10MB`, `500KB`, `1GB`, `5242880`.

## Correctness Properties

### Property 1: Rotation triggers at size limit
WHEN the log file size >= maxFileSize, THEN rotation SHALL occur before the next write.
Validates: Requirement 1, AC 1, 6

### Property 2: Three-file rotation chain
WHEN rotation occurs, THEN at most 3 log files exist (current, .backup, .tobedeleted).
Validates: Requirement 1, AC 2, 3, 4

### Property 3: No data loss during rotation
WHEN rotation occurs, THEN the backup file contains the previous log content and the current file is empty/fresh.
Validates: Requirement 1, AC 2

### Property 4: Default size is 10MB
WHEN KONDUCTOR_LOG_MAX_SIZE is not set, THEN the default max size SHALL be 10MB (10485760 bytes).
Validates: Requirement 1, AC 5

### Property 5: Size parsing correctness
WHEN a size string is parsed, THEN "10MB" = 10485760, "500KB" = 512000, "1GB" = 1073741824.
Validates: Requirement 1, AC 1

### Property 6: Client-server parity
The client watcher and server logger SHALL use identical rotation logic and configuration format.
Validates: Requirement 1, AC 1-6
