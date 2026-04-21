# Konductor Regression Test Plan

## Purpose

This test plan maps EVERY use case to a specific test. Tests are organized by feature area matching the use-case documents. Each test has a unique ID, priority, method, and expected result.

## Test Environment

**IMPORTANT:** When `testrepo` is available in the workspace, ALL client-side tests MUST use it as the test project.

### Prerequisites
- Konductor server running (`start-konductor.sh` or `node dist/index.js`)
- Node.js 20+
- testrepo workspace with working client installation

### Test Methods
- **API**: REST API calls via `client-verification.mjs` or direct fetch
- **Playwright**: Browser-based UI tests
- **Shell**: Process/filesystem verification
- **Agent**: Steering rule behavior (manual or scripted agent interaction)

### Priority Levels
- **P0**: System is broken if this fails
- **P1**: Feature is broken if this fails
- **P2**: Edge case or enhancement

---

## Section 1: Client Connection (01-client-connection.md)

| ID | UC | Priority | Method | Test Description | Expected Result |
|----|----|----------|--------|-----------------|-----------------|
| T-001 | 1.1 | P0 | Shell | npx installer deploys all files | All 8 file locations populated |
| T-002 | 1.1 | P0 | Shell | npx installer launches watcher | `pgrep -f konductor-watcher.mjs` returns PID |
| T-003 | 1.1 | P0 | Shell | npx installer creates MCP config | `.kiro/settings/mcp.json` exists with konductor entry |
| T-004 | 1.1 | P1 | Shell | npx installer creates steering rules | `.kiro/steering/konductor-collision-awareness.md` exists |
| T-005 | 1.1 | P1 | Shell | npx installer creates hooks | Both hook files exist in `.kiro/hooks/` |
| T-006 | 1.1 | P1 | Shell | npx installer writes .konductor-version | File exists with semver content |
| T-007 | 1.1 | P1 | Shell | npx installer adds to .gitignore | Konductor artifacts listed in .gitignore |
| T-008 | 1.1 | P0 | API | After install, server accepts registration | POST /api/register → 200 with sessionId |
| T-009 | 1.2 | P1 | Agent | Manual MCP config triggers auto-install | Agent runs npx, deploys workspace artifacts |
| T-010 | 1.2 | P1 | API | First register without version → updateRequired | Response has `updateRequired: true` |
| T-011 | 1.2 | P1 | Agent | Auto-install completes and re-registers | Second register succeeds without updateRequired |
| T-012 | 1.3 | P0 | Shell | Project open → watcher starts automatically | pgrep finds watcher PID after project load |
| T-013 | 1.3 | P0 | API | SSE connection established on project open | MCP tools callable, /health returns ok |
| T-014 | 1.3 | P1 | Agent | First interaction shows connection status | Green status message in chat |
| T-015 | 1.3 | P1 | API | Registration response includes repoPageUrl | repoPageUrl field present and valid URL |
| T-016 | 1.4 | P0 | Agent | Server down → agent shows disconnection warning | "Connection lost" message displayed |
| T-017 | 1.4 | P0 | Agent | Per-file warning when disconnected | Each modified file gets individual warning |
| T-018 | 1.4 | P1 | Shell | Watcher logs disconnection | .konductor-watcher.log shows disconnect entry |
| T-019 | 1.5 | P0 | Agent | Server returns → agent shows reconnection | "Reconnected" message displayed |
| T-020 | 1.5 | P1 | API | After reconnect, registration succeeds | POST /api/register → 200 |
| T-021 | 1.6 | P0 | API | Outdated client version → updateRequired true | Header X-Konductor-Client-Version: 0.0.1 → updateRequired |
| T-022 | 1.6 | P0 | API | Current client version → no update required | Matching version → updateRequired absent/false |
| T-023 | 1.6 | P1 | Agent | Auto-update runs npx and reports success | "Client updated to v..." message |
| T-024 | 1.6 | P1 | Shell | After update, .konductor-version reflects new version | File content matches server version |
| T-025 | 1.7 | P1 | API | Channel change triggers update for affected users | User on changed channel gets updateRequired |
| T-026 | 1.7 | P1 | API | Users on other channels unaffected | User on different channel: no updateRequired |
| T-027 | 1.8 | P1 | API | Deleted bundle → bundleStale true | register_session response has bundleStale: true |
| T-028 | 1.8 | P1 | Agent | Stale bundle warning displayed | "bundle was removed" message shown |
| T-029 | 1.8 | P0 | API | MCP tools still work when bundle stale | check_status, who_is_active etc. still return 200 |
| T-030 | 1.9 | P0 | Shell | Hook restarts watcher if not running | Kill watcher, trigger hook, verify new PID |
| T-031 | 1.9 | P1 | Shell | Watcher survives IDE panel switches | Watcher PID unchanged after panel navigation |
| T-032 | 1.10 | P2 | Agent | "konductor, show baton" returns URL | repoPageUrl displayed |
| T-033 | 1.11 | P1 | Shell | Second project install preserves global config | ~/.kiro/settings/mcp.json unchanged |
| T-034 | 1.11 | P1 | Shell | Second project gets its own watcher | Separate PID for second project watcher |
| T-035 | 1.12 | P0 | Shell | Reinstall preserves .konductor-watcher.env | Custom values retained after reinstall |
| T-036 | 1.12 | P1 | Shell | Reinstall updates code files | konductor-watcher.mjs content updated |

---

## Section 2: Collision Scenarios (02-collision-scenarios.md)

### Solo State

| ID | UC | Priority | Method | Test Description | Expected Result |
|----|----|----------|--------|-----------------|-----------------|
| T-037 | 2.1 | P0 | API | Single user registers → solo | collisionState: "solo" |
| T-038 | 2.2 | P1 | API | Other user deregisters via POST /api/deregister → remaining user solo | State drops to solo after deregister |
| T-039 | 2.3 | P1 | API | Solo user with 50 files still solo | File count doesn't affect solo state |

### Neighbors State

| ID | UC | Priority | Method | Test Description | Expected Result |
|----|----|----------|--------|-----------------|-----------------|
| T-040 | 2.4 | P0 | API | Two users, different directories → neighbors | collisionState: "neighbors" (files must be in different parent dirs) |
| T-041 | 2.5 | P1 | API | Three users, all different areas → neighbors | All three see neighbors (files in different parent dirs) |
| T-042 | 2.6 | P1 | API | Different branches, no file overlap → neighbors | Branch alone doesn't escalate (files in different parent dirs) |

### Crossroads State

| ID | UC | Priority | Method | Test Description | Expected Result |
|----|----|----------|--------|-----------------|-----------------|
| T-043 | 2.7 | P0 | API | Same directory, different files → crossroads | collisionState: "crossroads" |
| T-044 | 2.8 | P1 | API | Nested directory overlap → crossroads | Deep paths still match directories |
| T-045 | 2.9 | P2 | API | Parent/child directory → neighbors | src/ and src/utils/ are different directories, evaluator returns neighbors |

### Collision Course State

