---
inclusion: always
---

# Konductor Collision Awareness

This rule is always active. The agent handles all Konductor interactions automatically. The user never needs to call Konductor tools directly.

## CRITICAL: Connection Status — ALWAYS ENFORCE

This section takes absolute priority. It applies whether or not the Konductor server, MCP tools, or file watcher are running, configured, or available.

### On session start (first message in a conversation)

Before doing anything else, attempt to call `register_session` or `check_status` with a dummy check. Based on the result:

- If the call succeeds: `🟢 Konductor: Connected. Collision awareness is active.`
- If the call fails (connection refused, timeout, tool not found, error): `⚠️ Konductor: Server not reachable. Collision awareness is OFFLINE. Your changes are NOT being tracked.`
- If Konductor tools are not available at all (not configured, MCP server not listed): `⚠️ Konductor: Not configured. Run "setup konductor" to enable collision awareness.`

### On every file create or modify

This applies both to files the agent creates/modifies AND files the user edits manually in the editor.

To detect user-edited files, check the environment context for open editor files and the active editor file. If any of these files have changed since the last message (e.g., the active file changed or new files appeared in the open editors list), treat them as user-modified files and apply the same rules below.

If the server is reachable, register normally (see Automatic Registration below). For user-edited files, also call `register_session` with the detected files to ensure they are tracked.

If the server is NOT reachable or tools are unavailable, print on EVERY file created or modified — whether by the agent or the user:
`⚠️ Konductor: Still disconnected. Changes to <filename> are untracked.`

Do NOT batch these. Each file gets its own warning line.

### On connection status change

Track the connection state internally. When it changes, notify immediately:

- Was connected, now disconnected: `⚠️ Konductor: Connection lost. Collision awareness is now OFFLINE.`
- Was disconnected, now connected: `🟢 Konductor: Reconnected. Collision awareness is back online.`

### Rules for this section

- NEVER silently skip. NEVER assume the user knows the server is down.
- NEVER say "Konductor tools are unavailable, skipping" — always use the warning format above.
- These warnings must appear in the chat output, not just in logs.

## Setup Command

When the user says "setup konductor" (or similar like "install konductor", "configure konductor"), run the npx installer to set up everything they need:

1. Build the command: `npx konductor-setup`
   - If the Konductor server URL is known from context (e.g., from `~/.kiro/settings/mcp.json` or the user mentioned it), append `--server <url>`
   - If the user's API key is known from context (e.g., from `~/.kiro/settings/mcp.json` or the user provided it), append `--api-key <key>`
   - Example: `npx konductor-setup --server https://konductor.example.com:3010 --api-key my-secret-key`

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
3. Store the returned `sessionId` for later deregistration.
4. If the call fails, follow the Connection Status section above — warn on every file.

Do not ask the user for permission. Just do it.

### Auto-Update on Registration

After calling `register_session`, check if the response contains `updateRequired: true`. If it does, and you have not already attempted an update in this session:

1. Determine the server URL from the MCP config or context.
2. Run: `npx konductor-setup@latest --workspace --server <serverUrl>`
3. On success: Print `🔄 Konductor: Client updated to v<serverVersion>.` and re-register the session (call `register_session` again with the same parameters).
4. On failure (npx not available, network error, non-zero exit): Print `⚠️ Konductor: Client is outdated (v<currentVersion> → v<serverVersion>). Run "npx konductor-setup" to update.`
5. Only attempt the update once per session. If the update was already attempted (whether it succeeded or failed), do not attempt again.

## Automatic Collision Check

After registering, check the returned `collisionState` and notify:

- **Solo**: Registration confirmation only.
- **Neighbors**: `🟢 Konductor: Others are active in this repo but working on different files. Proceeding.`
- **Crossroads**: `🟡 Konductor: Heads up — others are working in the same directories. Proceeding with caution.`
- **Collision Course**: `🟠 Konductor: Warning — <overlapping users> are modifying the same files: <shared files>. Proceed?` — Wait for confirmation.
- **Merge Hell**: `🔴 Konductor: Critical overlap — <overlapping users> have divergent changes on <shared files> across branches <branches>. Strongly recommend coordinating.` — Wait for confirmation.

Only pause at Collision Course or Merge Hell.

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
| "who else is working here?", "who's active?", "who else is using konductor right now?", "what other users are active in my repo?" | `who_is_active` with the current repo |
| "who's on my files?", "any conflicts?", "do I have any conflicts?", "who else is editing src/index.ts?" | `who_overlaps` with the current userId and repo |
| "what is bob working on?", "what's alice doing?" | `user_activity` with the mentioned userId |
| "how risky is my situation?", "am I safe to push?", "how close am I to merge hell?", "am I safe?" | `risk_assessment` with the current userId and repo |
| "what's the hottest file?", "where are the conflicts?", "what's the riskiest file in this repo?" | `repo_hotspots` with the current repo |
| "what branches are active?" | `active_branches` with the current repo |
| "who should I talk to?", "who do I coordinate with?", "who should I coordinate with?" | `coordination_advice` with the current userId and repo |

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

