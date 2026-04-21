# File Watcher Use Cases

## Overview

The file watcher (`konductor-watcher.mjs`) is a background Node.js process that monitors file changes in the workspace and reports them to the Konductor server. It handles auto-update, reconnection, and offline queuing.

---

## UC-3.1: Watcher Starts and Registers Initial File Set

**Actor:** File watcher process  
**Precondition:** Watcher launched (by hook, installer, or manually)  
**Trigger:** Process starts

**Steps:**
1. Watcher reads `.konductor-watcher.env` for config (server URL, user, poll interval)
2. Watcher reads `.kiro/settings/mcp.json` for server URL and API key
3. Watcher determines userId (from env, then git, then hostname)
4. Watcher determines repo (from `git remote get-url origin`)
5. Watcher determines branch (from `git branch --show-current`)
6. Watcher scans workspace for tracked files (respecting `.gitignore` and extension filter)
7. Watcher calls `/api/register` with initial file set
8. Watcher logs: connection status, server version, repo page URL
9. Watcher begins polling at configured interval

**Expected Result:**
- Session registered on server
- Watcher log shows successful connection
- Poll loop running

**Verification:**
- Check `.konductor-watcher.log` for startup messages
- `pgrep -f konductor-watcher.mjs` → PID exists

---

## UC-3.2: Watcher Detects File Change

**Actor:** File watcher  
**Precondition:** Watcher running, connected to server  
**Trigger:** User saves a file in the workspace

**Steps:**
1. Watcher's poll cycle detects changed file (via git status or fs watch)
2. Watcher updates internal file list
3. Watcher calls `/api/register` with updated file list
4. Server responds with collision state
5. If collision state is elevated, watcher logs warning

**Expected Result:**
- File change detected within one poll interval
- Server session updated with new file list
- Collision state re-evaluated

---

## UC-3.3: Watcher Respects Extension Filter

**Actor:** File watcher  
**Precondition:** `KONDUCTOR_WATCH_EXTENSIONS=ts,tsx,js` set in env  
**Trigger:** User saves a `.md` file

**Steps:**
1. User saves `README.md`
2. Watcher's poll cycle runs
3. Watcher checks file extension against filter
4. `.md` not in `ts,tsx,js` → file ignored
5. No registration update sent

**Expected Result:** Only files matching the extension filter are tracked.

**Verification:**
- Set extension filter to `ts` only
- Save a `.py` file
- Verify no registration update in watcher log

---

## UC-3.4: Watcher Auto-Update Check

**Actor:** File watcher  
**Precondition:** Watcher running, server has newer bundle version  
**Trigger:** Watcher's periodic update check

**Steps:**
1. Watcher checks server bundle version (via manifest or register response)
2. Server version > local version (from `.konductor-version`)
3. Watcher downloads new installer from server
4. Watcher runs installer in workspace-only mode
5. Watcher restarts itself with new code
6. Watcher logs: `Updated to v<new_version>`

**Expected Result:**
- Watcher self-updates without user intervention
- New version deployed
- Watcher restarts cleanly
- `.konductor-version` updated

---

## UC-3.5: Watcher Handles Server Unreachable

**Actor:** File watcher  
**Precondition:** Watcher running, server goes down  
**Trigger:** Next poll cycle fails

**Steps:**
1. Watcher attempts `/api/register` call
2. Connection refused / timeout
3. Watcher logs: `Server unreachable, will retry`
4. Watcher continues polling at normal interval
5. Watcher tracks file changes locally (for replay on reconnection)
6. On each failed poll, watcher logs briefly (not spamming)

**Expected Result:**
- Watcher does NOT crash
- Watcher continues monitoring files
- Reconnection attempted on every poll cycle
- Log shows disconnection but doesn't flood

**⚠️ MISSING FEATURE:** Offline change queuing. Currently the watcher may not queue changes for replay. This needs verification and potentially implementation.

---

## UC-3.6: Watcher Reconnects After Server Returns

**Actor:** File watcher  
**Precondition:** Watcher was disconnected, server comes back  
**Trigger:** Next poll cycle succeeds

**Steps:**
1. Server comes back online
2. Watcher's next `/api/register` call succeeds
3. Watcher sends current file list (including any changes made while offline)
4. Watcher logs: `Reconnected to server`
5. Normal operation resumes

**Expected Result:**
- Seamless reconnection
- Current state reported to server
- No lost data

---

## UC-3.7: Watcher Respects .gitignore

**Actor:** File watcher  
**Precondition:** Watcher running  
**Trigger:** User saves a file that's in `.gitignore`

