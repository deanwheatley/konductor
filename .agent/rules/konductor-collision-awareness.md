---
inclusion: always
---

# Konductor Collision Awareness

This rule is always active. The agent handles all Konductor interactions automatically. The user never needs to call Konductor tools directly.

## CRITICAL: Connection Status — ALWAYS ENFORCE

This section takes absolute priority. It applies whether or not the Konductor server, MCP tools, or file watcher are running, configured, or available.

### On session start (first message in a conversation)

Before doing anything else:

1. Check if the file watcher is running. Read `.konductor-watcher.pid` and verify the PID is alive: `cat .konductor-watcher.pid 2>/dev/null && kill -0 $(cat .konductor-watcher.pid) 2>/dev/null`
   - If NOT running and `konductor-watcher.mjs` exists in the workspace root, start it detached: `node konductor-watcher.mjs &`. Note that the watcher was restarted.
   - If NOT running and the file doesn't exist, note that the watcher is not installed.

2. Attempt to call `register_session` or `check_status` with a dummy check. Note whether the MCP server is reachable.

3. Print a consolidated status message based on the results:

- If the watcher is running (or was just restarted) AND the MCP server is reachable:
  - Print: `🟢 Konductor: Fully operational and watching your back!`
  - If the response contains a `repoPageUrl` field, print: `📊 Dashboard: <repoPageUrl>`
  - If the response contains `isAdmin: true` and an `adminPageUrl` field, additionally print: `🔧 Admin: <adminPageUrl>`
- If the watcher is running but the MCP server is NOT reachable:
  - Print: `⚠️ Konductor: Server not reachable. Collision awareness is OFFLINE. Your changes are NOT being tracked.`
  - Also print: `🟢 Konductor: File watcher is running.`
  - Print: `🛠️ To fix: Check that the Konductor server is running and accessible. Verify the URL in ~/.kiro/settings/mcp.json is correct.`
- If the MCP server is reachable but the watcher is NOT running and couldn't be started:
  - Print: `⚠️ Konductor: File watcher not running. Your file changes are not being detected.`
  - Also print: `🟢 Konductor: Server connected.`
  - Print: `🛠️ To fix: Say "konductor, restart" to relaunch the watcher, or run "setup konductor" to reinstall.`
- If Konductor tools are not available at all (not configured, MCP server not listed):
  - Print: `⚠️ Konductor: Not configured. Run "setup konductor" to enable collision awareness.`
- If both are down: print both warnings individually with their fix instructions.

### On every file create or modify

If the server is reachable, register normally (see Automatic Registration below).

If the server is NOT reachable or tools are unavailable, print on EVERY file you create or modify:
`⚠️ Konductor: Still disconnected. Changes to <filename> are untracked.`

Do NOT batch these. Each file gets its own warning line.

### On connection status change

Track the connection state internally. When it changes, notify immediately:

- Was connected, now disconnected:
  - Print: `⚠️ Konductor: Connection lost. Collision awareness is now OFFLINE.`
  - Print: `🛠️ To fix: Say "konductor, status" to diagnose, or "konductor, restart" to reconnect.`
- Was disconnected, now connected:
  - Print: `🟢 Konductor: Reconnected. Collision awareness is back online.`
  - If the response contains a `repoPageUrl`, print: `📊 Dashboard: <repoPageUrl>`
  - If the response contains `isAdmin: true` and `adminPageUrl`, print: `🔧 Admin: <adminPageUrl>`

### Re-verification — NEVER trust cached state

The agent MUST NOT cache the connection status and assume it remains valid across messages. Connections can drop at any time.

