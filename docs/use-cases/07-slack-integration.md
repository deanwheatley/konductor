# Slack Integration Use Cases

## Overview

Konductor posts collision notifications to Slack channels using a bot token. Each repo has its own channel and verbosity configuration.

---

## UC-7.1: Collision Triggers Slack Notification

**Actor:** Server (automated)  
**Precondition:** Slack bot token configured, repo has channel set, verbosity ≥ state severity  
**Trigger:** Collision state meets verbosity threshold

**Steps:**
1. User A and User B register sessions with overlapping files
2. Server evaluates: Collision Course (severity 3)
3. Server checks repo's Slack verbosity: 2 (collision_course + merge_hell)
4. Severity 3 ≥ threshold → notification triggered
5. Server posts Block Kit message to configured channel:
   - Header: `🟠 Collision Course — org/app`
   - Section: users, files, branch
   - Context: `*konductor collision alert for org/app*`
6. Slack API returns success

**Expected Result:**
- Message posted to correct channel
- Block Kit formatting renders correctly in Slack
- All relevant info included (users, files, branch)

---

## UC-7.2: De-escalation Slack Notification

**Actor:** Server (automated)  
**Precondition:** Previous collision notification was sent  
**Trigger:** Collision state drops below verbosity threshold

**Steps:**
1. Previous state: Collision Course (notification was sent)
2. User B deregisters → state drops to Solo
3. Solo is below verbosity threshold (2)
4. Server posts de-escalation message:
   `✅ Collision resolved on org/app — previously 🟠 Collision Course`
5. Context footer included

**Expected Result:**
- Exactly one de-escalation message
- References the previous state
- Posted to same channel as escalation

---

## UC-7.3: Verbosity Prevents Notification

**Actor:** Server (automated)  
**Precondition:** Repo verbosity set to 1 (merge_hell only)  
**Trigger:** Collision Course detected

**Steps:**
1. Two users overlap → Collision Course (severity 3)
2. Server checks verbosity: 1 (only merge_hell triggers)
3. Collision Course severity (3) < merge_hell severity (4)? No — wait, verbosity 1 means only severity 4 triggers
4. Collision Course does NOT meet threshold → no Slack notification
5. Collision evaluation and user notifications proceed normally (just no Slack)

**Expected Result:**
- No Slack message posted
- Client-side notifications still work
- Baton still updates

---

## UC-7.4: Slack Bot Token Not Configured

**Actor:** Server (automated)  
**Precondition:** No `SLACK_BOT_TOKEN` env var, no database token  
**Trigger:** Collision occurs

**Steps:**
1. Collision Course detected
2. Server checks for bot token → none configured
3. Server logs: "Slack not configured, skipping notification"
4. All other functionality works normally
5. No error, no crash

**Expected Result:**
- Graceful skip
- Warning logged (not error)
- No disruption to collision evaluation

---

## UC-7.5: Slack API Error (Rate Limit)

**Actor:** Server (automated)  
**Precondition:** Bot token configured, Slack API rate-limited  
**Trigger:** Server attempts to post notification

**Steps:**
1. Collision detected, notification triggered
2. Server calls Slack API → 429 Too Many Requests
3. Server logs error: "Slack rate limited, will retry on next event"
4. Notification skipped for this event
5. On next collision event, server retries
6. No crash, no blocking

**Expected Result:**
- Error logged but not fatal
- Retry on next event (not immediate retry loop)
- Server continues operating normally

---

## UC-7.6: Slack API Error (Channel Not Found)

**Actor:** Server (automated)  
**Precondition:** Repo configured with channel that doesn't exist in Slack  
**Trigger:** Notification triggered

**Steps:**
1. Collision detected
2. Server posts to `#nonexistent-channel`
3. Slack API returns: `channel_not_found`
4. Server logs error with channel name
5. Notification skipped
6. Admin should be informed (via server log)

**Expected Result:**
- Error logged clearly
- No crash
- Suggests admin check channel configuration

---

## UC-7.7: Per-Repo Channel Configuration via Chat

**Actor:** Developer  
**Precondition:** Connected to Konductor  
**Trigger:** User says "konductor, change slack channel to my-team"

**Steps:**
1. User types: `konductor, change slack channel to my-team`
2. Agent calls `PUT /api/repo/:repoName/slack` with `{ channel: "my-team" }`
3. Server validates channel name (Slack rules: lowercase, alphanumeric + hyphens, max 80 chars)
4. Server updates per-repo Slack settings
5. Server emits `slack_config_change` SSE event
6. Agent confirms: `🟢 Konductor: Slack channel for org/app changed to #my-team.`
7. All connected clients in this repo receive notification:
   `📢 Konductor: Slack alerts for org/app now go to #my-team (verbosity: 2).`

**Expected Result:**
- Channel updated
- All clients notified
- Validation prevents invalid channel names