**Steps:**
1. User saves `node_modules/package/index.js`
2. Watcher checks against `.gitignore` rules
3. File is ignored → not included in tracked files
4. No registration update for this file

**Expected Result:** `.gitignore`'d files never reported to server.

---

## UC-3.8: Watcher Watchdog Recovery

**Actor:** Watchdog script (`konductor-watchdog.sh`)  
**Precondition:** Watcher was running but crashed  
**Trigger:** Watchdog detects watcher is not running

**Steps:**
1. Watcher process crashes (OOM, unhandled error, etc.)
2. Watchdog script runs on schedule (or is triggered)
3. Watchdog checks `pgrep -f konductor-watcher.mjs`
4. No PID found → watchdog restarts watcher
5. Watcher starts fresh, re-registers session

**Expected Result:**
- Watcher automatically recovered
- Brief gap in tracking (between crash and recovery)
- No permanent loss of collision awareness

---

## UC-3.9: Watcher Log Rotation

**Actor:** File watcher  
**Precondition:** `KONDUCTOR_LOG_MAX_SIZE=1MB` configured  
**Trigger:** Log file exceeds 1MB

**Steps:**
1. Watcher writes to `.konductor-watcher.log`
2. Log file reaches 1MB
3. Watcher rotates: `.tobedeleted` deleted, `.backup` → `.tobedeleted`, current → `.backup`, new current created
4. Writing continues to fresh log file

**Expected Result:**
- At most 3 log files on disk (~3MB total)
- No unbounded disk usage
- Rotation is seamless (no lost log entries)

---

## UC-3.10: Watcher Configuration Change

**Actor:** Developer  
**Precondition:** Watcher running  
**Trigger:** User says "konductor, change poll interval to 5"

**Steps:**
1. Agent updates `.konductor-watcher.env`: `KONDUCTOR_POLL_INTERVAL=5`
2. Agent kills existing watcher: `pkill -f konductor-watcher.mjs`
3. Agent restarts watcher: `node konductor-watcher.mjs &`
4. New watcher reads updated config
5. Watcher now polls every 5 seconds

**Expected Result:**
- Config change applied
- Watcher restarted with new settings
- No gap in tracking (restart is fast)

---

## UC-3.11: Watcher Identity Resolution

**Actor:** File watcher  
**Precondition:** First run, `KONDUCTOR_USER` not set in env  
**Trigger:** Watcher starts

**Steps:**
1. Watcher reads `.konductor-watcher.env` → `KONDUCTOR_USER` empty/commented
2. Watcher tries `gh api user --jq .login` → succeeds with "alice"
3. Watcher writes `KONDUCTOR_USER=alice` to `.konductor-watcher.env`
4. Watcher uses "alice" as userId for all registrations

**Expected Result:**
- Identity resolved automatically
- Persisted for future runs
- No user prompt needed

---

## UC-3.12: Watcher Handles Branch Switch

**Actor:** Developer  
**Precondition:** Watcher running on branch `main`  
**Trigger:** User runs `git checkout feature/new-thing`

**Steps:**
1. User switches branch
2. Watcher's next poll detects branch change (via `git branch --show-current`)
3. Watcher updates registration with new branch name
4. Server re-evaluates collision state with new branch context
5. If same files now on different branch from another user → potential Merge Hell

**Expected Result:**
- Branch change detected automatically
- Session updated with correct branch
- Collision state re-evaluated (branch matters for Merge Hell detection)


---

## Extended Watcher Edge Cases

### UC-3.13: Watcher Handles Rapid File Saves (Debouncing)

**Actor:** File watcher  
**Precondition:** Watcher running, poll interval = 10s  
**Trigger:** User saves 20 files in 2 seconds (IDE "save all")

**Steps:**
1. User triggers "Save All" in IDE
2. 20 files written to disk in rapid succession
3. Watcher's next poll cycle detects all 20 changes at once
4. Watcher sends single `/api/register` with all 20 files
5. NOT 20 separate API calls

**Expected Result:** Watcher batches changes per poll cycle. Single API call per cycle regardless of how many files changed.

---

### UC-3.14: Watcher Handles File Deletion

**Actor:** File watcher  
**Precondition:** Watcher tracking `src/old.ts`  
**Trigger:** User deletes `src/old.ts`

**Steps:**
1. User deletes `src/old.ts`
2. Watcher's next poll: file no longer in git status
3. Watcher removes `src/old.ts` from tracked file list
4. Watcher registers with updated list (without deleted file)
5. If `src/old.ts` was causing a collision → collision may resolve

**Expected Result:** Deleted files removed from tracking. Collision state re-evaluated.

---

### UC-3.15: Watcher Handles File Rename

