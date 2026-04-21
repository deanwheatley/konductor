# Baton Dashboard Use Cases

## Overview

The Baton dashboard provides per-repository web pages at `/repo/:repoName` with real-time visibility into development activity, collision notifications, query logs, PRs, and history.

---

## UC-6.1: Developer Views Repo Page

**Actor:** Developer  
**Precondition:** Server running, at least one active session in repo  
**Trigger:** Developer navigates to `/repo/<repoName>`

**Steps:**
1. Developer opens `https://<server>:3010/repo/myapp`
2. Page loads with sections:
   - Repository Summary (always expanded)
   - Notifications & Alerts (collapsible)
   - Query Log (collapsible)
   - Open PRs (collapsible)
   - Repo History (collapsible)
   - Slack Integration (collapsible)
3. Repository Summary shows:
   - Repo name (linked to GitHub)
   - Health status badge (Healthy/Warning/Alerting)
   - Active branches (linked to GitHub)
   - Active users as color-coded pills
   - Session and user counts

**Expected Result:**
- Page renders with all sections
- Real-time data displayed
- SSE connection established for live updates

---

## UC-6.2: Health Status Reflects Collision State

**Actor:** Developer viewing Baton  
**Precondition:** Multiple users active  
**Trigger:** Collision state changes

**Scenarios:**

| Active Users State | Expected Health | Badge Color |
|---|---|---|
| All Solo | 🟢 Healthy | Green |
| Any Neighbors | 🟡 Warning | Yellow |
| Any Crossroads | 🟡 Warning | Yellow |
| Any Collision Course | 🔴 Alerting | Red |
| Any Merge Hell | 🔴 Alerting | Red |

**Steps:**
1. Two users register with overlapping files → Collision Course
2. Baton health badge changes to 🔴 Alerting (red background)
3. One user deregisters → remaining user is Solo
4. Baton health badge changes to 🟢 Healthy (green background)

**Expected Result:**
- Health updates within 5 seconds of state change
- Color coding matches severity
- No page refresh needed

---

## UC-6.3: User Freshness Pills

**Actor:** Developer viewing Baton  
**Precondition:** Multiple users with varying last-heartbeat times  
**Trigger:** Page loads

**Steps:**
1. User A: last heartbeat 2 minutes ago → Level 1 (bright green)
2. User B: last heartbeat 25 minutes ago → Level 3 (teal)
3. User C: last heartbeat 90+ minutes ago → Level 10 (near black)
4. Each user displayed as pill badge with appropriate color

**Expected Result:**
- Color accurately reflects recency
- 10-level scale from green to black
- Interval configurable via `BATON_FRESHNESS_INTERVAL_MINUTES`

---

## UC-6.4: Notifications Table — New Collision Event

**Actor:** Developer viewing Baton  
**Precondition:** Page open with SSE connected  
**Trigger:** Collision state escalates

**Steps:**
1. User A and User B start editing same file
2. Server evaluates: Collision Course
3. Server creates notification record
4. SSE event pushed to Baton page
5. New row appears in Notifications table:
   - Timestamp: now
   - Type: Alerting
   - State: Collision Course
   - Branch: main
   - JIRAs: PROJ-123 (if branch is `feature/PROJ-123-thing`)
   - Summary: "alice and bob modifying src/index.ts"
   - Users: alice, bob (linked to GitHub)
   - Resolve button

**Expected Result:**
- Row appears within 5 seconds
- All columns populated
- JIRA extracted from branch name

---

## UC-6.5: Resolve a Notification

**Actor:** Developer  
**Precondition:** Active notification in table  
**Trigger:** Developer clicks Resolve button

**Steps:**
1. Developer clicks Resolve on a Collision Course notification
2. Confirmation dialog appears
3. Developer confirms
4. Server marks notification as resolved
5. Notification moves to "History" tab
6. Active notification count decreases

**Expected Result:**
- Notification removed from active view
- Available in history view
- Count badge updates

---

## UC-6.6: Query Log Records User Queries

**Actor:** Developer using "konductor," commands  
**Precondition:** Baton page open  
**Trigger:** User asks "konductor, who else is working here?"

**Steps:**
1. User invokes `who_is_active` via chat
2. Server logs query in query log store
3. SSE event pushed to Baton
4. New row in Query Log table:
   - Timestamp: now
   - User: alice
   - Branch: main
   - Query Type: who_is_active
   - Parameters: (none)

**Expected Result:**
- All user-initiated queries logged
- Visible on Baton in real time
- Sortable and filterable

---

## UC-6.7: Collapsible Sections

**Actor:** Developer  
**Precondition:** Baton page loaded  
**Trigger:** Developer clicks section header

