# GitHub Integration Use Cases

## Overview

Konductor polls GitHub for open PRs and recent commits, creating passive sessions that participate in collision detection alongside active (live) sessions.

---

## UC-8.1: PR Creates Passive Session

**Actor:** Server (automated)  
**Precondition:** GitHub integration configured in `konductor.yaml`  
**Trigger:** GitHub poller runs on schedule

**Steps:**
1. Poller fetches open PRs for configured repo
2. PR #42 by "bob" modifies `src/index.ts`, `src/utils.ts`
3. Poller creates passive PR session:
   - userId: bob
   - repo: org/app
   - branch: feature/bobs-thing
   - files: [src/index.ts, src/utils.ts]
   - source: github_pr
4. Session participates in collision evaluation

**Expected Result:**
- PR files tracked as if bob were actively editing them
- Collision detected if another user touches same files
- Source attribution in collision messages

---

## UC-8.2: Commit Creates Passive Session

**Actor:** Server (automated)  
**Precondition:** `commit_branches: [main]` configured for repo  
**Trigger:** Poller detects recent commits on main

**Steps:**
1. Poller fetches commits on `main` within lookback window (24h)
2. "carol" pushed commits modifying `src/api.ts`
3. Poller creates passive commit session:
   - userId: carol
   - source: github_commit
   - files: [src/api.ts]
4. Session participates in collision evaluation

**Expected Result:**
- Recent commits tracked
- Collision detected if active user touches same files
- Source-attributed message: "carol pushed commits to main (Apr 15–16) modifying src/api.ts"

---

## UC-8.3: Self-Collision Suppression

**Actor:** User A (active session + has open PR)  
**Precondition:** User A has both active session and open PR  
**Trigger:** Collision evaluation runs

**Steps:**
1. User A has active session: `["src/index.ts"]`
2. User A also has PR #10 modifying `src/index.ts`
3. Deduplication filter detects: same user, same files
4. PR session suppressed for User A's collision check
5. User A does NOT get warned about their own PR

**Expected Result:**
- No self-collision
- User only warned about OTHER users' PRs/commits

---

## UC-8.4: PR Supersedes Commits

**Actor:** Server (automated)  
**Precondition:** User has both PR and commits touching same files  
**Trigger:** Deduplication filter runs

**Steps:**
1. "bob" has PR #42 modifying `src/index.ts`
2. "bob" also has commits on `main` modifying `src/index.ts`
3. Deduplication: PR covers same files → commit session skipped
4. Only PR session used for collision evaluation

**Expected Result:**
- No duplicate collision warnings
- PR takes precedence (more actionable)

---

## UC-8.5: Active Session Supersedes Passive

**Actor:** User with both active and passive sessions  
**Precondition:** User has live session AND PR/commits  
**Trigger:** Collision evaluation

**Steps:**
1. "bob" has active session (live editing `src/index.ts`)
2. "bob" also has PR modifying `src/index.ts`
3. Active session supersedes passive PR session
4. Collision messages reference active session, not PR

**Expected Result:**
- Active session is the authoritative source
- No redundant warnings from passive sessions

---

## UC-8.6: Approved PR Escalates Severity

**Actor:** User A (active), User B (approved PR)  
**Precondition:** User B's PR is approved and targets User A's branch  
**Trigger:** User A registers session

**Steps:**
1. User B's PR #42 is approved, targets `main`
2. User A registers on `main` with overlapping files
3. Server detects: approved PR + same target branch = imminent merge
4. Severity escalated
5. Message: `🔴 Critical — bob's PR #42 is approved and targets main. Merge is imminent.`

**Expected Result:**
- Higher severity than regular open PR
- Clear "imminent merge" warning
- Suggests immediate coordination

---

## UC-8.7: Draft PR De-escalates Severity

**Actor:** User A (active), User B (draft PR)  
**Precondition:** User B has draft PR  
**Trigger:** User A registers with overlapping files

**Steps:**
1. User B's PR #42 is a draft, modifies `src/index.ts`
2. User A registers with `src/index.ts`
3. Server detects: draft PR = work in progress, low risk
4. Severity de-escalated
5. Message: `🟡 Heads up — bob has a draft PR #42 touching src/index.ts. Low risk but worth tracking.`

**Expected Result:**
- Lower severity than regular open PR
- "Low risk" language
- Still tracked (not ignored)

---

## UC-8.8: GitHub Token Not Configured

**Actor:** Server  
**Precondition:** No `GITHUB_TOKEN` in env  
**Trigger:** Server starts

**Steps:**
1. Server reads `konductor.yaml` → `github` section present
2. Server checks for token → not found
3. Server logs: "GitHub integration configured but no token available"
4. Poller does not start
5. All other functionality works normally

**Expected Result:**
- No crash
- Clear log message
- Active sessions still tracked normally

