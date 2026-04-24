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
| 🟢 Proximity | 2.5 | Same file as another user, but different sections — no line overlap |
| 🟠 Collision Course | 3 | Someone is modifying the same files as you |
| 🔴 Merge Hell | 4 | Divergent changes on the same files across branches |

### Line-Level Collision Detection

The Konductor goes beyond file-level overlap. When the file watcher reports line ranges (via `git diff` hunks), the collision evaluator distinguishes between "same file, different sections" (Proximity) and "same file, same lines" (Collision Course).

**How it works:**

1. The file watcher runs `git diff --unified=0` for each changed file to extract modified line ranges
2. The watcher sends `FileChange` objects (`{ path, lineRanges? }`) instead of plain file paths
3. The collision evaluator checks whether line ranges overlap between users
4. If ranges don't overlap → Proximity (severity 2.5, no pause, no Slack at default verbosity)
5. If ranges overlap → Collision Course or Merge Hell (unchanged behavior)
6. If line data is missing for either user → falls back to Collision Course (assumes worst case)

**Merge severity assessment:**

When line overlap is detected, the server computes a severity score:

| Severity | Condition |
|----------|-----------|
| `minimal` | 1–5 overlapping lines |
| `moderate` | 6–20 overlapping lines |
| `severe` | 21+ overlapping lines, or >50% of either user's changes |

Severity is included in `risk_assessment` responses and Slack notifications.

**Backward compatibility:**

- Clients sending `files: string[]` (no line ranges) continue working unchanged
- File-level collision detection (current behavior) is the fallback when line data is unavailable
- The collision state model is unchanged — Proximity is a new state between Crossroads and Collision Course
- Existing clients require no updates

---

# Using the Konductor Client

Everything you need to get Konductor running in your project and interact with it day-to-day.

## Installing Konductor (Client)

There are two ways to install the Konductor client. Method 1 (npx command) does everything in one step. Method 2 (manual MCP config) lets you set up the MCP connection first and triggers auto-install on the agent's first interaction.

### Prerequisites

