# Chat Commands Use Cases

## Overview

Users interact with Konductor by prefixing messages with "konductor," (case-insensitive). These use cases cover all supported queries and management commands.

---

## Queries

### UC-9.1: "konductor, who else is working here?"

**Actor:** Developer  
**Trigger:** User wants to know who's active in their repo

**Steps:**
1. User types: `konductor, who else is working here?`
2. Agent calls `who_is_active` with current repo
3. Server returns list of active users with branches, files, duration
4. Agent formats response with emoji prefixes

**Expected Output:**
```
📂 Active users in org/app:
  👤 bob — feature/auth (3 files, 42 min)
  👤 carol — main (1 file, 12 min)
```

---

### UC-9.2: "konductor, who's on my files?"

**Actor:** Developer  
**Trigger:** User wants to check for file overlaps

**Steps:**
1. User types: `konductor, who's on my files?`
2. Agent calls `who_overlaps` with userId and repo
3. Server returns overlapping users with shared files and collision state
4. Agent formats with severity emoji

**Expected Output (overlap exists):**
```
🟠 File overlaps in org/app:
  👤 bob (feature/auth) — shared files: src/index.ts
  Collision state: collision_course
```

**Expected Output (no overlap):**
```
🟢 No file overlaps. You're clear to proceed.
```

---

### UC-9.3: "konductor, what is bob working on?"

**Actor:** Developer  
**Trigger:** User wants to see a specific user's activity

**Steps:**
1. User types: `konductor, what is bob working on?`
2. Agent calls `user_activity` with userId "bob"
3. Server returns bob's sessions across all repos

**Expected Output:**
```
👤 bob's active sessions:
  📂 org/app — feature/auth (src/auth.ts, src/session.ts) — 42 min
  📂 org/docs — main (README.md) — 5 min
```

---

### UC-9.4: "konductor, how risky is my situation?"

**Actor:** Developer  
**Trigger:** User wants a risk assessment before pushing

**Steps:**
1. User types: `konductor, am I safe to push?`
2. Agent calls `risk_assessment` with userId and repo
3. Server returns severity, overlap count, cross-branch info

**Expected Output (high risk):**
```
🟠 Risk Assessment for org/app:
  Collision state: collision_course (severity 3)
  Overlapping users: 1
  Shared files: 1 (src/index.ts)
  Cross-branch overlap: yes
  Summary: High risk — bob editing src/index.ts on a different branch
```

**Expected Output (safe):**
```
🟢 Risk Assessment for org/app:
  Collision state: solo (severity 0)
  You're the only one here. Safe to push.
```

---

### UC-9.5: "konductor, what's the hottest file?"

**Actor:** Developer  
**Trigger:** User wants to find repo hotspots

**Steps:**
1. User types: `konductor, what's the hottest file?`
2. Agent calls `repo_hotspots` with repo
3. Server returns files ranked by editor count

**Expected Output:**
```
📂 Hotspots in org/app:
  🔴 src/index.ts — 3 editors (alice/main, bob/feature-x, carol/feature-y)
  🟠 src/config.ts — 2 editors (alice/main, bob/feature-x)
```

---

### UC-9.6: "konductor, what branches are active?"

**Actor:** Developer  
**Trigger:** User wants to see branch activity

**Steps:**
1. User types: `konductor, what branches are active?`
2. Agent calls `active_branches` with repo
3. Server returns branches with users and overlap flags

**Expected Output:**
```
📂 Active branches in org/app:
  main — alice (2 files) ⚠️ cross-branch overlap
  feature/auth — bob (3 files) ⚠️ cross-branch overlap
  feature/ui — carol (1 file)
```

---

### UC-9.7: "konductor, who should I talk to?"

**Actor:** Developer  
**Trigger:** User wants coordination advice

**Steps:**
1. User types: `konductor, who should I talk to?`
2. Agent calls `coordination_advice` with userId and repo
3. Server returns targets ranked by urgency

**Expected Output:**
```
🎯 Coordination advice for org/app:
  🔴 HIGH: Talk to bob (feature/auth) — same files on different branch (src/index.ts)
     Suggested action: merge before pushing
  🟡 LOW: carol (main) — same directories
```

---

### UC-9.8: "konductor, show PRs"

**Actor:** Developer  
**Trigger:** User wants to see open PRs