| ID | UC | Priority | Method | Test Description | Expected Result |
|----|----|----------|--------|-----------------|-----------------|
| T-046 | 2.10 | P0 | API | Same file, same branch → collision_course | collisionState: "collision_course" |
| T-047 | 2.10 | P0 | API | Response includes shared files list | sharedFiles array in both register and status responses contains the overlapping file |
| T-048 | 2.11 | P1 | API | 3 users, 2 sharing file → per-user states | A&B see collision_course, C sees neighbors |
| T-049 | 2.12 | P1 | API | Joining user gets collision on registration | New user's register response shows collision |

### Merge Hell State

| ID | UC | Priority | Method | Test Description | Expected Result |
|----|----|----------|--------|-----------------|-----------------|
| T-050 | 2.13 | P0 | API | Same file, different branches → merge_hell | collisionState: "merge_hell" |
| T-051 | 2.14 | P1 | API | Large feature vs small fix, same file → merge_hell | Both users see merge_hell |
| T-052 | 2.15 | P1 | API | Three-way cross-branch overlap → merge_hell | All three users see merge_hell |
| T-053 | 2.16 | P1 | API | PR collision detected (GitHub passive session) | Active user sees collision with PR source |
| T-054 | 2.17 | P1 | API | Approved PR → escalated severity | Response indicates imminent merge |

### State Transitions

| ID | UC | Priority | Method | Test Description | Expected Result |
|----|----|----------|--------|-----------------|-----------------|
| T-055 | 2.18 | P0 | API | Escalation: solo → neighbors → crossroads → collision | Each step returns correct state |
| T-056 | 2.19 | P0 | API | De-escalation: collision → solo after deregister | State drops correctly |
| T-057 | 2.20 | P2 | API | Rapid state changes don't spam notifications | Watcher signature dedup works |

### Edge Cases

| ID | UC | Priority | Method | Test Description | Expected Result |
|----|----|----------|--------|-----------------|-----------------|
| T-058 | 2.21 | P0 | API | Empty file list rejected | 400 error on register with files: [] |
| T-059 | 2.22 | P2 | API | Very long file paths handled | No crash, paths stored correctly |
| T-060 | 2.23 | P1 | API | Same user, multiple repos → independent | Collision only within same repo |

### Line-Level Collision (Future — konductor-line-level-collision)

| ID | UC | Priority | Method | Test Description | Expected Result |
|----|----|----------|--------|-----------------|-----------------|
| T-061 | 2.24 | P1 | API | Same file, overlapping lines → collision_course | lineOverlap: true in response |
| T-062 | 2.25 | P1 | API | Same file, non-overlapping lines → proximity | collisionState: "proximity" |
| T-063 | 2.26 | P1 | API | Severe overlap (>50%) → severity: severe | Severity field = "severe" |
| T-064 | 2.27 | P2 | API | Minimal overlap (1-5 lines) → severity: minimal | Severity field = "minimal" |
| T-065 | 2.28 | P1 | API | Multiple files, mixed overlap → per-file breakdown | Each file has its own overlap status |
| T-066 | 2.29 | P0 | API | One user no line data → fallback to collision_course | Backward compatible file-level detection |
| T-067 | 2.30 | P2 | API | Single line edit formatted correctly | "line 42" not "lines 42-42" |
| T-068 | 2.31 | P1 | API | Large feature branch line overlap | Correct severity despite many files |
| T-069 | 2.32 | P1 | API | risk_assessment includes line context | Line ranges in risk response |
| T-070 | 2.35 | P2 | API | User moves to different section → de-escalation | Proximity after line range change |

### Resolution Suggestions

| ID | UC | Priority | Method | Test Description | Expected Result |
|----|----|----------|--------|-----------------|-----------------|
| T-071 | 2.45 | P2 | Agent | Proximity → informational suggestions shown | "Continue working" suggestion displayed |
| T-072 | 2.46 | P1 | Agent | Collision Course → numbered action list | Rebase/coordinate/shelve/continue options |
| T-073 | 2.47 | P1 | Agent | Severe overlap → strong coordination recommendation | "Stop and coordinate" as first option |
| T-074 | 2.48 | P1 | Agent | Merge Hell → cross-branch resolution options | Shared branch suggestion included |
| T-075 | 2.49 | P1 | Agent | Approved PR imminent → time-sensitive actions | "Commit immediately" option present |
| T-076 | 2.50 | P2 | Agent | Proximity on different branches → future merge note | "Keep changes small" suggestion |
| T-077 | 2.51 | P1 | Agent | Multiple collisions → prioritized list | Ranked by severity, workflow order |
| T-078 | 2.52 | P1 | Agent | "what should I do?" → context-aware advice | coordination_advice tool called |
| T-079 | 2.53 | P2 | Agent | User picks "rebase" → git command executed | git pull --rebase runs after confirmation |
| T-080 | 2.54 | P2 | Agent | User picks "shelve" → stash + monitoring | git stash runs, monitoring offered |

---

## Section 3: File Watcher (03-file-watcher.md)

| ID | UC | Priority | Method | Test Description | Expected Result |
|----|----|----------|--------|-----------------|-----------------|
| T-081 | 3.1 | P0 | Shell | Watcher reads config from .env and mcp.json | Correct server URL, user, poll interval |
| T-082 | 3.1 | P0 | API | Watcher registers initial file set on startup | Session created on server |
| T-083 | 3.2 | P0 | API | File save detected within poll interval | Updated file list in next registration |
| T-084 | 3.3 | P1 | Shell | Extension filter excludes non-matching files | .md file not reported when filter=ts,tsx |
| T-085 | 3.4 | P1 | Shell | Watcher self-updates when server has newer version | .konductor-version updated, watcher restarted |
| T-086 | 3.5 | P0 | Shell | Server unreachable → watcher doesn't crash | Process still running after failed poll |
| T-087 | 3.5 | P1 | Shell | Watcher logs disconnection (not spamming) | Single disconnect log entry, not per-cycle |
| T-088 | 3.6 | P0 | API | Server returns → watcher reconnects and registers | Registration succeeds on next cycle |
| T-089 | 3.7 | P1 | Shell | .gitignore'd files not tracked | node_modules files never in registration |
| T-090 | 3.8 | P1 | Shell | Watchdog restarts crashed watcher | Kill watcher, verify watchdog restarts it |
| T-091 | 3.9 | P1 | Shell | Log rotation at max size | Log file rotated when exceeding limit |
| T-092 | 3.10 | P1 | Agent | Config change → watcher restarted | New poll interval applied after restart |
| T-093 | 3.11 | P1 | Shell | Identity resolved from git/env | KONDUCTOR_USER populated correctly |
| T-094 | 3.12 | P1 | Shell | Branch switch detected | Watcher reports new branch after git checkout |
| T-095 | 3.13 | P1 | API | Rapid saves batched into single registration | One API call per poll cycle, not per save |
| T-096 | 3.14 | P1 | API | Deleted file removed from tracked list | File no longer in registration after delete |
| T-097 | 3.15 | P1 | API | Renamed file tracked correctly | Old path gone, new path present |
| T-098 | 3.16 | P2 | API | Large repo (10k+ files) doesn't timeout | Registration completes within poll interval |
| T-099 | 3.17 | P2 | API | Binary files tracked at file level | Binary in registration, no line data |
| T-100 | 3.18 | P2 | Shell | Symlinks handled without crash | Symlinked file changes detected |
| T-101 | 3.19 | P2 | API | Submodule files tracked | Submodule path in registration |
| T-102 | 3.20 | P1 | API | Stale session updated on watcher restart | No duplicate sessions after crash+restart |
| T-103 | 3.21 | P1 | Shell | Network timeout doesn't block watcher | Watcher continues after slow server |
| T-104 | 3.22 | P1 | Shell | Server 500 error logged, watcher continues | Process alive, error in log |
| T-105 | 3.23 | P1 | Shell | Invalid API key → clear error in log | 401 logged with helpful message |
| T-106 | 3.24 | P2 | Shell | Corrupted installer doesn't brick watcher | Watcher stays on current version |
| T-107 | 3.25 | P2 | Shell | Workspace move → watcher exits cleanly | No zombie process |
| T-108 | 3.26 | P1 | Shell | .gitignore changes respected dynamically | Newly ignored files dropped from tracking |
| T-109 | 3.27 | P1 | API | Auto-save frequency doesn't multiply API calls | One registration per poll regardless of saves |
| T-110 | 3.28 | P2 | Shell | OOM kill → watchdog recovery | Watcher restarted after SIGKILL |
| T-111 | 3.29 | P2 | API | Two watchers same repo → no duplicate sessions | Last write wins, single session |

