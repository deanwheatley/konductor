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

## Installing Konductor (Client)

This is what you need to do to get Konductor running in your project. The installer is a single `npx` command — no cloning, no copying files, no bash scripts.

### Prerequisites

- Node.js 20 or later
- A running Konductor server (see [Running the Server](#running-the-konductor-server) below, or get the URL from your team)
- Kiro IDE, or any MCP-compatible client

### First-time setup (once per machine + project)

```bash
npx http://YOUR_SERVER:3010/bundle/installer.tgz --server http://YOUR_SERVER:3010 --api-key YOUR_API_KEY
```

That's it. This single command:
1. Creates `~/.kiro/settings/mcp.json` with your server URL and API key
2. Installs global steering rules and agent rules
3. Deploys workspace hooks, steering rules, and the file watcher into your current project
4. Launches the file watcher in the background
5. Adds Konductor artifacts to `.gitignore`

Replace `YOUR_SERVER` with the hostname/IP of the Konductor server and `YOUR_API_KEY` with the shared team key.

### Adding Konductor to another project

Just run the same command in any project directory:

```bash
npx http://YOUR_SERVER:3010/bundle/installer.tgz --server http://YOUR_SERVER:3010 --api-key YOUR_API_KEY
```

The installer detects existing global config and updates it with the correct server URL and key every time.

### Updating

The file watcher auto-updates when the server reports a newer version. You can also update manually by re-running the install command.

### All CLI flags

```
npx http://YOUR_SERVER:3010/bundle/installer.tgz [options]

Options:
  --server <url>        Konductor server URL (required)
  --api-key <key>       API key for authentication (recommended)
  --version             Print installed package version
  --help                Show help
```

### What gets installed

| Location | Files | Purpose |
|----------|-------|---------|
| `~/.kiro/settings/mcp.json` | MCP server config | Connects your IDE to the Konductor server |
| `~/.kiro/steering/` | Global steering rule | Agent collision awareness (all workspaces) |
| `.kiro/steering/` | Workspace steering rule | Agent collision awareness (this project) |
| `.kiro/hooks/` | File save + session start hooks | Triggers registration on file save |
| `.agent/rules/` | Agent rule | Collision awareness for Antigravity |
| Workspace root | `konductor-watcher.mjs`, launcher, watchdog | Background file watcher |
| Workspace root | `.konductor-watcher.env` | Watcher config (preserved on reinstall) |
| Workspace root | `.konductor-version` | Deployed version (used for auto-update) |

### Offline / no server available

If the server is unreachable during install, `npx` won't be able to fetch the installer tarball. Use the legacy install method below instead.

### Legacy install (manual fallback)

The shell-based installers (`install.sh` / `install.ps1`) in `konductor_bundle/` still work if you prefer. See `konductor/konductor_bundle/README.md`.

## Running the Konductor Server

This section is for whoever hosts the server. If someone on your team already runs it, you just need the URL and API key — skip to [Installing Konductor](#installing-konductor-client) above.

### Prerequisites

- Node.js 20 or later
- npm

### Clone and build

```bash
git clone https://github.com/deanwheatley/konductor.git
cd konductor/konductor
npm install
npm run build
```

### Verify the build (optional)

```bash
npm test
```

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
      "autoApprove": ["register_session", "check_status", "deregister_session", "list_sessions", "who_is_active", "who_overlaps", "user_activity", "risk_assessment", "repo_hotspots", "active_branches", "coordination_advice", "client_install_info", "client_update_check"]
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
      "autoApprove": ["register_session", "check_status", "deregister_session", "list_sessions", "who_is_active", "who_overlaps", "user_activity", "risk_assessment", "repo_hotspots", "active_branches", "coordination_advice", "client_install_info", "client_update_check"]
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
      "autoApprove": ["register_session", "check_status", "deregister_session", "list_sessions", "who_is_active", "who_overlaps", "user_activity", "risk_assessment", "repo_hotspots", "active_branches", "coordination_advice", "client_install_info", "client_update_check"]
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
      "autoApprove": ["register_session", "check_status", "deregister_session", "list_sessions", "who_is_active", "who_overlaps", "user_activity", "risk_assessment", "repo_hotspots", "active_branches", "coordination_advice", "client_install_info", "client_update_check"]
    }
  }
}
```

3. Replace the API key with whatever you set in `.env.local` on the server machine.

## Talking to Konductor

You interact with Konductor by prefixing your message with `konductor,` (case-insensitive). This tells the agent the message is directed at Konductor rather than being a general coding request.

```
konductor, who else is working here?
konductor, help
konductor, status
```

Background operations (session registration, collision checks, deregistration) happen automatically and don't need the prefix.

### Queries

Ask questions about repo activity, collision risk, and coordination:

| What you want to know | What to say |
|---|---|
| Who's active in my repo? | `konductor, who else is working here?` |
| Who's editing my files? | `konductor, who's on my files?` |
| What is a specific user doing? | `konductor, what is bob working on?` |
| How risky is my situation? | `konductor, how risky is my situation?` |
| Which files have the most editors? | `konductor, what's the hottest file?` |
| What branches are active? | `konductor, what branches are active?` |
| Who should I coordinate with? | `konductor, who should I talk to?` |