- Node.js 20 or later
- A running Konductor server (see [Running the Konductor Server](#running-the-konductor-server) below, or get the URL from your team)
- Kiro IDE, or any MCP-compatible client

### Method 1: npx Installer (recommended)

The installer is a single `npx` command — no cloning, no copying files, no bash scripts.

Get the server URL and API key from your team, then run from your project directory.

Same machine as the server (localhost):

```bash
npm config set strict-ssl false && npx https://localhost:3010/bundle/installer.tgz --server https://localhost:3010 --api-key kd-a7f3b9c2e1d4; npm config set strict-ssl true
```

Remote machine on the network:

```bash
npm config set strict-ssl false && npx https://192.168.68.64:3010/bundle/installer.tgz --server https://192.168.68.64:3010 --api-key kd-a7f3b9c2e1d4; npm config set strict-ssl true
```

Replace `192.168.68.64` with the IP of your Konductor server and `kd-a7f3b9c2e1d4` with your team's API key. Check the current version at `https://<server>:3010/bundle/manifest.json`.

That's it. This single command:
1. Creates `~/.kiro/settings/mcp.json` with your server URL and API key
2. Creates `.kiro/settings/mcp.json` in your workspace with the correct MCP config
3. Installs global and workspace steering rules, hooks, and agent rules
4. Deploys the file watcher and launches it in the background
5. Adds Konductor artifacts to `.gitignore`
6. Verifies the server is reachable

Kiro auto-detects the config change and connects to the MCP server. No IDE restart needed.

### Adding Konductor to another project

Run the same command from any project directory. The installer updates both global and workspace configs every time.

### Auto-updates

The file watcher checks for updates on startup and every 10 seconds. When the server has a newer version, the watcher automatically downloads and installs it, then restarts itself. No manual intervention needed.

You can also update manually by re-running the install command, or say `konductor, update` in the IDE chat.

### CLI flags

```
npx https://192.168.68.64:3010/bundle/installer.tgz [options]

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

### Method 2: Manual MCP Config (auto-install)

If you prefer to configure the MCP connection yourself — or if `npx` isn't available — you can create the MCP config manually and let the steering rule handle the rest.

1. Create `.kiro/settings/mcp.json` in your workspace root:

**Same machine as the server (localhost):**

```json
{
  "mcpServers": {
    "konductor": {
      "url": "https://localhost:3010/sse",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      },
      "autoApprove": ["register_session", "check_status", "deregister_session", "list_sessions", "who_is_active", "who_overlaps", "user_activity", "risk_assessment", "repo_hotspots", "active_branches", "coordination_advice", "client_install_info", "client_update_check"]
    }
  }
}
```

**Remote server on the network:**

```json
{
  "mcpServers": {
    "konductor": {
      "url": "https://192.168.68.64:3010/sse",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      },
      "autoApprove": ["register_session", "check_status", "deregister_session", "list_sessions", "who_is_active", "who_overlaps", "user_activity", "risk_assessment", "repo_hotspots", "active_branches", "coordination_advice", "client_install_info", "client_update_check"]
    }
  }
}
```

Replace `192.168.68.64` with your server's IP and `YOUR_API_KEY` with your team's API key.

2. Kiro detects the config change and connects to the MCP server automatically.

3. On the agent's first interaction (send any message in chat), the steering rule detects that workspace files are missing (no watcher, no hooks, no steering rules) and automatically runs the npx installer to deploy them. This is the same installer that runs with Method 1 — the only difference is the trigger.

4. After auto-install completes, the watcher starts in the background and collision awareness is active.

### What happens after each method

| Step | Method 1 (npx) | Method 2 (manual config) |
|------|----------------|--------------------------|
| MCP config created | Immediately by the installer | You create it manually |
| Steering rules, hooks, agent rules | Installed by the installer | Installed on first agent interaction (auto-install) |
| File watcher deployed and started | Immediately by the installer | On first agent interaction (auto-install) |
| `.gitignore` updated | Immediately by the installer | On first agent interaction (auto-install) |
| Collision awareness active | Immediately after install | After first agent interaction triggers auto-install |

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

1. Make sure the Konductor SSE server is running (see [Running the Konductor Server](#running-the-konductor-server))
2. Create or edit `.kiro/settings/mcp.json` in your workspace root

**Connecting from the same machine:**

```json
{
  "mcpServers": {
    "konductor": {
      "url": "https://localhost:3010/sse",
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
      "url": "https://LT-DWHEATLEY-2.local:3010/sse",
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
      "url": "https://192.168.68.64:3010/sse",
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

**Slack:**

| What to say | What it does |
|---|---|
| `konductor, slack status` | Show Slack config for this repo |
| `konductor, change slack channel to X` | Set the Slack channel for this repo |
| `konductor, change slack verbosity to X` | Set notification verbosity (0-5) |
| `konductor, disable slack` | Turn off Slack notifications (verbosity 0) |
| `konductor, enable slack` | Turn on Slack notifications (verbosity 2) |

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

## Client Environment Variables

Set in `.konductor-watcher.env` in your workspace root:

| Variable | Default | Description |
|----------|---------|-------------|
| `KONDUCTOR_LOG_LEVEL` | `info` | Watcher log level: `info` for color-coded notifications, `debug` for all API traffic. |
| `KONDUCTOR_POLL_INTERVAL` | `10` | Seconds between collision state polls in the file watcher. |
| `KONDUCTOR_LOG_FILE` | `.konductor-watcher.log` | File path for watcher log output. Set to empty to disable file logging. |
| `KONDUCTOR_WATCH_EXTENSIONS` | `ts,tsx,js,...` | Comma-separated file extensions the watcher monitors. |
| `KONDUCTOR_LOG_MAX_SIZE` | `10MB` | Max log file size before rotation. |

## Client Troubleshooting

| Problem | Solution |
|---------|----------|
| Kiro says "Remote MCP Servers must use https or localhost" | The MCP config has a non-localhost URL. Re-run the installer or edit `.kiro/settings/mcp.json` to use `http://localhost:3010/sse` |
| SSH tunnel drops | Use `ServerAliveInterval` in SSH config, or use `autossh` for auto-reconnect |
| `curl localhost:3010/health` fails on remote machine | SSH tunnel isn't running or port 3010 is already in use locally |
| Watcher not auto-updating | Check `.konductor-watcher.log` for errors. The watcher checks for updates on startup and every poll interval (default 10s) |
| Antigravity: watcher doesn't start on project open | Antigravity doesn't have Kiro's hooks system. Send a message in chat to trigger the agent rule, or start manually: `node konductor-watcher.mjs &` |
| Antigravity: MCP server doesn't reconnect on reopen | Same limitation — Antigravity doesn't auto-reconnect MCP servers. Reopen the project or reconnect manually from the MCP panel. |
| SSE connection rejected with 401 | Check that `KONDUCTOR_API_KEY` matches between server and client |

---

# Using the Konductor Server

Everything for whoever hosts or operates the Konductor server. If someone on your team already runs it, you just need the URL and API key — skip to [Using the Konductor Client](#using-the-konductor-client) above.

## Running the Konductor Server

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

Skip to [Connecting to Kiro](#connecting-to-kiro).

### Option B: Shared mode (SSE) — multi-user on a network

Run the Konductor as a standalone server so multiple teammates can connect. HTTPS is enabled by default.

First, configure your environment. Copy the example env file and set your API key:

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```bash
KONDUCTOR_PORT=3010
KONDUCTOR_API_KEY=konductor
```

Generate TLS certificates using `mkcert` (recommended — creates OS-trusted certs so Kiro and browsers accept them without warnings):

```bash
# Install mkcert (one-time)
brew install mkcert      # macOS
# or: sudo apt install mkcert  # Linux

# Install the local CA into your system trust store (one-time, needs sudo)
mkcert -install

# Generate certs for your hostname, localhost, and your IP
mkdir -p certs
mkcert -key-file certs/key.pem -cert-file certs/cert.pem \
  $(hostname) localhost 127.0.0.1 YOUR_IP_ADDRESS
```

Replace `YOUR_IP_ADDRESS` with your machine's LAN IP (e.g., `192.168.68.64`).

For remote clients on other machines, copy the CA cert to each client and install it:

```bash
# Find the CA cert on the server machine
mkcert -CAROOT
# → e.g., /Users/you/Library/Application Support/mkcert/rootCA.pem

# On the client machine (macOS):
security add-trusted-cert -d -r trustRoot -k ~/Library/Keychains/login.keychain rootCA.pem

# On the client machine (Linux):
sudo cp rootCA.pem /usr/local/share/ca-certificates/mkcert-ca.crt
sudo update-ca-certificates
```

Then start the server:

```bash
node dist/index.js
```

The server reads `.env.local` automatically and detects the certs. You should see:

```
Konductor SSE server listening on https://localhost:3010
```

To force HTTP instead (e.g., for local-only use), set `KONDUCTOR_PROTOCOL=http` in `.env.local` or remove the `certs/` directory.

Verify it's running:

```bash
curl -sk https://localhost:3010/health
# → {"status":"ok"}
```

Leave this running in a terminal (or use a process manager like `pm2`). Teammates connect their MCP clients to this instance.

## GitHub Integration

The Konductor can poll the GitHub API for open pull requests and recent commits, creating passive sessions that participate in collision detection alongside active user sessions. This powers the "Open PRs" and "Repo History" panels on the Baton dashboard and enables PR-based collision warnings.

### Prerequisites

You need a GitHub Personal Access Token (PAT). This is **not** the same as an SSH key — SSH keys authenticate git operations, while a PAT authenticates REST API calls.

**Creating a token:**

1. Go to https://github.com/settings/tokens
2. Click **Generate new token** → **Fine-grained token** (recommended)
3. Set a name (e.g. "Konductor") and expiration
4. Under **Repository access**, select the repos you want to monitor (or "All repositories")
5. Under **Permissions**, grant:
   - **Pull requests**: Read
   - **Contents**: Read
6. Click **Generate token** and copy it (starts with `github_pat_`)

Alternatively, create a **Classic token** with the `repo` scope (or `public_repo` for public repos only).

### Configuration

Two things are needed: the token in `.env.local` and the repo list in `konductor.yaml`.

**1. Add the token to `.env.local`:**

```bash
GITHUB_TOKEN=github_pat_your_token_here
```

**2. Add the `github` section to `konductor.yaml`:**

```yaml
github:
  token_env: GITHUB_TOKEN
  poll_interval_seconds: 60
  include_drafts: true
  commit_lookback_hours: 24
  repositories:
    - repo: "owner/repo-name"
    - repo: "owner/another-repo"
```

Replace `owner/repo-name` with the actual `owner/repo` format for each repository you want to monitor.

### Configuration Options

| Field | Default | Description |
|-------|---------|-------------|
| `token_env` | `GITHUB_TOKEN` | Name of the environment variable holding the PAT |
| `poll_interval_seconds` | `60` | How often to poll GitHub for changes (seconds) |
| `include_drafts` | `true` | Whether to create sessions for draft PRs |
| `commit_lookback_hours` | `24` | How far back to look for recent commits |
| `repositories` | *(required)* | List of repos to monitor in `owner/repo` format |

Each repository entry can optionally specify which branches to poll for commits:

```yaml
repositories:
  - repo: "myorg/myapp"
    commit_branches:
      - main
      - develop
```

If `commit_branches` is omitted, all branches are polled.

### Hot-Reload

The `konductor.yaml` file is watched for changes. When you add, remove, or modify the `github` section, the pollers restart automatically — no server restart needed.

However, changes to `.env.local` (like adding or changing `GITHUB_TOKEN`) require a server restart since environment variables are read at process startup.

### What It Does

Once configured, the GitHub poller:

- Fetches all open PRs for each configured repository every `poll_interval_seconds`
- Creates passive sessions for each PR (author, branch, changed files, review status)
- Detects when PRs are closed/merged and removes their sessions
- Suppresses self-collision: if a PR author also has an active Konductor session, the PR session is skipped to avoid false positives
- Tracks approval status so the Baton dashboard can flag approved PRs as high-priority collision risks
- Emits SSE events so the Baton dashboard updates in real time

### Troubleshooting

| Problem | Solution |
|---------|----------|
| "Open PRs" panel shows "No open PRs" | Check that `konductor.yaml` has a `github` section and `GITHUB_TOKEN` is set in `.env.local`. Restart the server after adding the token. |
| GitHub API returns 401 | Token is invalid or expired. Generate a new one. |
| GitHub API returns 403 | Token doesn't have the required permissions, or rate limit exceeded. Check token scopes and the server log for rate limit warnings. |
| PRs not updating | Check the server log for `[GITHUB]` entries. The poller logs each poll cycle with the number of PRs found. |
| Token starts with `ghp_` vs `github_pat_` | Both work. `ghp_` is a classic token, `github_pat_` is a fine-grained token. Fine-grained is recommended for least-privilege access. |

## Baton Dashboard (Per-Repo Page)

The Konductor Baton is a web dashboard that gives each repository its own dedicated page with real-time visibility into concurrent development activity. When running in SSE mode, the Baton is served on the same HTTP port as the MCP transport — no extra setup required.

### Accessing the Repo Page

Every repo tracked by the Konductor has a page at:

```
https://<host>:<port>/repo/<repoName>
```

For example, if the server runs at `https://localhost:3010` and the repo is `app`:

```
https://localhost:3010/repo/app
```

The URL uses just the repo name (not the owner) — all users across branches share the same page. You receive this URL automatically when your client registers a session via `register_session` (the `repoPageUrl` field in the response), and the file watcher displays it in its startup banner.

### What the Dashboard Shows

The repo page has five sections:

| Section | What it displays |
|---------|-----------------|
| Repository Summary | Repo name (linked to GitHub), health status badge (Healthy/Warning/Alerting), all active branches (linked to GitHub), active users as color-coded pills showing recency of last heartbeat, session and user counts |
| Notifications & Alerts | Real-time table of collision state changes with timestamp, notification type, collision state, branch, JIRAs, summary, users (linked to GitHub profiles), and a resolve button. Supports Active/History tabs, sorting, and filtering. |
| Query Log | Table of user-initiated queries (who_is_active, who_overlaps, etc.) with timestamp, user, branch, query type, and parameters. Sortable and filterable. |
| Open PRs | When GitHub integration is configured: table of open pull requests with Hours Open, Branch (linked to GitHub), PR # (linked), User (linked to GitHub profile), Status (Draft/Open/Approved), and file count. Updates in real time via SSE. |
| Repo History | When GitHub integration is configured: chronological table of commits, PRs, and merges with Timestamp, Action type, User (linked to GitHub profile), Branch, and Summary. |

All sections except Repository Summary are collapsible. Click a section header to collapse or expand it. Collapsed headers show a count badge.

### Health Status

The health status is derived from the collision states of all active users in the repo:

| Status | Condition | Badge Color |
|--------|-----------|-------------|
| 🟢 Healthy | No active users, or all users are Solo | Green |
| 🟡 Warning | Any user is at Neighbors or Crossroads | Yellow |
| 🔴 Alerting | Any user is at Collision Course or Merge Hell | Red |

### User Freshness Colors

Active users are displayed as pill-shaped badges color-coded by how recently their last heartbeat was received. The scale has 10 levels, from bright green (most recent) to near-black (least recent):

| Level | Minutes Since Heartbeat | Color |
|-------|------------------------|-------|
| 1 | 0–10 | Bright Green (`#22c55e`) |
| 2 | 10–20 | Green (`#16a34a`) |
| 3 | 20–30 | Teal (`#14b8a6`) |
| 4 | 30–40 | Cyan (`#06b6d4`) |
| 5 | 40–50 | Blue (`#3b82f6`) |
| 6 | 50–60 | Indigo (`#6366f1`) |
| 7 | 60–70 | Purple (`#8b5cf6`) |
| 8 | 70–80 | Dim Purple (`#6b21a8`) |
| 9 | 80–90 | Dark Gray (`#4b5563`) |
| 10 | 90+ | Near Black (`#1f2937`) |

The interval per level defaults to 10 minutes but is configurable via environment variables (see below).

### Freshness Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `BATON_FRESHNESS_INTERVAL_MINUTES` | `10` | Minutes per freshness level. A value of 5 means level 1 = 0–5 min, level 2 = 5–10 min, etc. |
| `BATON_FRESHNESS_COLORS` | *(10-color scale above)* | Comma-separated list of 10 hex color values to override the default freshness color scale. |

Set these in `.env.local` alongside the other Konductor server variables. This configuration is also editable from the Admin Dashboard's System Settings panel (see [Admin Dashboard](#admin-dashboard)).

### Real-Time Updates

The dashboard uses Server-Sent Events (SSE) to push live updates. When a session is registered, updated, or deregistered, or when a notification or query log entry is created, the page updates automatically — no manual refresh needed. If the SSE connection drops, a disconnection banner appears and the client reconnects automatically with exponential backoff.

## Baton Authentication

The Baton dashboard supports optional GitHub OAuth-based access control. When enabled, users must authenticate with GitHub and have read access to a repository before viewing its Baton page. When not configured, the Baton serves pages without authentication (the default, backward-compatible behavior).

### Setting Up a GitHub OAuth App

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**
2. Fill in the fields:
   - **Application name**: anything (e.g. "Konductor Baton")
   - **Homepage URL**: your Konductor server URL (e.g. `https://localhost:3010`)
   - **Authorization callback URL**: `<your-server-url>/auth/callback` (e.g. `https://localhost:3010/auth/callback`)
3. Click **Register application**
4. Copy the **Client ID** and generate a **Client Secret**

### Enabling Authentication

Add the OAuth credentials to your `.env.local`:

```bash
# GitHub OAuth App credentials
BATON_GITHUB_CLIENT_ID=your_client_id_here
BATON_GITHUB_CLIENT_SECRET=your_client_secret_here
```

That's it. Restart the server and Baton pages will require GitHub login.

### Auth Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BATON_GITHUB_CLIENT_ID` | *(none)* | GitHub OAuth App client ID. Auth is disabled when this is not set. |
| `BATON_GITHUB_CLIENT_SECRET` | *(none)* | GitHub OAuth App client secret. Required when client ID is set. |
| `BATON_SESSION_SECRET` | *(random at startup)* | Secret key for encrypting session cookies. If not set, a random key is generated at startup — sessions won't survive server restarts. Set this for production use. |
| `BATON_SESSION_HOURS` | `8` | Session cookie lifetime in hours. |
| `BATON_ACCESS_CACHE_MINUTES` | `5` | How long to cache GitHub repo access check results (minutes). Reduces API calls for repeated page loads. |

### How It Works

1. User visits a Baton repo page (e.g. `/repo/my-app`)
2. Server redirects to GitHub for OAuth authorization
3. User authorizes the OAuth App on GitHub
4. GitHub redirects back to `/auth/callback` with an authorization code
5. Server exchanges the code for an access token, fetches the user's GitHub profile
6. Server sets an encrypted session cookie and redirects the user to the original page
7. On each page load, the server checks (via GitHub API) that the user has read access to the repo
8. Access check results are cached for `BATON_ACCESS_CACHE_MINUTES` to avoid excessive API calls

### Disabling Authentication

To run the Baton without authentication (open access), simply omit `BATON_GITHUB_CLIENT_ID` from your `.env.local`. This is the default behavior — no configuration changes needed if you're upgrading from a version without auth.

### Auth Routes

| Route | Description |
|-------|-------------|
| `GET /auth/login?redirect=<path>` | Initiates the OAuth flow, redirects to GitHub |
| `GET /auth/callback` | Handles the GitHub OAuth callback |
| `GET /auth/logout` | Clears the session and redirects to the logged-out page |
| `GET /auth/logged-out` | Displays a "logged out" confirmation page |

### API Authentication

When auth is enabled, Baton API endpoints (`/api/repo/:repoName/*`) are also protected:

- Unauthenticated requests return `401` JSON
- Requests from users without repo access return `403` JSON
- The SSE event stream (`/api/repo/:repoName/events`) requires the same authentication

## Admin Dashboard

The Konductor Admin Dashboard is a web-based administration interface at `/admin` for managing system settings, installer channels, users, and client install commands. It shares the same storage backend and visual design language as the Baton dashboard.

### Accessing the Admin Dashboard

Navigate to:

```
https://<host>:<port>/admin
```

If you're not authenticated, you'll be redirected to `/login`. Enter your userId and API key to log in. A session cookie is set on success (httpOnly, 8-hour expiry).

Programmatic access is also supported via `Authorization: Bearer <apiKey>` + `X-Konductor-User: <userId>` headers.

### Admin Access Model

Admin access uses a two-tier check:

1. **KONDUCTOR_ADMINS env var** (highest precedence) — comma-separated list of userIds and/or email addresses. Matching is case-insensitive with whitespace trimmed.
2. **User record `admin` flag** — stored in the database. Can be toggled from the User Management panel.

If a user matches `KONDUCTOR_ADMINS`, they are always admin regardless of the database flag. The env-sourced admin status is displayed as read-only in the UI.

**Bootstrap admin**: When `KONDUCTOR_ADMINS` is not set and the first user record is created in an empty system, that user automatically gets `admin: true`.

Example `.env.local`:

```bash
KONDUCTOR_ADMINS=alice,bob@example.com,charlie
```

### Dashboard Panels

The admin dashboard has five collapsible panels:

| Panel | Description |
|-------|-------------|
| System Settings | View and modify server settings (heartbeat timeout, session retention, log level, etc.) |
| Global Client Settings | Manage installer channels (Dev/UAT/Prod), promote/rollback, set global default channel |
| Client Install Commands | Display ready-to-copy install commands per channel |
| User Management | Sortable/filterable table of all users with channel assignment and admin toggle |
| Freshness Color Scale | Preview of the time-based color gradient used for pill badges |

### Installer Channel Management

The Konductor supports three release channels for the client installer:

| Channel | Purpose |
|---------|---------|
| Dev | Latest development builds |
| UAT | User acceptance testing |
| Prod | Stable production release |

#### Promotion Flow

Promotion copies a tarball from one channel to the next:

```
Dev → UAT → Prod
```

When you promote, the destination channel's previous tarball is retained for rollback. Each channel serves its installer at a dedicated endpoint:

- `/bundle/installer-dev.tgz`
- `/bundle/installer-uat.tgz`
- `/bundle/installer-prod.tgz`

The legacy `/bundle/installer.tgz` endpoint continues to serve the Prod channel for backward compatibility.

#### Rollback

Each channel supports one level of rollback. Clicking "Rollback" reverts the channel to its previous tarball. If no previous version exists, rollback is unavailable.

#### Example Workflow

1. Upload a new installer build to the Dev channel
2. Test internally, then click "Promote Dev → UAT"
3. QA validates on UAT, then click "Promote UAT → Prod"
4. If a problem is found in Prod, click "Rollback" on the Prod channel to revert

### Client Install Commands

The Client Install Commands panel shows the exact `npx` command users need to run, per channel. The command format is:

```bash
npx <serverUrl>/bundle/installer-<channel>.tgz --server <serverUrl> --api-key YOUR_API_KEY
```

The panel adapts based on server mode:

- **Cloud mode** (`KONDUCTOR_EXTERNAL_URL` is set): displays a single command using the external URL
- **Local mode** (default): displays two commands — one for localhost and one for the machine's network IP

The `YOUR_API_KEY` placeholder is always shown instead of a real key.

### User Management

Users are auto-created when they first register a session. The User Management table shows:

| Column | Description |
|--------|-------------|
| Username | Linked to GitHub profile when available |
| Repos Accessed | Color-coded pill badges by last-access recency (stale repos hidden) |
| Last Seen | Color-coded pill badge by recency |
| Last Activity Summary | Brief description with JIRA ticket if available |
| Installer Channel Override | Per-user channel assignment (Dev/UAT/Prod or "Default") |
| Admin | Toggle (read-only if set by `KONDUCTOR_ADMINS`) |

Admins can:
- Assign a per-user installer channel override (the user receives that channel's installer on next update)
- Toggle the admin flag (unless the user's admin status comes from `KONDUCTOR_ADMINS`)

JIRA tickets are extracted from branch names matching `<prefix>/<KEY>-<number>-<description>` (e.g. `feature/PROJ-123-add-login` → `PROJ-123`).

### Real-Time Updates

The admin dashboard uses SSE (Server-Sent Events) at `/api/admin/events` for live updates. Settings changes, user updates, and channel operations are reflected in the UI within seconds. A disconnection indicator appears if the SSE connection drops, with automatic reconnection.

### Admin Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KONDUCTOR_ADMINS` | *(none)* | Comma-separated list of admin userIds/emails. Takes precedence over database admin flag. |
| `KONDUCTOR_SESSION_SECRET` | *(random at startup)* | Secret for encrypting admin session cookies. Random if not set (sessions won't survive restarts). |
| `KONDUCTOR_EXTERNAL_URL` | *(none)* | External URL of the server (e.g. `https://konductor.example.com`). When set, enables cloud mode for install commands. |

## Slack Integration

The Konductor can post collision notifications directly to Slack channels using a bot token. When a collision state meets or exceeds the configured verbosity threshold for a repo, the server posts a rich Block Kit message to the repo's Slack channel. De-escalation messages are sent when the collision resolves.

### Prerequisites

- A Slack workspace where you want to receive notifications
- A Slack Bot Token (`xoxb-...`) with `chat:write` and `chat:write.public` scopes
- The Konductor server running in SSE mode

### Getting a Slack Bot Token

You need a bot token (`xoxb-...`) to enable Slack notifications. If you're not a Slack admin on your team's workspace, you can create a free test workspace at https://slack.com/get-started — you'll be the admin there.

1. Go to https://api.slack.com/apps
2. Click "Create New App" → "From scratch"
3. Give it a name (e.g. "Konductor") and pick your workspace
4. In the left sidebar, click "OAuth & Permissions"
5. Scroll to "Bot Token Scopes" → click "Add an OAuth Scope" → add:
   - `chat:write` (post messages)
   - `chat:write.public` (post to public channels without being invited first)
6. Scroll back up and click "Install to Workspace" → click "Allow"
7. Copy the "Bot User OAuth Token" — that's your `xoxb-...` token

If you're on a team workspace and not an admin, ask your Slack admin to create the app and share the bot token with you. The app only needs the two scopes above — no user data access required.

### Configuring the Bot Token

There are two ways to configure the Slack bot token:

**Option A: Environment variable (recommended for production)**

Add to your `.env.local`:

```bash
# Slack bot token — overrides database-stored token when set
SLACK_BOT_TOKEN=xoxb-your-token-here
```

When set via env var, the token is read-only in the Admin Dashboard.

**Option B: Admin Dashboard**

1. Navigate to the Admin Dashboard at `https://<host>:<port>/admin`
2. Open the "Slack Integration" panel
3. Paste your bot token or use the OAuth "Install Slack App" flow
4. Click Validate to confirm the token works

The environment variable takes precedence over the database-stored token.

### Per-Repo Channel Configuration

Each repository has its own Slack channel for collision notifications. Configure it from:

**Baton Repo Page:**
1. Open the repo page at `https://<host>:<port>/repo/<repoName>`
2. Expand the "Slack Integration" panel
3. Set the channel name and verbosity level
4. Click "Save Changes"

**Chat commands:**
```
konductor, show slack config
konductor, change slack channel to my-team-alerts
konductor, change slack verbosity to 3
konductor, disable slack
konductor, enable slack
```

**Default channel:** If no channel is configured for a repo, the server uses `konductor-alerts-<repo_name>` (sanitized to Slack naming rules).

### Verbosity Levels

Verbosity controls which collision states trigger Slack notifications:

| Level | Label | States that trigger notifications |
|-------|-------|-----------------------------------|
| 0 | Disabled | None (Slack off for this repo) |
| 1 | Merge Hell only | merge_hell |
| 2 | Collision Course + Merge Hell (default) | collision_course, merge_hell |
| 3 | Crossroads and above | crossroads, collision_course, merge_hell |
| 4 | Neighbors and above | neighbors, crossroads, collision_course, merge_hell |
| 5 | Everything | solo, neighbors, crossroads, collision_course, merge_hell |

The default verbosity is 2 — only collision_course and merge_hell trigger notifications.

### Message Format

Slack messages use Block Kit for rich formatting.

**Escalation message (collision detected):**

```json
{
  "channel": "konductor-alerts-my-project",
  "blocks": [
    {
      "type": "header",
      "text": { "type": "plain_text", "text": "🟠 Collision Course — org/my-project" }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "alice and bob are modifying the same files:\n• `src/auth.ts`\n• `src/types.ts`\n\nBranch: `feature/auth`"
      }
    },
    {
      "type": "context",
      "elements": [
        { "type": "mrkdwn", "text": "*konductor collision alert for org/my-project*" }
      ]
    }
  ]
}
```

**De-escalation message (collision resolved):**

```json
{
  "channel": "konductor-alerts-my-project",
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "✅ Collision resolved on org/my-project — previously 🟠 Collision Course"
      }
    },
    {
      "type": "context",
      "elements": [
        { "type": "mrkdwn", "text": "*konductor collision alert for org/my-project*" }
      ]
    }
  ]
}
```

### Emoji Mapping

| Collision State | Emoji |
|-----------------|-------|
| solo | 🟢 |
| neighbors | 🟢 |
| crossroads | 🟡 |
| collision_course | 🟠 |
| merge_hell | 🔴 |

### Without Slack Integration

If no bot token is configured (neither env var nor database), the Konductor operates exactly as before — collision evaluation continues normally, Slack notifications are simply skipped. Slack integration is entirely optional.

## GitHub Integration

The Konductor can poll GitHub for open pull requests and recent commits, creating passive sessions that participate in collision detection alongside active (live) sessions. This lets you detect conflicts with teammates who aren't online — their open PRs and recent pushes still represent pending changes that could collide with your work.

### Prerequisites

- A GitHub Personal Access Token (PAT) with `repo` scope (for private repos) or `public_repo` scope (for public repos)
- The Konductor server running in SSE mode

### Setting Up Credentials

1. Generate a PAT at [github.com/settings/tokens](https://github.com/settings/tokens)
2. Add it to your `.env.local` file:

```bash
# GitHub integration — Personal Access Token for polling PRs and commits
# Required scopes: repo (for private repos) or public_repo (for public repos)
GITHUB_TOKEN=ghp_your_token_here
```

The `GITHUB_TOKEN` env var name is the default. You can use a different env var name by setting `token_env` in the YAML config (see below).

### Configuring Repositories

Add a `github` section to your `konductor.yaml`:

```yaml
heartbeat_timeout_seconds: 300

github:
  token_env: GITHUB_TOKEN          # Env var holding the PAT (default: GITHUB_TOKEN)
  poll_interval_seconds: 60        # How often to poll GitHub (default: 60)
  include_drafts: true             # Track draft PRs as passive sessions (default: true)
  commit_lookback_hours: 24        # How far back to look for commits (default: 24)
  repositories:
    - repo: "org/frontend-app"     # owner/repo format
      commit_branches:             # Branches to poll for commits (omit to skip commit polling)
        - main
        - develop
    - repo: "org/backend-api"
      commit_branches:
        - main

states:
  solo:
    message: "You're the only one here. Go wild."
  # ... other state messages
```

The config is hot-reloadable — changes to the `github` section take effect on the next poll cycle without restarting the server.

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `github.token_env` | string | `GITHUB_TOKEN` | Name of the env var holding the GitHub PAT |
| `github.poll_interval_seconds` | number | `60` | Seconds between GitHub API polls |
| `github.include_drafts` | boolean | `true` | Whether to create passive sessions for draft PRs |
| `github.commit_lookback_hours` | number | `24` | How far back (in hours) to look for recent commits |
| `github.repositories[].repo` | string | *(required)* | Repository in `owner/repo` format |
| `github.repositories[].commit_branches` | string[] | *(none)* | Branches to poll for commits. Omit to skip commit polling for this repo. |

### How It Works

1. The **GitHubPoller** fetches open PRs for each configured repo, extracts changed files, and creates passive PR sessions
2. The **CommitPoller** fetches recent commits on configured branches within the lookback window, groups by author, and creates passive commit sessions
3. The **DeduplicationFilter** prevents redundant sessions:
   - Self-collision suppression: you won't be warned about your own PRs or commits
   - PR supersedes commits: if a user has a PR covering the same files, their commit session is skipped
   - Active supersedes passive: if a user has a live session, their own PR/commit sessions are suppressed
4. Passive sessions participate in collision evaluation identically to active sessions — source only affects severity weighting and message formatting

### Severity Adjustments

| Condition | Effect |
|-----------|--------|
| Approved PR overlaps with your files | Severity escalated (merge is imminent) |
| Draft PR overlaps with your files | Severity de-escalated (work in progress) |
| PR targets your current branch | Severity escalated (direct conflict risk) |

### Example Collision Messages

When GitHub-sourced collisions are detected, the client receives source-attributed messages that explain *how* you're colliding and what action to take.

**Active session collision (live user):**
```
🟠 Warning — bob is actively editing src/index.ts on feature-y.
```

**PR collision (open pull request):**
```
🟠 Warning — carol's PR #42 (github.com/org/app/pull/42) modifies src/index.ts, targeting main.
```

**Approved PR collision (imminent merge):**
```
🔴 Critical — carol's PR #42 is approved and targets main. Merge is imminent.
```

**Draft PR collision (low risk):**
```
🟡 Heads up — carol has a draft PR #42 touching src/index.ts. Low risk but worth tracking.
```

**Commit collision (recent pushes):**
```
🟠 Warning — dave pushed commits to main (Apr 15–16) modifying src/index.ts.
```

**Mixed-source collision (multiple types at once):**
```
[COLLISION_COURSE] repo:org/app | user:alice
  🟠 bob is actively editing src/index.ts on feature-y (live session)
  🟠 carol's PR #42 (github.com/org/app/pull/42) modifies src/index.ts, targeting main
  🟠 dave pushed commits to main (Apr 15–16) modifying src/index.ts
```

**Merge Hell with mixed sources:**
```
[MERGE_HELL] repo:org/app | user:alice
  🔴 bob is actively editing src/index.ts on feature-y (live session, different branch)
  🔴 carol's PR #42 targets main with changes to src/index.ts (cross-branch conflict)
```

### Rate Limiting

The pollers respect GitHub API rate limits. When `X-RateLimit-Remaining` is low, the poller backs off and retries on the next interval. API errors are logged but never disrupt active session tracking.

### Without GitHub Integration

If no `github` section exists in `konductor.yaml`, the Konductor operates exactly as before — only active (live) sessions are tracked. GitHub integration is entirely optional.

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

## Log Rotation

Both the server and client watcher support automatic log rotation to prevent unbounded disk usage. When a log file reaches the configured size limit, it is rotated using a three-file scheme:

1. `<name>.tobedeleted` is deleted (if it exists)
2. `<name>.backup` is renamed to `<name>.tobedeleted`
3. `<name>` (current) is renamed to `<name>.backup`
4. A fresh `<name>` is created for new writes

This keeps at most 3 log files on disk, capping total usage at ~3× the max size.

### Server Configuration

Set in `.env.local`:

```bash
KONDUCTOR_LOG_MAX_SIZE=10MB    # default: 10MB
```

### Client Configuration

Set in `.konductor-watcher.env`:

```bash
KONDUCTOR_LOG_MAX_SIZE=10MB    # default: 10MB
```

### Size Format

Accepts `<number>KB`, `<number>MB`, `<number>GB`, or plain `<number>` (bytes). Case-insensitive. Examples: `10MB`, `500KB`, `1GB`, `5242880`.

### Admin Page

`KONDUCTOR_LOG_MAX_SIZE` is editable from the Admin Dashboard's System Settings panel. Environment variables take precedence over admin-configured values.

## Server Environment Variables

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
| `KONDUCTOR_LOG_MAX_SIZE` | `10MB` | Max log file size before rotation. |
| `KONDUCTOR_TLS_KEY` | `certs/key.pem` | Path to TLS private key. HTTPS is enabled when both key and cert exist. |
| `KONDUCTOR_TLS_CERT` | `certs/cert.pem` | Path to TLS certificate. |
| `KONDUCTOR_PROTOCOL` | *(auto)* | Set to `http` to force HTTP even when certs exist. |
| `BATON_FRESHNESS_INTERVAL_MINUTES` | `10` | Minutes per freshness level on the Baton dashboard user pills. |
| `BATON_FRESHNESS_COLORS` | *(10-color scale)* | Comma-separated list of 10 hex color values for the freshness color scale. |
| `GITHUB_TOKEN` | *(none)* | GitHub Personal Access Token for polling PRs and commits. Required scopes: `repo` (private repos) or `public_repo` (public repos). Referenced by `token_env` in `konductor.yaml`. |
| `BATON_GITHUB_CLIENT_ID` | *(none)* | GitHub OAuth App client ID for Baton authentication. Auth disabled when not set. |
| `BATON_GITHUB_CLIENT_SECRET` | *(none)* | GitHub OAuth App client secret. Required when client ID is set. |
| `BATON_SESSION_SECRET` | *(random at startup)* | Secret key for encrypting Baton session cookies. Random if not set (sessions won't survive restarts). |
| `BATON_SESSION_HOURS` | `8` | Baton session cookie lifetime in hours. |
| `BATON_ACCESS_CACHE_MINUTES` | `5` | Minutes to cache GitHub repo access check results for Baton auth. |
| `KONDUCTOR_ADMINS` | *(none)* | Comma-separated list of admin userIds/emails. Takes precedence over database admin flag. |
| `KONDUCTOR_SESSION_SECRET` | *(random at startup)* | Secret for encrypting admin session cookies. Random if not set (sessions won't survive restarts). |
| `KONDUCTOR_EXTERNAL_URL` | *(none)* | External URL of the server (e.g. `https://konductor.example.com`). Enables cloud mode for install commands. |
| `KONDUCTOR_SERVE_CLIENT_BUNDLES_FROM_LOCAL_STORE` | `false` | When `true`, scan `installers/` for versioned `.tgz` bundles and serve them via the admin dashboard. When `false`, pack `konductor-setup/` at startup. |
| `SLACK_BOT_TOKEN` | *(none)* | Slack bot token (`xoxb-...`) for posting collision notifications. Overrides database-stored token. Optional. |

## Server Troubleshooting

| Problem | Solution |
|---------|----------|
| `Invalid repo format` error | Use `owner/repo` format (e.g. `acme/app`) |
| Session not found on deregister | Session may have been cleaned up as stale. Re-register. |
| SSE connection rejected with 401 | Check that `KONDUCTOR_API_KEY` matches between server and client |
| Config changes not picked up | Ensure `konductor.yaml` is in the working directory or set `KONDUCTOR_CONFIG` |
| Corrupted `sessions.json` | The server backs up the corrupted file and starts fresh. Check `sessions.json.backup`. |
| Empty file list rejected | `register_session` requires at least one file path |
| Stale sessions disappearing | Sessions without a heartbeat within the configured timeout are automatically cleaned up |

---

# Developing the Konductor Server

Architecture, internals, and API reference for contributors working on the server codebase.

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
- **GitHubPoller** — Polls GitHub API for open PRs, creates/updates/removes passive PR sessions
- **CommitPoller** — Polls GitHub API for recent commits on configured branches, creates passive commit sessions
- **DeduplicationFilter** — Prevents redundant passive sessions (self-collision suppression, PR-supersedes-commits, active-supersedes-passive)
- **Bundle Endpoints** — `GET /bundle/installer.tgz` serves the `konductor-setup` npm package as a tarball (built once via `npm pack` and cached). `GET /bundle/manifest.json` and `GET /bundle/files/:path` serve the client bundle for the installer. No authentication required.
- **BundleRegistry** — In-memory index of versioned `.tgz` bundles from the local `installers/` directory. Supports scan, list, get, delete, and channel reference tracking. Active when `KONDUCTOR_SERVE_CLIENT_BUNDLES_FROM_LOCAL_STORE=true`.

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

## Baton API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/repo/:repoName` | GET | Serve the repo page HTML |
| `/api/repo/:repoName` | GET | Repo summary JSON (health, users, branches) |
| `/api/repo/:repoName/notifications` | GET | Notifications list (`?status=active\|resolved`) |
| `/api/repo/:repoName/log` | GET | Query log entries |
| `/api/repo/:repoName/notifications/:id/resolve` | POST | Resolve a notification |
| `/api/repo/:repoName/events` | GET | SSE event stream for real-time updates |
| `/api/github/prs/:repo` | GET | Open PRs for a repo (requires GitHub integration) |
| `/api/github/history/:repo` | GET | Recent commits, PRs, and merges for a repo (requires GitHub integration) |

## Slack API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/repo/:repoName/slack` | Authenticated | Get Slack config for a repo |
| PUT | `/api/repo/:repoName/slack` | Authenticated | Update Slack channel/verbosity for a repo |
| GET | `/api/admin/slack` | Admin | Get global Slack auth status |
| PUT | `/api/admin/slack` | Admin | Update bot token or OAuth credentials |
| POST | `/api/admin/slack/test` | Admin | Send a test message to a channel |

## Admin API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/login` | Login page |
| POST | `/login` | Authenticate and set session cookie |
| GET | `/admin` | Admin dashboard (requires admin) |
| GET | `/api/admin/settings` | Get all settings with source info |
| PUT | `/api/admin/settings/:key` | Update a setting (rejects env-sourced) |
| GET | `/api/admin/channels` | Get all channel metadata |
| POST | `/api/admin/channels/promote` | Promote a channel |
| POST | `/api/admin/channels/rollback` | Rollback a channel |
| GET | `/api/admin/users` | Get all user records |
| PUT | `/api/admin/users/:userId` | Update user (channel override, admin flag) |
| GET | `/api/admin/install-commands` | Get install command data |
| GET | `/api/admin/events` | SSE stream for admin events |

## Local Bundle Store

The Local Bundle Store provides a filesystem-backed installer bundle registry for local development. Instead of packing `konductor-setup/` at startup, the server scans a local `installers/` directory for versioned `.tgz` bundles, indexes them in memory, and lets admins assign specific versions to channels via the dashboard.

### Enabling the Local Bundle Store

Set the environment variable in `.env.local`:

```bash
KONDUCTOR_SERVE_CLIENT_BUNDLES_FROM_LOCAL_STORE=true
```

When enabled, the server scans `installers/` (relative to the server working directory) at startup. When disabled or unset, the server uses the default behavior (pack `konductor-setup/` and seed Prod).

### The `installers/` Directory

The `installers/` directory is the filesystem-backed bundle store. It lives relative to the server's working directory (typically `konductor/konductor/installers/`). Place versioned `.tgz` bundles here and the server discovers them at startup.

#### Directory Structure

```
konductor/konductor/
└── installers/
    ├── installer-1.0.0.tgz
    ├── installer-1.1.0.tgz
    ├── installer-1.2.0-beta.1.tgz
    ├── installer-2.0.0-rc.1.tgz
    └── installer-2.0.0.tgz
```

#### Naming Convention

Files must follow the exact pattern:

```
installer-<semver>.tgz
```

Where `<semver>` is a valid [Semantic Versioning 2.0.0](https://semver.org/) string: `MAJOR.MINOR.PATCH[-prerelease][+build]`.

Valid examples:
- `installer-1.0.0.tgz` — stable release
- `installer-1.2.3.tgz` — stable release
- `installer-1.0.0-alpha.2.tgz` — pre-release
- `installer-3.0.0-rc.1+build.42.tgz` — pre-release with build metadata

Invalid examples (skipped with a warning):
- `installer-v1.0.0.tgz` — leading `v` is not valid semver
- `installer-1.0.tgz` — missing patch version
- `installer-latest.tgz` — not a semver string (reserved for the Latest pseudo-channel endpoint)
- `my-bundle-1.0.0.tgz` — doesn't match the `installer-` prefix
- `installer-dev.tgz` — channel names (`dev`, `uat`, `prod`) are reserved and skipped

#### Behavior Rules

| Scenario | Server behavior |
|----------|----------------|
| Directory doesn't exist | Creates `installers/` and logs instructions for where to place bundles |
| Directory is empty (no valid `.tgz` files) | Falls back to packing `konductor-setup/` and seeding Prod channel |
| File has invalid semver in name | Logs a warning and skips the file |
| Two files have the same version | Logs a warning and uses the first one found |
| File can't be read (permissions, corrupt) | Logs an error and skips the file |
| File doesn't contain `bundle-manifest.json` | Uses fallback metadata (version from filename, creation date from file mtime, author "unknown", empty summary) |

#### Startup Logging

On startup, the server logs each discovered bundle:

```
Bundle registry: discovered v2.0.0 (245 KB, created 2026-04-20)
Bundle registry: discovered v1.2.0-beta.1 (230 KB, created 2026-04-18)
Bundle registry: discovered v1.1.0 (220 KB, created 2026-04-15)
Bundle registry: skipping installer-v1.0.tgz — invalid semver "v1.0"
```

#### Adding New Bundles

To add a bundle to the local store:

1. Build and pack `konductor-setup/`:
   ```bash
   cd konductor-setup
   npm run build    # generates bundle-manifest.json
   npm pack         # produces installer-<version>.tgz
   ```
2. Copy the resulting `.tgz` into `installers/`:
   ```bash
   cp installer-*.tgz ../konductor/installers/
   ```
3. Restart the server (the registry is populated at startup, not watched live)
4. Assign the new version to a channel via the admin dashboard

#### Sorting and Precedence

Bundles are sorted by semver precedence (newest first) in all listings and dropdowns:
- `2.0.0` > `1.2.0` > `1.1.0` > `1.0.0`
- Pre-release versions have lower precedence than their associated release: `1.0.0` > `1.0.0-rc.1` > `1.0.0-beta.1` > `1.0.0-alpha.1`
- Build metadata is ignored for precedence comparison

### Bundle Manifest (`bundle-manifest.json`)

Each `.tgz` bundle can contain a `bundle-manifest.json` at the package root (`package/bundle-manifest.json` inside the tarball):

```json
{
  "version": "1.2.0",
  "createdAt": "2026-04-20T09:00:00.000Z",
  "author": "deanwheatley-star",
  "summary": "Channel-aware update URLs, Slack disable checkbox, local bundle store"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | string | yes | Semver version string |
| `createdAt` | string | yes | ISO 8601 timestamp |
| `author` | string | no | Who built this bundle |
| `summary` | string | no | Brief description of features/changes |

If a bundle doesn't contain a manifest, the server falls back to:
- Version from the filename
- Creation date from file mtime
- Author as "unknown"
- Summary as empty

### Channel Assignment Workflow

Once bundles are discovered, admins assign versions to channels from the admin dashboard:

1. Open the Global Client Settings panel at `/admin`
2. Each channel card (Dev, UAT, Prod) shows a dropdown of available versions (sorted newest first)
3. Select a version and click Save
4. The channel immediately serves that bundle to clients

The same version can be assigned to multiple channels. Promote and rollback buttons continue to work — promote copies the version assignment, rollback reverts to the previous one.

### Bundle Manager Page

A dedicated page at `/admin/bundles` provides full visibility into the registry:

- Channel assignment summary cards (Dev, UAT, Prod, Latest)
- Sortable/filterable table of all bundles with: Version, Channels (pill badges), Size, Created, Author, Notes, Actions
- Delete button with confirmation dialog (warns about affected channels/users)
- Real-time updates via SSE
- "Local Store Mode" badge when serving from the local store

Access requires admin authentication (same as `/admin`).

### Latest Pseudo-Channel

Users can be assigned to a "Latest" channel override that always resolves to the most recently created bundle (by `createdAt` timestamp, not semver order):

- Set via the User Management panel's Channel Override dropdown
- Served at `/bundle/installer-latest.tgz`
- When a new bundle is added, "Latest" users get `updateRequired: true` on their next session registration

### Bundle Deletion and Stale Clients

When a bundle assigned to a channel is deleted:

1. The channel enters a "stale" state (no tarball available)
2. Clients on that channel receive `bundleStale: true` in their `register_session` response
3. The steering rule displays: `⚠️ Konductor: Your installer bundle was removed by an admin. Waiting for a replacement...`
4. Clients are NOT blocked — all MCP tools continue to work normally
5. When the admin assigns a new version, clients get `updateRequired: true` and auto-update

### Bundle API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/bundles` | Admin | List all bundles with metadata, sorted by semver |
| DELETE | `/api/admin/bundles/:version` | Admin | Delete a bundle (triggers stale if assigned) |
| PUT | `/api/admin/channels/:channel/assign` | Admin | Assign a version to a channel (`{ version: "1.2.0" }`) |
| GET | `/admin/bundles` | Admin | Bundle Manager page (HTML) |
| GET | `/bundle/installer-latest.tgz` | None | Serve the latest bundle |

### Fallback Behavior

When the local bundle store is enabled but empty (no valid `.tgz` files found), the server falls back to the default behavior: packing `konductor-setup/` and seeding the Prod channel. This ensures the server always has at least one bundle available.

---

# Developing the Konductor Client

Information for contributors working on the client-side components: the installer package (`konductor-setup`), the file watcher, and steering rules.

## Generating the Manifest (`konductor-setup`)

The `konductor-setup/` build process generates `bundle-manifest.json` automatically:

```bash
cd konductor-setup
npm run build   # generates bundle-manifest.json from package.json, git, and CHANGELOG
npm pack        # produces installer-<version>.tgz with the manifest included
```

The manifest is sourced from:
- `version` → `package.json` version field
- `author` → `git config user.name`
- `createdAt` → current timestamp
- `summary` → first entry from `CHANGELOG.md`

## Client Testing Guide

### Same machine (localhost)

Start the server, then install the client from any project directory:

```bash
cd ~/projects/my-project
npm config set strict-ssl false && npx https://localhost:3010/bundle/installer.tgz --server https://localhost:3010 --api-key kd-a7f3b9c2e1d4; npm config set strict-ssl true
```

The `strict-ssl false` is needed because npm uses its own cert store, not the OS trust store. Kiro itself will trust the mkcert cert via the OS. Check `.konductor-watcher.log` for watcher output.

### Remote machine on the same network

Ensure the mkcert CA cert is installed on the remote machine (see cert setup above). Then:

```bash
cd ~/projects/my-project
npm config set strict-ssl false && npx https://192.168.68.64:3010/bundle/installer.tgz --server https://192.168.68.64:3010 --api-key kd-a7f3b9c2e1d4; npm config set strict-ssl true
```

The `strict-ssl false` is needed because npm's cert validation is separate from the OS trust store. The installer and Kiro will trust the cert via the OS.

The MCP config will have `https://192.168.68.64:3010/sse` — Kiro accepts HTTPS URLs from any host.

### HTTP fallback (SSH tunnel)

If you need to run the server without HTTPS (set `KONDUCTOR_PROTOCOL=http` in `.env.local`), remote clients need an SSH tunnel:

```bash
# On the remote client machine
ssh -N -L 3010:localhost:3010 deanwheatley@LT-DWHEATLEY-2.local

# Then install
npx http://localhost:3010/bundle/installer.tgz --server http://localhost:3010 --api-key kd-a7f3b9c2e1d4
```

---

## License

MIT
