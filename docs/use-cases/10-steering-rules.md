# Steering Rules & Agent Behavior Use Cases

## Overview

The steering rule (`konductor-collision-awareness.md`) instructs the AI agent to automatically handle Konductor interactions. These use cases cover the agent's autonomous behavior.

---

## UC-10.1: Session Start — Full Health Check

**Actor:** Agent (automated on first message)  
**Trigger:** User sends first message in a new conversation

**Steps:**
1. Agent checks watcher: `pgrep -f konductor-watcher.mjs`
2. If not running and `konductor-watcher.mjs` exists → start it
3. Agent calls `check_status` or `register_session` to probe MCP server
4. Agent prints consolidated status message

**Scenarios:**

| Watcher | Server | Output |
|---------|--------|--------|
| Running | Reachable | `🟢 Konductor: Fully operational and watching your back!` |
| Running | Unreachable | `⚠️ Konductor: Server not reachable. Collision awareness is OFFLINE.` + `🟢 File watcher is running.` |
| Not running (started) | Reachable | `🟢 Konductor: Fully operational...` (note watcher was restarted) |
| Not installed | Reachable | `⚠️ Konductor: File watcher not installed. Run "setup konductor".` + `🟢 Server connected.` |
| Not installed | Unreachable | Both warnings individually |

---

## UC-10.2: Automatic Session Registration on File Modify

**Actor:** Agent (automated)  
**Trigger:** Agent is about to create or modify files as part of a task

**Steps:**
1. Agent determines list of files it will touch
2. Agent calls `register_session` with userId, repo, branch, files
3. Agent prints: `🟢 Konductor: Registered session on org/app#main (5 files)`
4. If response has `repoPageUrl`: `📊 Dashboard: <url>`
5. Agent stores `sessionId` for later deregistration
6. Agent checks `collisionState` in response and notifies accordingly

**Expected Result:**
- Registration happens automatically before file modifications
- No user prompt needed
- Collision state checked immediately

---

## UC-10.3: Collision Course — Agent Pauses

**Actor:** Agent (automated)  
**Trigger:** `register_session` returns `collisionState: "collision_course"`

**Steps:**
1. Agent registers session
2. Response: `collisionState: "collision_course"`, overlapping users: ["bob"]
3. Agent displays: `🟠 Konductor: Warning — bob is modifying the same files: src/index.ts. Proceed?`
4. Agent WAITS for user confirmation
5. Agent echoes to terminal: `echo "🟠 KONDUCTOR: COLLISION COURSE..." >&2`
6. Agent appends tip: `💡 Tip: Ask "konductor, who should I coordinate with?" for detailed coordination advice.`

**Expected Result:**
- Agent pauses work
- User must explicitly confirm to proceed
- Terminal echo ensures visibility even if chat panel hidden

---

## UC-10.4: Merge Hell — Agent Pauses with Strong Warning

**Actor:** Agent (automated)  
**Trigger:** `register_session` returns `collisionState: "merge_hell"`

**Steps:**
1. Agent registers session
2. Response: `collisionState: "merge_hell"`, cross-branch overlap
3. Agent displays: `🔴 Konductor: Critical overlap — bob has divergent changes on src/index.ts across branches main, feature/auth. Strongly recommend coordinating.`
4. Agent WAITS for user confirmation
5. Terminal echo: `echo "🔴 KONDUCTOR: MERGE HELL..." >&2`
6. Tip appended

**Expected Result:**
- Strongest possible warning
- Agent will NOT proceed without explicit user confirmation
- Both chat and terminal notification

---

## UC-10.5: Solo/Neighbors — Agent Proceeds

**Actor:** Agent (automated)  
**Trigger:** `register_session` returns `collisionState: "solo"` or `"neighbors"`

**Steps:**
1. Agent registers session
2. Response: `collisionState: "solo"` or `"neighbors"`
3. Agent prints registration confirmation
4. If neighbors: `🟢 Konductor: Others are active in this repo but working on different files. Proceeding.`
5. Agent continues with task (no pause)

**Expected Result:**
- No interruption to workflow
- Brief informational message
- Agent proceeds immediately

---

## UC-10.6: Crossroads — Agent Proceeds with Caution

**Actor:** Agent (automated)  
**Trigger:** `register_session` returns `collisionState: "crossroads"`

**Steps:**
1. Agent registers session
2. Response: `collisionState: "crossroads"`
3. Agent displays: `🟡 Konductor: Heads up — others are working in the same directories. Proceeding with caution.`
4. Agent proceeds (no pause at this level)