**Actor:** File watcher  
**Precondition:** Watcher tracking `src/old-name.ts`  
**Trigger:** User renames to `src/new-name.ts`

**Steps:**
1. User renames file (git sees as delete + add)
2. Watcher's next poll: `src/old-name.ts` gone, `src/new-name.ts` appears
3. Watcher updates file list: removes old, adds new
4. Registers with new file list
5. If another user was colliding on `src/old-name.ts` → collision may resolve
6. If another user is on `src/new-name.ts` → new collision may appear

**Expected Result:** Renames handled as delete + add. Collision state adjusts.

---

### UC-3.16: Watcher Handles Large Repo (10,000+ Files)

**Actor:** File watcher  
**Precondition:** Monorepo with 10,000+ tracked files  
**Trigger:** Watcher starts

**Steps:**
1. Watcher scans workspace
2. `git status` or file system scan returns 10,000+ files
3. Watcher only reports CHANGED files (not all files)
4. Initial registration: only files with uncommitted changes
5. Performance: scan completes within poll interval

**Expected Result:** Watcher scales to large repos. Only changed files reported. No timeout or OOM.

**⚠️ VERIFY:** How does the watcher determine "changed" files? `git diff --name-only`? Or full filesystem scan?

---

### UC-3.17: Watcher Handles Binary Files

**Actor:** File watcher  
**Precondition:** User modifies a binary file (image, compiled asset)  
**Trigger:** Binary file changes detected

**Steps:**
1. User modifies `assets/logo.png`
2. Watcher detects change
3. If extension filter is set and doesn't include `png` → ignored
4. If no extension filter: binary file included in registration
5. Line range data: NOT available for binary files (no `git diff` hunks)
6. File-level tracking only for binaries

**Expected Result:** Binary files tracked at file level. No line data. No crash on binary diff.

---

### UC-3.18: Watcher Handles Symlinks

**Actor:** File watcher  
**Precondition:** Workspace contains symlinks  
**Trigger:** Symlinked file changes

**Steps:**
1. `src/config.ts` is a symlink to `../shared/config.ts`
2. User edits the symlinked file
3. Watcher detects change
4. Watcher reports the symlink path (not the target)
5. Collision evaluated against the path other users see

**Expected Result:** Symlinks handled without following to target. Path consistency with other users.

**⚠️ POTENTIAL ISSUE:** If User A sees `src/config.ts` (symlink) and User B sees `../shared/config.ts` (real path), they won't collide even though it's the same file. Consider resolving to real paths.

---

### UC-3.19: Watcher Handles Git Submodules

**Actor:** File watcher  
**Precondition:** Workspace has git submodules  
**Trigger:** File in submodule changes

**Steps:**
1. Workspace has submodule at `libs/shared/`
2. User edits `libs/shared/utils.ts`
3. Watcher detects change in submodule
4. Watcher reports path relative to workspace root: `libs/shared/utils.ts`
5. Registration includes submodule files

**Expected Result:** Submodule files tracked like any other file. Path relative to workspace root.

---

### UC-3.20: Watcher Startup — Server Already Has Stale Session

**Actor:** File watcher  
**Precondition:** Previous watcher crashed, server has stale session for this user  
**Trigger:** New watcher starts

**Steps:**
1. Previous watcher crashed 3 minutes ago
2. Server still has session (not yet timed out at 5 min)
3. New watcher starts
4. Watcher registers with current file list
5. Server updates existing session (same user+repo = update, not duplicate)
6. Session heartbeat refreshed

**Expected Result:** No duplicate sessions. Existing session updated seamlessly. No "session already exists" error.

---

### UC-3.21: Watcher Handles Network Timeout (Slow Server)

**Actor:** File watcher  
**Precondition:** Server is slow (high load)  
**Trigger:** API call takes > 30 seconds

**Steps:**
1. Watcher calls `/api/register`
2. Server is slow, doesn't respond for 30 seconds
3. Watcher's HTTP client times out
4. Watcher logs: "Server timeout. Will retry next cycle."
5. Watcher does NOT block — continues to next poll cycle
6. Next cycle: server may be faster, registration succeeds

**Expected Result:** Timeout doesn't block the watcher. Retries on next cycle. No hung process.

---

### UC-3.22: Watcher Handles Server 500 Error

**Actor:** File watcher  
**Precondition:** Server has internal error  
**Trigger:** API returns 500

**Steps:**
1. Watcher calls `/api/register`
2. Server returns 500 Internal Server Error
3. Watcher logs: "Server error (500). Will retry."
4. Watcher continues polling
5. Does NOT treat as "disconnected" (server is reachable, just erroring)
6. Next cycle: may succeed if server recovered