### Offline Queue (Req 1, 5)

| ID | UC | Priority | Method | Test Description | Expected Result |
|----|----|----------|--------|-----------------|-----------------|
| T-334 | 1.4 | P0 | Shell | Watcher queues file changes when server unreachable | offlineQueue accumulates file paths in memory |
| T-335 | 1.4 | P1 | Shell | Offline queue stores unique file paths (Set) | Duplicate file paths not double-counted |
| T-336 | 1.4 | P1 | Shell | Offline queue FIFO eviction at max size | Oldest entries removed when queue exceeds KONDUCTOR_OFFLINE_QUEUE_MAX |
| T-337 | 1.4 | P1 | Shell | Offline queue max configurable via .konductor-watcher.env | KONDUCTOR_OFFLINE_QUEUE_MAX read from env, default 100 |
| T-338 | 1.5 | P1 | Shell | Watcher logs queue count while offline | "X file changes queued while offline" in log |
| T-339 | 1.6 | P1 | Shell | Watcher logs eviction warning | "Offline queue full (max: X). Oldest events discarded." in log |
| T-340 | 1.2 | P0 | API | Reconnection replays queued files as single registration | One POST /api/register with cumulative file list |
| T-341 | 1.3 | P1 | API | Replay sends union of all queued files | No duplicate files in replay registration |
| T-342 | 1.2 | P1 | Shell | Queue cleared after successful replay | offlineQueue empty after reconnect |
| T-343 | 5.1 | P1 | Shell | Watcher log includes queue count on reconnect | "Reconnected. Synced X offline changes." in log |

### Branch Detection (Req 7)

| ID | UC | Priority | Method | Test Description | Expected Result |
|----|----|----------|--------|-----------------|-----------------|
| T-344 | 7.1 | P1 | Shell | Branch re-evaluated on every poll cycle | refreshBranch() called each interval |
| T-345 | 7.2 | P1 | Shell | Branch change logged | "Branch changed: X → Y" in watcher log |
| T-346 | 7.3 | P1 | API | New branch name used in next registration | register call uses updated branch |
| T-347 | 7.1 | P2 | Shell | KONDUCTOR_BRANCH env override is static | No re-evaluation when env override set |

---

## Section 4: Admin Dashboard (04-admin-dashboard.md)

| ID | UC | Priority | Method | Test Description | Expected Result |
|----|----|----------|--------|-----------------|-----------------|
| T-112 | 4.1 | P0 | Playwright | Admin navigates to /admin → redirected to /login | 302 redirect to /login |
| T-113 | 4.1 | P0 | Playwright | Valid login → session cookie + redirect to /admin | Cookie set, dashboard loads |
| T-114 | 4.1 | P0 | Playwright | Dashboard shows all panels | System Settings, Global Client Settings, Install Commands, User Management visible |
| T-115 | 4.2 | P0 | API | Non-admin user → 403 on /admin | Forbidden response |
| T-116 | 4.2 | P1 | Playwright | Invalid credentials → error message on login page | 401, stays on login |
| T-117 | 4.3 | P1 | Playwright | System Settings shows current values | Heartbeat timeout, log level etc. displayed |
| T-118 | 4.3 | P1 | Playwright | Env-sourced settings shown as read-only | "ENV" label, field disabled |
| T-119 | 4.4 | P1 | API | PUT /api/admin/settings/:key updates value | Setting persisted, 200 response |
| T-120 | 4.4 | P1 | Playwright | Setting change reflected without page refresh | SSE updates panel in real time |
| T-121 | 4.5 | P0 | Playwright | Global Client Settings shows channel versions | Dev, UAT, Prod cards with versions |
| T-122 | 4.5 | P1 | Playwright | Channel dropdowns populated from registry | Versions sorted by semver (newest first) |
| T-123 | 4.6 | P0 | API | PUT /api/admin/channels/:channel/assign updates channel | Channel assignment saved |
| T-124 | 4.6 | P1 | Playwright | Assign version → Install Commands panel updates | New URL reflected immediately |
| T-125 | 4.7 | P0 | API | POST /api/admin/channels/promote Dev→UAT | UAT gets Dev's version |
| T-126 | 4.7 | P1 | API | Promotion retains previous for rollback | Previous version stored |
| T-127 | 4.8 | P0 | API | POST /api/admin/channels/rollback Prod | Prod reverts to previous version |
| T-128 | 4.8 | P1 | API | Rollback unavailable when no previous exists | 400 or disabled button |
| T-129 | 4.9 | P0 | Playwright | User Management table loads with all users | Table visible with correct columns |
| T-130 | 4.9 | P1 | Playwright | User table sortable by any column | Click header → sort changes |
| T-131 | 4.9 | P1 | Playwright | User table filterable by username | Filter input narrows results |
| T-132 | 4.9 | P1 | Playwright | Freshness pills color-coded correctly | Recent = green, old = dark |
| T-133 | 4.9 | P1 | Playwright | JIRA ticket extracted from branch name | "PROJ-123" shown in activity column |
| T-134 | 4.10 | P0 | API | PUT /api/admin/users/:userId channel override | User record updated |
| T-135 | 4.10 | P1 | API | Changed channel → user gets updateRequired next register | Version mismatch detected |
| T-136 | 4.11 | P1 | API | PUT /api/admin/users/:userId admin toggle | Admin flag updated |
| T-137 | 4.11 | P1 | Playwright | KONDUCTOR_ADMINS user → toggle read-only | "ENV" label, toggle disabled |
| T-138 | 4.12 | P0 | Playwright | Install Commands panel shows correct commands | Channel-specific URLs displayed |
| T-139 | 4.12 | P1 | Playwright | Cloud mode → single external URL command | KONDUCTOR_EXTERNAL_URL used |
| T-140 | 4.12 | P1 | Playwright | Local mode → localhost + network IP commands | Two commands shown |
| T-141 | 4.12 | P1 | Playwright | Copy button copies command to clipboard | Clipboard contains full command |
| T-142 | 4.12 | P1 | Playwright | API key shown as placeholder | "YOUR_API_KEY" in command text |
| T-143 | 4.13 | P1 | Playwright | Two admin sessions → SSE sync | Change in one reflects in other |
| T-144 | 4.14 | P1 | Playwright | Expired session → redirect to login | After 8h, next request redirects |
| T-145 | 4.15 | P1 | API | First user in empty system → bootstrap admin | admin: true on first user record |
| T-146 | 4.16 | P1 | API | Change global default channel | All "Default" users resolve to new channel |
| T-147 | 4.17 | P2 | Playwright | User table shows collision context in activity | Red/orange pills for active collisions |
| T-148 | 4.20 | P1 | Playwright | Stale activity threshold hides old repos | Repos older than threshold not shown |
| T-149 | 4.21 | P1 | API | Server restart preserves sessions | sessions.json loaded on startup |
| T-150 | 4.22 | P1 | Playwright | Slack panel shows token status | "Configured" or "Not configured" |
| T-151 | 4.23 | P1 | API | POST /api/admin/slack/test sends test message | 200 response (or Slack error) |
| T-152 | 4.25 | P1 | Playwright | SSE disconnect → indicator shown | Red "Disconnected" banner |
| T-153 | 4.25 | P1 | Playwright | SSE reconnect → indicator green | "Connected" banner returns |