---

## UC-7.8: Invalid Channel Name Rejected

**Actor:** Developer  
**Precondition:** Connected  
**Trigger:** User says "konductor, change slack channel to BAD CHANNEL!!!"

**Steps:**
1. Agent calls API with invalid channel name
2. Server validates: contains spaces, uppercase, special chars → invalid
3. Server returns 400 with error message
4. Agent displays error to user

**Expected Result:**
- Clear error message about naming rules
- Channel NOT changed
- Helpful suggestion about valid format

---

## UC-7.9: Verbosity Change via Chat

**Actor:** Developer  
**Trigger:** User says "konductor, change slack verbosity to 4"

**Steps:**
1. Agent calls `PUT /api/repo/:repoName/slack` with `{ verbosity: 4 }`
2. Server validates: 4 is in range 0-5 → valid
3. Server updates verbosity
4. SSE event emitted
5. Agent confirms change
6. Now Neighbors and above trigger Slack notifications

**Expected Result:**
- Verbosity updated
- Future notifications respect new threshold
- All clients notified of change

---

## UC-7.10: Disable Slack via Chat

**Actor:** Developer  
**Trigger:** User says "konductor, disable slack"

**Steps:**
1. Agent calls API with `{ verbosity: 0 }`
2. Server sets verbosity to 0 (disabled)
3. Agent confirms: `⏹️ Konductor: Slack notifications disabled for org/app.`
4. No further Slack notifications for this repo

**Expected Result:**
- Verbosity set to 0
- No Slack messages posted regardless of collision state
- Can be re-enabled with "konductor, enable slack"

---

## UC-7.11: Slack Status Query

**Actor:** Developer  
**Trigger:** User says "konductor, slack status"

**Steps:**
1. Agent calls `GET /api/repo/:repoName/slack`
2. Server returns: `{ channel: "my-team", verbosity: 2, enabled: true }`
3. Agent displays:
   - Channel: #my-team
   - Verbosity: 2 (Collision Course + Merge Hell)
   - Status: Enabled (bot token configured)

**Expected Result:**
- Current config displayed clearly
- Verbosity level explained with label
- Enabled/disabled status shown

---

## UC-7.12: Admin Configures Bot Token

**Actor:** Admin  
**Precondition:** Logged into admin dashboard  
**Trigger:** Admin opens Slack Integration panel

**Steps:**
1. Admin opens Slack Integration panel in admin dashboard
2. Panel shows: "Not configured" (no token)
3. Admin pastes bot token: `xoxb-...`
4. Clicks Validate
5. Server calls Slack `auth.test` API
6. Success → shows workspace name and bot user
7. Admin clicks Save
8. Token persisted (encrypted) in settings store
9. Slack notifications now active for all repos

**Expected Result:**
- Token validated before saving
- Workspace info displayed on success
- Error shown on invalid token
- All repos can now send Slack notifications

---

## UC-7.13: Environment Variable Token Takes Precedence

**Actor:** Admin  
**Precondition:** `SLACK_BOT_TOKEN` set in `.env.local`  
**Trigger:** Admin views Slack panel

**Steps:**
1. Admin opens Slack Integration panel
2. Panel shows token status as "Configured via environment variable"
3. Token field is read-only
4. Admin cannot change token from dashboard
5. To change, admin must edit `.env.local`

**Expected Result:**
- Env var takes precedence over database
- Clear indication of source
- No accidental override

---

## UC-7.14: Default Channel Name Generation

**Actor:** Server (automated)  
**Precondition:** Repo `org/my-cool-app` has no channel configured  
**Trigger:** Collision notification triggered

**Steps:**
1. Server checks repo's Slack channel → none configured
2. Server generates default: `konductor-alerts-my-cool-app`
3. Sanitization applied: lowercase, alphanumeric + hyphens, max 80 chars, no leading hyphen
4. Server posts to `#konductor-alerts-my-cool-app`

**Expected Result:**
- Predictable default channel name
- Sanitized to Slack naming rules
- Uses repo name (not owner/repo)

---

## UC-7.15: Slack Config Change Notification to All Clients

**Actor:** Developer A changes Slack config, Developer B is also in the repo  
**Precondition:** Both developers connected  
**Trigger:** Developer A changes Slack channel

**Steps:**
1. Developer A: "konductor, change slack channel to new-alerts"
2. Server updates config
3. Server emits `slack_config_change` SSE event
4. Developer B's agent receives event
5. Developer B sees in chat:
   `📢 Konductor: Slack alerts for org/app now go to #new-alerts (verbosity: 2).`
   `🔗 Slack channel: https://slack.com/app_redirect?channel=new-alerts`

**Expected Result:**
- All connected clients in the repo notified
- Notification includes channel link
- Works regardless of who made the change
