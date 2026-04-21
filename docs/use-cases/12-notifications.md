# Notification Use Cases

## Overview

Notifications flow through multiple channels: agent chat, watcher terminal, Baton dashboard, and Slack. This document covers the full notification lifecycle across all delivery mechanisms.

---

## Notification Delivery Channels

| Channel | Mechanism | Audience | Latency |
|---------|-----------|----------|---------|
| Agent Chat | MCP tool response + steering rule | Individual developer | Immediate (on next interaction) |
| Watcher Terminal | Console output from watcher process | Individual developer | Within poll interval |
| Baton Dashboard | SSE push to browser | Anyone viewing repo page | < 5 seconds |
| Slack | Bot API post | Team channel subscribers | < 5 seconds |
| Terminal Echo | `echo ... >&2` from agent | Individual developer (visible even if chat hidden) | Immediate |

---

## UC-12.1: Collision Notification — All Channels Fire

**Actors:** User A, User B  
**Precondition:** Slack configured, Baton open, both users connected  
**Trigger:** Collision Course detected

**Steps:**
1. User B registers with files overlapping User A
2. Server evaluates: Collision Course
3. **Baton:** SSE event → notification row appears in table (< 5s)
4. **Slack:** Bot posts Block Kit message to repo channel (< 5s)
5. **User B's Agent:** Registration response includes collision state → agent displays warning
6. **User B's Watcher:** Next poll shows collision in terminal
7. **User A's Watcher:** Next poll detects state change → terminal notification
8. **User A's Agent:** Next interaction shows collision (or proactive push if implemented)

**Expected Result:** All channels fire. No channel is missed. Timing varies by mechanism.

---

## UC-12.2: Notification Deduplication — Same State, No Repeat

**Actor:** User A (watcher polling every 10s)  
**Precondition:** Collision Course active for 5 minutes  
**Trigger:** Each poll cycle returns same collision state

**Steps:**
1. Poll 1: Collision Course with bob on src/index.ts → NOTIFY (first time)
2. Poll 2 (10s later): Same state, same users, same files → NO notification (signature unchanged)
3. Poll 3: Same → NO notification
4. Poll 4: Bob adds src/utils.ts to overlap → NOTIFY (signature changed)
5. Poll 5: Same as poll 4 → NO notification

**Expected Result:** Watcher uses state signature to deduplicate. Only notifies on CHANGE.

**Signature format:** `state:userId:branch:files` — if unchanged, skip notification.

---

## UC-12.3: Slack Notification — Verbosity Filtering

**Actor:** Server  
**Precondition:** Repo verbosity = 2 (collision_course + merge_hell)  
**Trigger:** Various collision states occur

| Event | Verbosity Check | Slack Fires? |
|-------|----------------|--------------|
| Solo detected | 0 < 2 | ❌ No |
| Neighbors detected | 1 < 2 | ❌ No |
| Crossroads detected | 2 = 2? No, crossroads is severity 2 but verbosity 2 means only collision_course(3) and merge_hell(4) | ❌ No |
| Collision Course detected | severity 3 ≥ threshold | ✅ Yes |
| Merge Hell detected | severity 4 ≥ threshold | ✅ Yes |
| De-escalation below threshold | was above, now below | ✅ Yes (de-escalation msg) |

**Expected Result:** Only states meeting verbosity threshold trigger Slack. De-escalation fires when crossing below.

---

## UC-12.4: Slack De-escalation — Exactly One Message

**Actor:** Server  
**Precondition:** Collision Course notification was sent  
**Trigger:** State drops to Neighbors

**Steps:**
1. T+0: Collision Course → Slack notification sent
2. T+5min: State drops to Crossroads (still above? No — verbosity 2 means only CC and MH)
3. Actually: Crossroads is below verbosity 2 threshold
4. Server detects: was above threshold (CC), now below (Crossroads) → de-escalation
5. Server posts: `✅ Collision resolved on org/app — previously 🟠 Collision Course`
6. T+10min: State drops further to Neighbors → NO additional de-escalation (already sent)
7. T+15min: State drops to Solo → NO additional de-escalation

**Expected Result:** Exactly ONE de-escalation message when crossing below threshold. Not repeated for further drops.

---

## UC-12.5: Slack Notification — Multiple Users in Collision

**Actor:** Server  
**Precondition:** 3 users all editing same file  
**Trigger:** Collision Course with multiple overlaps

**Steps:**
1. alice, bob, and carol all editing `src/index.ts`
2. Server evaluates: Collision Course (3-way)
3. Slack message includes ALL involved users:
   ```
   🟠 Collision Course — org/app
   alice, bob, and carol are modifying the same files:
   • src/index.ts
   Branch: main
   ```
4. Single message (not one per pair)

**Expected Result:** One consolidated Slack message listing all involved parties. Not N messages for N users.

---

## UC-12.6: Baton Notification — Real-Time Appearance

**Actor:** Developer viewing Baton  
**Precondition:** Baton page open with SSE connected  
**Trigger:** New collision event

**Steps:**
1. Collision Course detected
2. Server creates notification record
3. Server emits SSE event: `{ type: "notification", data: { ... } }`
4. Baton page receives event
5. New row animates into Notifications table (top of list)
6. Count badge updates
7. Health status badge updates (if severity changed)
8. Active users section updates (new user pill appears)

**Expected Result:** All sections update simultaneously. No partial updates. Animation provides visual cue.

---

## UC-12.7: Baton Notification — History Tab

**Actor:** Developer  
**Precondition:** Some notifications resolved  
**Trigger:** Developer clicks "History" tab

**Steps:**
1. Notifications section has two tabs: "Active" and "History"
2. Developer clicks "History"
3. Table shows resolved notifications with:
   - Original timestamp
   - Resolution timestamp
   - Who resolved it
   - Original collision details