---

## UC-8.9: GitHub Rate Limit Handling

**Actor:** Server (poller)  
**Precondition:** GitHub API rate limit approaching  
**Trigger:** Poller makes API call

**Steps:**
1. Poller calls GitHub API
2. Response header: `X-RateLimit-Remaining: 2`
3. Poller notes low remaining calls
4. Poller backs off (skips next poll cycle)
5. Resumes on following cycle when limit resets

**Expected Result:**
- No 403 rate limit errors
- Graceful backoff
- Resumes automatically
- Never disrupts active session tracking

---

## UC-8.10: Mixed-Source Collision Display

**Actor:** User A (active session colliding with multiple sources)  
**Precondition:** Active user, PR, and commits all touching same file  
**Trigger:** User A registers

**Steps:**
1. User A registers: `["src/index.ts"]`
2. Server finds overlaps:
   - bob: active session on `feature-y` editing `src/index.ts`
   - carol: PR #42 modifying `src/index.ts`, targeting `main`
   - dave: commits on `main` (Apr 15-16) modifying `src/index.ts`
3. Agent displays multi-source collision:
   ```
   🟠 Konductor: Collision detected on org/app
     🟠 bob is actively editing src/index.ts on feature-y (live session)
     🟠 carol's PR #42 (github.com/org/app/pull/42) modifies src/index.ts, targeting main
     🟠 dave pushed commits to main (Apr 15–16) modifying src/index.ts
   ```

**Expected Result:**
- Each source gets its own line
- Source type clearly indicated
- All relevant context included

---

## UC-8.11: Baton Shows Open PRs

**Actor:** Developer viewing Baton  
**Precondition:** GitHub integration configured  
**Trigger:** Page loads

**Steps:**
1. Baton fetches `/api/github/prs/:repo`
2. Table displays:
   - Hours Open: 48
   - Branch: feature/auth (linked)
   - PR #: 42 (linked)
   - User: bob (linked to GitHub profile)
   - Status: Open
   - Files: 5
3. Updates in real time via SSE

**Expected Result:**
- All open PRs displayed
- Links work
- Status accurate (Draft/Open/Approved)


---

## Extended GitHub PR Workflow Scenarios

### UC-8.12: PR Opened — Passive Session Created

**Actor:** Server (poller)  
**Precondition:** GitHub integration configured, repo `org/app` in config  
**Trigger:** New PR #50 opened by "eve" targeting `main`

**Steps:**
1. Poller fetches open PRs for `org/app`
2. New PR #50 found: author "eve", branch `feature/payments`, target `main`
3. Poller fetches PR changed files: `src/payments.ts`, `src/checkout.ts`
4. Poller creates passive PR session:
   - userId: eve
   - repo: org/app
   - branch: feature/payments
   - files: [src/payments.ts, src/checkout.ts]
   - source: github_pr
   - metadata: { prNumber: 50, status: "open", targetBranch: "main" }
5. Session participates in collision evaluation for all active users

**Expected Result:** PR tracked immediately on next poll cycle. Active users editing same files get notified.

---

### UC-8.13: PR Updated — Files Change

**Actor:** Server (poller)  
**Precondition:** PR #50 already tracked as passive session  
**Trigger:** Eve pushes new commits to PR #50, adding `src/api.ts`

**Steps:**
1. Poller fetches PR #50 changed files on next cycle
2. Files now: `src/payments.ts`, `src/checkout.ts`, `src/api.ts`
3. Poller updates passive session with new file list
4. Collision re-evaluated for all active users
5. If `src/api.ts` overlaps with an active user → new collision detected

**Expected Result:** PR session stays current with latest PR state. File additions/removals tracked.

---

### UC-8.14: PR Closed (Not Merged) — Session Removed

**Actor:** Server (poller)  
**Precondition:** PR #50 tracked as passive session  
**Trigger:** Eve closes PR #50 without merging

**Steps:**
1. Poller fetches open PRs
2. PR #50 no longer in open PR list
3. Poller removes passive session for PR #50
4. Collision state re-evaluated for affected users
5. If this was the only overlap → de-escalation

**Expected Result:** Closed PRs immediately stop contributing to collision detection. De-escalation fires if appropriate.

---

### UC-8.15: PR Merged — Session Removed, History Updated

**Actor:** Server (poller)  
**Precondition:** PR #50 tracked, gets merged  
**Trigger:** PR #50 merged into main

**Steps:**
1. Poller detects PR #50 is no longer open (merged)
2. Passive PR session removed
3. Commit poller picks up the merge commit on `main`
4. Baton "Repo History" section shows: "PR Merged — eve — #50 — feature/payments"
5. Collision de-escalation for affected users

**Expected Result:** Smooth transition from PR session to merge history. No gap in tracking.

---

### UC-8.16: PR Approved — Severity Escalation