Responses are formatted with emoji severity indicators — never raw JSON.

### Management Commands

Control Konductor's lifecycle and configuration through chat:

**Status and lifecycle:**

| What to say | What it does |
|---|---|
| `konductor, status` | Check if the MCP server and file watcher are running |
| `konductor, turn on` | Start the file watcher and register a session |
| `konductor, turn off` | Stop the file watcher and deregister |
| `konductor, restart` | Restart the file watcher |
| `konductor, reinstall` | Re-run the installer script |

**Configuration:**

| What to say | What it does |
|---|---|
| `konductor, change my API key to X` | Update the Bearer token in MCP config |
| `konductor, change my logging level to debug` | Update log level in watcher config |
| `konductor, enable file logging` | Turn on file logging for the watcher |
| `konductor, disable file logging` | Turn off file logging |
| `konductor, change poll interval to 5` | Change collision poll interval (seconds) |
| `konductor, watch only ts,tsx,js` | Limit which file extensions are watched |
| `konductor, watch all files` | Clear the file extension filter |
| `konductor, change my username to alice` | Update your Konductor identity |

Configuration changes that affect the watcher trigger an automatic restart.

**Informational:**

| What to say | What it does |
|---|---|
| `konductor, help` | Show all available queries and commands |
| `konductor, show my config` | Display current configuration values |
| `konductor, config options` | List all config options with descriptions |
| `konductor, who am I?` | Show your resolved userId, repo, and branch |

### Quick reference (direct tool calls)

You can also invoke tools directly if needed:

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

### `who_is_active`

List all active users in a repository with their branches, files, and session duration.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `repo` | string | yes | Repository in `owner/repo` format |

**Output:**

```json
{
  "repo": "acme/app",
  "users": [
    {
      "userId": "alice",
      "branch": "main",
      "files": ["src/index.ts", "src/utils.ts"],
      "sessionDurationMinutes": 42
    }
  ],
  "totalUsers": 1
}
```

### `who_overlaps`

Find users whose files overlap with a specific user in a repository.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `userId` | string | yes | User to check overlaps for |
| `repo` | string | yes | Repository in `owner/repo` format |

**Output:**

```json
{
  "userId": "alice",
  "repo": "acme/app",
  "overlaps": [
    {
      "userId": "bob",
      "branch": "feature-x",
      "sharedFiles": ["src/index.ts"],
      "collisionState": "collision_course"
    }
  ],
  "isAlone": false
}
```

### `user_activity`

Show all active sessions for a user across all repositories.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `userId` | string | yes | User identifier |

**Output:**

```json
{
  "userId": "alice",
  "sessions": [
    {
      "repo": "acme/app",
      "branch": "main",
      "files": ["src/index.ts"],
      "sessionStartedAt": "2026-04-15T10:00:00.000Z",
      "lastHeartbeat": "2026-04-15T10:42:00.000Z"
    }
  ],
  "isActive": true
}
```

### `risk_assessment`

Compute a collision risk score for a user in a repository.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `userId` | string | yes | User identifier |
| `repo` | string | yes | Repository in `owner/repo` format |

**Output:**

```json
{
  "userId": "alice",
  "repo": "acme/app",
  "collisionState": "collision_course",
  "severity": 3,
  "overlappingUserCount": 1,
  "sharedFileCount": 1,
  "hasCrossBranchOverlap": true,
  "riskSummary": "High risk — 1 user editing src/index.ts on a different branch"
}
```

### `repo_hotspots`

Rank files in a repository by collision risk (number of concurrent editors).

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `repo` | string | yes | Repository in `owner/repo` format |

**Output:**