4. Sorted by resolution time (newest first)

**Expected Result:** Full audit trail of past collisions. Useful for retrospectives.

---

## UC-12.8: Terminal Echo — High Severity Only

**Actor:** Agent  
**Precondition:** Collision Course or Merge Hell detected  
**Trigger:** Agent processes collision response

**Steps:**
1. Agent gets Collision Course response
2. Agent displays warning in chat
3. Agent ALSO echoes to terminal: `echo "🟠 KONDUCTOR: COLLISION COURSE — bob modifying same files: src/index.ts" >&2`
4. Terminal echo visible even if chat panel is minimized/hidden

**Only for Collision Course and Merge Hell.** Lower states do NOT echo to terminal.

**Expected Result:** Critical warnings visible in terminal. Ensures developer sees them even if not looking at chat.

---

## UC-12.9: Notification When Slack Config Changes

**Actor:** Developer A (changes config), Developer B (receives notification)  
**Precondition:** Both developers connected to same repo  
**Trigger:** Developer A changes Slack channel

**Steps:**
1. Developer A: "konductor, change slack channel to new-alerts"
2. Server updates config
3. Server emits `slack_config_change` SSE event to all clients in repo
4. Developer B's agent receives event
5. Developer B sees:
   ```
   📢 Konductor: Slack alerts for org/app now go to #new-alerts (verbosity: 2).
   🔗 Slack channel: https://slack.com/app_redirect?channel=new-alerts
   ```
6. Baton repo page also updates (Slack panel shows new channel)

**Expected Result:** All stakeholders informed of config change. Link provided for quick access.

---

## UC-12.10: Notification When Bundle Update Available

**Actor:** Client  
**Precondition:** Server has newer version  
**Trigger:** Registration response

**Steps:**
1. Client registers → `updateRequired: true`
2. **Watcher terminal:** "Update available: v1.0.0 → v1.1.0. Updating..."
3. **Agent chat:** `🔄 Konductor: Client updated to v1.1.0.`
4. **Baton:** No notification (this is client-side)
5. **Slack:** No notification (not a collision event)

**Expected Result:** Update notifications only in client-side channels. Not broadcast to team.

---

## UC-12.11: Notification When Bundle Becomes Stale

**Actor:** Client  
**Precondition:** Admin deleted assigned bundle  
**Trigger:** Registration response has `bundleStale: true`

**Steps:**
1. Client registers → `bundleStale: true`
2. **Agent chat:** `⚠️ Konductor: Your installer bundle was removed by an admin. Waiting for a replacement...`
3. **Watcher terminal:** Warning logged
4. Notification shown ONCE per session (not repeated on every registration)

**Expected Result:** Single warning. Not repeated. Client continues working.

---

## UC-12.12: Notification When Server Connection Lost

**Actor:** Client  
**Precondition:** Connected, server goes down  
**Trigger:** MCP tool call fails or watcher poll fails

**Steps:**
1. **Agent (on next interaction):** `⚠️ Konductor: Connection lost. Collision awareness is now OFFLINE.`
2. **Watcher terminal:** "Server unreachable. Will retry."
3. **Per-file warnings (agent):** `⚠️ Konductor: Still disconnected. Changes to <file> are untracked.`
4. **Baton:** Page shows "Disconnected" banner (if open)

**Expected Result:** Clear disconnection notification. Per-file warnings ensure user knows tracking is offline.

---

## UC-12.13: Notification When Server Connection Restored

**Actor:** Client  
**Precondition:** Was disconnected, server returns  
**Trigger:** Next successful API call

**Steps:**
1. **Agent (on next interaction):** `🟢 Konductor: Reconnected. Collision awareness is back online.`
2. **Watcher terminal:** "Reconnected to server."
3. **Baton:** "Connected" indicator returns
4. If offline queue exists: "Synced X offline changes."

**Expected Result:** Clear reconnection notification. Offline changes synced.

---

## UC-12.14: Notification Persistence Across Server Restart

**Actor:** Server  
**Precondition:** Notifications exist, server restarts  
**Trigger:** Server comes back up

**Steps:**
1. Server has 5 active notifications in memory/database
2. Server restarts
3. Server loads notifications from persistence store
4. Baton page reconnects → sees all 5 notifications still there
5. No data loss

**Expected Result:** Notifications survive server restarts. Baton shows complete history.

---

## UC-12.15: Notification Flood Protection

**Actor:** Server  
**Precondition:** 20 users all start editing same file simultaneously  
**Trigger:** Rapid registrations

**Steps:**
1. 20 users register within 5 seconds, all touching `src/index.ts`
2. Each registration triggers collision evaluation
3. Server should NOT create 20 separate notifications
4. Server should create ONE notification: "20 users in Collision Course on src/index.ts"
5. Slack should receive ONE message (not 20)

**Expected Result:** Notification coalescing for rapid events. Single consolidated notification.

**⚠️ POTENTIAL GAP:** Current implementation may create a notification per registration. Need coalescing/debouncing logic.

---

## UC-12.16: Proactive Push Notification (Missing Feature)

**Actor:** User A (already working)  
**Precondition:** User A has active session  
**Trigger:** User B registers with overlapping files

**Steps:**
1. User A is working, hasn't saved in 2 minutes
2. User B registers with files overlapping User A
3. Server detects collision with User A
4. Server pushes SSE event to User A's connected client
5. User A's agent receives push and displays:
   `🟠 Konductor: bob just started editing src/index.ts — overlaps with your active files!`
6. User A doesn't need to save or interact to see this

**Expected Result:** Immediate notification without requiring User A to take any action.

**⚠️ STATUS: NOT IMPLEMENTED.** Currently User A only finds out on their next `register_session` (next file save/poll). This is captured in the missing features spec.