**Actor:** Server (poller)  
**Precondition:** PR #50 was "open", reviewer approves it  
**Trigger:** Poller detects approval status change

**Steps:**
1. Previous poll: PR #50 status = "open"
2. Reviewer approves PR #50
3. Next poll: PR #50 status = "approved"
4. Poller updates passive session metadata: `status: "approved"`
5. Collision evaluator escalates severity for overlapping users
6. Active user "alice" (editing `src/payments.ts` on `main`) gets:
   - Previous: `🟠 Warning — eve's PR #50 modifies src/payments.ts, targeting main.`
   - Now: `🔴 Critical — eve's PR #50 is approved and targets main. Merge is imminent.`
7. Slack notification fires (if not already at this level)

**Expected Result:** Approval status change triggers re-evaluation. Severity escalates. Users warned of imminent merge.

---

### UC-8.17: PR Changes Requested — Severity De-escalation

**Actor:** Server (poller)  
**Precondition:** PR #50 was "approved", reviewer requests changes  
**Trigger:** Poller detects status change to "changes_requested"

**Steps:**
1. PR #50 status changes from "approved" to "changes_requested"
2. Poller updates session metadata
3. Severity de-escalates (no longer imminent merge)
4. Active users get updated message:
   - `🟠 Warning — eve's PR #50 has changes requested. Merge delayed.`

**Expected Result:** Status changes in both directions tracked. Severity adjusts accordingly.

---

### UC-8.18: Draft PR — Low Severity

**Actor:** Server (poller)  
**Precondition:** Eve opens draft PR #51  
**Trigger:** Poller discovers draft PR

**Steps:**
1. Poller finds PR #51: draft = true
2. `include_drafts: true` in config → create passive session
3. Session marked as draft source
4. Active user "alice" overlaps with draft PR files
5. Message: `🟡 Heads up — eve has a draft PR #51 touching src/payments.ts. Low risk but worth tracking.`
6. Severity de-escalated (draft = work in progress)

**Expected Result:** Draft PRs tracked but at lower severity. Informational, not alarming.

---

### UC-8.19: Draft PR Converted to Open — Severity Escalation

**Actor:** Server (poller)  
**Precondition:** Draft PR #51 tracked  
**Trigger:** Eve marks PR #51 as "ready for review"

**Steps:**
1. Previous: PR #51 draft = true
2. Eve converts to ready: draft = false
3. Poller detects change
4. Session metadata updated: no longer draft
5. Severity escalates for overlapping users:
   - Previous: `🟡 Heads up — draft PR`
   - Now: `🟠 Warning — eve's PR #51 modifies src/payments.ts, targeting main.`

**Expected Result:** Draft → open transition triggers re-evaluation and escalation.

---

### UC-8.20: PR Targets Non-Main Branch

**Actor:** Server (poller)  
**Precondition:** PR #52 targets `develop` branch, not `main`  
**Trigger:** Active user on `main` has overlapping files

**Steps:**
1. PR #52 by "frank": targets `develop`, modifies `src/config.ts`
2. Active user "alice" on `main` editing `src/config.ts`
3. Server evaluates: PR targets `develop`, alice is on `main`
4. Different target branch → lower severity than if PR targeted alice's branch
5. Message: `🟠 Warning — frank's PR #52 modifies src/config.ts, targeting develop (not your branch).`

**Expected Result:** Target branch matters. PR targeting user's branch = higher risk than PR targeting different branch.

---

### UC-8.21: PR Targets User's Current Branch — Highest Risk

**Actor:** Server (poller)  
**Precondition:** PR #53 targets `main`, active user is on `main`  
**Trigger:** Overlap detected

**Steps:**
1. PR #53 targets `main`
2. Active user "alice" is on `main` editing same files
3. Server evaluates: PR targets alice's CURRENT branch → direct conflict risk
4. Severity escalated: this PR will directly affect alice's branch when merged
5. Message: `🔴 Critical — frank's PR #53 targets YOUR branch (main) and modifies src/config.ts.`

**Expected Result:** PR targeting user's current branch gets highest severity. Direct merge conflict guaranteed.

---

### UC-8.22: Multiple PRs Overlapping Same File

**Actor:** Server (poller)  
**Precondition:** 3 PRs all modify `src/index.ts`  
**Trigger:** Active user also editing `src/index.ts`

**Steps:**
1. PR #40 (bob): modifies `src/index.ts`, status: open
2. PR #41 (carol): modifies `src/index.ts`, status: approved
3. PR #42 (dave): modifies `src/index.ts`, status: draft
4. Active user "alice" editing `src/index.ts` on `main`
5. Server evaluates all three overlaps:
   ```
   🔴 Merge Hell — multiple PRs targeting your files:
     🔴 carol's PR #41 is APPROVED — merge imminent
     🟠 bob's PR #40 modifies src/index.ts, targeting main
     🟡 dave's draft PR #42 touching src/index.ts (low risk)
   ```
