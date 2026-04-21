# Client Connection Use Cases

## Overview

These use cases cover the full client lifecycle: onboarding, connection, disconnection, reconnection, and auto-update. The "client" is the combination of the AI agent (via steering rules + MCP tools) and the file watcher background process.

---

## UC-1.1: First-Time Setup via npx Command (Manual Install)

**Actor:** New client developer  
**Precondition:** Node.js 20+ installed, Konductor server running, no prior Konductor installation  
**Trigger:** User runs the npx install command from their project directory

**Steps:**
1. User obtains server URL and API key from their team
2. User runs: `npm config set strict-ssl false && npx https://<server>:3010/bundle/installer.tgz --server https://<server>:3010 --api-key <key>; npm config set strict-ssl true`
3. Installer creates `~/.kiro/settings/mcp.json` with server URL and API key
4. Installer creates `.kiro/settings/mcp.json` in workspace with MCP config
5. Installer deploys steering rules (global + workspace), hooks, agent rules
6. Installer deploys file watcher (`konductor-watcher.mjs`, launcher, watchdog)
7. Installer creates `.konductor-watcher.env` with default config
8. Installer writes `.konductor-version` with installed version
9. Installer adds Konductor artifacts to `.gitignore`
10. Installer launches file watcher as background process
11. Installer prints summary of what was installed
12. Kiro auto-detects MCP config change and connects to server

**Expected Result:**
- All files deployed to correct locations
- File watcher running (verify with `pgrep -f konductor-watcher.mjs`)
- Kiro shows "konductor" as connected in MCP Servers panel
- Agent steering rule is active (user can say "konductor, help")

**Verification:**
- `ls .kiro/settings/mcp.json` → exists
- `ls .kiro/steering/konductor-collision-awareness.md` → exists
- `ls .kiro/hooks/konductor-file-save.hook.md` → exists
- `ls .kiro/hooks/konductor-session-start.hook.md` → exists
- `ls konductor-watcher.mjs` → exists
- `ls .konductor-watcher.env` → exists
- `cat .konductor-version` → shows version number
- `pgrep -f konductor-watcher.mjs` → returns PID

---

## UC-1.2: First-Time Setup via MCP Config (Auto-Install)

**Actor:** New client developer  
**Precondition:** Node.js 20+ installed, Konductor server running, no prior Konductor installation  
**Trigger:** User manually creates `.kiro/settings/mcp.json` with Konductor server URL

**Steps:**
1. User creates `.kiro/settings/mcp.json` with the konductor server entry (URL + API key)
2. Kiro detects config change and connects to Konductor MCP server
3. On first `register_session` call, server responds with `updateRequired: true` (client has no version)
4. Steering rule triggers auto-install: runs `npx <server>/bundle/installer.tgz --workspace --server <server>`
5. Installer deploys all workspace artifacts (watcher, hooks, steering, agent rules)
6. Installer launches file watcher
7. Agent re-registers session after install completes
8. User sees: `🔄 Konductor: Client updated to v<version>.`

**Expected Result:**
- Full client installation completed automatically
- No manual intervention required after initial MCP config
- File watcher running
- All subsequent sessions managed automatically

**Verification:**
- Same file checks as UC-1.1
- Agent chat shows update notification
- `register_session` succeeds without `updateRequired` on subsequent calls

---

## UC-1.3: Client Connects to Server on Project Open

**Actor:** Existing client developer  
**Precondition:** Konductor previously installed, project opened in Kiro  
**Trigger:** User opens project in Kiro

**Steps:**
1. Kiro loads workspace and reads `.kiro/settings/mcp.json`
2. Kiro establishes SSE connection to Konductor server
3. File watcher starts automatically (via hook or launcher script)
4. On first agent interaction, steering rule checks watcher status and server connectivity
5. Agent displays: `🟢 Konductor: Fully operational and watching your back!`
6. If server provides `repoPageUrl`, agent displays: `📊 Dashboard: <url>`