---

## Section 5: Bundle Management (05-bundle-management.md)

| ID | UC | Priority | Method | Test Description | Expected Result |
|----|----|----------|--------|-----------------|-----------------|
| T-154 | 5.1 | P0 | Playwright | Bundle Manager page loads at /admin/bundles | Page renders with table and cards |
| T-155 | 5.1 | P1 | Playwright | "Local Store Mode" badge shown | Yellow badge visible |
| T-156 | 5.1 | P1 | Playwright | Channel summary cards show assigned versions | Dev/UAT/Prod/Latest cards populated |
| T-157 | 5.2 | P1 | Playwright | Sort by column header | Table reorders, arrow indicator shown |
| T-158 | 5.3 | P1 | Playwright | Filter by version text | Table narrows to matching versions |
| T-159 | 5.4 | P1 | API | DELETE /api/admin/bundles/:version (unassigned) | Bundle removed, 200 response |
| T-160 | 5.4 | P1 | Playwright | Delete unassigned → confirmation dialog | "Safe to delete" message |
| T-161 | 5.5 | P0 | API | DELETE assigned bundle → channel stale | Channel enters stale state |
| T-162 | 5.5 | P1 | Playwright | Delete assigned → warning dialog with user count | Lists affected channels and users |
| T-163 | 5.5 | P1 | Shell | Delete removes .tgz from disk | File gone from installers/ |
| T-164 | 5.6 | P0 | API | Assign new version to stale channel → resolves | Next register: updateRequired (not bundleStale) |
| T-165 | 5.7 | P1 | Playwright | Two admins → SSE sync on bundle changes | Channel cards update in both sessions |
| T-166 | 5.8 | P1 | Playwright | Empty registry → dropdowns disabled | "No bundles available" shown |
| T-167 | 5.8 | P1 | API | Empty registry → fallback to konductor-setup pack | /bundle/installer.tgz still serves |
| T-168 | 5.9 | P1 | API | "Latest" user gets newest bundle | /bundle/installer-latest.tgz serves most recent |
| T-169 | 5.9 | P1 | API | New bundle added → Latest users get updateRequired | Version comparison triggers update |
| T-170 | 5.10 | P1 | Shell | Invalid filenames skipped with warning | Server log shows skip reason |
| T-171 | 5.10 | P1 | Shell | Valid bundles discovered and indexed | Server log shows each discovered version |
| T-172 | 5.11 | P2 | Shell | Duplicate version → warning, first wins | Log shows duplicate warning |

---

## Section 6: Baton Dashboard (06-baton-dashboard.md)

| ID | UC | Priority | Method | Test Description | Expected Result |
|----|----|----------|--------|-----------------|-----------------|
| T-173 | 6.1 | P0 | Playwright | /repo/testrepo loads with all sections | Repository Summary, Notifications, Query Log, Open PRs, Repo History visible |
| T-174 | 6.1 | P0 | API | GET /api/repo/testrepo → JSON summary | healthStatus, users, branches in response |
| T-175 | 6.2 | P0 | Playwright | Health badge reflects collision state | Green=healthy, Yellow=warning, Red=alerting |
| T-176 | 6.2 | P1 | Playwright | Health updates when collision state changes | Badge color changes via SSE |
| T-177 | 6.3 | P1 | Playwright | User pills color-coded by freshness | Recent=green, old=dark gradient |
| T-178 | 6.4 | P0 | API | GET /api/repo/testrepo/notifications → array | notifications array returned |
| T-179 | 6.4 | P1 | Playwright | New collision → notification row appears | Row animates in within 5s |
| T-180 | 6.4 | P1 | Playwright | Notification has all columns | Timestamp, Type, State, Branch, JIRAs, Summary, Users, Resolve |
| T-181 | 6.5 | P1 | Playwright | Resolve button → notification moves to history | Active count decreases |
| T-182 | 6.5 | P1 | API | POST /api/repo/:repo/notifications/:id/resolve | 200, notification marked resolved |
| T-183 | 6.6 | P1 | API | GET /api/repo/testrepo/log → entries array | Query log entries returned |
| T-184 | 6.6 | P1 | Playwright | User query → log entry appears | who_is_active logged in table |
| T-185 | 6.7 | P1 | Playwright | Click section header → collapses | Section hidden, count badge shown |
| T-186 | 6.7 | P1 | Playwright | Click collapsed header → expands | Full content visible again |
| T-187 | 6.7 | P1 | Playwright | Repository Summary not collapsible | No collapse control on summary |
| T-188 | 6.8 | P0 | API | GET /api/repo/testrepo/events → SSE stream | Content-type: text/event-stream |
| T-189 | 6.8 | P1 | Playwright | SSE disconnect → banner shown | "Disconnected" indicator visible |
| T-190 | 6.8 | P1 | Playwright | SSE reconnect → banner green | "Connected" indicator returns |
| T-191 | 6.9 | P1 | API | GET /api/github/prs/testrepo → prs array | PR data returned (or empty) |
| T-192 | 6.9 | P1 | Playwright | Open PRs table shows PR data | Hours, Branch, PR#, User, Status, Files |
| T-193 | 6.10 | P1 | Playwright | No GitHub config → placeholder message | "GitHub Integration Coming Soon" |
| T-194 | 6.11 | P1 | API | GET /api/github/history/testrepo → history array | History entries returned |
| T-195 | 6.11 | P1 | Playwright | Repo History table sortable | Click header → sort changes |
| T-196 | 6.12 | P1 | Playwright | Repo with no sessions → empty state | "No active sessions" message |
| T-197 | 6.13 | P2 | Playwright | Baton auth enabled → GitHub OAuth redirect | Redirect to GitHub login |
| T-198 | 6.14 | P2 | API | No repo access → 403 | Authenticated but unauthorized → 403 |
| T-199 | 6.15 | P1 | Playwright | Slack panel shows config | Channel, verbosity, enabled status |
| T-200 | 6.15 | P1 | Playwright | Slack channel editable and saveable | Change channel → save → updated |