6. Ranked by severity (approved > open > draft)

**Expected Result:** All overlapping PRs shown, ranked by risk. Approved PRs highlighted as most urgent.

---

### UC-8.23: Commit Poller — Recent Pushes Create Sessions

**Actor:** Server (commit poller)  
**Precondition:** `commit_branches: [main, develop]` configured  
**Trigger:** Poller runs on schedule

**Steps:**
1. Poller fetches commits on `main` within last 24 hours
2. Finds 3 commits by "bob" modifying `src/auth.ts`, `src/session.ts`
3. Finds 1 commit by "carol" modifying `src/api.ts`
4. Creates passive commit sessions:
   - bob: files [src/auth.ts, src/session.ts], source: github_commit, date_range: "Apr 19-20"
   - carol: files [src/api.ts], source: github_commit, date_range: "Apr 20"
5. Sessions participate in collision evaluation

**Expected Result:** Recent commits tracked. Users who pushed recently have passive sessions.

---

### UC-8.24: Commit Lookback Window Expiry

**Actor:** Server (commit poller)  
**Precondition:** `commit_lookback_hours: 24` configured  
**Trigger:** Commits age past 24 hours

**Steps:**
1. Bob's commits from 25 hours ago
2. Poller runs: commits outside 24h window
3. Passive commit session for bob removed
4. Collision state re-evaluated

**Expected Result:** Old commits automatically stop contributing to collision detection. No manual cleanup needed.

---

### UC-8.25: GitHub Token Revoked Mid-Operation

**Actor:** Server (poller)  
**Precondition:** Token was valid, admin revokes it on GitHub  
**Trigger:** Next poll cycle

**Steps:**
1. Poller attempts GitHub API call
2. Response: 401 Unauthorized (token revoked)
3. Poller logs error: "GitHub token invalid. PR/commit polling disabled."
4. All existing passive sessions from GitHub remain (not immediately removed)
5. On next cycle: same error, sessions start aging out
6. After `commit_lookback_hours`: commit sessions expire naturally
7. PR sessions remain until manually cleaned or token restored

**Expected Result:** No crash. Clear error logging. Graceful degradation. Active sessions unaffected.

---

### UC-8.26: GitHub API Returns Partial Data

**Actor:** Server (poller)  
**Precondition:** Large repo with 100+ open PRs  
**Trigger:** GitHub API paginates results

**Steps:**
1. Poller requests open PRs
2. GitHub returns page 1 of 3 (30 PRs per page)
3. Poller follows pagination links
4. Fetches all 100 PRs across 4 pages
5. Creates/updates passive sessions for all

**Expected Result:** Pagination handled correctly. All PRs discovered regardless of count.

**⚠️ VERIFY:** Does the poller handle GitHub API pagination? Or does it only get the first page?

---

### UC-8.27: PR with 500+ Changed Files

**Actor:** Server (poller)  
**Precondition:** Large PR with many changed files  
**Trigger:** Poller fetches PR files

**Steps:**
1. PR #60 has 500 changed files (large refactor)
2. GitHub API may paginate file list (max 300 per page)
3. Poller fetches all pages of changed files
4. Creates passive session with all 500 files
5. Collision evaluation runs against all 500 files

**Expected Result:** Large PRs handled correctly. All files tracked. Performance acceptable.

**⚠️ CONCERN:** 500-file session may slow collision evaluation. Consider capping or sampling.

---

### UC-8.28: Same User Has Active Session AND Open PR

**Actor:** User A (active session + own PR)  
**Precondition:** Alice has active session AND PR #45 open  
**Trigger:** Collision evaluation for alice

**Steps:**
1. Alice has active session: `["src/auth.ts", "src/config.ts"]`
2. Alice also has PR #45: modifies `["src/auth.ts", "src/old-code.ts"]`
3. Deduplication filter: active session supersedes own PR
4. Alice's PR session suppressed for her own collision check
5. Alice does NOT get warned about her own PR
6. OTHER users still see alice's PR as a collision source

**Expected Result:** Self-collision suppressed. Other users still see the PR.

---

### UC-8.29: PR Author Same as Active User — Different Files

**Actor:** User A  
**Precondition:** Alice has active session on `src/new.ts`, PR on `src/old.ts`  
**Trigger:** Collision evaluation

**Steps:**
1. Alice active: `["src/new.ts"]`
2. Alice PR #45: `["src/old.ts"]`
3. No file overlap between active and PR → no self-collision anyway
4. Both sessions exist independently
5. Other user "bob" editing `src/old.ts` → collision with alice's PR (not active session)

**Expected Result:** PR and active session tracked independently when files don't overlap. Other users collide with whichever source matches.