**Steps:**
1. Developer clicks "Notifications & Alerts" header
2. Section collapses to single header bar
3. Header shows count badge (e.g., "3 active")
4. Developer clicks again → section expands
5. Repository Summary section is NOT collapsible

**Expected Result:**
- All sections except Repository Summary are collapsible
- Count badge shown when collapsed
- State persists during session

---

## UC-6.8: SSE Disconnection and Reconnection

**Actor:** Developer viewing Baton  
**Precondition:** Page open, SSE connected  
**Trigger:** Network interruption

**Steps:**
1. Network drops briefly
2. SSE connection lost
3. Disconnection banner appears: "● Disconnected — reconnecting..."
4. Client attempts reconnection with exponential backoff
5. Network returns
6. SSE reconnects
7. Banner changes to: "● Connected — live updates active"
8. Page fetches latest data to catch up on missed events

**Expected Result:**
- Clear visual indicator of connection state
- Automatic reconnection
- No data loss (catches up after reconnect)

---

## UC-6.9: Open PRs Section (GitHub Configured)

**Actor:** Developer  
**Precondition:** GitHub integration configured for this repo  
**Trigger:** Page loads

**Steps:**
1. Open PRs section shows table:
   - Hours Open
   - Branch (linked to GitHub)
   - PR # (linked to GitHub)
   - User (linked to GitHub profile)
   - Status (Draft/Open/Approved)
   - File count
2. Table updates in real time as PRs are opened/closed/approved

**Expected Result:**
- All open PRs for the repo displayed
- Links work correctly
- Status reflects current PR state

---

## UC-6.10: Open PRs Section (GitHub NOT Configured)

**Actor:** Developer  
**Precondition:** No GitHub integration  
**Trigger:** Page loads

**Steps:**
1. Open PRs section shows placeholder: "GitHub Integration Coming Soon"
2. No table rendered
3. No errors in console

**Expected Result:**
- Graceful degradation
- Clear message about missing integration
- No broken UI

---

## UC-6.11: Repo History Section

**Actor:** Developer  
**Precondition:** GitHub integration configured  
**Trigger:** Page loads

**Steps:**
1. Repo History section shows table:
   - Timestamp
   - Action (Commit, PR, Merge)
   - User (linked to GitHub)
   - Branch
   - Summary
2. Sortable by any column
3. Filterable by Action and User

**Expected Result:**
- Recent activity displayed chronologically
- All action types represented
- Links to GitHub work

---

## UC-6.12: Baton Page for Repo with No Sessions

**Actor:** Developer  
**Precondition:** Repo exists but no active sessions  
**Trigger:** Developer navigates to repo page

**Steps:**
1. Developer opens `/repo/empty-repo`
2. Page loads with empty sections
3. Message: "No active sessions"
4. Health: 🟢 Healthy (no users = healthy)

**Expected Result:**
- Page renders without errors
- Empty state handled gracefully
- Ready to populate when sessions appear

---

## UC-6.13: Baton Authentication (When Enabled)

**Actor:** Developer  
**Precondition:** `BATON_GITHUB_CLIENT_ID` configured  
**Trigger:** Developer navigates to repo page without auth

**Steps:**
1. Developer opens `/repo/myapp`
2. No session cookie → redirect to GitHub OAuth
3. Developer authorizes on GitHub
4. Callback redirects back to `/repo/myapp`
5. Server checks GitHub API: does user have read access to repo?
6. Access confirmed → page loads
7. Session cookie set (8-hour expiry)

**Expected Result:**
- OAuth flow works end-to-end
- Access check enforced
- Session cached to avoid repeated OAuth

---

## UC-6.14: Baton Authentication — No Access

**Actor:** Developer without repo access  
**Precondition:** Baton auth enabled  
**Trigger:** Developer tries to view repo they can't access

**Steps:**
1. Developer authenticates via GitHub
2. Server checks repo access → user does NOT have read access
3. Server returns 403
4. Developer sees access denied message

**Expected Result:**
- Clear error message
- No repo data leaked
- Suggestion to request access

---

## UC-6.15: Slack Integration Panel on Repo Page

**Actor:** Developer  
**Precondition:** Slack bot token configured  
**Trigger:** Developer views Baton repo page

**Steps:**
1. Slack Integration panel shows:
   - Current channel name (editable)
   - Verbosity dropdown (0-5 with labels)
   - Slack channel link
   - "Slack is enabled" indicator
2. Developer changes channel to "my-team-alerts"
3. Clicks Save
4. Server updates per-repo Slack config
5. Test notification sent to new channel
6. SSE event notifies all connected clients

**Expected Result:**
- Slack config visible and editable
- Changes take effect immediately
- Test notification confirms working integration