**Expected Result:**
- MCP connection established without user action
- File watcher running
- User informed of connection status
- Baton dashboard URL provided

**Verification:**
- MCP Servers panel shows "konductor" connected
- `pgrep -f konductor-watcher.mjs` → PID
- First chat interaction shows green status message

---

## UC-1.4: Client Disconnects (Server Goes Down)

**Actor:** Connected client developer  
**Precondition:** Client connected and working normally  
**Trigger:** Konductor server becomes unreachable (crash, network issue, restart)

**Steps:**
1. File watcher's next poll fails (connection refused / timeout)
2. Watcher logs disconnection event
3. On next agent interaction, MCP tool call fails
4. Agent displays: `⚠️ Konductor: Connection lost. Collision awareness is now OFFLINE.`
5. For each file the agent modifies while disconnected:
   - Agent displays: `⚠️ Konductor: Still disconnected. Changes to <filename> are untracked.`
6. File watcher continues tracking local changes (queued for reconnection)

**Expected Result:**
- User clearly informed of disconnection
- Per-file warnings on every modification
- No silent failures
- Local work continues unimpeded

**Verification:**
- Stop server, trigger agent file modification
- Verify warning messages appear in chat
- Verify watcher log shows disconnection

---

## UC-1.5: Client Reconnects After Server Comes Back

**Actor:** Previously disconnected client  
**Precondition:** Client was disconnected, server is now back online  
**Trigger:** Server becomes reachable again

**Steps:**
1. File watcher's next poll succeeds
2. Watcher reports queued offline changes to server via `/api/register`
3. On next agent interaction, MCP tool call succeeds
4. Agent displays: `🟢 Konductor: Reconnected. Collision awareness is back online.`
5. Agent registers session with current file list
6. Server responds with collision state and `repoPageUrl`
7. Agent displays Baton dashboard link

**Expected Result:**
- Seamless reconnection without user action
- Offline changes reported to server
- User informed of reconnection
- Collision state re-evaluated with current data

**⚠️ MISSING FEATURE:** Offline change queuing and replay on reconnection. The watcher currently does NOT queue changes while disconnected. This needs to be captured in the missing features spec.

---

## UC-1.6: Client Auto-Update (Server Has Newer Version)

**Actor:** Connected client developer  
**Precondition:** Client connected, server has newer bundle version than client  
**Trigger:** Client calls `register_session`

**Steps:**
1. Client sends `register_session` with `X-Konductor-Client-Version` header
2. Server compares client version to current bundle version
3. Server responds with `updateRequired: true` and `serverVersion`
4. Steering rule runs: `npx <server>/bundle/installer.tgz --workspace --server <server>`
5. Installer updates workspace artifacts (watcher, hooks, steering)
6. Installer restarts file watcher
7. Agent displays: `🔄 Konductor: Client updated to v<version>.`
8. Agent re-registers session

**Expected Result:**
- Update happens automatically without user intervention
- Watcher restarted with new code
- User informed of update
- Session continues normally after update

**Verification:**
- `cat .konductor-version` → shows new version
- Watcher PID changed (restarted)
- No interruption to user workflow

---

## UC-1.7: Client Auto-Update When Admin Changes Channel Assignment

**Actor:** Connected client developer  
**Precondition:** Client connected, admin changes the bundle version for client's channel  
**Trigger:** Admin assigns new version to client's effective channel (Dev/UAT/Prod)

**Steps:**
1. Admin assigns new bundle version to channel via admin dashboard
2. On client's next `register_session`, server detects version mismatch
3. Server responds with `updateRequired: true` and update URL for client's channel
4. Client auto-updates (same flow as UC-1.6)
5. User sees: `🔄 Konductor: Client updated to v<version>.`

**Expected Result:**
- Channel-specific update delivered to correct users
- Users on other channels unaffected
- Update URL points to correct channel endpoint (e.g., `/bundle/installer-uat.tgz`)

