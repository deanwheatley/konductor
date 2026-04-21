# Auto-Update & Version Management Use Cases

## Overview

The Konductor client auto-update system ensures all clients run the correct installer version for their assigned channel. Updates are triggered by version comparison during `register_session` calls. The admin controls which versions are assigned to which channels, and users receive updates automatically.

---

## UC-11.1: Normal Auto-Update Flow (Happy Path)

**Actor:** Client watcher + agent  
**Precondition:** Client on Prod channel, running v1.0.0. Admin promoted v1.1.0 to Prod.  
**Trigger:** Client's next `register_session` call

**Steps:**
1. Watcher calls `/api/register` with `X-Konductor-Client-Version: 1.0.0`
2. Server checks: Prod channel has v1.1.0, client has v1.0.0 → outdated
3. Server responds: `{ updateRequired: true, serverVersion: "1.1.0", updateUrl: "/bundle/installer-prod.tgz" }`
4. Watcher downloads `/bundle/installer-prod.tgz`
5. Watcher runs installer in workspace-only mode
6. Installer updates: watcher code, hooks, steering rules
7. Installer preserves: `.konductor-watcher.env`, existing MCP config API key
8. Installer writes new `.konductor-version`: `1.1.0`
9. Watcher restarts itself with new code
10. New watcher registers session → server confirms version matches

**Expected Result:**
- Seamless update without user intervention
- Watcher restarts cleanly
- No data loss
- User sees update notification in watcher log

**Verification:**
- `cat .konductor-version` → `1.1.0`
- Watcher log shows: "Updated to v1.1.0"
- Next registration: no `updateRequired`

---

## UC-11.2: Auto-Update via Agent (Steering Rule)

**Actor:** Agent (steering rule)  
**Precondition:** Agent calls `register_session` and gets `updateRequired: true`  
**Trigger:** Agent's MCP tool call response

**Steps:**
1. Agent calls `register_session` MCP tool
2. Response includes `updateRequired: true`, `serverVersion: "1.1.0"`
3. Agent runs: `npx <server>/bundle/installer-prod.tgz --workspace --server <server>`
4. Installer updates workspace artifacts
5. Agent displays: `🔄 Konductor: Client updated to v1.1.0.`
6. Agent re-registers session (confirms update)
7. Agent only attempts update ONCE per session (no retry loop)

**Expected Result:**
- Agent handles update automatically
- User informed
- Single attempt (no infinite loop on failure)
- Session continues normally after update

---

## UC-11.3: Auto-Update Fails (Network Error)

**Actor:** Client watcher  
**Precondition:** Server says update required, but download fails  
**Trigger:** Watcher tries to download new bundle

**Steps:**
1. Watcher gets `updateRequired: true`
2. Watcher attempts to download `/bundle/installer-prod.tgz`
3. Download fails (timeout, 500 error, network drop)
4. Watcher logs: "Update failed: network error. Will retry on next cycle."
5. Watcher continues running current version
6. On next poll cycle, watcher tries again
7. Eventually succeeds (or keeps retrying each cycle)

**Expected Result:**
- No crash on failed update
- Watcher continues operating on old version
- Retries on subsequent cycles
- User not spammed with repeated failure messages (log once, retry silently)

---

## UC-11.4: Auto-Update Fails (Agent Path — npx Not Available)

**Actor:** Agent  
**Precondition:** Agent gets `updateRequired: true` but npx fails  
**Trigger:** Agent runs npx command

**Steps:**
1. Agent runs `npx <server>/bundle/installer.tgz --workspace --server <server>`
2. Command fails (npx not in PATH, permission error, etc.)
3. Agent displays: `⚠️ Konductor: Client is outdated (v1.0.0 → v1.1.0). Run the install command from "konductor, how do I install?" to update.`
4. Agent does NOT retry in this session
5. Work continues normally on old version

**Expected Result:**
- Graceful failure with manual fallback instructions
- No repeated attempts
- User can update manually when convenient

---

## UC-11.5: Version Check — Client Already Current

**Actor:** Client  
**Precondition:** Client version matches server's channel version  
**Trigger:** Normal `register_session` call

