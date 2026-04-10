# Konductor MCP Server

A Work Coordination MCP Server that tracks concurrent development activity across GitHub repositories and evaluates collision risk using a graduated state model.

## What It Does

The Konductor solves "collision debt" — the accumulated cost of merge conflicts caused by uncoordinated concurrent development. Engineers (and their AI agents) register active work sessions, and the Konductor evaluates overlap in real time, surfacing collision risk before it becomes a problem.

### Collision States

| State | Severity | Meaning |
|-------|----------|---------|
| 🟢 Solo | 0 | You're the only one in this repo |
| 🟢 Neighbors | 1 | Others are in the repo but touching different files |
| 🟡 Crossroads | 2 | Others are working in the same directories |
| 🟠 Collision Course | 3 | Someone is modifying the same files as you |
| 🔴 Merge Hell | 4 | Divergent changes on the same files across branches |

## Quick Start

```bash
# Install
npm install konductor

# Run with stdio transport (local, single-user)
npx konductor

# Run with SSE transport (remote, multi-user)
KONDUCTOR_PORT=3100 KONDUCTOR_API_KEY=your-secret npx konductor --sse
```

### MCP Client Configuration (Kiro)

**Local (stdio)** — add to `.kiro/settings/mcp.json`:

```json
{
  "mcpServers": {
    "konductor": {
      "command": "npx",
      "args": ["konductor"],
      "autoApprove": ["register_session", "check_status", "deregister_session", "list_sessions"]
    }
  }
}
```

**Remote (SSE)** — connect to a shared Konductor instance:

```json
{
  "mcpServers": {
    "konductor": {
      "url": "http://your-host:3100/sse",
      "headers": {
        "Authorization": "Bearer your-secret"
      },
      "autoApprove": ["register_session", "check_status", "deregister_session", "list_sessions"]
    }
  }
}
```

## Configuration

The Konductor loads its configuration from a `konductor.yaml` file. If the file is missing, built-in defaults are used. The server watches the file for changes and hot-reloads automatically — no restart required.

### Config File Location

By default the Konductor looks for `konductor.yaml` in the current working directory. You can specify a custom path via the `KONDUCTOR_CONFIG` environment variable.

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `heartbeat_timeout_seconds` | number | `300` | Seconds before an idle session is considered stale |
| `states.<state>.message` | string | *(see below)* | Human-readable message shown for this collision state |
| `states.<state>.block_submissions` | boolean | `false` | *(Future)* Block code submissions at this state |

### Example `konductor.yaml`

```yaml
heartbeat_timeout_seconds: 300

states:
  solo:
    message: "You're the only one here. Go wild."
  neighbors:
    message: "Others are in this repo, but touching different files."
  crossroads:
    message: "Heads up — others are working in the same directories."
  collision_course:
    message: "Warning — someone is modifying the same files as you."
  merge_hell:
    message: "Critical — multiple divergent changes on the same files."
    block_submissions: false
```

### Default Messages

If a state is not configured, the Konductor uses these defaults:

- **Solo**: "You're the only one here. Go wild."
- **Neighbors**: "Others are in this repo, but touching different files."
- **Crossroads**: "Heads up — others are working in the same directories."
- **Collision Course**: "Warning — someone is modifying the same files as you."
- **Merge Hell**: "Critical — multiple divergent changes on the same files."

### Partial Configs

You only need to include the options you want to override. Missing fields are merged with defaults:

```yaml
# Only override the timeout — all state messages use defaults
heartbeat_timeout_seconds: 120
```

## MCP Tools

### `register_session`

Register or update a work session for a user in a repository. If a session already exists for the same user+repo, it is updated. Returns the current collision state.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `userId` | string | yes | User identifier |
| `repo` | string | yes | Repository in `owner/repo` format |
| `branch` | string | yes | Git branch name |
| `files` | string[] | yes | List of file paths being modified (non-empty) |

**Output:**

```json
{
  "sessionId": "uuid-v4",
  "collisionState": "solo",
  "summary": "[SOLO] repo:acme/app | user:alice"
}
```

**Example:**

```json
{
  "tool": "register_session",
  "arguments": {
    "userId": "alice",
    "repo": "acme/app",
    "branch": "main",
    "files": ["src/index.ts", "src/utils.ts"]
  }
}
```

### `check_status`

Check the current collision state for a user without modifying sessions. If `files` is omitted, uses the files from the user's existing session.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `userId` | string | yes | User identifier |
| `repo` | string | yes | Repository in `owner/repo` format |
| `files` | string[] | no | Optional file list override |

**Output:**

