# Live Share Integration Use Cases

## Overview

These use cases cover the full lifecycle of Konductor-mediated collaboration requests: how collisions trigger suggestions, how users initiate and respond to pairing requests, how links are exchanged across multiple delivery channels (agent chat, watcher terminal, Slack, Baton dashboard), and how the feature degrades gracefully when components are unavailable.

---

## Initiating a Collaboration Request

### UC-LS-1: User Requests Live Share After Collision Warning

**Actors:** Alice (initiator), Bob (recipient)
**Precondition:** Alice and Bob both have active sessions in `org/app`. Collision Course detected on `src/index.ts`.
**Trigger:** Alice says `"konductor, live share with bob"`

**Steps:**
1. Alice's agent parses the command, extracts target user `bob`
2. Agent calls `who_is_active` to validate Bob is active in `org/app` → Bob found
3. Agent calls `create_collab_request` MCP tool with:
   ```json
   { "initiator": "alice", "recipient": "bob", "repo": "org/app", "branch": "main", "files": ["src/index.ts"], "collisionState": "collision_course" }
   ```
4. Server creates request with status `pending`, returns `requestId`
5. Server emits `collab_request_update` SSE event to Baton subscribers
6. If Slack configured: server sends Slack message to `#konductor-alerts-app` (or DM to Bob)
7. Agent displays: `🤝 Konductor: Collaboration request sent to bob. They'll be notified via Slack and their next Konductor check-in.`

**Expected Result:**
- Request stored server-side with 30-minute TTL
- Bob notified via up to 3 channels (Slack, agent check-in, Baton dashboard)
- Alice gets immediate confirmation

---

### UC-LS-2: User Requests Live Share Without Specifying a User

**Actors:** Alice (in Collision Course with Bob)
**Precondition:** Active collision with Bob on `src/auth.ts`
**Trigger:** Alice says `"konductor, live share"`

**Steps:**
1. Agent detects no target user specified
2. Agent checks current collision state — finds Bob as the overlapping user
3. Agent auto-selects Bob as the recipient
4. Agent proceeds as in UC-LS-1 (calls `create_collab_request` with recipient: `bob`)
5. Agent displays: `🤝 Konductor: Collaboration request sent to bob (detected from current collision). They'll be notified via Slack and their next Konductor check-in.`

**Expected Result:** No need to type the username when there's an obvious collision partner.

---

### UC-LS-3: User Requests Live Share — Target User Not Active

**Actors:** Alice (initiator), Charlie (not active)
**Precondition:** Charlie has no active session in `org/app`
**Trigger:** Alice says `"konductor, live share with charlie"`

**Steps:**
1. Agent calls `who_is_active` → Charlie not found in active sessions
2. Agent calls `user_activity` for Charlie → no recent activity
3. Agent displays: `⚠️ Konductor: charlie doesn't appear to be active in this repo. They may be offline.`
4. No collaboration request created

**Expected Result:** Clear feedback. No phantom request sitting on the server.

---

### UC-LS-4: User Requests Live Share — No Active Collision

**Actors:** Alice (Solo state)
**Precondition:** Alice is the only user in the repo
**Trigger:** Alice says `"konductor, live share"` (no user specified)

**Steps:**
1. Agent detects no target user specified
2. Agent checks current collision state — Solo, no overlapping users
3. Agent displays: `⚠️ Konductor: No active collisions detected. Specify a user: "konductor, live share with <user>"`

**Expected Result:** Helpful guidance instead of a confusing error.

---

### UC-LS-5: User Requests Live Share — Multiple Collision Partners

**Actors:** Alice (in Merge Hell with Bob and Carol on different files)
**Precondition:** Bob overlapping on `src/auth.ts` (severe), Carol overlapping on `src/config.ts` (minimal)
**Trigger:** Alice says `"konductor, live share"`