**Expected Result:**
- Informational warning
- Agent continues (doesn't block)
- User aware of nearby activity

---

## UC-10.7: File List Changes Mid-Task

**Actor:** Agent (automated)  
**Trigger:** Agent modifies additional files not in original registration

**Steps:**
1. Agent registered with 3 files
2. During task, agent needs to modify 2 additional files
3. Agent calls `register_session` again with updated file list (5 files)
4. Agent prints: `🔄 Konductor: Updated session — now tracking 5 files`
5. Collision state re-evaluated with new file list

**Expected Result:**
- Session updated seamlessly
- New files included in collision evaluation
- If new files create collision, agent notifies

---

## UC-10.8: Task Complete — Automatic Deregistration

**Actor:** Agent (automated)  
**Trigger:** Agent finishes a task

**Steps:**
1. Agent completes all file modifications
2. Agent calls `deregister_session` with stored sessionId
3. Agent prints: `✅ Konductor: Session closed.`

**Expected Result:**
- Session removed from server
- Other users' collision state may improve
- Clean session lifecycle

---

## UC-10.9: Server Unreachable During File Modify

**Actor:** Agent (automated)  
**Trigger:** Agent tries to register but server is down

**Steps:**
1. Agent attempts `register_session`
2. MCP tool call fails (timeout/connection refused)
3. Agent updates internal state: disconnected
4. Agent prints: `⚠️ Konductor: Connection lost. Collision awareness is now OFFLINE.`
5. For EACH file agent modifies:
   - `⚠️ Konductor: Still disconnected. Changes to src/index.ts are untracked.`
6. Agent continues with task (doesn't block on server failure)

**Expected Result:**
- Per-file warnings (not batched)
- Work continues
- User clearly informed of tracking gap

---

## UC-10.10: Auto-Update Triggered by Registration

**Actor:** Agent (automated)  
**Trigger:** `register_session` response has `updateRequired: true`

**Steps:**
1. Agent registers session
2. Response includes `updateRequired: true`, `serverVersion: "1.2.0"`
3. Agent runs: `npx <server>/bundle/installer.tgz --workspace --server <server>`
4. On success: `🔄 Konductor: Client updated to v1.2.0.`
5. Agent re-registers session
6. Only attempted once per session (no retry loop)

**Expected Result:**
- Automatic update without user intervention
- Re-registration after update
- Single attempt (no infinite loop on failure)

---

## UC-10.11: Auto-Update Fails

**Actor:** Agent (automated)  
**Trigger:** Update command fails (npx not available, network error)

**Steps:**
1. Agent detects `updateRequired: true`
2. Agent runs npx command → fails
3. Agent prints: `⚠️ Konductor: Client is outdated (v0.3.0 → v1.2.0). Run the install command from "konductor, how do I install?" to update.`
4. Agent does NOT retry in this session
5. Work continues normally

**Expected Result:**
- Graceful failure
- User informed with manual fallback
- No repeated attempts

---

## UC-10.12: Identity Resolution on Session Start

**Actor:** Agent (automated)  
**Trigger:** First message in conversation

**Steps:**
1. Agent resolves userId:
   - Check `KONDUCTOR_USER` in `.konductor-watcher.env`
   - If empty: try `gh api user --jq .login`
   - If fails: try `git config user.name`
   - Last resort: system hostname
2. Agent resolves repo: `git remote get-url origin` → extract `owner/repo`
3. Agent resolves branch: `git branch --show-current`
4. Values cached for session duration

**Expected Result:**
- Identity resolved without user input
- Correct userId used for all registrations
- Persisted to `.konductor-watcher.env` if not already set

---

## UC-10.13: Persist Identity on First Run

**Actor:** Agent (automated)  
**Trigger:** First session start, `KONDUCTOR_USER` empty in env

**Steps:**
1. Agent resolves userId (e.g., "alice" from GitHub CLI)
2. Agent checks `.konductor-watcher.env` → `KONDUCTOR_USER` empty/commented
3. Agent writes `KONDUCTOR_USER=alice` to env file
4. Done silently (no user notification)

**Expected Result:**
- Identity persisted for future sessions
- Watcher and agent use same identity
- No user prompt

---

## UC-10.14: Source-Attributed Collision Messages

**Actor:** Agent (automated)  
**Trigger:** Collision with mixed sources (active + PR + commits)

**Steps:**
1. Registration response includes `overlappingDetails` with source info
2. Agent formats each overlap with source context:
   - Active: `🟠 Warning — bob is actively editing src/index.ts on feature-y.`
   - PR: `🟠 Warning — carol's PR #42 (github.com/org/app/pull/42) modifies src/index.ts, targeting main.`
   - Approved PR: `🔴 Critical — carol's PR #42 is approved and targets main. Merge is imminent.`
   - Draft PR: `🟡 Heads up — carol has a draft PR #42 touching src/index.ts. Low risk but worth tracking.`
   - Commits: `🟠 Warning — dave pushed commits to main (Apr 15–16) modifying src/index.ts.`

**Expected Result:**
- Each source type has distinct formatting
- All relevant context included
- Severity adjusted by source type
