# Admin Dashboard Use Cases

## Overview

The admin dashboard at `/admin` provides system configuration, installer channel management, user management, and Slack integration. Access requires admin privileges.

---

## UC-4.1: Admin Logs In via Browser

**Actor:** Admin user  
**Precondition:** Server running, user listed in `KONDUCTOR_ADMINS` or has `admin: true`  
**Trigger:** Admin navigates to `/admin`

**Steps:**
1. Admin opens `https://<server>:3010/admin` in browser
2. No session cookie → redirected to `/login`
3. Admin enters userId and API key
4. Server validates credentials (userId exists, API key matches `KONDUCTOR_API_KEY`)
5. Server checks admin status (env var or database flag)
6. Server sets httpOnly session cookie (8-hour expiry)
7. Admin redirected to `/admin`
8. Dashboard loads with all panels

**Expected Result:**
- Login form displayed
- Valid credentials → redirect to dashboard
- Session cookie set
- All panels visible and populated

**Verification:**
- Navigate to `/admin` → see login form
- Submit valid creds → see dashboard
- Check cookie in browser dev tools

---

## UC-4.2: Non-Admin Attempts Access

**Actor:** Regular user (not admin)  
**Precondition:** User exists but not in `KONDUCTOR_ADMINS` and `admin: false`  
**Trigger:** User navigates to `/admin`

**Steps:**
1. User navigates to `/admin`
2. Redirected to `/login`
3. User enters valid credentials
4. Server authenticates but checks admin status → not admin
5. Server returns 403 Forbidden

**Expected Result:**
- Authentication succeeds but authorization fails
- Clear error message: "Admin access required"
- User cannot see dashboard content

---

## UC-4.3: Admin Views System Settings

**Actor:** Admin  
**Precondition:** Logged into admin dashboard  
**Trigger:** Dashboard loads

**Steps:**
1. System Settings panel displays current values:
   - Heartbeat timeout (seconds)
   - Session retention (days)
   - Purge interval (hours)
   - Verbose logging (on/off)
   - Log level
   - Storage mode
   - Log max size
2. Settings sourced from env vars shown as read-only with "ENV" label
3. Settings from database shown as editable

**Expected Result:**
- All settings displayed with current values
- Env-sourced settings clearly marked as read-only
- Editable settings have Save buttons

---

## UC-4.4: Admin Modifies a System Setting

**Actor:** Admin  
**Precondition:** Logged into admin dashboard  
**Trigger:** Admin changes heartbeat timeout from 300 to 120

**Steps:**
1. Admin locates "Heartbeat Timeout" in System Settings
2. Admin changes value from 300 to 120
3. Admin clicks Save
4. Server persists new value to settings store
5. Server applies change immediately (no restart needed)
6. Server logs: `[CONFIG] heartbeat_timeout changed from 300 to 120`
7. SSE event emitted → other admin sessions update in real time

**Expected Result:**
- Setting saved and applied immediately
- No server restart required
- Change logged
- Other admin browsers update via SSE

---

## UC-4.5: Admin Views Global Client Settings (Channels)

**Actor:** Admin  
**Precondition:** Logged into admin dashboard, bundles available  
**Trigger:** Dashboard loads

**Steps:**
1. Global Client Settings panel shows:
   - Dev channel: current version, dropdown to change, Promote → UAT button
   - UAT channel: current version, dropdown to change, Promote → Prod button
   - Prod channel: current version, dropdown to change
   - Each channel has Rollback button (if previous version exists)
   - Global default channel selector (Dev/UAT/Prod)
   - "Manage Bundles" button
2. Dropdowns populated from bundle registry (sorted by semver, newest first)

**Expected Result:**
- All channels displayed with current assignments
- Dropdowns show available versions
- Promote/Rollback buttons visible where applicable

---

## UC-4.6: Admin Assigns Bundle Version to Channel

**Actor:** Admin  
**Precondition:** Bundle registry has multiple versions  
**Trigger:** Admin selects version from Dev channel dropdown

**Steps:**
1. Admin opens Dev channel dropdown
2. Sees versions: `2.0.0`, `1.2.0`, `1.1.0`, `1.0.0`
3. Selects `2.0.0`
4. Clicks Save
5. Server updates Dev channel to serve `installer-2.0.0.tgz`
6. SSE event emitted
7. Client Install Commands panel updates with new URL
8. Users on Dev channel get `updateRequired: true` on next registration