**Steps:**
1. Agent detects no target user specified
2. Agent checks collision state — finds Bob (severe overlap) and Carol (minimal overlap)
3. Agent selects Bob as default (highest severity)
4. Agent displays:
   ```
   🤝 Konductor: Multiple collision partners detected:
     🔴 bob — src/auth.ts (severe overlap)
     🟡 carol — src/config.ts (minimal overlap)
   Sending request to bob (highest risk). Say "konductor, live share with carol" to pair with carol instead.
   ```
5. Agent proceeds to create collab request with Bob

**Expected Result:** Picks the most urgent partner. User can override.

---

## Proactive Suggestions

### UC-LS-6: Collision Course Triggers Live Share Suggestion

**Actors:** Alice (registering session), Bob (already active)
**Precondition:** Bob has active session on `src/index.ts`
**Trigger:** Alice registers session with `src/index.ts`

**Steps:**
1. Alice's agent calls `register_session`
2. Server returns: `collisionState: "collision_course"`, overlapping with Bob
3. Agent displays standard collision warning:
   ```
   🟠 Konductor: Warning — bob is modifying the same files: src/index.ts. Proceed?
   💡 Tip: Ask "konductor, who should I coordinate with?" for detailed coordination advice.
   💡 Tip: Say "konductor, live share with bob" to start a pairing session.
   ```
4. Agent waits for user confirmation

**Expected Result:** Live Share suggestion appears naturally in the collision flow. Not intrusive — just an option.

---

### UC-LS-7: Merge Hell Triggers Stronger Live Share Suggestion

**Actors:** Alice (branch `main`), Bob (branch `feature/auth`)
**Precondition:** Both editing `src/auth.ts` on different branches
**Trigger:** Alice registers session

**Steps:**
1. Server returns: `collisionState: "merge_hell"`, overlapping with Bob
2. Agent displays:
   ```
   🔴 Konductor: Critical overlap — bob has divergent changes on src/auth.ts across branches main, feature/auth. Strongly recommend coordinating.
   💡 Tip: Ask "konductor, who should I coordinate with?" for detailed coordination advice.
   🤝 Strongly recommend pairing. Say "konductor, live share with bob" to coordinate in real-time.
   ```

**Expected Result:** Stronger language at Merge Hell. The suggestion is more assertive.

---

## Recipient Notification Channels

### UC-LS-8: Recipient Notified via Agent Check-In (Primary Channel)

**Actors:** Bob (recipient, actively coding)
**Precondition:** Alice sent a collab request to Bob. Bob's watcher is running.
**Trigger:** Bob saves a file, triggering `register_session`

**Steps:**
1. Bob's watcher detects file change, calls `/api/register`
2. Server response includes: `pendingCollabRequests: [{ requestId: "abc-123", initiator: "alice", files: ["src/index.ts"], collisionState: "collision_course", createdAt: "..." }]`
3. Bob's agent displays:
   ```
   🤝 Konductor: alice wants to pair with you on src/index.ts (collision: Collision Course).
   Say "konductor, accept collab from alice" or "konductor, decline collab from alice".
   ```

**Expected Result:** Bob sees the request in his IDE chat on his next interaction. No action required from Alice beyond the initial request.

**Timing:** Depends on Bob's next file save or poll interval (default 10s). Worst case: 10 seconds. Best case: immediate if Bob saves a file.

---

### UC-LS-9: Recipient Notified via Slack DM (Secondary Channel)

**Actors:** Bob (recipient, may not be looking at IDE)
**Precondition:** Slack configured for `org/app`, DMs enabled
**Trigger:** Alice creates collab request

**Steps:**
1. Server creates collab request
2. Server sends Slack message to `#konductor-alerts-app` (or DM to Bob if `KONDUCTOR_COLLAB_SLACK_DM=true`):
   ```
   🤝 Collaboration Request — org/app
   alice wants to pair with bob on:
   • src/index.ts
   Collision state: 🟠 Collision Course

   Open your IDE and say: konductor, accept collab from alice
   ```
