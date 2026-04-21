# Collision Scenario Use Cases

## Overview

These use cases cover all five collision states with concrete multi-user scenarios. Each state has at least 3 scenarios demonstrating different ways the state can be triggered, plus the expected Konductor behavior (notifications, Baton updates, Slack messages).

---

## State: 🟢 Solo (Severity 0)

### UC-2.1: Single User in Empty Repo

**Actors:** User A  
**Precondition:** No active sessions in repo `org/app`  
**Trigger:** User A saves a file

**Steps:**
1. User A's watcher detects file change to `src/index.ts`
2. Watcher calls `/api/register` with files: `["src/index.ts"]`
3. Server evaluates collision: no other sessions → Solo
4. Server responds: `{ collisionState: "solo", summary: "[SOLO] repo:org/app | user:alice" }`
5. Agent displays registration confirmation only (no collision warning)

**Expected Baton State:** Health = 🟢 Healthy, 1 active user (green pill)  
**Expected Slack:** No notification (Solo never triggers Slack at any verbosity except 5)  
**Expected Agent Output:** `🟢 Konductor: Registered session on org/app#main (1 files)`

---

### UC-2.2: User Remains Solo After Others Deregister

**Actors:** User A, User B  
**Precondition:** Both users active in repo, User B finishes work  
**Trigger:** User B's session is deregistered

**Steps:**
1. User A and User B both have active sessions (state was Neighbors or higher)
2. User B closes their project / session times out
3. Server deregisters User B's session
4. On User A's next heartbeat/registration, server evaluates: only User A remains → Solo
5. If previous state was above verbosity threshold, server posts de-escalation to Slack

**Expected Baton State:** Health drops to 🟢 Healthy  
**Expected Slack:** De-escalation message if previous state was ≥ verbosity threshold  

---

### UC-2.3: Solo User Editing Many Files

**Actors:** User A  
**Precondition:** No other users in repo  
**Trigger:** User A is working on a large feature touching 50+ files

**Steps:**
1. User A's watcher reports 50 files being modified
2. Server registers session with all 50 files
3. No other sessions exist → Solo regardless of file count
4. Collision state remains Solo

**Expected Result:** File count does NOT affect collision state when alone. Solo is Solo.

---

## State: 🟢 Neighbors (Severity 1)

### UC-2.4: Two Users, Completely Different Files

**Actors:** User A (editing `src/auth.ts`), User B (editing `src/payments.ts`)  
**Precondition:** Both users in same repo `org/app`, same branch `main`  
**Trigger:** Both users register sessions

**Steps:**
1. User A registers: files `["src/auth.ts", "src/auth.test.ts"]`
2. User B registers: files `["src/payments.ts", "src/payments.test.ts"]`
3. Server evaluates: same repo, different files, no directory overlap → Neighbors
4. Both users receive: `collisionState: "neighbors"`
5. Agent displays: `🟢 Konductor: Others are active in this repo but working on different files. Proceeding.`

**Expected Baton State:** Health = 🟡 Warning, 2 active users  
**Expected Slack:** No notification at default verbosity (2). Notification at verbosity 4+.  

---

### UC-2.5: Three Users, All Different Areas

**Actors:** User A (`src/auth/`), User B (`src/api/`), User C (`tests/`)  
**Precondition:** All in same repo, same branch  
**Trigger:** All three register sessions

**Steps:**
1. User A: `["src/auth/login.ts", "src/auth/session.ts"]`
2. User B: `["src/api/routes.ts", "src/api/middleware.ts"]`
3. User C: `["tests/e2e/smoke.test.ts"]`
4. No file or directory overlap → Neighbors for all three

**Expected Result:** All users see Neighbors state. Baton shows 3 users, Warning health.

---

### UC-2.6: Users on Different Branches, No File Overlap

**Actors:** User A (branch `main`), User B (branch `feature/new-ui`)  
**Precondition:** Same repo, different branches, different files  
**Trigger:** Both register

**Steps:**
1. User A on `main`: `["README.md"]`
2. User B on `feature/new-ui`: `["src/components/Button.tsx"]`
3. Different branches AND different files → Neighbors

**Expected Result:** Branch difference alone doesn't escalate. Still Neighbors because no file overlap.

---

## State: 🟡 Crossroads (Severity 2)

### UC-2.7: Same Directory, Different Files

**Actors:** User A (editing `src/auth/login.ts`), User B (editing `src/auth/session.ts`)  
**Precondition:** Same repo, same branch  
**Trigger:** Both users register sessions with files in the same directory

**Steps:**
1. User A registers: `["src/auth/login.ts"]`
2. User B registers: `["src/auth/session.ts"]`
3. Server evaluates: same directory (`src/auth/`) but different files → Crossroads
4. Both users receive: `collisionState: "crossroads"`
5. Agent displays: `🟡 Konductor: Heads up — others are working in the same directories. Proceeding with caution.`

**Expected Baton State:** Health = 🟡 Warning  
**Expected Slack:** No notification at default verbosity (2). Notification at verbosity 3+.  

---

### UC-2.8: Nested Directory Overlap

**Actors:** User A (editing `src/components/auth/LoginForm.tsx`), User B (editing `src/components/auth/SignupForm.tsx`)  
**Precondition:** Same repo  
**Trigger:** Both register

**Steps:**
1. User A: `["src/components/auth/LoginForm.tsx"]`
2. User B: `["src/components/auth/SignupForm.tsx"]`
3. Same directory `src/components/auth/` → Crossroads

**Expected Result:** Directory matching works at any depth.

---

### UC-2.9: One User in Parent, One in Child Directory

**Actors:** User A (editing `src/utils.ts`), User B (editing `src/utils/helpers.ts`)  
**Precondition:** Same repo  
**Trigger:** Both register

**Steps:**
1. User A: `["src/utils.ts"]` (file in `src/`)
2. User B: `["src/utils/helpers.ts"]` (file in `src/utils/`)
3. Server evaluates directory overlap: `src/` contains both → Crossroads

