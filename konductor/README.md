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

## Setup and Installation

### Prerequisites

- Node.js 20 or later
- npm
- Kiro IDE (for MCP integration) or any MCP-compatible client

### Step 1: Clone the repository

```bash
git clone https://github.com/deanwheatley/konductor.git
cd konductor/konductor
```

### Step 2: Install dependencies

```bash
npm install
```

### Step 3: Build the project

```bash
npm run build
```

This compiles TypeScript to JavaScript in the `dist/` directory.

### Step 4: Verify the build (optional)

Run the test suite to make sure everything is working:

```bash
npm test
```

You should see all 50 tests pass.

## Running the Konductor

### Option A: Local mode (stdio) — single user

This is the simplest setup. The Konductor runs as a child process managed by your MCP client (e.g. Kiro). You don't need to start it manually — just configure it and your client launches it on demand.

Skip to [Connecting to Kiro](#connecting-to-kiro) below.

### Option B: Shared mode (SSE) — multi-user on a network

Run the Konductor as a standalone HTTP server so multiple teammates can connect.

First, configure your environment. Copy the example env file and set your API key:

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```bash
KONDUCTOR_PORT=3010
KONDUCTOR_API_KEY=konductor
```

Then start the server:

```bash
node dist/index.js --sse
```

The server reads `.env.local` automatically — no need to pass env vars on the command line. You should see:

```
Konductor SSE server listening on port 3010
```

You can also override values from the command line (CLI env vars take precedence over `.env.local`):

```bash
KONDUCTOR_PORT=4000 node dist/index.js --sse
```

Verify it's running:

```bash
curl -H "Authorization: Bearer konductor" http://localhost:3010/health
# → {"status":"ok"}
```

Leave this running in a terminal (or use a process manager like `pm2`). Teammates connect their MCP clients to this instance.

## Connecting to Kiro

### For local mode (stdio)

1. Open your Kiro workspace
2. Create or edit the file `.kiro/settings/mcp.json` in your workspace root
3. Add the following configuration (adjust the path to where you cloned the repo):

```json
{
  "mcpServers": {
    "konductor": {
      "command": "node",
      "args": ["/absolute/path/to/konductor/konductor/dist/index.js"],
      "autoApprove": ["register_session", "check_status", "deregister_session", "list_sessions"]
    }
  }
}
```

4. Kiro will detect the config change and connect to the Konductor automatically. You can verify by opening the MCP Servers panel in Kiro — you should see "konductor" listed as connected.

### For shared mode (SSE)

1. Make sure the Konductor SSE server is running (see Option B above)
2. Create or edit `.kiro/settings/mcp.json` in your workspace root

**Connecting from the same machine:**

```json
{
  "mcpServers": {
    "konductor": {
      "url": "http://localhost:3010/sse",
      "headers": {
        "Authorization": "Bearer kd-a7f3b9c2e1d4"
      },
      "autoApprove": ["register_session", "check_status", "deregister_session", "list_sessions"]
    }
  }
}
```

**Connecting from another machine on the network:**

Use the hostname or IP of the machine running the server. For example, if the server is running on `LT-DWHEATLEY-2.local` (IP `192.168.68.74`):

```json
{
  "mcpServers": {
    "konductor": {
      "url": "http://LT-DWHEATLEY-2.local:3010/sse",
      "headers": {
        "Authorization": "Bearer kd-a7f3b9c2e1d4"
      },
      "autoApprove": ["register_session", "check_status", "deregister_session", "list_sessions"]
    }
  }
}
```

Or using the IP directly:

```json
{
  "mcpServers": {
    "konductor": {
      "url": "http://192.168.68.74:3010/sse",
      "headers": {
        "Authorization": "Bearer kd-a7f3b9c2e1d4"
      },
      "autoApprove": ["register_session", "check_status", "deregister_session", "list_sessions"]
    }
  }
}
```

3. Replace the API key with whatever you set in `.env.local` on the server machine.

## Getting Started Using the Konductor MCP Server

The Konductor ships with a client bundle (`konductor/konductor_bundle/`) that handles setup. There's a one-time global step for the MCP connection, then a quick per-project install for the steering rule and hook.

### First time setup (once per machine)

macOS / Linux:

```bash
bash /path/to/konductor/konductor_bundle/install.sh --global
```

Windows (PowerShell):

```powershell
.\install.ps1 -Global
```

This installs the MCP config to `~/.kiro/settings/mcp.json` so every Kiro workspace can talk to the Konductor. Edit the file to set your server URL and API key.

### Per-project setup (once per workspace)

macOS / Linux:

```bash
bash /path/to/konductor/konductor_bundle/install.sh --workspace
```

Windows (PowerShell):

```powershell
.\install.ps1 -Workspace
```

This copies two files into `.kiro/` and two files into the project root:

| File | Purpose |
|------|---------|
| `.kiro/steering/konductor-collision-awareness.md` | Agent auto-registers sessions and warns on collisions |
| `.kiro/hooks/konductor-file-save.hook.md` | Registers sessions when you save files during active chat |
| `konductor-watcher.sh` | Background file watcher with color-coded collision notifications |
| `.konductor-watcher.env` | Watcher configuration (server URL, API key, log level, poll interval) |

Or do both steps at once (first time in a new project):

macOS / Linux:

```bash
bash /path/to/konductor/konductor_bundle/install.sh
```

Windows (PowerShell):

```powershell
.\install.ps1
```

### Start the file watcher

After install, open a terminal in your project and run:

```bash
./konductor-watcher.sh
```

Leave it running alongside your editor. It watches for file changes, registers them with the Konductor, and polls for collision state changes from other users. Notifications are color-coded by severity — green for safe, yellow for caution, orange for warning, red for critical.

Edit `.konductor-watcher.env` to set your API key and adjust settings:

```env
KONDUCTOR_URL=http://localhost:3010
KONDUCTOR_API_KEY=your-api-key
KONDUCTOR_LOG_LEVEL=info        # info = notifications only, debug = all API traffic
KONDUCTOR_POLL_INTERVAL=10      # seconds between collision polls
```

### How it works

Three layers cover all editing scenarios:

| Layer | Covers | How |
|-------|--------|-----|
| Steering rule | Agent-driven file changes | Agent auto-registers before modifying files |
| File save hook | Editor saves during active chat | Hook triggers agent to register on save |
| File watcher | All file changes (no agent needed) | Watches filesystem + polls server for collisions |

You'll see short notifications in chat:

```
🟢 Konductor: Registered session on acme/app#main (3 files)
🟠 Konductor: Warning — bob is modifying the same files: src/index.ts. Proceed?
✅ Konductor: Session closed.
```

The agent only pauses to ask for confirmation at Collision Course or Merge Hell. Everything else proceeds automatically.

See `konductor/konductor_bundle/README.md` for the full bundle documentation.

## Using the Konductor

Once connected, you can invoke the tools from Kiro's chat or let steering rules call them automatically.

### Try it out manually

Ask Kiro in chat:

> "Register a session for user alice on repo acme/app, branch main, files src/index.ts and src/utils.ts"

Kiro will call `register_session` and return the collision state (likely "Solo" if you're the only one).

Then simulate a second user:

> "Register a session for user bob on repo acme/app, branch main, files src/index.ts"

Now check status:

> "Check the collision status for alice on repo acme/app"

You should see "Collision Course" since both alice and bob are touching `src/index.ts`.

### Quick reference

| What you want to do | Tool to call |
|---|---|
| Start tracking your work | `register_session` |
| See if anyone overlaps with you | `check_status` |
| Stop tracking when you're done | `deregister_session` |
| See who's active in a repo | `list_sessions` |

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
# Using .env.local (recommended)
node dist/index.js --sse

# Or with inline env vars
KONDUCTOR_PORT=3010 KONDUCTOR_API_KEY=my-team-secret node dist/index.js --sse
```

| Env Variable | Default | Description |
|---|---|---|
| `KONDUCTOR_PORT` | `3010` | Port for the SSE HTTP server |
| `KONDUCTOR_API_KEY` | *(none)* | Shared API key for `Authorization: Bearer` auth. If unset, auth is disabled. |

SSE endpoints:
- `GET /sse` — establish SSE connection
- `POST /messages?sessionId=<id>` — send MCP messages
- `GET /health` — health check

REST API endpoints (for file watchers and scripts):
- `POST /api/register` — register or update a session (body: `{userId, repo, branch, files}`)
- `POST /api/status` — check collision state (body: `{userId, repo}`, optional `files`)

## Environment Variables

Environment variables can be set in a `.env.local` file in the `konductor/` directory, or passed on the command line. CLI env vars take precedence over `.env.local`.

Copy the example to get started:

```bash
cp .env.local.example .env.local
```

| Variable | Default | Description |
|----------|---------|-------------|
| `KONDUCTOR_PORT` | `3010` | Port for SSE HTTP server. Setting this also enables SSE mode. |
| `KONDUCTOR_API_KEY` | *(none)* | Shared API key for SSE `Authorization: Bearer` auth. If unset, auth is disabled. |
| `KONDUCTOR_CONFIG` | `./konductor.yaml` | Path to the YAML configuration file. |
| `VERBOSE_LOGGING` | `false` | Set to `true` to enable structured verbose logging of all server events. |
| `LOG_TO_TERMINAL` | `false` | Set to `true` to write log entries to stderr. Requires `VERBOSE_LOGGING=true`. |
| `LOG_TO_FILE` | `false` | Set to `true` to append log entries to a file. Requires `VERBOSE_LOGGING=true`. |
| `LOG_FILENAME` | `konductor.log` | File path for log output when `LOG_TO_FILE=true`. |
| `KONDUCTOR_LOG_LEVEL` | `info` | Watcher log level: `info` for color-coded notifications, `debug` for all API traffic. |
| `KONDUCTOR_POLL_INTERVAL` | `10` | Seconds between collision state polls in the file watcher. |
| `KONDUCTOR_LOG_FILE` | *(none)* | Optional file path for watcher log output (in addition to terminal). |
| `KONDUCTOR_WATCH_EXTENSIONS` | `ts,tsx,js,...` | Comma-separated file extensions the watcher monitors. |

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