3. Bob sees Slack notification on phone/desktop

**Expected Result:** Bob gets a push notification even if IDE is minimized. The message tells Bob exactly what to type.

---

### UC-LS-10: Recipient Notified via Baton Dashboard (Tertiary Channel)

**Actors:** Bob (recipient, checking dashboard)
**Precondition:** Baton dashboard open for `org/app`
**Trigger:** Alice creates collab request

**Steps:**
1. Server emits `collab_request_update` SSE event
2. Baton dashboard's "Collaboration Requests" section updates in real-time
3. Bob sees:
   ```
   ┌─────────────────────────────────────────────────────┐
   │ 🤝 Collaboration Requests                           │
   ├─────────────────────────────────────────────────────┤
   │ alice → bob  |  src/index.ts  |  🟠 Collision Course │
   │ Status: Pending  |  2 min ago                        │
   │ [No share link yet]                                  │
   └─────────────────────────────────────────────────────┘
   ```

**Expected Result:** Visual overview on the dashboard. Useful for team leads monitoring the repo.

---

### UC-LS-11: Recipient Notified via Watcher Terminal

**Actors:** Bob (recipient, watcher terminal visible)
**Precondition:** Bob's watcher is running in a terminal
**Trigger:** Bob's next poll picks up the pending request

**Steps:**
1. Bob's watcher polls `/api/status`
2. Response includes `pendingCollabRequests`
3. Watcher logs to terminal:
   ```
   🤝 COLLAB REQUEST from alice — src/index.ts (Collision Course)
      Say "konductor, accept collab from alice" in your IDE chat.
   ```

**Expected Result:** Even if Bob isn't in the chat panel, the watcher terminal shows the request.

---

## Responding to Collaboration Requests

### UC-LS-12: Recipient Accepts Collaboration Request

**Actors:** Bob (recipient)
**Precondition:** Pending collab request from Alice
**Trigger:** Bob says `"konductor, accept collab from alice"`

**Steps:**
1. Agent calls `respond_collab_request` with `{ requestId: "abc-123", action: "accept" }`
2. Server updates request status to `accepted`
3. Server emits `collab_request_update` SSE event
4. If Slack configured: server sends update to channel/DM
5. Agent displays:
   ```
   🟢 Konductor: Accepted. Start a Live Share session and say "konductor, share link <url>" to send it to alice.
   ```
6. Alice's next agent check-in picks up the status change:
   ```
   🟢 Konductor: bob accepted your collaboration request. Waiting for a share link...
   ```

**Expected Result:** Both parties informed. Bob gets clear next-step instructions.

---

### UC-LS-13: Recipient Declines Collaboration Request

**Actors:** Bob (recipient)
**Precondition:** Pending collab request from Alice
**Trigger:** Bob says `"konductor, decline collab from alice"`

**Steps:**
1. Agent calls `respond_collab_request` with `{ requestId: "abc-123", action: "decline" }`
2. Server updates request status to `declined`
3. Server emits SSE event
4. Agent displays: `👋 Konductor: Declined. alice will be notified.`
5. Alice's next check-in:
   ```
   👋 Konductor: bob declined your collaboration request. You can still coordinate via Slack or try again later.
   ```

**Expected Result:** Clean decline. No hard feelings. Alice gets alternatives.

---

### UC-LS-14: Collaboration Request Expires

**Actors:** Alice (initiator), Bob (recipient, went to lunch)
**Precondition:** Alice sent request 30 minutes ago. Bob hasn't responded.
**Trigger:** Server TTL expiry check

**Steps:**
1. Server's periodic cleanup marks the request as `expired` (TTL: 30 min)
2. Server emits `collab_request_update` SSE event with status `expired`
3. Alice's next check-in:
   ```
   ⏰ Konductor: Your collaboration request to bob expired (no response after 30 min). Say "konductor, live share with bob" to try again.
   ```
4. Baton dashboard updates to show expired status