**Expected Result:** Parent-child directory relationship triggers Crossroads.

**⚠️ VERIFY:** Does the collision evaluator consider `src/` and `src/utils/` as "same directory"? Need to confirm the directory matching algorithm.

---

## State: 🟠 Collision Course (Severity 3)

### UC-2.10: Two Users Editing the Same File, Same Branch

**Actors:** User A, User B  
**Precondition:** Same repo, same branch `main`  
**Trigger:** Both users modify `src/index.ts`

**Steps:**
1. User A registers: `["src/index.ts", "src/utils.ts"]`
2. User B registers: `["src/index.ts", "src/api.ts"]`
3. Server evaluates: shared file `src/index.ts`, same branch → Collision Course
4. Both users receive: `collisionState: "collision_course"`
5. Agent displays: `🟠 Konductor: Warning — bob is modifying the same files: src/index.ts. Proceed?`
6. Agent WAITS for user confirmation before proceeding

**Expected Baton State:** Health = 🔴 Alerting  
**Expected Slack:** Notification posted (default verbosity 2 includes collision_course)  
**Expected Agent Behavior:** Agent pauses and asks user to confirm  

**Slack Message:**
```
🟠 Collision Course — org/app
alice and bob are modifying the same files:
• src/index.ts
Branch: main
```

---

### UC-2.11: Three Users, Two Sharing a File

**Actors:** User A, User B, User C  
**Precondition:** Same repo  
**Trigger:** A and B share `src/config.ts`, C is on different files