**Expected Result:** 500 errors logged but not treated as full disconnection. Retry on next cycle.

---

### UC-3.23: Watcher Handles Invalid API Key

**Actor:** File watcher  
**Precondition:** API key in MCP config is wrong  
**Trigger:** Every API call returns 401

**Steps:**
1. Watcher reads API key from `.kiro/settings/mcp.json`
2. Key is invalid (typo, expired, wrong server)
3. Every `/api/register` call returns 401 Unauthorized
4. Watcher logs: "Authentication failed (401). Check API key in .kiro/settings/mcp.json"
5. Watcher continues polling (key might be fixed without restart)
6. Log message shown ONCE, not every cycle

**Expected Result:** Clear error about auth failure. Not spamming logs. Continues trying (key might be hot-fixed).

---

### UC-3.24: Watcher Auto-Update — Installer Corrupted

**Actor:** File watcher  
**Precondition:** Server serves corrupted tarball  
**Trigger:** Watcher downloads and tries to install

**Steps:**
1. Watcher detects `updateRequired: true`
2. Downloads `/bundle/installer-prod.tgz`
3. Tarball is corrupted (incomplete download, disk error)
4. Installer fails to extract/run
5. Watcher logs: "Update failed: installer corrupt. Continuing on current version."
6. Watcher does NOT restart (would lose current working code)
7. Retries on next cycle (re-downloads)

**Expected Result:** Corrupted installer doesn't brick the watcher. Stays on current version. Retries.

---

### UC-3.25: Watcher Handles Workspace Root Change

**Actor:** File watcher  
**Precondition:** Watcher running in `/projects/app`  
**Trigger:** User moves/renames project directory

**Steps:**
1. Watcher running, workspace at `/projects/app`
2. User renames to `/projects/app-v2`
3. Watcher's file paths become invalid
4. `git` commands fail (not in a git repo anymore from watcher's perspective)
5. Watcher detects error, logs: "Workspace root changed or invalid. Stopping."
6. Watcher exits cleanly
7. Next IDE session: hook restarts watcher in new location

**Expected Result:** Graceful exit on workspace move. No zombie process. Clean restart in new location.

---

### UC-3.26: Watcher Handles .gitignore Changes

**Actor:** File watcher  
**Precondition:** Watcher respects .gitignore  
**Trigger:** User adds a file pattern to .gitignore

**Steps:**
1. Watcher tracking `build/output.js` (not in .gitignore)
2. User adds `build/` to .gitignore
3. Watcher's next poll: `build/output.js` now ignored by git
4. Watcher removes `build/output.js` from tracked files
5. Registration updated without that file

**Expected Result:** .gitignore changes respected dynamically. No watcher restart needed.

---

### UC-3.27: Watcher Concurrent with IDE Auto-Save

**Actor:** File watcher + IDE  
**Precondition:** IDE has auto-save enabled (saves every 1 second)  
**Trigger:** User typing continuously

**Steps:**
1. IDE auto-saves every 1 second
2. Watcher polls every 10 seconds
3. Between polls: 10 auto-saves happen
4. Watcher's poll detects cumulative changes (not individual saves)
5. Single registration with current state

**Expected Result:** Auto-save frequency doesn't affect watcher behavior. Watcher only sees state at poll time.

---

### UC-3.28: Watcher Process Killed by OS (OOM)

**Actor:** Operating system  
**Precondition:** System under memory pressure  
**Trigger:** OS kills watcher process (SIGKILL)

**Steps:**
1. System runs low on memory
2. OS kills `konductor-watcher.mjs` (SIGKILL — no cleanup possible)
3. Watcher dies immediately
4. No deregistration sent to server
5. Server session remains active until heartbeat timeout
6. Watchdog script detects watcher is gone
7. Watchdog restarts watcher
8. New watcher registers, updating the stale session

**Expected Result:** OOM kill handled by watchdog recovery. Brief gap in tracking. Session eventually refreshed or times out.

---

### UC-3.29: Two Workspaces, Same Repo, Same User

**Actor:** Developer with two IDE windows on same repo  
**Precondition:** Same project open in two Kiro windows  
**Trigger:** Both windows have watchers

**Steps:**
1. Window A: watcher running, tracking files in `src/auth/`
2. Window B: watcher running, tracking files in `src/api/`
3. Both register as same user, same repo, same branch
4. Server: last registration wins (session updated, not duplicated)
5. File list = whatever the last watcher reported

**Expected Result:** No duplicate sessions. Last write wins. May cause flickering file lists.

**⚠️ POTENTIAL ISSUE:** Two watchers for same user/repo will overwrite each other's file lists. Consider merging or detecting duplicates.