**Expected Result:** No zombie requests. Alice gets clear feedback and can retry.

---

## Share Link Exchange

### UC-LS-15: Recipient Shares Live Share Link (Manual Flow)

**Actors:** Bob (accepted request), Alice (waiting for link)
**Precondition:** Bob accepted Alice's collab request. Bob starts a Live Share session manually.
**Trigger:** Bob says `"konductor, share link https://prod.liveshare.vsengsaas.visualstudio.com/join?ABC123"`

**Steps:**
1. Agent validates URL contains `liveshare` or `vsengsaas.visualstudio.com` → valid
2. Agent calls `share_link` MCP tool with `{ requestId: "abc-123", shareLink: "https://..." }`
3. Server stores link, updates status to `link_shared`
4. Server emits SSE event
5. If Slack configured: server sends link to Alice via Slack
6. Agent displays: `🔗 Konductor: Link shared with alice. They'll receive it on their next check-in and via Slack.`
7. Alice's next check-in:
   ```
   🔗 Konductor: bob shared a Live Share link: https://prod.liveshare.vsengsaas.visualstudio.com/join?ABC123
   Open it to join the session.
   ```

**Expected Result:** Link relayed through the server. Alice doesn't need to be online at the exact moment Bob shares it.

---

### UC-LS-16: Invalid Share Link Rejected

**Actors:** Bob
**Trigger:** Bob says `"konductor, share link https://google.com"`

**Steps:**
1. Agent validates URL — doesn't contain `liveshare` or `vsengsaas.visualstudio.com`
2. Agent displays: `⚠️ Konductor: That doesn't look like a Live Share link. Expected a URL containing "liveshare" or "vsengsaas.visualstudio.com".`

**Expected Result:** Validation prevents accidental sharing of wrong URLs.

---

### UC-LS-17: Share Link via Baton Dashboard

**Actors:** Alice (viewing dashboard after Bob shared link)
**Precondition:** Bob shared a Live Share link
**Trigger:** Alice opens Baton dashboard

**Steps:**
1. Baton repo page shows updated Collaboration Requests section:
   ```
   ┌──────────────────────────────────────────────────────────┐
   │ 🤝 Collaboration Requests                                │
   ├──────────────────────────────────────────────────────────┤
   │ alice → bob  |  src/index.ts  |  🟠 Collision Course      │
   │ Status: Link Shared  |  5 min ago                         │
   │ [Join Session]  ← clickable button                        │
   └──────────────────────────────────────────────────────────┘
   ```
2. Alice clicks "Join Session" → opens Live Share link in browser/IDE

**Expected Result:** One-click join from the dashboard. No copy-pasting needed.

---

## Graceful Degradation

### UC-LS-18: Slack Not Configured — Agent-Only Delivery

**Actors:** Alice (initiator), Bob (recipient)
**Precondition:** Slack NOT configured for `org/app`
**Trigger:** Alice says `"konductor, live share with bob"`

**Steps:**
1. Agent creates collab request (server-side)
2. Server detects Slack not configured — skips Slack notification
3. Agent displays:
   ```
   🤝 Konductor: Collaboration request sent to bob.
   ⚠️ Slack not configured for this repo. bob will see the request on their next Konductor check-in or on the Baton dashboard.
   ```
4. Bob's next `register_session` or `check_status` includes the pending request
5. Bob sees the request in his agent chat