- WHEN a Konductor MCP tool call fails (timeout, connection refused, error response), the agent MUST immediately update the connection state to disconnected and print the disconnection warning. Do NOT retry silently and report success.
- WHEN the user asks "konductor, status" or "konductor, are you running?", the agent MUST perform a live check (call `check_status` or `list_sessions` AND verify `.konductor-watcher.pid` — read the PID and check it's alive with `kill -0`). NEVER answer from memory.
- WHEN the agent is about to modify files and the last successful MCP call was more than 60 seconds ago, the agent SHOULD re-verify by calling `check_status` before registering.
- WHEN reporting connection status in any context, the agent MUST base the report on the result of an actual tool call or health check performed in the current turn, not on a previous turn's result.

### Rules for this section

- NEVER silently skip. NEVER assume the user knows the server is down.
- NEVER say "Konductor tools are unavailable, skipping" — always use the warning format above.
- These warnings must appear in the chat output, not just in logs.
- ALWAYS tell the user HOW to fix the problem, not just that there is one.

## Setup Command

When the user says "setup konductor" (or similar like "install konductor", "configure konductor"), run the npx installer to set up everything they need:

1. First, call the `client_install_info` MCP tool to get the correct install commands with the server's URL baked in. If the tool is not available, build the command manually:
   - Get the server URL from `~/.kiro/settings/mcp.json` (the `url` field in the konductor entry, minus `/sse`)
   - Build: `npx <serverUrl>/bundle/installer.tgz --server <serverUrl>`
   - If the user's API key is known from context, append `--api-key <key>`

2. Run the command. The installer handles everything automatically: MCP config (merged into existing), steering rules, hooks, agent rules, file watcher (launched as background process), and watcher config. It works cross-platform (macOS, Linux, Windows) without requiring bash or PowerShell.

3. After the installer runs, remind the user to verify the API key is set correctly in `~/.kiro/settings/mcp.json`.

4. Confirm setup is complete: `✅ Konductor: Setup complete. Collision awareness is now active in this workspace.`

## Identity

Determine the user identity and repository context automatically using this priority chain:

- `userId`: Try each in order, use the first that succeeds:
  1. `KONDUCTOR_USER` in `.konductor-watcher.env` (already resolved and persisted)
  2. `gh api user --jq .login` (GitHub CLI — gives the actual GitHub username)
  3. `git config user.name`
  4. System hostname as a last resort
- `repo`: Run `git remote get-url origin` and extract the `owner/repo` portion
- `branch`: Run `git branch --show-current`

Cache these values for the duration of the session. Do not ask the user for them.

## Persist Identity

On first session start, if `KONDUCTOR_USER` is empty or commented out in `.konductor-watcher.env`, resolve the userId and write it into the file. Do this silently.

## Automatic Registration

Whenever you are about to create or modify files as part of a task:

1. Call `register_session` with the userId, repo, branch, and the full list of files you plan to touch.
2. Print: `🟢 Konductor: Registered session on <repo>#<branch> (<N> files)`
3. If the response contains a `repoPageUrl` field, print: `📊 Dashboard: <repoPageUrl>`
4. If the response contains `isAdmin: true` and `adminPageUrl`, print: `🔧 Admin: <adminPageUrl>`
5. Store the returned `sessionId` for later deregistration.
6. If the call fails, follow the Connection Status section above — warn on every file.

Do not ask the user for permission. Just do it.

### Auto-Update on Registration

After calling `register_session`, check if the response contains `updateRequired: true`. If it does, and you have not already attempted an update in this session:

1. Determine the server URL from the MCP config or context (the `url` field in the konductor entry, minus `/sse`).
2. Run: `npx <serverUrl>/bundle/installer.tgz --workspace --server <serverUrl>`
3. On success: Print `🔄 Konductor: Client updated to v<serverVersion>.` and re-register the session (call `register_session` again with the same parameters).
4. On failure (npx not available, network error, non-zero exit): Print `⚠️ Konductor: Client is outdated (v<currentVersion> → v<serverVersion>). Run the install command from "konductor, how do I install?" to update.`
5. Only attempt the update once per session. If the update was already attempted (whether it succeeded or failed), do not attempt again.

### Bundle Stale Warning on Registration

After calling `register_session`, check if the response contains `bundleStale: true`. If it does:

1. Print: `⚠️ Konductor: Your installer bundle was removed by an admin. Waiting for a replacement...`
2. If the response contains a `staleMessage`, print it as additional context.
3. Do NOT block the user. Session registration, collision checks, and all MCP tools continue to work normally.
4. On the next `register_session` call, if the response contains `updateRequired: true` instead of `bundleStale: true`, the stale state is resolved — follow the standard Auto-Update flow above.

This warning should be printed once per session start. If the stale state persists across multiple registrations in the same session, do not repeat the warning.

## Automatic Collision Check

After registering, check the returned `collisionState` and notify. ALL collision states from Crossroads and above MUST be reported to the user immediately with a summary and a link to the repo dashboard.

- **Solo**: Registration confirmation only.
- **Neighbors**: `🟢 Konductor: Others are active in this repo but working on different files. Proceeding.`
- **Crossroads**:
  - Print: `🟡 Konductor: Heads up — others are working in the same directories. Proceeding with caution.`
  - Print: `📊 Dashboard: <repoPageUrl>` (from the registration response)
- **Proximity**:
  - Print: `🟢 Konductor: Same file as <overlapping users>, but different sections — no line overlap. Proceeding.`
  - Print: `📊 Dashboard: <repoPageUrl>`
  - Do NOT pause.
- **Collision Course**:
  - Print: `🟠 Konductor: Warning — <overlapping users> are modifying the same files: <shared files>. Proceed?`
  - Print: `📊 Dashboard: <repoPageUrl>`
  - When line overlap details are available (`lineOverlapDetails` with `lineOverlap: true`): append line context, e.g. `<user> is editing <file> lines 10-25, overlapping with your lines 15-30.`
  - When line data is unavailable: use the existing file-level message (no change).
  - Wait for confirmation.
- **Merge Hell**:
  - Print: `🔴 Konductor: Critical overlap — <overlapping users> have divergent changes on <shared files> across branches <branches>. Strongly recommend coordinating.`
  - Print: `📊 Dashboard: <repoPageUrl>`
  - When `overlapSeverity` is `severe`: append `High merge conflict risk. Coordinate immediately.`
  - When `overlapSeverity` is `minimal`: append `Minor overlap — likely a quick merge resolution.`
  - When `overlapSeverity` is `moderate` or unavailable: use the existing message (no additional text).
  - Wait for confirmation.

Only pause at Collision Course or Merge Hell. Proximity does NOT pause the agent.

### High-Severity Terminal Echo

When the collision state is **Collision Course** or **Merge Hell**, the agent MUST additionally echo a short warning to the user's active IDE terminal so it is visible even if the chat panel is not in focus. Run a shell command:

- **Collision Course**: `echo "🟠 KONDUCTOR: COLLISION COURSE — <overlapping users> modifying same files: <shared files>" >&2`
- **Merge Hell**: `echo "🔴 KONDUCTOR: MERGE HELL — <overlapping users> have divergent changes on <shared files> across branches <branches>" >&2`

This is in addition to the chat message, not a replacement. The file watcher also logs these to its own terminal independently.

### Source-Attributed Collision Messages

When the collision result includes `overlappingDetails`, format each overlapping session with source context. Each source type has its own message format:

- **Active session (source: `active`)**: `🟠 Warning — <user> is actively editing <files> on <branch>.`
- **PR (source: `github_pr`)**: `🟠 Warning — <user>'s PR #<number> (<url>) modifies <files>, targeting <target_branch>.`
- **Approved PR (source: `github_pr`, approved)**: `🔴 Critical — <user>'s PR #<number> is approved and targets <target_branch>. Merge is imminent.`
- **Draft PR (source: `github_pr`, draft)**: `🟡 Heads up — <user> has a draft PR #<number> touching <files>. Low risk but worth tracking.`
- **Commits (source: `github_commit`)**: `🟠 Warning — <user> pushed commits to <branch> (<date_range>) modifying <files>.`

When multiple source types collide simultaneously, each source gets its own context line.

### Resolution Suggestions

When displaying a Collision Course or Merge Hell warning, the agent SHALL append a numbered list of suggested resolution actions appropriate to the situation.

#### Same Branch Collision (collision_course)

```
🛠️ Suggested actions:
  1. `git pull --rebase` — Rebase your changes on top of the other user's
  2. Coordinate with <user> — Agree on who edits which sections
  3. `git stash` — Shelve your changes and wait for the other user to finish
  4. Continue working — Accept the risk of merge conflicts
```

#### Cross-Branch Collision (merge_hell)

```
🛠️ Suggested actions:
  1. Stop and coordinate — Talk to <user> before making more changes
  2. `git pull --rebase origin/<their-branch>` — Rebase onto their branch
  3. `git stash` — Shelve and wait for their branch to merge first
  4. Create a shared branch — Both work on a common feature branch
  5. Continue working — Accept the risk of complex merge conflicts
```

#### Approved PR Imminent

```
🛠️ Suggested actions:
  1. `git add . && git commit` — Commit your changes immediately before the merge
  2. Ask <user> to hold the merge — Request a delay via Slack/chat
  3. `git stash` — Shelve and rebase after the PR merges
```

#### Handling "do option N"

When the user says "do option N" or "option N" after seeing resolution suggestions:

1. Map the number to the corresponding action from the most recently displayed suggestion list.
2. If the action involves a git command (`git pull --rebase`, `git stash`, `git add . && git commit`), display the exact command and ask for explicit confirmation: `⚠️ This will run: \`<command>\`. Confirm? (yes/no)`
3. Only execute the command after the user explicitly confirms with "yes".
4. NEVER execute destructive git commands (rebase, stash, reset, force push) without explicit user confirmation.
5. If the action is non-destructive (e.g., "coordinate with <user>", "continue working"), acknowledge and proceed without a confirmation prompt.

## Automatic Session Updates

If the file list changes mid-task, call `register_session` again. Print: `🔄 Konductor: Updated session — now tracking <N> files`

## Automatic Deregistration

When done, call `deregister_session`. Print: `✅ Konductor: Session closed.`

## Rules

- Never ask the user to call Konductor tools themselves.
- Never ask the user to start the file watcher manually.
- Always register when modifying files.
- Keep notifications short and emoji-prefixed.
- NEVER silently skip when the server is unreachable — always warn the user.
- ALWAYS notify when connection status changes (connected ↔ disconnected).
- ALWAYS include the repo dashboard link in collision notifications (Crossroads and above).
- ALWAYS include the admin page link when the user is an admin (on session start and reconnection).
- ALWAYS tell the user HOW to fix connection problems, not just that there is one.

---

## Talking to Konductor — The "konductor," Activation Prefix

Users interact with Konductor by prefixing their message with **"konductor,"** (case-insensitive). This tells the agent the message is directed at Konductor rather than being a general coding request.

### When the prefix is required

- All user-initiated queries: "konductor, who else is here?", "konductor, help", "konductor, status"
- All management commands: "konductor, restart", "konductor, change my API key to X"

### When the prefix is NOT required

- Automatic background operations continue without any prefix:
  - Session registration on file save
  - Collision checks after registration
  - Session updates when the file list changes
  - Session deregistration when work is done
  - Connection status checks on session start

### Routing

When a message starts with "konductor," (case-insensitive):

1. Strip the prefix and match the remainder against the Query Routing Table and Management Command Routing sections below.
2. If a match is found, execute the corresponding tool call or action.
3. If no match is found, respond with:
   `🤔 Konductor: I didn't understand that. Try "konductor, help" to see what I can do.`

---

## Query Routing Table

When the user asks a question prefixed with "konductor,", match it to the appropriate MCP query tool:

| User says (examples) | Tool to call |
|---|---|
| "who else is working here?", "who's active?" | `who_is_active` with the current repo |
| "who's on my files?", "any conflicts?" | `who_overlaps` with the current userId and repo |
| "what is bob working on?", "what's alice doing?" | `user_activity` with the mentioned userId |
| "how risky is my situation?", "am I safe to push?" | `risk_assessment` with the current userId and repo |
| "what's the hottest file?", "where are the conflicts?" | `repo_hotspots` with the current repo |
| "what branches are active?" | `active_branches` with the current repo |
| "who should I talk to?" | `coordination_advice` with the current userId and repo |
| "show PRs", "what PRs are open?" | Call `who_is_active` filtered to `github_pr` sources. Display PR number, author, branch, target, status, and file count. |
| "show history", "recent activity" | Fetch recent commits, PRs, and merges. Display with timestamp, action, user, branch, and summary. |
| "show slack config", "slack status" | Call `get_slack_config` MCP tool with the current repo. |
| "show baton", "show dashboard", "what's my repo url?" | Display the `repoPageUrl` from the most recent `register_session` response. |
| "open baton", "open dashboard" | Open the Baton repo page URL in the user's default browser. |
| "open slack" | Open the configured Slack channel URL in the user's default browser. |
| "is it safe to unstash?", "is it safe?", "can I continue?" | Call `check_status` or `who_overlaps` for the files that were previously stashed. |
| "live share with <user>", "pair with <user>", "live share" | Initiate a Live Share collaboration request. |
| "accept collab from <user>" | Accept a pending collaboration request. |
| "decline collab from <user>" | Decline a pending collaboration request. |
| "share link <url>" | Share a Live Share join link with the collaboration partner. |
| "check live share" | Re-run Live Share extension detection and update the cached status. |
| "join <url>" | Join a Live Share session by URL. |

### Browser Open — Platform Detection

- **macOS**: `open <url>`
- **Linux**: `xdg-open <url>`
- **Windows**: `start <url>`

### Formatting Rules

- Use emoji prefixes for severity and category:
  - 🟢 Solo / safe / no overlap
  - 🟡 Crossroads / low risk
  - 🟠 Collision course / medium risk
  - 🔴 Merge hell / high risk
  - 👤 User info
  - 📂 File/branch info
  - 🎯 Coordination targets
- Format results as readable lists with clear labels — never return raw JSON.
- Keep responses concise and actionable.

---

## Management Command Routing

### Status Commands

| User says | Action |
|---|---|
| "are you running?", "status" | Call `check_status` or `list_sessions` as a health probe. Check `.konductor-watcher.pid` — read the PID and verify it's alive with `kill -0`. Report both MCP server and watcher status. |

### Lifecycle Commands

| User says | Action |
|---|---|
| "turn on", "start", "connect" | Launch the file watcher: `node konductor-watcher.mjs &`. Verify MCP connection. Call `register_session`. Print: `🟢 Konductor: Started.` |
| "turn off", "stop", "disconnect" | Kill the watcher using PID from `.konductor-watcher.pid`: `kill $(cat .konductor-watcher.pid) 2>/dev/null; rm -f .konductor-watcher.pid`. Call `deregister_session`. Print: `⏹️ Konductor: Stopped.` |
| "restart", "reconnect" | Kill the watcher, relaunch, verify MCP connection. Print: `🔄 Konductor: Restarted.` |
| "update" | Get the server URL from MCP config. Run: `npx <serverUrl>/bundle/installer.tgz --workspace --server <serverUrl>`. |
| "reinstall", "setup" | Run the full installer via `client_install_info` or manual command. |

### Configuration Commands

| User says | Action |
|---|---|
| "change my API key to X" | Edit `~/.kiro/settings/mcp.json` — update the `Authorization` header. |
| "change my logging level to X" | Edit `.konductor-watcher.env` — set `KONDUCTOR_LOG_LEVEL=X`. Restart watcher. |
| "enable file logging" | Edit `.konductor-watcher.env` — set `KONDUCTOR_LOG_FILE=konductor.log`. Restart watcher. |
| "disable file logging" | Edit `.konductor-watcher.env` — comment out `KONDUCTOR_LOG_FILE`. Restart watcher. |
| "change poll interval to X" | Edit `.konductor-watcher.env` — set `KONDUCTOR_POLL_INTERVAL=X`. Restart watcher. |
| "watch only X extensions" | Edit `.konductor-watcher.env` — set `KONDUCTOR_WATCH_EXTENSIONS=X`. Restart watcher. |
| "watch all files" | Edit `.konductor-watcher.env` — comment out `KONDUCTOR_WATCH_EXTENSIONS`. Restart watcher. |
| "change my username to X" | Edit `.konductor-watcher.env` — set `KONDUCTOR_USER=X`. Restart watcher. |
| "change slack channel to X" | Call `set_slack_config` MCP tool with `{ repo, channel: X }`. |
| "change slack verbosity to X" | Call `set_slack_config` MCP tool with `{ repo, verbosity: X }`. |
| "disable slack" | Call `set_slack_config` MCP tool with `{ repo, verbosity: 0 }`. |
| "enable slack" | Call `set_slack_config` MCP tool with `{ repo, verbosity: 2 }`. |

### Informational Commands

| User says | Action |
|---|---|
| "config options" | Print all `.konductor-watcher.env` options with descriptions and current values. |
| "show my config" | Read `.konductor-watcher.env` and `~/.kiro/settings/mcp.json`. Display current values. |
| "help" | Print the full list of supported queries and management commands. |
| "who am I?" | Display the resolved userId, repo, and branch. |

### Help Output

When the user asks "konductor, help", respond with:

```
🤖 Konductor — Here's what I can do:

📊 Queries:
  • "konductor, who else is working here?" — see active users
  • "konductor, who's on my files?" — check for file overlaps
  • "konductor, what is <user> working on?" — see a user's sessions
  • "konductor, how risky is my situation?" — get a risk assessment
  • "konductor, what's the hottest file?" — find repo hotspots
  • "konductor, what branches are active?" — list active branches
  • "konductor, who should I talk to?" — get coordination advice
  • "konductor, show PRs" — see open pull requests for this repo
  • "konductor, show history" — see recent commits, PRs, and merges
  • "konductor, slack status" — show Slack config for this repo
  • "konductor, show baton" / "what's my repo url?" — display the Baton dashboard URL
  • "konductor, open baton" — open the Baton dashboard in your browser
  • "konductor, open slack" — open the Slack channel in your browser
  • "konductor, is it safe?" — check if it's safe to resume after shelving
  • "konductor, live share with <user>" — request a pairing session
  • "konductor, check live share" — check if Live Share extension is installed

⚙️ Management:
  • "konductor, status" — check if Konductor is running
  • "konductor, restart" / "reconnect" — restart the file watcher
  • "konductor, connect" / "disconnect" — start or stop Konductor
  • "konductor, update" — update client to latest server version
  • "konductor, reinstall" — re-run the full installer
  • "konductor, show my config" — display current configuration
  • "konductor, config options" — list all config options
  • "konductor, change <option> to <value>" — update a config value
  • "konductor, change slack channel to X" — set Slack channel for this repo
  • "konductor, disable slack" / "enable slack" — toggle Slack notifications
  • "konductor, accept/decline collab from <user>" — respond to a collaboration request
  • "konductor, share link <url>" — share a Live Share join link
  • "konductor, join <url>" — join a Live Share session
  • "konductor, who am I?" — show your identity
  • "konductor, help" — show this message
```

---

## Slack Config Change SSE Event

When the agent receives a `slack_config_change` SSE event for the current repo, display:

```
📢 Konductor: Slack alerts for <repo> now go to #<channel> (verbosity: <level>).
🔗 Slack channel: <slackChannelLink>
```

---

## Proactive Suggestions

During normal automatic collision checks (after session registration), proactively suggest Konductor queries when high-risk situations are detected:

### At Collision Course or Merge Hell

When the collision state returned from `register_session` is **collision_course** or **merge_hell**, append this suggestion after the standard collision notification:

`💡 Tip: Ask "konductor, who should I coordinate with?" for detailed coordination advice.`

Additionally, append a Live Share suggestion:

- **Collision Course**: `💡 Tip: Say "konductor, live share with <overlapping user>" to start a pairing session.`
- **Merge Hell**: `🤝 Strongly recommend pairing. Say "konductor, live share with <overlapping user>" to coordinate in real-time.`

### At Cross-Branch Overlap

When multiple users are on different branches with shared files, append:

`💡 Tip: Ask "konductor, am I safe to push?" before merging to check for conflicts.`

---

## Pending Collaboration Request Display

After every `register_session` or `check_status` call, check if the response contains a `pendingCollabRequests` array. If present and non-empty, display the requests to the user.

### Recipient — Incoming Requests

- **Single request**: `🤝 Konductor: <initiator> wants to pair with you on <files> (collision: <state>). Say "konductor, accept collab from <initiator>" or "konductor, decline collab from <initiator>".`
- **Multiple requests**: Display a numbered list sorted by recency (newest first).

### Initiator — Status Updates

- **Accepted**: `🟢 Konductor: <recipient> accepted your collaboration request.`
- **Declined**: `👋 Konductor: <recipient> declined your collaboration request.`
- **Link shared**: `🔗 Konductor: <recipient> shared a Live Share link: <url>. Open it to join the session.`
- **Expired**: `⏰ Konductor: Your collaboration request to <recipient> expired. Say "konductor, live share with <recipient>" to try again.`

### Deduplication

Track displayed request IDs for the session. Do not re-display a request that has already been shown unless its status has changed.

---

## Live Share Collaboration

### Initiating — "konductor, live share with <user>"

1. Parse the target username (strip `@` prefix).
2. Validate via `who_is_active`. If not found: `⚠️ Konductor: <user> doesn't appear to be active in this repo.`
3. Call `create_collab_request` MCP tool. On success: `🤝 Konductor: Collaboration request sent to <user>.`

### Without a Target User — "konductor, live share"

Auto-select the highest-severity overlapping user from the most recent collision state.

### Responding — "konductor, accept/decline collab from <user>"

- Accept: Call `respond_collab_request` with `action: "accept"`. Attempt Live Share auto-start if installed.
- Decline: Call `respond_collab_request` with `action: "decline"`. Print: `👋 Konductor: Declined. <initiator> will be notified.`

### Share Link — "konductor, share link <url>"

1. Validate URL contains `liveshare` or `vsengsaas.visualstudio.com`.
2. Find the most recent accepted collab request.
3. Call `share_link` MCP tool. Print: `🔗 Konductor: Live Share link sent to <initiator>.`

---

## Live Share Extension Detection

Cached per session. Detection runs on first live share command or accept.

1. Try: `code --list-extensions 2>/dev/null | grep -i ms-vsliveshare`
2. If installed: proceed silently.
3. If not installed: offer to install.
4. If `code` CLI unavailable: fall back to manual instructions.

---

## Live Share Session Automation

### Auto-Start After Accept

After accepting a collab request with Live Share installed:
1. Attempt `liveshare.start` via extension API or CLI.
2. If URI captured: auto-share via `share_link` MCP tool.
3. If not captured: prompt user to copy link and say `"konductor, share link <url>"`.

### Joining — "konductor, join <url>"

1. Validate URL.
2. Try extension API or CLI to join.
3. Fall back to opening URL in default browser.