---

## UC-1.8: Client Receives Stale Bundle Warning

**Actor:** Connected client developer  
**Precondition:** Client connected, admin deletes the bundle assigned to client's channel  
**Trigger:** Client calls `register_session` after bundle deletion

**Steps:**
1. Admin deletes bundle from Bundle Manager
2. Channel enters "stale" state
3. On client's next `register_session`, server responds with `bundleStale: true`
4. Agent displays: `⚠️ Konductor: Your installer bundle was removed by an admin. Waiting for a replacement...`
5. All MCP tools continue working normally
6. When admin assigns new bundle, next `register_session` returns `updateRequired: true`
7. Client auto-updates to new bundle

**Expected Result:**
- Client warned but NOT blocked
- All collision awareness continues working
- Auto-update triggers when replacement available

---

## UC-1.9: File Watcher Auto-Starts on Project Load

**Actor:** Client developer  
**Precondition:** Konductor installed, project opened in Kiro  
**Trigger:** Project loaded in IDE

**Steps:**
1. Kiro loads project and processes hooks
2. `konductor-session-start.hook.md` triggers on first message
3. Hook checks if watcher is running (`pgrep -f konductor-watcher.mjs`)
4. If not running, hook starts watcher: `node konductor-watcher.mjs &`
5. Watcher begins polling for file changes

**Expected Result:**
- Watcher starts without user intervention
- No manual `node konductor-watcher.mjs &` needed
- Watcher survives IDE panel switches

**Verification:**
- Kill watcher, send a message in chat
- Verify watcher restarts automatically
- `pgrep -f konductor-watcher.mjs` → new PID

---

## UC-1.10: Client Asks for Baton Dashboard URL

**Actor:** Connected client developer  
**Precondition:** Client connected, session registered  
**Trigger:** User says "konductor, where is the repo website?" or "konductor, show baton"

**Steps:**
1. User types "konductor, show baton" in chat
2. Agent retrieves `repoPageUrl` from last registration response
3. Agent displays the URL
4. If user asks to "open baton", agent opens URL in default browser

**Expected Result:**
- User receives correct repo-specific Baton URL
- URL follows pattern: `https://<host>:<port>/repo/<repoName>`

**⚠️ MISSING FEATURE:** "show baton" / "open baton" command not in current steering rule routing table. The URL is provided on registration but there's no explicit chat command to retrieve it or open it in a browser.

---

## UC-1.11: Multiple Projects with Same Server

**Actor:** Developer with multiple projects  
**Precondition:** Konductor installed in Project A, user wants to add Project B  
**Trigger:** User runs installer from Project B directory

**Steps:**
1. User runs npx install command from Project B directory
2. Installer detects global config already exists (MCP config has konductor entry)
3. Installer performs workspace-only setup (skips global config)
4. Installer deploys watcher, hooks, steering to Project B
5. Installer prints: "Global config detected, performing workspace-only setup"
6. Both projects now tracked independently

**Expected Result:**
- Global config preserved (not duplicated)
- Each project has its own watcher instance
- Each project registers sessions independently
- Collision detection works across projects (same repo)

---

## UC-1.12: Client Install Preserves Existing Config

**Actor:** Developer re-running installer  
**Precondition:** `.konductor-watcher.env` exists with custom settings  
**Trigger:** User re-runs installer (update or reinstall)

**Steps:**
1. User has customized `.konductor-watcher.env` (changed poll interval, log level, etc.)
2. User runs installer again
3. Installer detects existing `.konductor-watcher.env`
4. Installer preserves the file (does NOT overwrite)
5. All other artifacts updated to latest version

**Expected Result:**
- Custom watcher config preserved
- User's poll interval, log level, extensions filter all retained
- Only code files (watcher, hooks, steering) updated

**Verification:**
- Modify `.konductor-watcher.env` with custom value
- Re-run installer
- Verify custom value still present