```json
{
  "collisionState": "neighbors",
  "overlappingSessions": [
    { "sessionId": "...", "userId": "bob", "branch": "main", "files": ["src/api.ts"] }
  ],
  "summary": "[NEIGHBORS] repo:acme/app | user:alice | overlaps:bob",
  "actions": [{ "type": "warn", "message": "Others are in this repo, but touching different files." }]
}
```

**Example:**

```json
{
  "tool": "check_status",
  "arguments": {
    "userId": "alice",
    "repo": "acme/app"
  }
}
```

### `deregister_session`

Remove a work session by its session ID.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `sessionId` | string | yes | The session ID to deregister |

**Output:**

```json
{
  "success": true,
  "message": "Session abc-123 deregistered."
}
```

**Example:**

```json
{
  "tool": "deregister_session",
  "arguments": {
    "sessionId": "abc-123-def-456"
  }
}
```

### `list_sessions`

List all active (non-stale) work sessions for a repository.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `repo` | string | yes | Repository in `owner/repo` format |

**Output:**

```json
{
  "sessions": [
    {
      "sessionId": "...",
      "userId": "alice",
      "repo": "acme/app",
      "branch": "main",
      "files": ["src/index.ts"],
      "createdAt": "2026-04-10T12:00:00.000Z",
      "lastHeartbeat": "2026-04-10T12:05:00.000Z"
    }
  ]
}
```

**Example:**

```json
{
  "tool": "list_sessions",
  "arguments": {
    "repo": "acme/app"
  }
}
```

## Architecture

```
Kiro Agent ──┐
             ├── stdio / SSE ──→ Konductor MCP Server
Other Agent ─┘                      ├── SessionManager
                                    ├── CollisionEvaluator
                                    ├── SummaryFormatter
                                    ├── ConfigManager
                                    └── PersistenceStore → sessions.json
```

### Components

- **SessionManager** — CRUD operations on work sessions, heartbeat tracking, stale cleanup
- **CollisionEvaluator** — Pure function that computes collision state from session overlap
- **SummaryFormatter** — Human-readable summaries with round-trip parseability
- **ConfigManager** — YAML config loading with hot-reload via `fs.watch`
- **PersistenceStore** — Atomic JSON file writes for session durability

## Persistence

The Konductor persists all active work sessions to a `sessions.json` file so that collision awareness survives server restarts.

### How It Works

- **Atomic writes**: Sessions are written to a temporary file first, then renamed over the target. This prevents corruption from crashes mid-write.
- **Validation on load**: On startup, the store reads `sessions.json`, validates each entry's structure, and discards any malformed sessions.
- **Corrupted file recovery**: If the file contains invalid JSON or invalid session entries, the store backs up the corrupted file to `sessions.json.backup` and continues with whatever valid sessions it could recover (or an empty set).
- **Missing file**: If `sessions.json` doesn't exist yet, the store starts with an empty session list.

### File Location

By default, `sessions.json` is written to the current working directory. The path is configurable when constructing the server.

## Transport Modes

### stdio (default)

Local single-user mode. The Konductor communicates over stdin/stdout using the MCP protocol. No authentication required.

```bash
npx konductor
```

### SSE (remote multi-user)

Starts an HTTP server with Server-Sent Events transport. Teammates on the same network can connect their agents to a shared Konductor instance.

```bash
KONDUCTOR_PORT=3100 KONDUCTOR_API_KEY=your-secret npx konductor --sse
```

| Env Variable | Default | Description |
|---|---|---|
| `KONDUCTOR_PORT` | `3100` | Port for the SSE HTTP server |
| `KONDUCTOR_API_KEY` | *(none)* | Shared API key for `Authorization: Bearer` auth. If unset, auth is disabled. |

SSE endpoints:
- `GET /sse` — establish SSE connection
- `POST /messages?sessionId=<id>` — send MCP messages
- `GET /health` — health check

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KONDUCTOR_PORT` | `3100` | Port for SSE HTTP server. Setting this also enables SSE mode. |
| `KONDUCTOR_API_KEY` | *(none)* | Shared API key for SSE `Authorization: Bearer` auth. If unset, auth is disabled. |
| `KONDUCTOR_CONFIG` | `./konductor.yaml` | Path to the YAML configuration file. |

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `Invalid repo format` error | Use `owner/repo` format (e.g. `acme/app`) |
| Session not found on deregister | Session may have been cleaned up as stale. Re-register. |
| SSE connection rejected with 401 | Check that `KONDUCTOR_API_KEY` matches between server and client |
| Config changes not picked up | Ensure `konductor.yaml` is in the working directory or set `KONDUCTOR_CONFIG` |
| Corrupted `sessions.json` | The server backs up the corrupted file and starts fresh. Check `sessions.json.backup`. |
| Empty file list rejected | `register_session` requires at least one file path |
| Stale sessions disappearing | Sessions without a heartbeat within the configured timeout are automatically cleaned up |

## License

MIT