**Expected Result:**
- Channel assignment updated immediately
- Install commands reflect new version
- Affected users will auto-update

---

## UC-4.7: Admin Promotes Dev → UAT

**Actor:** Admin  
**Precondition:** Dev channel has version `2.0.0` assigned  
**Trigger:** Admin clicks "Promote Dev → UAT"

**Steps:**
1. Admin clicks "Promote Dev → UAT"
2. Confirmation dialog appears
3. Admin confirms
4. Server copies Dev's version assignment to UAT
5. UAT's previous version retained for rollback
6. Server logs: `[SERVER] Promoted Dev (v2.0.0) → UAT`
7. SSE event emitted
8. UAT users get `updateRequired: true` on next registration

**Expected Result:**
- UAT now serves same version as Dev
- Previous UAT version available for rollback
- UAT users will auto-update

---

## UC-4.8: Admin Rolls Back Prod Channel

**Actor:** Admin  
**Precondition:** Prod was promoted from `1.1.0` to `1.2.0`, previous version retained  
**Trigger:** Admin clicks "Rollback" on Prod channel

**Steps:**
1. Admin clicks Rollback on Prod
2. Confirmation dialog: "Revert Prod from v1.2.0 to v1.1.0?"
3. Admin confirms
4. Server reverts Prod to `1.1.0`
5. Prod users get `updateRequired: true` (downgrade to `1.1.0`)
6. Server logs rollback event

**Expected Result:**
- Prod reverted to previous version
- Users will receive the older version on next update
- Rollback button disappears (no further rollback available)

---

## UC-4.9: Admin Views User Management Table

**Actor:** Admin  
**Precondition:** Multiple users have registered sessions  
**Trigger:** Dashboard loads

**Steps:**
1. User Management panel shows table with columns:
   - Username (linked to GitHub profile)
   - Repos Accessed (color-coded pills by recency)
   - Last Seen (color-coded pill)
   - Last Activity Summary (pill with JIRA ticket if available)
   - Installer Channel Override (dropdown: Default/Dev/UAT/Prod/Latest)
   - Admin (toggle)
2. Table is sortable by any column
3. Table is filterable by username, channel, admin status

**Expected Result:**
- All users displayed
- Color coding reflects freshness (green = recent, dark = stale)
- JIRA tickets extracted from branch names
- Stale repos hidden (beyond threshold)

---

## UC-4.10: Admin Changes User's Channel Override

**Actor:** Admin  
**Precondition:** User "bob" is on Default (Prod)  
**Trigger:** Admin changes bob's channel to UAT

**Steps:**
1. Admin finds "bob" in user table
2. Changes Channel Override dropdown from "Default" to "UAT"
3. Server updates bob's user record
4. On bob's next `register_session`, server checks bob's effective channel
5. If bob's current version ≠ UAT version → `updateRequired: true`
6. Bob auto-updates to UAT channel's bundle

**Expected Result:**
- Bob's channel override saved immediately
- Bob receives UAT bundle on next update check
- Other users unaffected

---

## UC-4.11: Admin Toggles User's Admin Flag

**Actor:** Admin  
**Precondition:** User "carol" has `admin: false`  
**Trigger:** Admin toggles carol's admin flag

**Steps:**
1. Admin finds "carol" in user table
2. Clicks Admin toggle → on
3. Server updates carol's user record: `admin: true`
4. Carol can now access `/admin`

**Expected Result:**
- Admin flag updated immediately
- Carol gains admin access on next login

**Edge Case:** If carol is listed in `KONDUCTOR_ADMINS`, toggle is read-only with "ENV" label.

---

## UC-4.12: Admin Views Install Commands

**Actor:** Admin  
**Precondition:** Channels have bundles assigned  
**Trigger:** Admin opens Client Install Commands panel

**Steps:**
1. Panel shows channel selector (Dev/UAT/Prod)
2. Default selection = global default channel
3. For selected channel, displays install command(s):
   - Local mode: two commands (localhost + network IP)
   - Cloud mode: one command (external URL)
4. Each command has a copy button
5. API key shown as `YOUR_API_KEY` placeholder