**Steps:**
1. Client sends `X-Konductor-Client-Version: 1.1.0`
2. Server checks: Prod channel has v1.1.0 → matches
3. Server responds normally (no `updateRequired` field, or `updateRequired: false`)
4. No update triggered

**Expected Result:** No unnecessary updates. Normal operation continues.

---

## UC-11.6: Version Check — Client Newer Than Server (Rollback Scenario)

**Actor:** Client  
**Precondition:** Client has v1.2.0, admin rolled back Prod to v1.1.0  
**Trigger:** Client's next registration

**Steps:**
1. Client sends `X-Konductor-Client-Version: 1.2.0`
2. Server checks: Prod channel has v1.1.0, client has v1.2.0 → client is NEWER
3. Server responds: `{ updateRequired: true, serverVersion: "1.1.0" }` (downgrade)
4. Client downloads v1.1.0 installer
5. Client installs (downgrade)
6. Client now running v1.1.0

**Expected Result:** Rollbacks propagate to clients. Downgrade works the same as upgrade. Client always matches server's channel version.

**⚠️ VERIFY:** Does the current implementation handle downgrades? Or does it only trigger when server > client?

---

## UC-11.7: Channel-Specific Update URLs

**Actor:** Client on UAT channel  
**Precondition:** UAT has v2.0.0-beta.1, Prod has v1.1.0  
**Trigger:** UAT client registers

**Steps:**
1. Client on UAT sends `X-Konductor-Client-Version: 1.1.0`
2. Server determines client's effective channel: UAT (per-user override)
3. Server checks UAT version: v2.0.0-beta.1 → client outdated
4. Server responds: `{ updateRequired: true, serverVersion: "2.0.0-beta.1", updateUrl: "/bundle/installer-uat.tgz" }`
5. Client downloads from UAT-specific URL
6. Client installs UAT version

**Expected Result:** Each channel has its own update URL. UAT users get UAT bundles, not Prod.

---

## UC-11.8: "Latest" Channel User Gets Immediate Updates

**Actor:** Client assigned to "Latest" channel  
**Precondition:** New bundle v2.1.0 added to registry  
**Trigger:** Server restarts with new bundle in `installers/`

**Steps:**
1. Admin places `installer-2.1.0.tgz` in `installers/`
2. Server restarts, discovers new bundle
3. "Latest" resolves to v2.1.0 (newest by creation date)
4. Client on "Latest" channel registers
5. Server: client version < 2.1.0 → `updateRequired: true`
6. Client updates to v2.1.0

**Expected Result:** "Latest" users always get the newest bundle immediately after server restart.

---

## UC-11.9: Watcher Startup Version Check

**Actor:** File watcher  
**Precondition:** Watcher starts (project opened)  
**Trigger:** Watcher initialization

**Steps:**
1. Watcher starts
2. Watcher reads `.konductor-version`: `1.0.0`
3. Watcher calls `/api/register` with version header
4. Server responds with `updateRequired: true` (if outdated)
5. Watcher self-updates before entering normal poll loop
6. Watcher restarts with new code

**Expected Result:** Version check happens at startup, not just during normal polling. Ensures watcher is current before it starts tracking.

---

## UC-11.10: Concurrent Update Race Condition

**Actor:** Both watcher and agent detect update simultaneously  
**Precondition:** Both get `updateRequired: true` at roughly the same time  
**Trigger:** Watcher poll and agent registration happen close together

**Steps:**
1. Watcher polls → gets `updateRequired: true` → starts downloading
2. Agent registers → gets `updateRequired: true` → starts npx install
3. Both try to update simultaneously
4. One succeeds, one finds files already updated
5. Watcher restarts (regardless of who won the race)

**Expected Result:** No corruption from concurrent updates. Installer should be idempotent. Second run is a no-op if files already match.

**⚠️ POTENTIAL ISSUE:** Need to verify installer is safe for concurrent execution. File locking or PID check may be needed.

---

## UC-11.11: Update Preserves User Configuration

**Actor:** Client  
**Precondition:** User has customized `.konductor-watcher.env`  
**Trigger:** Auto-update runs

**Steps:**
1. User has custom config:
   - `KONDUCTOR_POLL_INTERVAL=5`
   - `KONDUCTOR_LOG_LEVEL=debug`
   - `KONDUCTOR_WATCH_EXTENSIONS=ts,tsx`