**Expected Result:** Feature works without Slack. Just slower delivery (depends on Bob's next interaction).

---

### UC-LS-19: Server Unreachable — Collab Request Fails

**Actors:** Alice (initiator)
**Precondition:** Konductor server is down
**Trigger:** Alice says `"konductor, live share with bob"`

**Steps:**
1. Agent attempts to call `create_collab_request` → connection fails
2. Agent displays:
   ```
   ⚠️ Konductor: Server not reachable. Can't send collaboration request right now.
   Try again when the server is back online, or reach out to bob directly.
   ```

**Expected Result:** Clear error. Suggests manual coordination as fallback.

---

### UC-LS-20: Collab Feature Disabled by Admin

**Actors:** Alice (initiator)
**Precondition:** `KONDUCTOR_COLLAB_ENABLED=false` on server
**Trigger:** Alice says `"konductor, live share with bob"`

**Steps:**
1. Agent calls `create_collab_request`
2. Server returns error: `Collaboration requests are disabled on this server.`
3. Agent displays: `⚠️ Konductor: Collaboration requests are disabled on this server. Contact your admin to enable them.`

**Expected Result:** Clear message about why it failed and who can fix it.

---

## Phase 3: IDE Automation

### UC-LS-21: Live Share Extension Detected and Session Started Automatically

**Actors:** Bob (accepted collab request, VS Code with Live Share installed)
**Precondition:** Bob accepted Alice's request. Live Share extension installed.
**Trigger:** Bob accepts the request

**Steps:**
1. Agent detects Live Share is installed (cached from earlier check or runs `code --list-extensions | grep ms-vsliveshare`)
2. Agent executes `liveshare.start` IDE command
3. If IDE exposes Live Share API: `share()` returns join URI programmatically
4. Agent automatically calls `share_link` with the captured URI
5. Agent displays: `🔗 Konductor: Live Share session started. Link sent to alice.`
6. Alice receives the link via all channels (agent, Slack, Baton)

**Expected Result:** Fully hands-free for Bob. Accept → session started → link shared → Alice joins.

---

### UC-LS-22: Live Share Not Installed — Offer to Install

**Actors:** Bob (no Live Share extension)
**Trigger:** Bob says `"konductor, accept collab from alice"`

**Steps:**
1. Agent checks for Live Share → not installed
2. Agent displays:
   ```
   📦 Konductor: Live Share is not installed. Install it? (say "yes" to proceed)
   You can also share a link manually without it.
   ```
3. Bob says "yes"
4. Agent runs `code --install-extension ms-vsliveshare.vsliveshare`
5. Agent displays: `✅ Konductor: Live Share installed. You may need to reload your IDE window.`
6. Agent caches installation status for the session

**Expected Result:** Guided installation. Bob isn't blocked — can always fall back to manual link sharing.

---

### UC-LS-23: Live Share API Not Available — Manual Fallback

**Actors:** Bob (Kiro IDE, Live Share extension status unknown)
**Trigger:** Bob accepts collab request

**Steps:**
1. Agent tries to detect Live Share via Kiro API → no API available
2. Agent tries `code --list-extensions` → `code` binary not found (Kiro, not VS Code)
3. Agent falls back to manual flow:
   ```
   🟢 Konductor: Accepted. Start a Live Share session manually:
   1. Open Command Palette → "Live Share: Start Collaboration Session"
   2. Copy the join link
   3. Say "konductor, share link <url>" to send it to alice
   ```

**Expected Result:** Graceful degradation. User gets step-by-step instructions.

---

### UC-LS-24: Alice Joins via "konductor, join" Command

**Actors:** Alice (received share link from Bob)
**Precondition:** Alice's agent displayed Bob's share link
**Trigger:** Alice says `"konductor, join https://prod.liveshare.vsengsaas.visualstudio.com/join?ABC123"`

**Steps:**
1. Agent validates URL → valid Live Share link
2. Agent attempts to execute `liveshare.join` IDE command with the URI
3. If IDE supports it: Live Share opens and Alice joins Bob's session
4. Agent displays: `🟢 Konductor: Joining bob's Live Share session...`
5. If IDE doesn't support it: Agent opens the URL in the default browser
6. Agent displays: `🔗 Konductor: Opening Live Share link in your browser. If you have the extension installed, it should open in your IDE.`

**Expected Result:** Best-effort IDE join, browser fallback.

---

### UC-LS-25: Live Share Requires Authentication

**Actors:** Bob (first time using Live Share)
**Trigger:** Agent attempts to start Live Share session

**Steps:**
1. Agent executes `liveshare.start`
2. Live Share prompts for Microsoft/GitHub sign-in (modal dialog)
3. Agent detects the session didn't start (no URI returned within timeout)
4. Agent displays:
   ```
   🔑 Konductor: Live Share needs you to sign in with your Microsoft or GitHub account.
   Complete the sign-in in the dialog that appeared, then say "konductor, share link <url>" after starting the session.
   ```

**Expected Result:** Agent doesn't hang waiting for auth. Gives clear instructions to complete manually.

---

## Edge Cases

### UC-LS-26: Duplicate Collab Request

**Actors:** Alice
**Precondition:** Alice already has a pending request to Bob
**Trigger:** Alice says `"konductor, live share with bob"` again

**Steps:**
1. Agent calls `create_collab_request`
2. Server detects existing pending request from Alice to Bob in same repo
3. Server returns existing `requestId` instead of creating a duplicate
4. Agent displays: `🤝 Konductor: You already have a pending request to bob. They'll be notified on their next check-in.`

**Expected Result:** No duplicate requests. Idempotent behavior.

---

### UC-LS-27: Collab Request After Collision Resolves

**Actors:** Alice (initiated request), Bob (deregistered, collision resolved)
**Precondition:** Alice sent request during Collision Course. Bob finished work and deregistered.
**Trigger:** Alice checks status

**Steps:**
1. Bob deregisters → collision drops to Solo
2. Request is still pending (hasn't expired yet)
3. Alice's next check-in shows: collision resolved + pending request
4. Agent displays:
   ```
   🟢 Konductor: Collision with bob resolved (bob is no longer active).
   ⏰ Your collaboration request to bob is still pending. It will expire in 22 min.
   ```

**Expected Result:** Request doesn't auto-cancel when collision resolves — Bob might come back. But Alice is informed.

---

### UC-LS-28: Both Users Send Collab Requests to Each Other

**Actors:** Alice and Bob (both in Collision Course)
**Trigger:** Both say `"konductor, live share"` at roughly the same time

**Steps:**
1. Alice creates request to Bob
2. Bob creates request to Alice
3. Server detects mutual requests (Alice→Bob and Bob→Alice for same repo)
4. Server auto-accepts both and notifies:
   ```
   🤝 Konductor: You and bob both requested to pair! Request auto-accepted.
   Start a Live Share session and say "konductor, share link <url>".
   ```

**Expected Result:** Mutual requests are a strong signal — auto-accept and skip the back-and-forth.

---

### UC-LS-29: Recipient Using Different IDE

**Actors:** Alice (Kiro), Bob (VS Code)
**Precondition:** Alice sends collab request
**Trigger:** Bob accepts and shares a Live Share link

**Steps:**
1. Bob (VS Code) starts Live Share, gets join URI
2. Bob shares link via `"konductor, share link <url>"`
3. Alice (Kiro) receives the link
4. Alice clicks the link or says `"konductor, join <url>"`
5. If Kiro supports Live Share: opens in IDE
6. If not: opens in browser → Live Share web client

**Expected Result:** Cross-IDE pairing works. Live Share links are IDE-agnostic.

---

### UC-LS-30: Multiple Pending Requests for Same Recipient

**Actors:** Bob (recipient of requests from Alice and Carol)
**Precondition:** Both Alice and Carol sent collab requests to Bob
**Trigger:** Bob's next agent check-in

**Steps:**
1. Server response includes 2 pending requests
2. Agent displays both:
   ```
   🤝 Konductor: You have 2 collaboration requests:
     1. alice wants to pair on src/index.ts (🟠 Collision Course) — 3 min ago
     2. carol wants to pair on src/config.ts (🔴 Merge Hell) — 1 min ago
   Say "konductor, accept collab from alice" or "konductor, accept collab from carol".
   ```

**Expected Result:** All pending requests shown, sorted by recency. Bob can respond to each individually.