```json
{
  "repo": "acme/app",
  "hotspots": [
    {
      "file": "src/index.ts",
      "editors": [
        { "userId": "alice", "branch": "main" },
        { "userId": "bob", "branch": "feature-x" }
      ],
      "collisionState": "merge_hell"
    }
  ],
  "isClear": false
}
```

### `active_branches`

List all branches with active sessions in a repository, flagging branches with cross-branch file overlap.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `repo` | string | yes | Repository in `owner/repo` format |

**Output:**

```json
{
  "repo": "acme/app",
  "branches": [
    {
      "branch": "main",
      "users": ["alice"],
      "files": ["src/index.ts", "src/utils.ts"],
      "hasOverlapWithOtherBranches": true
    },
    {
      "branch": "feature-x",
      "users": ["bob"],
      "files": ["src/index.ts"],
      "hasOverlapWithOtherBranches": true
    }
  ]
}
```

### `coordination_advice`

Get actionable coordination suggestions ranked by urgency.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `userId` | string | yes | User identifier |
| `repo` | string | yes | Repository in `owner/repo` format |

**Output:**

```json
{
  "userId": "alice",
  "repo": "acme/app",
  "targets": [
    {
      "userId": "bob",
      "branch": "feature-x",
      "sharedFiles": ["src/index.ts"],
      "urgency": "high",
      "suggestedAction": "merge before pushing"
    }
  ],
  "hasUrgentTargets": true
}
```

Urgency levels:
- `high` — merge hell (different branch, same files)
- `medium` — collision course (same branch, same files)
- `low` — crossroads (same directories)

### `client_install_info`

Get npx commands for installing or updating the Konductor client. No parameters required — the server returns commands with its own URL baked in.

**Output:**

```
Konductor server v0.1.0

Full install (first time — sets up MCP config, watcher, steering rules, hooks):
  npx http://LT-DWHEATLEY-2.local:3010/bundle/installer.tgz --server http://LT-DWHEATLEY-2.local:3010 --api-key <your-api-key>

Workspace-only update (updates watcher and bundle files only):
  npx http://LT-DWHEATLEY-2.local:3010/bundle/installer.tgz --workspace --server http://LT-DWHEATLEY-2.local:3010

Check if your client is up to date:
  npx http://LT-DWHEATLEY-2.local:3010/bundle/installer.tgz --check-update --server http://LT-DWHEATLEY-2.local:3010
```

### `client_update_check`

Check if a client version is up to date with this server.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `clientVersion` | string | yes | Client version string (semver) |

**Output:**

```json
{
  "clientVersion": "0.0.9",
  "serverVersion": "0.1.0",
  "status": "outdated",
  "updateCommand": "npx http://LT-DWHEATLEY-2.local:3010/bundle/installer.tgz --workspace --server http://LT-DWHEATLEY-2.local:3010"
}
```

## Architecture

```
npx <server>/bundle/installer.tgz ──→ GET /bundle/installer.tgz ──→ Konductor Server
                                  ──→ GET /bundle/manifest.json  ──→ konductor_bundle/
                                  ──→ GET /bundle/files/:path    ──→ konductor_bundle/

Kiro Agent ──┐
             ├── stdio / SSE ──→ Konductor MCP Server
Other Agent ─┘                      ├── SessionManager
                                    ├── CollisionEvaluator
                                    ├── QueryEngine
                                    ├── SummaryFormatter
                                    ├── ConfigManager
                                    ├── PersistenceStore → sessions.json
                                    └── Bundle Endpoints (installer tgz + manifest + file serving)
```

### Components

- **SessionManager** — CRUD operations on work sessions, heartbeat tracking, stale cleanup
- **CollisionEvaluator** — Pure function that computes collision state from session overlap
- **QueryEngine** — Composes SessionManager and CollisionEvaluator to answer awareness, risk, and coordination queries
- **SummaryFormatter** — Human-readable summaries with round-trip parseability
- **ConfigManager** — YAML config loading with hot-reload via `fs.watch`
- **PersistenceStore** — Atomic JSON file writes for session durability
- **Bundle Endpoints** — `GET /bundle/installer.tgz` serves the `konductor-setup` npm package as a tarball (built once via `npm pack` and cached). `GET /bundle/manifest.json` and `GET /bundle/files/:path` serve the client bundle for the installer. No authentication required.

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

Bundle endpoints (no auth required):
- `GET /bundle/installer.tgz` — npm-compatible tarball of `konductor-setup` (for `npx`)
- `GET /bundle/manifest.json` — list of client bundle files
- `GET /bundle/files/:path` — individual bundle file content

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