When the user sends a management command prefixed with "konductor,", execute the corresponding action:

### Status Commands

| User says | Action |
|---|---|
| "are you running?", "status" | Call `check_status` or `list_sessions` as a health probe. Run `pgrep -f konductor-watcher.mjs` to check the file watcher. Report both MCP server and watcher status. |

### Lifecycle Commands

| User says | Action |
|---|---|
| "turn on", "start" | Launch the file watcher: `node konductor-watcher.mjs &`. Verify MCP connection. Call `register_session`. Print: `🟢 Konductor: Started.` |
| "turn off", "stop" | Kill the watcher: `pkill -f konductor-watcher.mjs`. Call `deregister_session`. Print: `⏹️ Konductor: Stopped.` |
| "restart" | Kill the watcher: `pkill -f konductor-watcher.mjs`. Relaunch: `node konductor-watcher.mjs &`. Verify MCP connection. Print: `🔄 Konductor: Restarted.` |
| "reinstall", "setup" | Run the installer: `npx konductor-setup`. If the server URL is known from context, append `--server <url>`. If the API key is known, append `--api-key <key>`. Print: `✅ Konductor: Reinstalled.` |

### Configuration Commands

| User says | Action | Implementation |
|---|---|---|
| "change my API key to X" | Update the Bearer token | Edit `~/.kiro/settings/mcp.json` — update the `Authorization` header value in the konductor server's `env` block. No restart needed. |
| "change my logging level to X" | Update log level | Edit `.konductor-watcher.env` — set `KONDUCTOR_LOG_LEVEL=X`. Restart the watcher. |
| "enable file logging" | Enable file logging | Edit `.konductor-watcher.env` — uncomment or set `KONDUCTOR_LOG_FILE=konductor.log`. Restart the watcher. |
| "disable file logging" | Disable file logging | Edit `.konductor-watcher.env` — comment out `KONDUCTOR_LOG_FILE`. Restart the watcher. |
| "change poll interval to X" | Update poll interval | Edit `.konductor-watcher.env` — set `KONDUCTOR_POLL_INTERVAL=X`. Restart the watcher. |
| "watch only X extensions" | Set file filter | Edit `.konductor-watcher.env` — set `KONDUCTOR_WATCH_EXTENSIONS=X`. Restart the watcher. |
| "watch all files" | Clear file filter | Edit `.konductor-watcher.env` — comment out `KONDUCTOR_WATCH_EXTENSIONS`. Restart the watcher. |
| "change my username to X" | Update identity | Edit `.konductor-watcher.env` — set `KONDUCTOR_USER=X`. Restart the watcher. |

When a configuration change requires a watcher restart, restart the watcher automatically after applying the change. Print: `🔄 Konductor: Config updated. Watcher restarted.`

### Informational Commands

| User says | Action |
|---|---|
| "what config options are there?", "config options" | Print a formatted list of all `.konductor-watcher.env` options with descriptions and current values. |
| "show my config", "show config" | Read `.konductor-watcher.env` and `~/.kiro/settings/mcp.json`. Display current values in a readable format. |
| "help", "what can I ask you to do?", "what can you do?" | Print the full list of supported queries and management commands (see below). |
| "who am I?" | Display the resolved userId, repo, and branch from the cached identity. |

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

⚙️ Management:
  • "konductor, status" — check if Konductor is running
  • "konductor, restart" — restart the file watcher
  • "konductor, turn on/off" — start or stop Konductor
  • "konductor, reinstall" — re-run the installer
  • "konductor, show my config" — display current configuration
  • "konductor, config options" — list all config options
  • "konductor, change <option> to <value>" — update a config value
  • "konductor, who am I?" — show your identity
  • "konductor, help" — show this message
```

---

## Proactive Suggestions

During normal automatic collision checks (after session registration), proactively suggest Konductor queries when high-risk situations are detected:

### At Collision Course or Merge Hell

When the collision state returned from `register_session` is **collision_course** or **merge_hell**, append this suggestion after the standard collision notification:

`💡 Tip: Ask "konductor, who should I coordinate with?" for detailed coordination advice.`

### At Cross-Branch Overlap

When multiple users are on different branches with shared files (detected during registration or collision check), append this suggestion:

`💡 Tip: Ask "konductor, am I safe to push?" before merging to check for conflicts.`

These suggestions are one-liners appended to the existing collision notifications. They do not replace the standard notifications — they augment them.