---

## Section 7: Slack Integration (07-slack-integration.md)

| ID | UC | Priority | Method | Test Description | Expected Result |
|----|----|----------|--------|-----------------|-----------------|
| T-201 | 7.1 | P0 | API | Collision at verbosity threshold → Slack fires | Server posts to configured channel |
| T-202 | 7.1 | P1 | API | Slack message has Block Kit format | Header, section, context blocks |
| T-203 | 7.2 | P1 | API | De-escalation below threshold → de-escalation msg | "Collision resolved" posted |
| T-204 | 7.3 | P1 | API | Below verbosity threshold → no Slack | No message posted for low-severity |
| T-205 | 7.4 | P0 | API | No bot token → graceful skip | No crash, warning logged |
| T-206 | 7.5 | P1 | API | Slack rate limit → error logged, no crash | Server continues, retry next event |
| T-207 | 7.6 | P1 | API | Channel not found → error logged | Clear error with channel name |
| T-208 | 7.7 | P0 | API | PUT /api/repo/:repo/slack valid channel → 200 | Channel updated |
| T-209 | 7.7 | P1 | API | Slack config change → SSE event emitted | slack_config_change event sent |
| T-210 | 7.8 | P0 | API | Invalid channel name → 400 | "BAD CHANNEL!!!" rejected |
| T-211 | 7.9 | P0 | API | PUT verbosity 0-5 → accepted | Valid range accepted |
| T-212 | 7.9 | P0 | API | PUT verbosity 99 → 400 | Out of range rejected |
| T-213 | 7.10 | P1 | API | Verbosity 0 → no Slack notifications | Disabled repo gets no messages |
| T-214 | 7.11 | P0 | API | GET /api/repo/:repo/slack → config | channel, verbosity, enabled returned |
| T-215 | 7.12 | P1 | API | PUT /api/admin/slack with valid token → validated | auth.test called, workspace shown |
| T-216 | 7.13 | P1 | API | SLACK_BOT_TOKEN env → takes precedence | Admin panel shows "env" source |
| T-217 | 7.14 | P1 | API | No channel configured → default name generated | konductor-alerts-<repo> format |
| T-218 | 7.15 | P1 | Agent | Slack config change → all clients notified | "📢 Konductor: Slack alerts..." message |

### Slack Debouncing (Req 4)

| ID | UC | Priority | Method | Test Description | Expected Result |
|----|----|----------|--------|-----------------|-----------------|
| T-352 | 4.1 | P1 | API | Collision state change → Slack delayed by debounce period | No immediate Slack post, fires after 30s default |
| T-353 | 4.2 | P1 | API | Rapid state changes within debounce → timer resets | Only final state posted to Slack |
| T-354 | 4.3 | P1 | API | Debounce expires → single Slack message with settled state | One message reflecting current state |
| T-355 | 4.4 | P1 | API | Debounce period configurable (min 5s, max 300s) | Admin setting respected, clamped to range |

---

## Section 8: GitHub Integration (08-github-integration.md)

| ID | UC | Priority | Method | Test Description | Expected Result |
|----|----|----------|--------|-----------------|-----------------|
| T-219 | 8.1 | P1 | API | PR creates passive session | PR files tracked in collision eval |
| T-220 | 8.2 | P1 | API | Commit creates passive session | Recent commits tracked |
| T-221 | 8.3 | P0 | API | Self-collision suppressed | User not warned about own PR |
| T-222 | 8.4 | P1 | API | PR supersedes commits (same user, same files) | Only PR session used |
| T-223 | 8.5 | P1 | API | Active session supersedes passive | Active takes precedence |
| T-224 | 8.6 | P1 | API | Approved PR → severity escalated | "Merge is imminent" context |
| T-225 | 8.7 | P1 | API | Draft PR → severity de-escalated | "Low risk" context |
| T-226 | 8.8 | P1 | API | No GITHUB_TOKEN → poller doesn't start | No crash, log message |
| T-227 | 8.9 | P2 | API | Rate limit → graceful backoff | No 403 errors, resumes next cycle |
| T-228 | 8.10 | P1 | API | Mixed-source collision → per-source messages | Each source gets own line |
| T-229 | 8.11 | P1 | Playwright | Baton Open PRs table populated | PR data visible in table |
| T-230 | 8.12 | P1 | API | New PR opened → passive session created | Session appears in list_sessions |
| T-231 | 8.13 | P1 | API | PR files updated → session updated | New files reflected |
| T-232 | 8.14 | P1 | API | PR closed → session removed | Session gone from list |
| T-233 | 8.15 | P1 | API | PR merged → session removed, history updated | Baton history shows merge |
| T-234 | 8.16 | P1 | API | PR approved → metadata updated | Status changes to "approved" |
| T-235 | 8.17 | P2 | API | Changes requested → severity de-escalated | No longer "imminent" |
| T-236 | 8.18 | P1 | API | Draft PR tracked when include_drafts=true | Draft session created |
| T-237 | 8.19 | P2 | API | Draft → open conversion → severity escalates | Status change detected |
| T-238 | 8.20 | P1 | API | PR targets non-user branch → lower severity | Different target noted |
| T-239 | 8.21 | P1 | API | PR targets user's branch → highest severity | Direct conflict flagged |
| T-240 | 8.22 | P1 | API | Multiple PRs same file → all shown ranked | Approved > open > draft |
| T-241 | 8.23 | P1 | API | Commit poller creates sessions within lookback | Commits within 24h tracked |
| T-242 | 8.24 | P1 | API | Commits outside lookback → session removed | Old commits expire |
| T-243 | 8.25 | P2 | API | Token revoked → graceful degradation | Error logged, no crash |
| T-244 | 8.28 | P0 | API | Same user active + PR → no self-collision | Dedup filter works |
| T-245 | 8.29 | P1 | API | PR and active on different files → independent | Both tracked separately |

---

## Section 9: Chat Commands (09-chat-commands.md)