**Steps:**
1. User A: `["src/config.ts", "src/auth.ts"]`
2. User B: `["src/config.ts", "src/api.ts"]`
3. User C: `["tests/smoke.test.ts"]`
4. A and B → Collision Course (shared file)
5. C → Neighbors (no overlap with A or B's files)

**Expected Result:** Collision state is per-user. C sees Neighbors while A and B see Collision Course.

---

### UC-2.12: User Joins Existing Collision

**Actors:** User A (already working), User B (just starting)  
**Precondition:** User A has active session on `src/index.ts`  
**Trigger:** User B starts editing `src/index.ts`

**Steps:**
1. User A already registered with `["src/index.ts"]`
2. User B registers with `["src/index.ts", "src/new-feature.ts"]`
3. Server evaluates B's registration: overlap with A → Collision Course
4. User B's agent displays collision warning and pauses
5. User A is notified on their next heartbeat/interaction

**Expected Result:** The joining user gets immediate warning. The existing user gets notified on next interaction.

**⚠️ QUESTION:** Is User A proactively notified when User B joins and creates a collision? Or does User A only find out on their next `register_session` call?

---

## State: 🔴 Merge Hell (Severity 4)

### UC-2.13: Same File, Different Branches

**Actors:** User A (branch `main`), User B (branch `feature/auth-refactor`)  
**Precondition:** Same repo, different branches  
**Trigger:** Both users modify `src/auth.ts`

**Steps:**
1. User A on `main`: `["src/auth.ts", "src/types.ts"]`
2. User B on `feature/auth-refactor`: `["src/auth.ts", "src/auth.test.ts"]`
3. Server evaluates: same file, DIFFERENT branches → Merge Hell
4. Both users receive: `collisionState: "merge_hell"`
5. Agent displays: `🔴 Konductor: Critical overlap — bob has divergent changes on src/auth.ts across branches main, feature/auth-refactor. Strongly recommend coordinating.`
6. Agent WAITS for user confirmation
7. Terminal echo: `echo "🔴 KONDUCTOR: MERGE HELL — bob modifying same files: src/auth.ts across branches main, feature/auth-refactor" >&2`

**Expected Baton State:** Health = 🔴 Alerting  
**Expected Slack:** Notification posted (merge_hell triggers at verbosity 1+)  
**Expected Agent Behavior:** Agent pauses, echoes to terminal, asks user to confirm  

**Slack Message:**
```
🔴 Merge Hell — org/app
alice (main) and bob (feature/auth-refactor) have divergent changes:
• src/auth.ts
Strongly recommend coordinating before merging.
```

---

### UC-2.14: Large Feature Branch Collides with Main

**Actors:** User A (branch `main`, editing `src/feature/file1.ts` line 10, part of 1000-file feature), User B (branch `feature/other`, editing `src/feature/file1.ts` line 10, part of 2-file change)  
**Precondition:** Same repo, different branches  
**Trigger:** Both modify the same file

**Steps:**
1. User A on `main`: 1000 files including `src/feature/file1.ts`
2. User B on `feature/other`: `["src/feature/file1.ts", "src/feature/file2.ts"]`
3. Server evaluates: shared file across branches → Merge Hell
4. Both users notified with full context
5. Konductor recommends immediate coordination

**Expected Baton State:** Health = 🔴 Alerting  
**Expected Slack:** Posted with all affected files listed  
**Expected Coordination Advice:** User B should coordinate with User A (User A has larger scope)

---

### UC-2.15: Three Users, Cross-Branch File Overlap

**Actors:** User A (`main`), User B (`feature/x`), User C (`feature/y`)  
**Precondition:** All editing `src/shared/config.ts` on different branches  
**Trigger:** All three register

**Steps:**
1. User A on `main`: `["src/shared/config.ts"]`
2. User B on `feature/x`: `["src/shared/config.ts", "src/x.ts"]`
3. User C on `feature/y`: `["src/shared/config.ts", "src/y.ts"]`
4. Three-way cross-branch overlap → Merge Hell for all
5. All three users notified with full list of overlapping users

**Expected Result:** Merge Hell with multiple users listed. Coordination advice ranks by urgency.

---

### UC-2.16: PR Collision (GitHub Integration)

**Actors:** User A (active session), User B (has open PR)  
**Precondition:** GitHub integration configured, User B has PR #42 modifying `src/index.ts`  
**Trigger:** User A registers session with `src/index.ts`

**Steps:**
1. GitHub poller creates passive PR session for User B's PR #42
2. User A registers: `["src/index.ts"]`
3. Server evaluates: User A's files overlap with PR #42's changed files
4. If PR targets User A's branch → Merge Hell
5. Agent displays source-attributed message:
   `🟠 Warning — bob's PR #42 (github.com/org/app/pull/42) modifies src/index.ts, targeting main.`

**Expected Result:** PR collisions detected even when PR author is offline.

---

### UC-2.17: Approved PR Collision (Imminent Merge)

**Actors:** User A (active), User B (approved PR about to merge)  
**Precondition:** User B's PR #42 is approved and targets `main`  
**Trigger:** User A registers on `main` with overlapping files

**Steps:**
1. GitHub poller detects PR #42 is approved
2. User A registers with files that overlap PR #42
3. Server escalates severity (approved PR = imminent merge)
4. Agent displays: `🔴 Critical — bob's PR #42 is approved and targets main. Merge is imminent.`

**Expected Result:** Approved PRs get higher severity than open PRs.

---

## State Transitions

### UC-2.18: Escalation (Solo → Neighbors → Crossroads → Collision Course)

**Actors:** User A (already working), User B (progressively getting closer)  
**Trigger:** User B's file list changes over time

**Steps:**
1. User A registered: `["src/auth/login.ts", "src/auth/session.ts"]`
2. User B registers: `["src/payments/stripe.ts"]` → A sees Neighbors
3. User B updates: `["src/auth/oauth.ts"]` → A sees Crossroads (same directory)
4. User B updates: `["src/auth/login.ts"]` → A sees Collision Course (same file)

**Expected Result:** Each escalation triggers appropriate notification. Baton health updates in real time.

---

### UC-2.19: De-escalation (Collision Course → Solo)

**Actors:** User A, User B  
**Precondition:** Both in Collision Course state  
**Trigger:** User B finishes work and deregisters

**Steps:**
1. A and B both editing `src/index.ts` → Collision Course
2. User B deregisters (closes project or session times out)
3. On A's next interaction, server evaluates: only A remains → Solo
4. Slack receives de-escalation message: `✅ Collision resolved on org/app — previously 🟠 Collision Course`
5. Baton health drops to 🟢 Healthy

**Expected Result:** De-escalation message posted to Slack. Baton updates. User A informed.

---

### UC-2.20: Rapid State Changes (Flapping)

**Actors:** User A, User B  
**Precondition:** User B's watcher is rapidly changing file lists  
**Trigger:** User B saves files in quick succession

**Steps:**
1. User B saves `src/index.ts` → Collision Course with A
2. 2 seconds later, User B saves `src/other.ts` (watcher updates file list, drops `src/index.ts`)
3. State drops back to Neighbors
4. 3 seconds later, User B saves `src/index.ts` again → Collision Course

**Expected Result:** Server should NOT spam Slack with rapid state changes. Some debouncing or "only notify on sustained state" logic should apply.

**⚠️ VERIFY:** Is there debouncing on Slack notifications? Or does every state change trigger a message?

---

## Edge Cases

### UC-2.21: User Registers with Empty File List

**Actor:** User A  
**Trigger:** `register_session` called with `files: []`

**Expected Result:** Server rejects with error. `register_session` requires at least one file.

---

### UC-2.22: Very Long File Paths

**Actor:** User A  
**Trigger:** Files with deeply nested paths (100+ characters)

**Expected Result:** Server handles gracefully. Baton displays truncated paths. Slack message doesn't exceed limits.

---

### UC-2.23: Same User, Multiple Repos

**Actor:** User A  
**Precondition:** User A has sessions in `org/frontend` and `org/backend`  
**Trigger:** User B registers in `org/frontend` with overlapping files

**Expected Result:** Collision only evaluated within the same repo. `org/backend` session unaffected.


---

## Line-Level Collision Scenarios

These scenarios assume line-level collision detection is implemented (see `konductor-line-level-collision` spec).

---

### UC-2.24: Same File, Same Lines — Line Collision

**Actors:** User A (editing `src/auth.ts` lines 10-25), User B (editing `src/auth.ts` lines 15-30)  
**Precondition:** Both users in same repo, same branch  
**Trigger:** Both register sessions with line range data

**Steps:**
1. User A registers: `[{ path: "src/auth.ts", lineRanges: [{ startLine: 10, endLine: 25 }] }]`
2. User B registers: `[{ path: "src/auth.ts", lineRanges: [{ startLine: 15, endLine: 30 }] }]`
3. Server evaluates: same file, overlapping lines 15-25 → Line Collision
4. Overlap: 11 lines → severity: `moderate`
5. Both users receive Collision Course with enhanced context:
   - `🟠 Collision Course — bob is editing src/auth.ts lines 15-30, overlapping with your lines 10-25 (11 lines overlap). Moderate merge conflict risk.`

**Expected Baton State:** Health = 🔴 Alerting  
**Expected Slack:**
```
🟠 Collision Course — org/app
alice (lines 10-25) and bob (lines 15-30) are editing the same section of:
• src/auth.ts (11 lines overlap)
Branch: main
Merge conflict risk: moderate
```

---

### UC-2.25: Same File, Different Sections — Section Collision (Lower Risk)

**Actors:** User A (editing `src/auth.ts` lines 10-25), User B (editing `src/auth.ts` lines 200-220)  
**Precondition:** Both users in same repo, same branch  
**Trigger:** Both register sessions with line range data

**Steps:**
1. User A registers: `[{ path: "src/auth.ts", lineRanges: [{ startLine: 10, endLine: 25 }] }]`
2. User B registers: `[{ path: "src/auth.ts", lineRanges: [{ startLine: 200, endLine: 220 }] }]`
3. Server evaluates: same file, NON-overlapping lines → Section Collision
4. Collision state is still Collision Course (same file) but with reduced concern
5. Both users receive:
   - `🟠 Collision Course — bob is editing src/auth.ts lines 200-220 — you're in lines 10-25, no line overlap. Low merge conflict risk.`

**Expected Baton State:** Health = 🔴 Alerting (still Collision Course)  
**Expected Slack:**
```
🟠 Collision Course — org/app
alice (lines 10-25) and bob (lines 200-220) are editing different sections of:
• src/auth.ts (no line overlap)
Branch: main
Merge conflict risk: low — different sections
```

**Key Difference from UC-2.24:** Same collision STATE but the message clearly communicates lower risk. The developer can make an informed decision about whether to coordinate.

---

### UC-2.26: Same File, Severe Line Overlap (>50% of changes)

**Actors:** User A (editing `src/config.ts` lines 1-50), User B (editing `src/config.ts` lines 5-45)  
**Precondition:** Same repo, different branches  
**Trigger:** Both register with heavy overlap

**Steps:**
1. User A on `main`: `[{ path: "src/config.ts", lineRanges: [{ startLine: 1, endLine: 50 }] }]`
2. User B on `feature/refactor`: `[{ path: "src/config.ts", lineRanges: [{ startLine: 5, endLine: 45 }] }]`
3. Server evaluates: same file, different branches, overlapping lines 5-45 → Merge Hell + Line Collision
4. Overlap: 41 lines, >50% of both users' changes → severity: `severe`
5. Both users receive:
   - `🔴 Merge Hell — bob is editing src/config.ts lines 5-45 on feature/refactor, overlapping with your lines 1-50 on main (41 lines, 82% overlap). HIGH merge conflict risk. Coordinate immediately.`

**Expected Baton State:** Health = 🔴 Alerting  
**Expected Slack:**
```
🔴 Merge Hell — org/app
alice (main, lines 1-50) and bob (feature/refactor, lines 5-45) have severe overlap:
• src/config.ts (41 lines overlap, 82% of bob's changes)
⛔ HIGH merge conflict risk. Coordinate immediately.
```

---

### UC-2.27: Same File, Minimal Line Overlap (1-5 lines)

**Actors:** User A (editing `src/utils.ts` lines 40-60), User B (editing `src/utils.ts` lines 58-80)  
**Precondition:** Same repo, same branch  
**Trigger:** Both register with tiny overlap

**Steps:**
1. User A: `[{ path: "src/utils.ts", lineRanges: [{ startLine: 40, endLine: 60 }] }]`
2. User B: `[{ path: "src/utils.ts", lineRanges: [{ startLine: 58, endLine: 80 }] }]`
3. Server evaluates: overlap on lines 58-60 → 3 lines → severity: `minimal`
4. Both users receive:
   - `🟠 Collision Course — bob is editing src/utils.ts lines 58-80, overlapping with your lines 40-60 (3 lines overlap). Minor overlap — likely a quick merge resolution.`

**Expected Result:** Collision Course state but with reassuring context. Developer may choose to continue without coordinating.

---

### UC-2.28: Multiple Files, Mixed Line Overlap

**Actors:** User A (editing 3 files), User B (editing 2 of the same files)  
**Precondition:** Same repo  
**Trigger:** Both register with partial overlap

**Steps:**
1. User A registers:
   ```
   [
     { path: "src/auth.ts", lineRanges: [{ startLine: 10, endLine: 30 }] },
     { path: "src/config.ts", lineRanges: [{ startLine: 1, endLine: 20 }] },
     { path: "src/utils.ts", lineRanges: [{ startLine: 50, endLine: 70 }] }
   ]
   ```
2. User B registers:
   ```
   [
     { path: "src/auth.ts", lineRanges: [{ startLine: 100, endLine: 120 }] },
     { path: "src/config.ts", lineRanges: [{ startLine: 15, endLine: 40 }] }
   ]
   ```
3. Server evaluates per-file:
   - `src/auth.ts`: no line overlap (A: 10-30, B: 100-120) → section collision
   - `src/config.ts`: overlap on lines 15-20 (6 lines) → line collision, severity: moderate
4. Notification includes per-file breakdown:
   ```
   🟠 Collision Course — bob is editing shared files:
     • src/config.ts: lines 15-40 overlap with your lines 1-20 (6 lines overlap) ⚠️
     • src/auth.ts: lines 100-120, no overlap with your lines 10-30 ✓
   ```

**Expected Result:** Per-file line analysis. User can see exactly which files need coordination and which are safe.

---

### UC-2.29: One User Has Line Data, Other Doesn't (Fallback)

**Actors:** User A (new watcher with line support), User B (old watcher without line support)  
**Precondition:** Same repo, same file  
**Trigger:** Both register, but B's client doesn't send line ranges

**Steps:**
1. User A registers: `[{ path: "src/index.ts", lineRanges: [{ startLine: 10, endLine: 25 }] }]`
2. User B registers: `["src/index.ts"]` (string format, no line ranges)
3. Server evaluates: same file, B has no line data → fallback to file-level
4. Collision state: Collision Course (same as before line-level existed)
5. Message: `🟠 Collision Course — bob is editing src/index.ts (line data unavailable for bob's session)`

**Expected Result:** Graceful fallback. No crash. File-level detection still works. Message indicates why line data is missing.

---

### UC-2.30: User Editing Single Line

**Actors:** User A (editing line 42 only), User B (editing lines 40-50)  
**Precondition:** Same file  
**Trigger:** Both register

**Steps:**
1. User A: `[{ path: "src/index.ts", lineRanges: [{ startLine: 42, endLine: 42 }] }]`
2. User B: `[{ path: "src/index.ts", lineRanges: [{ startLine: 40, endLine: 50 }] }]`
3. Overlap: line 42 → 1 line → severity: `minimal`
4. Message uses singular: "line 42" not "lines 42-42"

**Expected Result:** Single-line formatting handled correctly. Minimal severity.

---

### UC-2.31: Large Feature Branch — Many Files, Few Line Overlaps

**Actors:** User A (1000 files, large refactor), User B (2 files, small fix)  
**Precondition:** Different branches  
**Trigger:** Both register with line data

**Steps:**
1. User A on `main`: 1000 files with various line ranges
2. User B on `feature/hotfix`: 
   ```
   [
     { path: "src/feature/file1.ts", lineRanges: [{ startLine: 10, endLine: 15 }] },
     { path: "src/feature/file2.ts", lineRanges: [{ startLine: 1, endLine: 5 }] }
   ]
   ```
3. Server finds `src/feature/file1.ts` in both sessions
4. User A's range for that file: lines 10-200 (large change)
5. User B's range: lines 10-15 → overlap: 6 lines → severity: moderate
6. Merge Hell (different branches) + line overlap context

**Expected Result:**
```
🔴 Merge Hell — alice (main) has divergent changes on src/feature/file1.ts
  Your lines 10-15 overlap with alice's lines 10-200 (6 lines overlap)
  alice is touching 1000 files total — coordinate before merging.
  Merge conflict risk: moderate (your changes are small relative to alice's)
```

---

### UC-2.32: Risk Assessment with Line Data

**Actor:** Developer  
**Trigger:** User says "konductor, how risky is my situation?"

**Steps:**
1. Agent calls `risk_assessment`
2. Server evaluates all overlaps with line data
3. Response includes line-level context:

**Expected Output:**
```
🟠 Risk Assessment for org/app:
  Collision state: collision_course (severity 3)
  Overlapping users: 2
  
  📂 src/config.ts:
    • bob (lines 15-40) overlaps your lines 1-20 — 6 lines, moderate risk
    • carol (lines 200-210) — no overlap with your lines 1-20 ✓
  
  📂 src/auth.ts:
    • bob (lines 5-50) overlaps your lines 30-60 — 21 lines, SEVERE risk
  
  Overall: High risk on src/auth.ts. Coordinate with bob immediately.
```

---

### UC-2.33: Baton Dashboard Shows Line Overlap Detail

**Actor:** Developer viewing Baton  
**Precondition:** Line-level collision active  
**Trigger:** Notification appears on Baton

**Steps:**
1. Collision Course with line overlap detected
2. Baton notification row shows:
   - Summary: "alice and bob: src/auth.ts lines 10-25 ↔ lines 15-30 (11 lines overlap)"
   - Expandable detail showing per-file line breakdown
3. Hovering over a notification shows tooltip with full line range info

**Expected Result:** Line data visible in Baton without cluttering the table. Detail available on expand/hover.

---

### UC-2.34: Proactive Line Collision Notification

**Actors:** User A (already working on lines 10-25), User B (starts editing lines 15-30)  
**Precondition:** Proactive notifications implemented (Requirement 3 from bugs spec)  
**Trigger:** User B registers with overlapping lines

**Steps:**
1. User A has active session: `src/auth.ts` lines 10-25
2. User B registers: `src/auth.ts` lines 15-30
3. Server detects line overlap with User A
4. Server pushes SSE event to User A's client immediately
5. User A's agent displays:
   `🟠 Konductor: bob just started editing src/auth.ts lines 15-30 — overlaps with your lines 10-25 (11 lines). Coordinate?`

**Expected Result:** User A notified immediately (not on next save). Line-level context included in proactive notification.

---

### UC-2.35: De-escalation with Line Context

**Actors:** User A, User B  
**Precondition:** Line collision active, User B moves to different section  
**Trigger:** User B's next save is in a non-overlapping section

**Steps:**
1. Previous state: Collision Course with line overlap (lines 15-30 ↔ lines 10-25)
2. User B saves changes in lines 200-220 (moved to different section)
3. User B's watcher reports new line ranges: `[{ startLine: 200, endLine: 220 }]`
4. Server re-evaluates: same file but no line overlap → Section Collision
5. Collision state remains Collision Course but context improves
6. Notification: "bob moved to lines 200-220 — no longer overlapping with your lines 10-25 ✓"

**Expected Result:** Context-aware de-escalation. User informed that the immediate risk has reduced even though they're still in the same file.


---

## Revised Collision State Definitions (with Line-Level Data)

With line-level collision detection, the state model gains a 6th state: **Proximity**.

| State | Severity | Definition | Agent Behavior | Slack (default v2) |
|-------|----------|------------|----------------|---------------------|
| 🟢 Solo | 0 | Only user in repo | Proceed | No |
| 🟢 Neighbors | 1 | Same repo, different files | Proceed | No |
| 🟡 Crossroads | 2 | Same directory, different files | Proceed (caution) | No |
| 🟡 Proximity | 2.5 | Same file, different sections (no line overlap) | Proceed (caution) | No |
| 🟠 Collision Course | 3 | Same file, overlapping lines (or no line data available) | **PAUSE** | Yes |
| 🔴 Merge Hell | 4 | Same file + overlapping lines + different branches | **PAUSE** | Yes |

### Key Change: Proximity State

The Proximity state is NEW. It represents "same file, but working in different sections." This is lower risk than Collision Course because the changes are unlikely to conflict at merge time.

- **Agent does NOT pause** at Proximity (same as Crossroads)
- **Slack does NOT fire** at default verbosity (2)
- **Baton health** = 🟡 Warning (not Alerting)
- **Message tone:** informational, not alarming

Without line data (old clients), same-file overlap still defaults to Collision Course (backward compatible).

---

## Additional Collision Detection & Notification Scenarios

### UC-2.36: Collision Course Notification — Agent Pause Behavior

**Actors:** User A (agent is mid-task)  
**Precondition:** Agent is executing a multi-file task  
**Trigger:** Registration returns Collision Course

**Steps:**
1. Agent is implementing a feature, about to modify 5 files
2. Agent registers session with all 5 files
3. Server returns: Collision Course (bob editing `src/index.ts`)
4. Agent STOPS mid-task
5. Agent displays warning with full context
6. Agent asks: "Proceed with changes to src/index.ts?"
7. User confirms → agent continues
8. User says "skip that file" → agent modifies other 4 files, skips `src/index.ts`

**Expected Result:** Agent gives user control over whether to proceed with conflicting files. User can selectively skip.

**⚠️ MISSING FEATURE:** Currently the agent pauses entirely. There's no "skip conflicting files" option.

---

### UC-2.37: Merge Hell Notification — Coordination Workflow

**Actors:** User A, User B (different branches, same file)  
**Precondition:** Merge Hell detected  
**Trigger:** Agent pauses and recommends coordination

**Steps:**
1. Agent detects Merge Hell
2. Agent displays full context:
   ```
   🔴 Konductor: Critical overlap — bob (feature/auth) has divergent changes on:
     • src/auth.ts lines 10-50 (your lines 20-40 overlap — 21 lines, SEVERE)
   Strongly recommend coordinating before continuing.
   ```
3. Agent suggests actions:
   - "Ask bob to merge first"
   - "Rebase your branch on bob's"
   - "Continue anyway (risky)"
   - "Ask konductor, who should I talk to?"
4. User picks an action
5. If user continues: agent proceeds but logs the decision

**Expected Result:** Actionable options presented. User makes informed decision. Decision logged for audit.

**⚠️ MISSING FEATURE:** Agent currently just says "Proceed?" — doesn't offer specific coordination actions.

---

### UC-2.38: Notification Escalation Chain

**Actors:** User A, User B  
**Precondition:** Users start with no overlap  
**Trigger:** Progressive file changes create escalating collision

**Steps:**
1. T+0: Both users register, different files → Neighbors
   - Agent: `🟢 Others active but different files. Proceeding.`
2. T+5min: User B saves file in same directory → Crossroads
   - Agent: `🟡 Heads up — bob working in same directories.`
3. T+10min: User B saves same file, different section → Collision Course (section)
   - Agent: `🟠 Warning — bob editing src/auth.ts lines 200-220. You're in lines 10-30. No line overlap, but same file.`
   - Agent proceeds (section collision = lower risk)
4. T+15min: User B saves same file, overlapping lines → Collision Course (line)
   - Agent: `🟠 WARNING — bob now editing src/auth.ts lines 25-50, OVERLAPPING your lines 10-30! 6 lines overlap. Proceed?`
   - Agent PAUSES
5. T+20min: User B switches to different branch → Merge Hell (line)
   - Agent: `🔴 CRITICAL — bob moved to feature/x and is editing src/auth.ts lines 25-50 on a DIFFERENT BRANCH. 6 lines overlap. Coordinate immediately.`

**Expected Result:** Each escalation step produces a distinct notification. User sees the progression. Agent behavior changes at each threshold.

---

### UC-2.39: Notification De-escalation Chain

**Actors:** User A, User B  
**Precondition:** Currently in Merge Hell  
**Trigger:** User B progressively reduces overlap

**Steps:**
1. T+0: Merge Hell (same file, different branches, line overlap)
2. T+5min: User B moves to different section of same file → still Merge Hell but "different sections"
   - Agent: `🔴 Merge Hell — bob still on different branch, but moved to lines 200-220. No longer overlapping your lines 10-30.`
   - Slack: de-escalation? (same state but reduced risk)
3. T+10min: User B switches to same branch → Collision Course (section)
   - Agent: `🟠 Improved — bob now on same branch. Same file but different sections.`
   - Slack: de-escalation message
4. T+15min: User B moves to different file → Neighbors
   - Agent: `🟢 Resolved — bob moved to different files. Proceeding.`
   - Slack: `✅ Collision resolved on org/app`

**Expected Result:** Each de-escalation step notified. Slack only fires de-escalation when crossing below verbosity threshold.

---

### UC-2.40: Multiple Simultaneous Collisions

**Actors:** User A, User B, User C, User D  
**Precondition:** User A has files overlapping with multiple users  
**Trigger:** User A registers

**Steps:**
1. User A registers: `["src/auth.ts", "src/config.ts", "src/api.ts"]`
2. Server finds:
   - User B: overlaps on `src/auth.ts` (line collision, severe)
   - User C: overlaps on `src/config.ts` (section collision, no line overlap)
   - User D: overlaps on `src/api.ts` (different branch, line collision)
3. Highest severity wins for overall state: Merge Hell (User D, different branch)
4. Agent displays ALL overlaps ranked by severity:
   ```
   🔴 Konductor: Multiple collisions detected:
     🔴 dave (feature/payments) — src/api.ts lines 5-20 overlap your lines 10-30 (MERGE HELL)
     🟠 bob (main) — src/auth.ts lines 15-40 overlap your lines 10-25 (severe)
     🟠 carol (main) — src/config.ts lines 200-220, no overlap with your lines 1-20 (safe)
   
   Coordinate with dave immediately. Bob's overlap is also significant.
   ```

**Expected Result:** All collisions shown, ranked by severity. Overall state = worst case. Coordination advice prioritized.

---

### UC-2.41: Collision Notification Includes JIRA Context

**Actors:** User A (branch `feature/PROJ-123-auth-refactor`), User B (branch `feature/PROJ-456-auth-fix`)  
**Precondition:** Both branches have JIRA ticket identifiers  
**Trigger:** Collision detected

**Steps:**
1. Server extracts JIRA from branch names: PROJ-123, PROJ-456
2. Notification includes ticket context:
   ```
   🟠 Collision Course — bob (PROJ-456) editing src/auth.ts, overlapping with your work (PROJ-123)
   Both tickets touch the same code. Consider linking them in JIRA.
   ```
3. Baton notification row shows both JIRA tickets
4. Slack message includes ticket references

**Expected Result:** JIRA context helps users understand WHY there's overlap (related tickets).

---

### UC-2.42: Collision with Stale Session (Near Timeout)

**Actors:** User A (active), User B (last heartbeat 4 minutes ago, timeout is 5 min)  
**Precondition:** User B's session is about to expire  
**Trigger:** User A registers with overlapping files

**Steps:**
1. User B's last heartbeat: 4 minutes ago (timeout: 5 min)
2. User A registers with overlapping files
3. Server evaluates: User B's session is still active (not yet stale)
4. Collision Course reported
5. 1 minute later: User B's session expires (stale)
6. User A's next registration: Solo (User B gone)
7. De-escalation notification

**Expected Result:** Near-stale sessions still count. Once expired, collision resolves automatically. No false positives from already-stale sessions.

---

### UC-2.43: Rapid File Saves — Notification Coalescing

**Actors:** User A (saving rapidly), User B (existing session)  
**Precondition:** User A saves 10 files in 5 seconds  
**Trigger:** Watcher reports changes on each poll

**Steps:**
1. User A saves file1.ts → watcher polls → registers → Collision Course
2. 0.5s later: saves file2.ts → watcher polls → registers → still Collision Course
3. 0.5s later: saves file3.ts → watcher polls → registers → still Collision Course
4. Each registration returns same collision state

**Expected Behavior:**
- Watcher should NOT spam the terminal with repeated identical notifications
- Watcher uses signature comparison: `sig = state + users + files`
- If signature unchanged → no new notification
- Only notify when state or overlap details CHANGE

**Expected Result:** Single notification for sustained state. No spam during rapid saves.

---

### UC-2.44: Ghost Collision (User Left but Session Lingers)

**Actors:** User A (active), User B (closed laptop, session not yet timed out)  
**Precondition:** User B closed their IDE but heartbeat timeout hasn't elapsed  
**Trigger:** User A registers with overlapping files

**Steps:**
1. User B closed laptop 2 minutes ago (timeout: 5 min)
2. User B's session still active in server
3. User A registers → Collision Course with User B
4. User A sees warning about User B
5. User A asks: "konductor, how risky is my situation?"
6. Risk assessment shows User B's last heartbeat was 2 min ago
7. User A decides to wait 3 more minutes for session to expire

**Expected Result:** Last heartbeat time visible in risk assessment. User can make informed decision about whether the "collision" is real or a ghost.

**Enhancement:** Agent could note: "bob's last heartbeat was 2 min ago. Session will expire in 3 min if inactive."


---

## Resolution Suggestions — Konductor Recommends Actions

Konductor should not just detect collisions — it should suggest HOW to resolve them. The suggestions depend on the collision state, branch relationship, and overlap severity.

---

### UC-2.45: Resolution Suggestion — Proximity (Same File, Different Sections)

**Actors:** User A, User B  
**State:** Proximity  
**Context:** Same file, no line overlap, same branch

**Agent Output:**
```
🟡 Proximity — bob is editing src/auth.ts lines 200-220. You're in lines 10-30. No line overlap.

💡 Suggested actions:
  • Continue working — low merge conflict risk
  • Consider committing frequently to reduce drift
  • If your changes grow toward bob's section, coordinate early
```

**Expected Behavior:** Agent proceeds without pausing. Suggestions are informational only.

---

### UC-2.46: Resolution Suggestion — Collision Course (Line Overlap, Same Branch)

**Actors:** User A, User B  
**State:** Collision Course  
**Context:** Same file, overlapping lines, SAME branch

**Agent Output:**
```
🟠 Collision Course — bob is editing src/auth.ts lines 15-30, overlapping your lines 10-25 (11 lines).

💡 Suggested actions (pick one):
  1. 🔄 Rebase now — pull bob's latest changes before continuing
     Run: git pull --rebase origin main
  2. 💬 Coordinate with bob — agree on who owns lines 15-25
     Ask: "konductor, who should I talk to?"
  3. 📦 Shelve your changes — stash and let bob finish first
     Run: git stash
  4. ⚡ Continue anyway — accept merge conflict risk (11 lines overlap)

What would you like to do?
```

**Expected Behavior:** Agent PAUSES. Waits for user to pick an action or say "continue."

---

### UC-2.47: Resolution Suggestion — Collision Course (Severe Overlap)

**Actors:** User A, User B  
**State:** Collision Course  
**Context:** Same file, 30+ lines overlap, same branch

**Agent Output:**
```
🟠 Collision Course — bob is editing src/config.ts lines 5-50, overlapping your lines 1-40 (36 lines, SEVERE).

⚠️ High merge conflict risk. Strongly recommend coordinating.

💡 Suggested actions:
  1. 🛑 Stop and coordinate — this overlap is too large to resolve easily
     Ask: "konductor, who should I talk to?"
  2. 🔄 Rebase immediately — pull bob's changes and resolve conflicts now while they're small
     Run: git pull --rebase origin main
  3. 📦 Shelve your changes — stash and wait for bob to finish
     Run: git stash
  4. 🔀 Split the work — agree with bob on who takes which section
     Suggestion: You take lines 1-20, bob takes lines 21-50

Proceeding without coordination is NOT recommended.
```

**Expected Behavior:** Agent PAUSES with strong language. "Continue anyway" option available but discouraged.

---

### UC-2.48: Resolution Suggestion — Merge Hell (Different Branches)

**Actors:** User A (main), User B (feature/auth)  
**State:** Merge Hell  
**Context:** Same file, overlapping lines, DIFFERENT branches

**Agent Output:**
```
🔴 Merge Hell — bob (feature/auth) is editing src/auth.ts lines 15-40, overlapping your lines 10-30 on main (21 lines).

⛔ Cross-branch conflict. These changes WILL conflict at merge time.

💡 Suggested actions (in order of preference):
  1. 🛑 Stop immediately — coordinate with bob before making more changes
     Ask: "konductor, who should I talk to?"
  2. 🔀 Rebase bob's branch onto yours — resolve conflicts now while they're manageable
     Tell bob: git rebase main
  3. 📦 Shelve your changes — let bob merge first, then rebase
     Run: git stash
     Wait for bob's PR to merge, then: git stash pop
  4. 🏗️ Create a shared branch — both work on the same branch to avoid divergence
     Run: git checkout -b shared/auth-refactor
     Tell bob to switch too
  5. ⚡ Continue anyway — accept that merge will be painful (21 lines across branches)

🔴 The longer you wait, the worse the merge conflict will be.
```

**Expected Behavior:** Agent PAUSES with strongest warning. Terminal echo fires. Slack notification sent.

---

### UC-2.49: Resolution Suggestion — Merge Hell (Approved PR, Imminent Merge)

**Actors:** User A (main), User B (approved PR about to merge)  
**State:** Merge Hell  
**Context:** Bob's PR is approved and about to merge into User A's branch

**Agent Output:**
```
🔴 Merge Hell — bob's PR #42 is APPROVED and targets main. Merge is imminent.
Overlapping: src/auth.ts lines 10-50 (your lines 20-40, 21 lines overlap).

⛔ Bob's changes will land on main very soon. Act NOW.

💡 Suggested actions:
  1. 🛑 Stop and commit what you have — get your changes committed before bob merges
     Run: git add -A && git commit -m "WIP: save before PR #42 merge"
  2. 🔄 Rebase after merge — wait for bob's PR to merge, then rebase
     Watch PR #42: github.com/org/app/pull/42
     After merge: git pull --rebase origin main
  3. 💬 Ask bob to wait — request a brief hold on merging
     Message bob: "Hold merge on #42 — I have overlapping changes in lines 20-40"
  4. 📦 Shelve and rebase — stash your work, pull bob's merge, then reapply
     Run: git stash && git pull origin main && git stash pop

⏰ Time-sensitive: bob could merge at any moment.
```

**Expected Behavior:** Highest urgency. Agent pauses. Time-sensitive language.

---

### UC-2.50: Resolution Suggestion — Proximity on Different Branches

**Actors:** User A (main), User B (feature/x)  
**State:** Proximity (same file, different sections, different branches)  
**Context:** No line overlap but cross-branch = future merge risk

**Agent Output:**
```
🟡 Proximity — bob (feature/x) is editing src/auth.ts lines 200-250. You're in lines 10-30 on main. No line overlap currently.

💡 Note: You're on different branches. While there's no line overlap now, both changes will need to merge eventually.

Suggested actions:
  • Continue working — no immediate conflict
  • Keep changes small and commit frequently
  • If bob's feature branch is long-lived, consider periodic rebases
  • Monitor: "konductor, am I safe to push?" before merging
```

**Expected Behavior:** Agent proceeds (Proximity = no pause). Informational suggestions about future merge risk.

---

### UC-2.51: Resolution Suggestion — Multiple Collisions, Prioritized

**Actors:** User A, User B (severe overlap), User C (minimal overlap), User D (proximity)  
**State:** Merge Hell (worst case from User B)

**Agent Output:**
```
🔴 Multiple collisions detected. Prioritized by risk:

1. 🔴 CRITICAL — bob (feature/auth) src/auth.ts lines 5-50 overlap your lines 10-40 (31 lines, SEVERE)
   ⛔ Action: Stop and coordinate with bob immediately
   
2. 🟠 MODERATE — carol (main) src/config.ts lines 58-62 overlap your lines 55-65 (5 lines)
   💡 Action: Rebase after resolving bob's conflict
   
3. 🟡 LOW — dave (feature/ui) src/utils.ts lines 200-220, no overlap with your lines 1-30
   ✓ Action: No action needed — different sections

Recommended workflow:
  1. Coordinate with bob first (highest risk)
  2. Then rebase to pick up carol's changes
  3. Dave's changes are safe to ignore
```

**Expected Behavior:** Agent pauses (Merge Hell). Suggestions ranked by priority. Clear workflow order.

---

### UC-2.52: Resolution Suggestion — User Asks "What Should I Do?"

**Actor:** User A  
**Precondition:** Collision active  
**Trigger:** User says "konductor, what should I do?" or "konductor, how do I fix this?"

**Steps:**
1. User asks for resolution advice
2. Agent calls `coordination_advice` tool
3. Server returns targets with urgency and suggested actions
4. Agent formats personalized advice based on:
   - Current collision state
   - Branch relationship
   - Line overlap severity
   - Whether overlapping user is active or passive (PR/commit)
   - Time since overlap started

**Expected Output:** Same format as the resolution suggestions above, but triggered on-demand rather than at registration time.

---

### UC-2.53: Resolution Suggestion — After User Chooses "Rebase"

**Actor:** User A  
**Precondition:** User chose "Rebase now" from suggestions  
**Trigger:** User says "do the rebase" or "option 1"

**Steps:**
1. User picks rebase option
2. Agent runs: `git pull --rebase origin main`
3. If rebase succeeds cleanly:
   - Agent: "✅ Rebase complete. No conflicts. You're up to date with bob's changes."
   - Agent re-registers session
   - Collision may resolve (if bob's changes are now in your branch)
4. If rebase has conflicts:
   - Agent: "⚠️ Rebase has conflicts in src/auth.ts. Resolve them before continuing."
   - Agent helps resolve conflicts if asked

**Expected Result:** Agent can execute the suggested action. Provides feedback on outcome.

**⚠️ NOTE:** Agent executing git commands on behalf of user is powerful but risky. May want confirmation before running.

---

### UC-2.54: Resolution Suggestion — After User Chooses "Shelve"

**Actor:** User A  
**Precondition:** User chose "Shelve your changes"  
**Trigger:** User says "shelve" or "stash"

**Steps:**
1. User picks shelve option
2. Agent runs: `git stash`
3. Agent confirms: "📦 Changes stashed. Your working directory is clean."
4. Agent deregisters session (no active files)
5. Agent: "I'll monitor bob's activity. Say 'konductor, is it safe to unstash?' when ready."
6. Later, user asks to unstash
7. Agent checks: is bob still editing those files?
8. If clear: "🟢 Bob finished. Safe to unstash. Run: git stash pop"
9. If still active: "⚠️ Bob is still editing src/auth.ts. Wait or coordinate."

**Expected Result:** Full shelve workflow with monitoring. Agent tracks when it's safe to resume.

**⚠️ MISSING FEATURE:** "Is it safe to unstash?" command not in current routing table. Needs to be added.