**Expected Result:**
- Commands are correct and copy-pasteable
- Channel-specific tarball URL used (e.g., `/bundle/installer-dev.tgz`)
- Switching channels updates commands immediately

---

## UC-4.13: Admin Dashboard Real-Time Updates (SSE)

**Actor:** Two admins viewing dashboard simultaneously  
**Precondition:** Both logged in  
**Trigger:** Admin A changes a setting

**Steps:**
1. Admin A changes heartbeat timeout to 120
2. Server emits SSE event: `admin_settings_change`
3. Admin B's dashboard receives event
4. Admin B's System Settings panel updates to show 120
5. No page refresh needed

**Expected Result:**
- Changes propagate to all admin sessions in real time
- SSE connection maintained
- Disconnection indicator shown if SSE drops

---

## UC-4.14: Admin Session Expires

**Actor:** Admin  
**Precondition:** Admin logged in, 8 hours pass  
**Trigger:** Admin makes next request after cookie expiry

**Steps:**
1. Admin's session cookie expires (8-hour lifetime)
2. Admin clicks a button or navigates
3. Server rejects request (invalid/expired cookie)
4. Admin redirected to `/login`
5. Admin re-authenticates

**Expected Result:**
- Graceful redirect to login
- No error page or crash
- Admin can re-authenticate and continue

---

## UC-4.15: Bootstrap Admin (First User)

**Actor:** First user to connect to fresh server  
**Precondition:** Empty user database, `KONDUCTOR_ADMINS` not set  
**Trigger:** First `register_session` creates user record

**Steps:**
1. Server starts with empty database
2. First user registers a session
3. Server creates user record with `admin: true` (bootstrap)
4. This user can now access `/admin`

**Expected Result:**
- First user automatically becomes admin
- No manual database editing needed
- Subsequent users get `admin: false` by default

---

## UC-4.16: Admin Changes Global Default Channel

**Actor:** Admin  
**Precondition:** Global default is Prod  
**Trigger:** Admin changes default to UAT

**Steps:**
1. Admin selects "UAT" in global default channel combo box
2. Clicks Save
3. Server updates global default
4. All users without per-user override now resolve to UAT
5. On next registration, those users get `updateRequired: true` if UAT version differs

**Expected Result:**
- Global default changed
- Affects all "Default" users
- Per-user overrides unaffected


---

## Extended Admin Workflow Scenarios

### UC-4.17: Admin Monitors Active Collisions Across All Repos

**Actor:** Admin  
**Precondition:** Multiple repos with active sessions  
**Trigger:** Admin wants overview of all collision activity

**Steps:**
1. Admin opens admin dashboard
2. Admin sees User Management table with all users
3. "Last Activity Summary" column shows per-user collision context
4. Users in Collision Course or Merge Hell have red/orange pills
5. Admin can identify which repos have active conflicts
6. Admin clicks user → sees their repos, branches, files

**Expected Result:** Admin has bird's-eye view of all collision activity without visiting each repo page.

**⚠️ POTENTIAL GAP:** No "all repos collision summary" panel on admin dashboard. Admin must infer from user table or visit individual Baton pages.

---

### UC-4.18: Admin Bulk-Assigns Users to Channel

**Actor:** Admin  
**Precondition:** 10 users need to move from Prod to UAT for testing  
**Trigger:** Admin wants to move multiple users at once

**Steps:**
1. Admin opens User Management table
2. Admin filters by Channel = "Default" (Prod)
3. Admin selects multiple users (checkbox?)
4. Admin changes channel for each user individually (no bulk action)
5. Each change triggers SSE event

**Expected Result:** Currently requires per-user changes. 

**⚠️ POTENTIAL GAP:** No bulk channel assignment. Admin must change each user individually. Consider adding multi-select + bulk action.

---

### UC-4.19: Admin Views Audit Trail of Setting Changes

**Actor:** Admin  
**Precondition:** Multiple settings have been changed over time  
**Trigger:** Admin wants to see who changed what and when

**Steps:**
1. Admin looks for audit/history of setting changes
2. Server logs contain `[CONFIG]` entries with timestamps and changes
3. No UI for viewing change history

**Expected Result:** Setting changes are logged but not easily viewable from the dashboard.