| ID | UC | Priority | Method | Test Description | Expected Result |
|----|----|----------|--------|-----------------|-----------------|
| T-246 | 9.1 | P0 | Agent | "konductor, who else is working here?" | who_is_active called, formatted response |
| T-247 | 9.2 | P0 | Agent | "konductor, who's on my files?" | who_overlaps called, overlap info shown |
| T-248 | 9.2 | P1 | Agent | No overlaps → "You're clear" message | Green message when alone |
| T-249 | 9.3 | P1 | Agent | "konductor, what is bob working on?" | user_activity called for bob |
| T-250 | 9.4 | P0 | Agent | "konductor, am I safe to push?" | risk_assessment called, severity shown |
| T-251 | 9.4 | P1 | Agent | Safe situation → "Safe to push" | Green message when solo |
| T-252 | 9.5 | P1 | Agent | "konductor, what's the hottest file?" | repo_hotspots called, ranked list |
| T-253 | 9.6 | P1 | Agent | "konductor, what branches are active?" | active_branches called, list shown |
| T-254 | 9.7 | P1 | Agent | "konductor, who should I talk to?" | coordination_advice called, targets ranked |
| T-255 | 9.8 | P1 | Agent | "konductor, show PRs" | PR list displayed with status |
| T-256 | 9.9 | P1 | Agent | "konductor, show history" | Recent activity displayed |
| T-257 | 9.10 | P0 | Agent | "konductor, status" | MCP + watcher status reported |
| T-258 | 9.10 | P1 | Agent | Watcher down → status shows warning | "File watcher not running" |
| T-259 | 9.11 | P1 | Agent | "konductor, restart" | Watcher killed and relaunched |
| T-260 | 9.12 | P0 | Agent | "konductor, help" | Full help text displayed |
| T-261 | 9.13 | P1 | Agent | "konductor, who am I?" | userId, repo, branch shown |
| T-262 | 9.14 | P1 | Agent | "konductor, show my config" | Config values displayed |
| T-263 | 9.15 | P0 | Agent | Unrecognized command → help suggestion | "I didn't understand that" message |
| T-264 | 9.16 | P2 | Agent | "konductor, show baton" → URL shown | repoPageUrl displayed |
| T-265 | 9.17 | P2 | Agent | "konductor, open baton" → browser opens | URL opened in browser |

---

## Section 10: Steering Rules (10-steering-rules.md)

| ID | UC | Priority | Method | Test Description | Expected Result |
|----|----|----------|--------|-----------------|-----------------|
| T-266 | 10.1 | P0 | Agent | Session start → health check runs | Watcher + server status printed |
| T-267 | 10.1 | P1 | Agent | Watcher not running → auto-started | Watcher PID appears |
| T-268 | 10.1 | P1 | Agent | Server unreachable → warning printed | "Server not reachable" message |
| T-269 | 10.2 | P0 | Agent | File modify → auto-registration | register_session called with file list |
| T-270 | 10.2 | P1 | Agent | Registration confirmation printed | "Registered session on..." message |
| T-271 | 10.3 | P0 | Agent | Collision Course → agent PAUSES | Agent waits for user confirmation |
| T-272 | 10.3 | P1 | Agent | Terminal echo at Collision Course | stderr echo visible |
| T-273 | 10.4 | P0 | Agent | Merge Hell → agent PAUSES with strong warning | "Critical overlap" + terminal echo |
| T-274 | 10.5 | P0 | Agent | Solo → agent proceeds without pause | No interruption |
| T-275 | 10.5 | P1 | Agent | Neighbors → informational message, proceeds | "Others active but different files" |
| T-276 | 10.6 | P1 | Agent | Crossroads → caution message, proceeds | "Same directories" warning, no pause |
| T-277 | 10.7 | P1 | Agent | File list changes → session updated | "Updated session — now tracking N files" |
| T-278 | 10.8 | P0 | Agent | Task complete → deregistration | "Session closed" message |
| T-279 | 10.9 | P0 | Agent | Server unreachable → per-file warnings | Each file gets individual warning |
| T-280 | 10.9 | P1 | Agent | Work continues despite server failure | Agent doesn't block |
| T-281 | 10.10 | P0 | Agent | updateRequired → auto-update triggered | npx command runs |
| T-282 | 10.10 | P1 | Agent | After update → re-registration | Session re-registered |
| T-283 | 10.11 | P1 | Agent | Update fails → manual fallback shown | Warning with install command |
| T-284 | 10.11 | P1 | Agent | Failed update → no retry in session | Single attempt only |
| T-285 | 10.12 | P1 | Agent | Identity resolved without user input | userId from env/git/hostname |
| T-286 | 10.13 | P1 | Shell | Identity persisted to .konductor-watcher.env | KONDUCTOR_USER written |
| T-287 | 10.14 | P1 | Agent | Source-attributed collision messages | Each source type formatted correctly |

---

## Section 11: Auto-Update & Versioning (11-auto-update-and-versioning.md)

| ID | UC | Priority | Method | Test Description | Expected Result |
|----|----|----------|--------|-----------------|-----------------|
| T-288 | 11.1 | P0 | API | Outdated version + register → updateRequired | Response has updateRequired: true |
| T-289 | 11.1 | P0 | Shell | Watcher downloads and installs new bundle | .konductor-version updated |
| T-290 | 11.1 | P1 | Shell | Watcher restarts after update | New PID, new version running |
| T-291 | 11.2 | P1 | Agent | Agent auto-update → "Client updated" message | Update notification in chat |
| T-292 | 11.2 | P1 | Agent | Agent re-registers after update | Second register succeeds |
| T-293 | 11.3 | P1 | Shell | Download fails → watcher continues on old version | Process alive, old version |
| T-294 | 11.3 | P1 | Shell | Watcher retries on next cycle | Next poll attempts update again |
| T-295 | 11.4 | P1 | Agent | npx fails → manual fallback message | Warning with install command |
| T-296 | 11.4 | P1 | Agent | No retry after failed update | Single attempt per session |
| T-297 | 11.5 | P0 | API | Current version → no updateRequired | Matching version = no update |
| T-298 | 11.6 | P1 | API | Client newer than server (rollback) → updateRequired | Downgrade triggered |
| T-299 | 11.7 | P0 | API | UAT user gets UAT-specific update URL | updateUrl points to /bundle/installer-uat.tgz |
| T-300 | 11.7 | P1 | API | Prod user gets Prod URL | Channel-specific serving |
| T-301 | 11.8 | P1 | API | "Latest" channel resolves to newest bundle | Most recent by createdAt |
| T-302 | 11.9 | P1 | Shell | Watcher checks version at startup | Update before entering poll loop |
| T-303 | 11.11 | P0 | Shell | Update preserves .konductor-watcher.env | Custom config unchanged after update |
| T-304 | 11.11 | P1 | Shell | Update changes code files | konductor-watcher.mjs content differs |
| T-305 | 11.12 | P2 | Playwright | Admin sees rollout progress in user table | Users updating visible |
| T-306 | 11.13 | P1 | API | Manual install with old version → auto-updates | First register triggers update |
| T-307 | 11.14 | P1 | Shell | Bundle with valid manifest → metadata extracted | Version, author, summary from manifest |
| T-308 | 11.14 | P1 | Shell | Bundle without manifest → fallback metadata | Version from filename, mtime for date |
| T-309 | 11.15 | P1 | Shell | .konductor-version readable | cat returns semver string |
| T-310 | 11.16 | P0 | API | Stale → new assignment → updateRequired | Transition from stale to update |
| T-311 | 11.17 | P2 | API | Duplicate watchers → no duplicate sessions | Last write wins |