2. Auto-update triggers
3. Installer runs in workspace mode
4. Installer checks: `.konductor-watcher.env` exists → PRESERVE
5. All code files updated (watcher, hooks, steering)
6. Config file untouched

**Expected Result:** User's custom settings survive updates. Only code changes, never config.

**Verification:**
- Before update: note custom values
- After update: verify same values in `.konductor-watcher.env`
- Verify watcher uses custom values after restart

---

## UC-11.12: Admin Promotes and Monitors Rollout

**Actor:** Admin  
**Precondition:** New version tested on Dev, ready for UAT  
**Trigger:** Admin promotes Dev → UAT

**Steps:**
1. Admin clicks "Promote Dev → UAT"
2. Server copies Dev's version to UAT
3. Admin watches User Management table
4. UAT users' "Last Seen" pills start updating (they're reconnecting)
5. Admin can see which users have updated (version in activity summary?)
6. If issues reported: Admin clicks "Rollback" on UAT
7. UAT users get rolled back on next registration

**Expected Result:** Admin has visibility into rollout progress. Can rollback quickly if issues arise.

**⚠️ POTENTIAL GAP:** No "client version" column in User Management table. Admin can't see which version each user is running. Consider adding this.

---

## UC-11.13: Client Version Mismatch After Manual Install

**Actor:** Developer who manually ran an old install command  
**Precondition:** User ran install command with old server URL that had v1.0.0  
**Trigger:** User connects to server that now has v1.2.0

**Steps:**
1. User installed with old command (got v1.0.0)
2. Server now serves v1.2.0 on Prod
3. User's first `register_session` → `updateRequired: true`
4. Auto-update brings user to v1.2.0
5. User is now current

**Expected Result:** Even manual installs get auto-updated. No permanent version drift.

---

## UC-11.14: Bundle Manifest Validation

**Actor:** Server  
**Precondition:** Bundle contains `bundle-manifest.json`  
**Trigger:** Server reads bundle at startup

**Steps:**
1. Server reads `installer-1.2.0.tgz`
2. Extracts `package/bundle-manifest.json`
3. Validates:
   - `version` matches filename version
   - `createdAt` is valid ISO 8601
   - `author` is string (optional)
   - `summary` is string (optional)
4. If manifest missing: fallback to filename + file mtime
5. If manifest invalid: log warning, use fallback

**Expected Result:** Robust handling of missing/invalid manifests. Never crashes on bad data.

---

## UC-11.15: Version Display in Client

**Actor:** Developer  
**Precondition:** Client installed  
**Trigger:** User wants to know their version

**Steps:**
1. User says "konductor, who am I?" or "konductor, status"
2. Agent reads `.konductor-version`
3. Displays: `Client Version: 1.2.0`
4. Or user runs: `cat .konductor-version`

**Expected Result:** Version easily discoverable. Matches what server expects.

---

## UC-11.16: Stale Bundle → New Assignment → Auto-Update

**Actor:** Client on stale channel  
**Precondition:** Admin deleted bundle, channel is stale  
**Trigger:** Admin assigns new version to channel

**Steps:**
1. Client's channel is stale (bundle deleted)
2. Client registers → gets `bundleStale: true`
3. Client shows warning but continues working
4. Admin assigns v1.3.0 to the channel
5. Client's next registration → gets `updateRequired: true` (stale resolved)
6. Client auto-updates to v1.3.0
7. Client shows: `🔄 Konductor: Client updated to v1.3.0.`

**Expected Result:** Seamless transition from stale → updated. No manual intervention.

---

## UC-11.17: Multiple Watchers in Same Workspace (Edge Case)

**Actor:** Developer  
**Precondition:** Somehow two watcher instances running  
**Trigger:** Both try to register/update

**Steps:**
1. Two watcher PIDs exist (bug or manual start)
2. Both poll and register
3. Server sees duplicate registrations from same user/repo
4. Server updates session (last write wins)
5. Both watchers may try to auto-update simultaneously

**Expected Result:** No crash. Server handles gracefully (idempotent registration). Watchdog should detect and kill duplicate.

**⚠️ POTENTIAL ISSUE:** Need PID file or lock to prevent duplicate watchers.