**⚠️ POTENTIAL GAP:** No settings change history UI. Admin must read server logs. Consider adding a "Recent Changes" section.

---

### UC-4.20: Admin Configures Stale Activity Threshold

**Actor:** Admin  
**Precondition:** User table shows repos from months ago  
**Trigger:** Admin wants to hide old repo activity

**Steps:**
1. Admin opens System Settings
2. Finds "Stale Activity Threshold" (days)
3. Changes from 30 to 7 days
4. Clicks Save
5. User table immediately hides repo pills older than 7 days
6. Users who haven't been active in 7+ days show fewer repo pills

**Expected Result:** Threshold applied immediately. Table becomes cleaner. Old activity hidden (not deleted).

---

### UC-4.21: Admin Handles Server Restart

**Actor:** Admin / Server Operator  
**Precondition:** Server needs restart (config change, update, etc.)  
**Trigger:** Server process restarted

**Steps:**
1. Server stops
2. All SSE connections drop
3. All admin dashboards show "Disconnected" indicator
4. All Baton pages show "Disconnected" indicator
5. All client watchers fail their next poll
6. Server starts back up
7. Server loads sessions from `sessions.json`
8. Server loads settings from database
9. Server loads bundle registry from `installers/`
10. SSE connections re-establish (auto-reconnect)
11. Watchers reconnect on next poll
12. Admin dashboards show "Connected" again

**Expected Result:** 
- No data loss (sessions persisted)
- Automatic reconnection everywhere
- Brief gap in tracking (acceptable)
- No manual intervention needed on client side

---

### UC-4.22: Admin Views Slack Integration Status

**Actor:** Admin  
**Precondition:** Slack bot token configured  
**Trigger:** Admin opens Slack Integration panel

**Steps:**
1. Admin opens Slack Integration panel in admin dashboard
2. Panel shows:
   - Token status: "Configured" (green) or "Not configured" (red)
   - Source: "Environment variable" or "Database"
   - Workspace: "MyTeam Workspace" (from `auth.test` response)
   - Bot user: "@konductor-bot"
   - Last successful post: timestamp
   - Last error: timestamp + error message (if any)
3. "Test" button available to send test message
4. Per-repo channel list showing all configured repos

**Expected Result:** Full visibility into Slack health. Admin can diagnose issues without checking logs.

---

### UC-4.23: Admin Tests Slack Integration

**Actor:** Admin  
**Precondition:** Bot token configured  
**Trigger:** Admin clicks "Test" button

**Steps:**
1. Admin enters channel name: "test-channel"
2. Clicks "Send Test Message"
3. Server posts: "🧪 Konductor test message — Slack integration is working!"
4. Server reports success/failure to admin
5. If success: "✅ Test message sent to #test-channel"
6. If failure: "❌ Failed: channel_not_found" (or whatever Slack returns)

**Expected Result:** Quick validation without waiting for a real collision.

---

### UC-4.24: Admin Manages Multiple Repos' Slack Config

**Actor:** Admin  
**Precondition:** 5 repos tracked, each needs different Slack channel  
**Trigger:** Admin wants to configure all repos

**Steps:**
1. Admin opens admin dashboard
2. No centralized "all repos Slack config" view exists
3. Admin must visit each Baton repo page individually
4. Or use chat commands per-repo

**Expected Result:** Currently requires per-repo configuration.

**⚠️ POTENTIAL GAP:** No admin-level "all repos Slack config" panel. Admin must visit each repo page or use API directly. Consider adding a Slack overview to admin dashboard.

---

### UC-4.25: Admin SSE Connection Drops and Recovers

**Actor:** Admin viewing dashboard  
**Precondition:** Dashboard open, SSE connected  
**Trigger:** Network blip

**Steps:**
1. SSE connection drops
2. Dashboard shows: "● Disconnected — reconnecting..." (red indicator)
3. Dashboard attempts reconnect with exponential backoff (1s, 2s, 4s, 8s...)
4. Network returns
5. SSE reconnects
6. Dashboard shows: "● Connected — live updates active" (green)
7. Dashboard fetches latest data to catch up on missed events
8. Any changes that happened during disconnect now visible

**Expected Result:** Automatic recovery. No stale data after reconnect. Clear visual indicator throughout.