---

## Section 12: Notifications (12-notifications.md)

| ID | UC | Priority | Method | Test Description | Expected Result |
|----|----|----------|--------|-----------------|-----------------|
| T-312 | 12.1 | P0 | API+Playwright | Collision → all channels fire | Baton SSE, Slack, agent all receive |
| T-313 | 12.2 | P0 | Shell | Watcher deduplicates repeated same-state | Single notification for sustained state |
| T-314 | 12.2 | P1 | Shell | State change → new notification | Signature change triggers notify |
| T-315 | 12.3 | P0 | API | Verbosity filtering correct | Only states ≥ threshold trigger Slack |
| T-316 | 12.4 | P1 | API | De-escalation → exactly one message | Single de-escalation when crossing below |
| T-317 | 12.4 | P1 | API | Further drops → no additional de-escalation | Only one message per crossing |
| T-318 | 12.5 | P1 | API | Multi-user collision → single consolidated Slack | One message listing all users |
| T-319 | 12.6 | P1 | Playwright | SSE event → Baton row appears within 5s | Real-time notification display |
| T-320 | 12.6 | P1 | Playwright | Health badge updates with notification | Color changes match severity |
| T-321 | 12.7 | P1 | Playwright | History tab shows resolved notifications | Resolved items in history view |
| T-322 | 12.8 | P1 | Agent | Collision Course → terminal echo fires | stderr output visible |
| T-323 | 12.8 | P1 | Agent | Solo/Neighbors → NO terminal echo | Only high severity echoes |
| T-324 | 12.9 | P1 | Agent | Slack config change → client notification | "📢 Konductor: Slack alerts..." |
| T-325 | 12.9 | P1 | Playwright | Slack config change → Baton panel updates | New channel shown in panel |
| T-326 | 12.10 | P1 | Agent | Update available → client-side notification only | No Slack, no Baton for updates |
| T-327 | 12.11 | P1 | Agent | Bundle stale → warning shown once | Single warning per session |
| T-328 | 12.12 | P0 | Agent | Server down → disconnection notification | "Connection lost" message |
| T-329 | 12.12 | P0 | Agent | Per-file warnings when disconnected | Each file gets warning line |
| T-330 | 12.13 | P0 | Agent | Server returns → reconnection notification | "Reconnected" message |
| T-331 | 12.14 | P1 | API | Notifications survive server restart | Loaded from persistence on startup |
| T-332 | 12.15 | P2 | API | 20 simultaneous registrations → coalesced notification | Not 20 separate notifications |
| T-333 | 12.16 | P1 | Agent | Proactive push to existing user | User A notified when B creates collision |

### Proactive Collision Push (Req 3)

| ID | UC | Priority | Method | Test Description | Expected Result |
|----|----|----------|--------|-----------------|-----------------|
| T-348 | 3.1 | P1 | API | New registration collision → SSE event to existing user | collision_alert event emitted to overlapping user's SSE |
| T-349 | 3.1 | P1 | API | SSE event payload contains collision context | type, repo, collisionState, triggeringUser, sharedFiles, summary |
| T-350 | 3.4 | P1 | API | Proactive push is best-effort | Registration not blocked by SSE send failure |
| T-351 | 3.1 | P2 | API | Solo registration → no SSE push | No collision_alert when state is solo |

---

## Section 13: Live Share Integration (konductor-live-share/use-cases.md)

### Initiating a Collaboration Request

| ID | UC | Priority | Method | Test Description | Expected Result |
|----|----|----------|--------|-----------------|-----------------|
| T-356 | LS-1 | P0 | API | User requests live share with active user → collab request created | create_collab_request returns requestId, status "pending" |
| T-357 | LS-1 | P1 | API | Collab request triggers SSE event | collab_request_update event emitted to Baton subscribers |
| T-358 | LS-1 | P1 | API | Collab request triggers Slack notification (if configured) | Slack message posted to channel or DM |
| T-359 | LS-2 | P1 | Agent | "konductor, live share" without user → auto-selects collision partner | Request sent to overlapping user |
| T-360 | LS-3 | P1 | Agent | Live share with inactive user → warning shown | "doesn't appear to be active" message, no request created |
| T-361 | LS-4 | P1 | Agent | "konductor, live share" with no collision → guidance shown | "No active collisions detected" message |
| T-362 | LS-5 | P1 | Agent | Multiple collision partners → highest severity auto-selected | Request sent to highest-risk partner, others listed |

### Proactive Suggestions

| ID | UC | Priority | Method | Test Description | Expected Result |
|----|----|----------|--------|-----------------|-----------------|
| T-363 | LS-6 | P1 | Agent | Collision Course → live share suggestion appended | "konductor, live share with <user>" tip shown |
| T-364 | LS-7 | P1 | Agent | Merge Hell → stronger live share suggestion | "Strongly recommend pairing" message shown |

### Recipient Notification Channels

| ID | UC | Priority | Method | Test Description | Expected Result |
|----|----|----------|--------|-----------------|-----------------|
| T-365 | LS-8 | P0 | API | Agent check-in returns pending collab requests | pendingCollabRequests array in register_session response |
| T-366 | LS-8 | P1 | Agent | Pending request displayed with accept/decline options | "accept collab from" / "decline collab from" commands shown |
| T-367 | LS-9 | P1 | API | Slack DM sent to recipient (if DMs enabled) | Slack message contains initiator, files, collision state |
| T-368 | LS-10 | P1 | Playwright | Baton dashboard shows collab request card via SSE | Collaboration Requests section updated in real-time |
| T-369 | LS-11 | P1 | Shell | Watcher terminal shows collab request notification | "COLLAB REQUEST from <user>" in watcher output |

### Responding to Collaboration Requests

| ID | UC | Priority | Method | Test Description | Expected Result |
|----|----|----------|--------|-----------------|-----------------|
| T-370 | LS-12 | P0 | API | Accept collab request → status updated to "accepted" | respond_collab_request returns success, SSE event emitted |
| T-371 | LS-12 | P1 | Agent | Initiator notified of acceptance on next check-in | "accepted your collaboration request" message |
| T-372 | LS-13 | P0 | API | Decline collab request → status updated to "declined" | respond_collab_request returns success, SSE event emitted |
| T-373 | LS-13 | P1 | Agent | Initiator notified of decline on next check-in | "declined your collaboration request" message |
| T-374 | LS-14 | P1 | API | Request expires after TTL (30 min) → status "expired" | Server marks expired, SSE event emitted |
| T-375 | LS-14 | P1 | Agent | Initiator notified of expiry on next check-in | "expired (no response after 30 min)" message |