**Steps:**
1. User types: `konductor, show PRs`
2. Agent fetches PR data (from Baton API or `who_is_active` filtered to PR sources)
3. Displays formatted PR list

**Expected Output:**
```
📂 Open PRs for org/app:
  #42 — bob (feature/auth → main) — Open — 5 files — 48h
  #38 — carol (fix/typo → main) — Approved — 1 file — 2h
```

---

### UC-9.9: "konductor, show history"

**Actor:** Developer  
**Trigger:** User wants recent repo activity

**Steps:**
1. User types: `konductor, show history`
2. Agent fetches history from Baton API
3. Displays recent commits, PRs, merges

**Expected Output:**
```
📂 Recent activity in org/app:
  Apr 20 10:30 — Commit — bob — feature/auth — "Add OAuth flow"
  Apr 20 09:15 — PR Merged — carol — #38 — "Fix typo in README"
  Apr 19 16:00 — PR Opened — bob — #42 — "OAuth implementation"
```

---

## Management Commands

### UC-9.10: "konductor, status"

**Actor:** Developer  
**Trigger:** User wants to check if Konductor is running

**Steps:**
1. User types: `konductor, status`
2. Agent calls `check_status` (MCP health probe)
3. Agent runs `pgrep -f konductor-watcher.mjs`
4. Agent reports both statuses

**Expected Output (all good):**
```
🟢 Konductor: Fully operational
  MCP Server: Connected
  File Watcher: Running (PID 12345)
```

**Expected Output (watcher down):**
```
⚠️ Konductor: File watcher not running
  MCP Server: Connected
  File Watcher: Not running — restarting...
🟢 Konductor: File watcher restarted.
```

---

### UC-9.11: "konductor, restart"

**Actor:** Developer  
**Trigger:** User wants to restart the watcher

**Steps:**
1. User types: `konductor, restart`
2. Agent kills watcher: `pkill -f konductor-watcher.mjs`
3. Agent relaunches: `node konductor-watcher.mjs &`
4. Agent verifies MCP connection
5. Agent displays: `🔄 Konductor: Restarted.`

---

### UC-9.12: "konductor, help"

**Actor:** Developer  
**Trigger:** User wants to see available commands

**Expected Output:** Full help text with all queries and management commands listed.

---

### UC-9.13: "konductor, who am I?"

**Actor:** Developer  
**Trigger:** User wants to verify their identity

**Steps:**
1. User types: `konductor, who am I?`
2. Agent displays cached identity

**Expected Output:**
```
👤 Your Konductor identity:
  User: deanwheatley-star
  Repo: deanwheatley/konductor
  Branch: main
```

---

### UC-9.14: "konductor, show my config"

**Actor:** Developer  
**Trigger:** User wants to see current configuration

**Steps:**
1. Agent reads `.konductor-watcher.env`
2. Agent reads MCP config
3. Displays formatted config

**Expected Output:**
```
⚙️ Konductor Configuration:
  Server: https://192.168.68.64:3010
  User: deanwheatley-star
  Poll Interval: 10s
  Log Level: info
  Log to Terminal: true
  Watch Extensions: (all)
  Client Version: 0.3.4
```

---

### UC-9.15: Unrecognized Command

**Actor:** Developer  
**Trigger:** User types something that doesn't match any command

**Steps:**
1. User types: `konductor, do a barrel roll`
2. Agent can't match to any known command
3. Agent responds: `🤔 Konductor: I didn't understand that. Try "konductor, help" to see what I can do.`

---

## Missing Commands (Identified Gaps)

### UC-9.16: "konductor, show baton" / "konductor, where is the repo website?"

**⚠️ MISSING FEATURE**

**Expected Behavior:**
1. User types: `konductor, show baton` or `konductor, where is the repo website?`
2. Agent retrieves `repoPageUrl` from last registration
3. Agent displays URL
4. If user says "open it" or "open baton", agent opens URL in default browser

**Current State:** Not in steering rule routing table. URL is provided on registration but no explicit command to retrieve or open it.

---

### UC-9.17: "konductor, open baton"

**⚠️ MISSING FEATURE**

**Expected Behavior:**
1. User types: `konductor, open baton`
2. Agent opens Baton repo page in default browser
3. Agent confirms: `🌐 Konductor: Opening Baton dashboard for org/app...`

**Current State:** No browser-opening capability in steering rule.