### Share Link Exchange

| ID | UC | Priority | Method | Test Description | Expected Result |
|----|----|----------|--------|-----------------|-----------------|
| T-376 | LS-15 | P0 | API | Share link relayed via share_link MCP tool | Status updated to "link_shared", link stored, SSE event emitted |
| T-377 | LS-15 | P1 | API | Slack notification includes share link | Slack message contains Live Share URL |
| T-378 | LS-15 | P1 | Agent | Initiator receives link on next check-in | "shared a Live Share link" message with URL |
| T-379 | LS-16 | P1 | Agent | Invalid share link URL rejected | "doesn't look like a Live Share link" message |
| T-380 | LS-17 | P1 | Playwright | Baton dashboard shows "Join Session" button for link_shared | Clickable button opens Live Share URL |

### Graceful Degradation

| ID | UC | Priority | Method | Test Description | Expected Result |
|----|----|----------|--------|-----------------|-----------------|
| T-381 | LS-18 | P1 | API | Slack not configured → agent-only delivery | Request created, "Slack not configured" warning shown |
| T-382 | LS-19 | P0 | Agent | Server unreachable → collab request fails gracefully | "Server not reachable" message, manual coordination suggested |
| T-383 | LS-20 | P1 | API | Collab feature disabled by admin → clear error | "Collaboration requests are disabled" message |

### IDE Automation

| ID | UC | Priority | Method | Test Description | Expected Result |
|----|----|----------|--------|-----------------|-----------------|
| T-384 | LS-21 | P2 | Agent | Live Share installed → session auto-started on accept | liveshare.start executed, link auto-shared |
| T-385 | LS-22 | P2 | Agent | Live Share not installed → offer to install | "Install it?" prompt shown |
| T-386 | LS-23 | P1 | Agent | VS Code CLI unavailable → manual fallback instructions | Step-by-step manual instructions shown |
| T-387 | LS-24 | P1 | Agent | "konductor, join <url>" → IDE join or browser fallback | Session joined or URL opened in browser |
| T-388 | LS-25 | P2 | Agent | Live Share requires auth → sign-in prompt shown | "needs you to sign in" message, no hang |

### Edge Cases

| ID | UC | Priority | Method | Test Description | Expected Result |
|----|----|----------|--------|-----------------|-----------------|
| T-389 | LS-26 | P1 | API | Duplicate collab request → returns existing requestId | No duplicate created, idempotent response |
| T-390 | LS-27 | P2 | API | Collision resolves while request pending → request persists | Request still pending, initiator informed of resolution |
| T-391 | LS-28 | P1 | API | Mutual collab requests → auto-accepted | Both requests auto-accepted, both users notified |
| T-392 | LS-29 | P2 | Agent | Cross-IDE pairing (Kiro ↔ VS Code) → link works | Live Share link opens in browser or IDE |
| T-393 | LS-30 | P1 | Agent | Multiple pending requests for same recipient → all shown | Numbered list sorted by recency with severity |

### Baton Dashboard — Live Share Indicators

| ID | UC | Priority | Method | Test Description | Expected Result |
|----|----|----------|--------|-----------------|-----------------|
| T-394 | LS-10 | P1 | Playwright | Collab panel renders request cards with all fields | Initiator, recipient, files, collision state, status, age visible |
| T-395 | LS-17 | P1 | Playwright | link_shared request shows "🟢 Live" badge | Green pulsing badge on card |
| T-396 | LS-12 | P1 | Playwright | accepted request shows "⏳ Waiting for Link" badge | Waiting badge on card |
| T-397 | LS-10 | P1 | Playwright | SSE collab_request_update → panel updates in real-time | New/changed cards appear without page refresh |

---

## Summary

| Section | Tests | P0 | P1 | P2 |
|---------|-------|----|----|-----|
| 1. Client Connection | 36 | 14 | 19 | 3 |
| 2. Collision Scenarios | 44 | 10 | 24 | 10 |
| 3. File Watcher | 45 | 7 | 28 | 10 |
| 4. Admin Dashboard | 42 | 8 | 30 | 4 |
| 5. Bundle Management | 19 | 3 | 14 | 2 |
| 6. Baton Dashboard | 28 | 5 | 20 | 3 |
| 7. Slack Integration | 22 | 5 | 16 | 1 |
| 8. GitHub Integration | 27 | 3 | 20 | 4 |
| 9. Chat Commands | 20 | 5 | 12 | 3 |
| 10. Steering Rules | 22 | 8 | 13 | 1 |
| 11. Auto-Update & Versioning | 24 | 6 | 14 | 4 |
| 12. Notifications | 26 | 6 | 16 | 4 |
| 13. Live Share Integration | 42 | 6 | 31 | 5 |
| **TOTAL** | **397** | **86** | **257** | **54** |

---

## Execution Strategy

### Phase 1: Smoke Test (P0 only — 86 tests)
Run all P0 tests first. If any fail, the system has critical issues.

```bash
# API smoke tests (covers ~42 P0 tests)
cd testrepo && node client-verification.mjs

# Shell verification (covers ~15 P0 tests)
pgrep -f konductor-watcher.mjs
cat .konductor-version
ls .kiro/settings/mcp.json .kiro/steering/*.md .kiro/hooks/*.md

# Playwright critical path (covers ~20 P0 tests)
cd konductor/konductor && npx playwright test e2e/regression-p0.spec.ts
```

### Phase 2: Feature Tests (P1 — 257 tests)
Run after P0 passes. Covers all feature-level functionality.

```bash
# Full API test suite
cd testrepo && node client-verification.mjs --full

# Playwright feature tests
cd konductor/konductor && npx playwright test e2e/regression-p1.spec.ts

# Watcher behavior tests
cd testrepo && node watcher-regression.mjs
```

### Phase 3: Edge Cases (P2 — 54 tests)
Run after P1 passes. Covers edge cases and future features.

```bash
cd konductor/konductor && npx playwright test e2e/regression-p2.spec.ts
```

---

## Test Status Tracking

Use this checklist to track test execution during regression runs:

- [ ] Phase 1 complete (P0: 86 tests)
- [ ] Phase 2 complete (P1: 257 tests)
- [ ] Phase 3 complete (P2: 54 tests)
- [ ] All failures documented with reproduction steps
- [ ] Blocking issues filed in konductor-bugs-and-missing-features spec

---

## Notes for Test Authors

1. **testrepo is the canonical client project** — all client-side tests run from there
2. **API tests should clean up** — deregister test sessions after each test
3. **Playwright tests need admin login** — use the helper in `e2e/helpers.ts`
4. **Multi-user tests** — register as "test-bob", "test-carol" etc., clean up after
5. **Previously missing features** — offline queue, branch detection, proactive push, Slack debounce, show/open baton, and resolution suggestions are now implemented
6. **SSE tests** — use AbortController with 3s timeout for SSE endpoint verification
7. **Watcher tests** — may need to kill/restart watcher; always verify PID after
