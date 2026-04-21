# Requirements Document

## Introduction

This spec captures missing features, behavioral gaps, and bugs identified during comprehensive use-case documentation of the Konductor system. These items represent functionality that users expect based on the documented behavior but that is not currently implemented or not working correctly. Each requirement maps to specific use cases in `docs/use-cases/`.

## Glossary

- **Konductor**: The Work Coordination MCP Server that tracks concurrent development activity and evaluates collision risk
- **File Watcher**: The background Node.js process (`konductor-watcher.mjs`) that monitors file changes and reports them to the server
- **Steering Rule**: The agent instruction file (`konductor-collision-awareness.md`) that defines autonomous Konductor behavior
- **Offline Queue**: A mechanism to store file change events while the server is unreachable and replay them on reconnection
- **Baton**: The per-repository web dashboard served by the Konductor server

## Requirements

### Requirement 1: Offline Change Queuing and Replay

**User Story:** As a developer, I want my file changes tracked even when the Konductor server is temporarily unreachable, so that collision awareness is accurate when the server comes back.

#### Acceptance Criteria

1. WHEN the file watcher detects a file change and the server is unreachable, THE watcher SHALL store the change event in a local queue (in memory)
2. WHEN the server becomes reachable again, THE watcher SHALL replay all queued change events to the server by sending the cumulative file list in a single registration call
3. WHEN replaying queued events, THE watcher SHALL send the cumulative file list (union of all queued files) to avoid excessive API calls
4. WHEN the offline queue exceeds the configured maximum size (`KONDUCTOR_OFFLINE_QUEUE_MAX` in `.konductor-watcher.env`, default: 100), THE watcher SHALL discard the oldest events first (FIFO eviction, similar to log rotation)
5. THE watcher SHALL inform the user of queued offline changes via the log: "X file changes queued while offline. Will report on reconnection."
6. WHEN the queue evicts old events, THE watcher SHALL log: "Offline queue full (max: X). Oldest events discarded."
7. THE `KONDUCTOR_OFFLINE_QUEUE_MAX` setting SHALL be configurable in `.konductor-watcher.env`

**References:** UC-1.4, UC-1.5, UC-3.5, UC-3.6

---

### Requirement 2: "Show Baton" / "Open Baton" Chat Command

**User Story:** As a developer, I want to ask Konductor for the Baton dashboard URL or have it opened in my browser, so that I can quickly access the repo page without remembering the URL.

#### Acceptance Criteria

1. WHEN the user says "konductor, show baton" or "konductor, where is the repo website?", THE agent SHALL display the `repoPageUrl` from the most recent registration response
2. WHEN the user says "konductor, open baton", THE agent SHALL open the Baton repo page URL in the user's default browser
3. WHEN no `repoPageUrl` is available (never registered or server unreachable), THE agent SHALL display a message indicating the URL is not available and suggest registering first
4. THE steering rule routing table SHALL include entries for "show baton", "open baton", and "where is the repo website?"

**References:** UC-1.10, UC-9.16, UC-9.17

---

### Requirement 3: Proactive Collision Notification to Existing Users

**User Story:** As a developer already working in a repo, I want to be notified immediately when someone else starts editing my files, so that I don't discover the collision only on my next save.

#### Acceptance Criteria

1. WHEN a new session registration creates a collision with an existing user, THE server SHALL emit an SSE event to the existing user's connected client
2. WHEN the existing user's agent receives the collision SSE event, THE agent SHALL display the appropriate collision warning without waiting for the user's next interaction
3. WHEN the collision is Collision Course or Merge Hell, THE agent SHALL echo the warning to the terminal immediately
4. THE proactive notification SHALL include the same source-attributed context as registration-time notifications

**References:** UC-2.12

**STATUS: CONFIRMED MISSING.** The server only returns collision state in the `register_session` response. There is no SSE push to existing users when a new session creates a collision. User A only discovers the collision on their next `register_session` call (next file save or poll cycle).

---

### Requirement 4: Slack Notification Debouncing

**User Story:** As a team, I want Slack notifications to be debounced during rapid state changes, so that the channel is not flooded with messages when users are rapidly saving files.

#### Acceptance Criteria

1. WHEN a collision state change occurs, THE server SHALL wait a configurable debounce period (default: 30 seconds) before posting to Slack
2. IF the collision state changes again within the debounce period, THE server SHALL reset the timer and use the latest state
3. WHEN the debounce period expires, THE server SHALL post a single notification reflecting the current (settled) state
4. THE debounce period SHALL be configurable via admin settings (minimum: 5 seconds, maximum: 300 seconds)

**References:** UC-2.20

---

### Requirement 5: Watcher Offline Status Indicator for User

**User Story:** As a developer, I want to see in my IDE that the watcher has queued offline changes, so that I know my changes will be reported when the server returns.

#### Acceptance Criteria

1. WHEN the watcher is offline and has queued changes, THE steering rule SHALL display on session start: "⚠️ Konductor: X changes queued while offline. Will sync on reconnection."
2. WHEN the watcher reconnects and replays queued changes, THE steering rule SHALL display: "🟢 Konductor: Reconnected. Synced X offline changes."
3. THE watcher log SHALL include a running count of queued changes while offline

**References:** UC-1.4, UC-1.5, UC-3.5

---

### Requirement 6: Browser Open Capability

**User Story:** As a developer, I want the agent to be able to open URLs in my default browser when I ask, so that I can quickly access the Baton dashboard or Slack channel.

#### Acceptance Criteria

1. WHEN the user says "konductor, open baton", THE agent SHALL execute `open <url>` (macOS) or `xdg-open <url>` (Linux) or `start <url>` (Windows) to open the Baton repo page
2. WHEN the user says "konductor, open slack", THE agent SHALL open the configured Slack channel URL in the default browser
3. THE agent SHALL detect the operating system and use the appropriate open command

**References:** UC-9.16, UC-9.17

---

### Requirement 7: Watcher Branch Change Detection

**User Story:** As a developer, I want the file watcher to detect when I switch branches and update my session accordingly, so that collision detection accounts for my current branch.

#### Acceptance Criteria

1. WHEN the file watcher detects a branch change (via `git branch --show-current`), THE watcher SHALL update the session registration with the new branch name
2. WHEN the branch changes, THE watcher SHALL re-evaluate the file list (some files may be different on the new branch)
3. THE branch check SHALL occur on every poll cycle (not just on file changes)

**References:** UC-3.12

**STATUS: CONFIRMED MISSING.** The watcher resolves `BRANCH` as a constant at startup (`const BRANCH = git("git branch --show-current")`). It is never re-evaluated during the poll loop. Branch switches are not detected until the watcher is restarted.

---

### Requirement 8: Documentation of Both Install Methods in README

**User Story:** As a new user, I want both installation methods (npx command and manual MCP config) clearly documented in the README, so that I can choose the approach that works for my situation.

#### Acceptance Criteria

1. THE README SHALL document the npx install command method with examples for localhost and remote
2. THE README SHALL document the manual MCP config method (create `.kiro/settings/mcp.json` and let auto-install handle the rest)
3. THE README SHALL explain what happens after each method (auto-install flow for manual config, immediate setup for npx)
4. BOTH methods SHALL be documented in the "Installing Konductor (Client)" section

**References:** UC-1.1, UC-1.2

**⚠️ STATUS:** The npx method is well-documented. The manual MCP config → auto-install flow is NOT documented in the README.


---

### Requirement 9: Actionable Resolution Suggestions

**User Story:** As a developer, I want Konductor to suggest specific actions to resolve collisions (rebase, shelve, coordinate, stop), so that I know HOW to fix the problem, not just that a problem exists.

#### Acceptance Criteria

1. WHEN the agent displays a Collision Course or Merge Hell warning, THE agent SHALL include a numbered list of suggested resolution actions appropriate to the situation
2. THE suggested actions SHALL be context-aware, considering: collision state, branch relationship (same vs different), line overlap severity, and whether the overlapping user is active or passive (PR/commit)
3. WHEN the collision is on the same branch with line overlap, THE suggestions SHALL include: rebase, coordinate, shelve, or continue
4. WHEN the collision is on different branches (Merge Hell), THE suggestions SHALL include: stop and coordinate, rebase the other branch, shelve and wait, create shared branch, or continue
5. WHEN an approved PR is about to merge, THE suggestions SHALL include time-sensitive actions: commit immediately, ask to hold merge, or shelve and rebase after merge
6. WHEN the user selects a suggestion (e.g., "do option 1"), THE agent SHALL execute the corresponding git command after user confirmation
7. THE agent SHALL NOT execute destructive git commands (rebase, stash) without explicit user confirmation

**References:** UC-2.45 through UC-2.54

---

### Requirement 10: "Is It Safe?" Query After Shelving

**User Story:** As a developer who shelved changes due to a collision, I want to ask Konductor when it's safe to resume, so that I don't unstash into an active conflict.

#### Acceptance Criteria

1. WHEN the user says "konductor, is it safe to unstash?" or "konductor, is it safe to resume?", THE agent SHALL check the current collision state for the files that were stashed
2. WHEN the previously conflicting user is no longer editing those files, THE agent SHALL respond: "🟢 Safe to resume. <user> is no longer editing <files>."
3. WHEN the previously conflicting user is still active on those files, THE agent SHALL respond: "⚠️ <user> is still editing <files>. Wait or coordinate."
4. THE steering rule routing table SHALL include entries for "is it safe to unstash?", "is it safe to resume?", and "can I continue?"

**References:** UC-2.54

---

### Requirement 11: Proximity State (6th Collision State)

**User Story:** As a developer, I want a "Proximity" state between Crossroads and Collision Course, so that same-file-different-section situations don't trigger false alarms.

#### Acceptance Criteria

1. WHEN two users edit the same file AND line range data shows no overlap, THE evaluator SHALL return the "Proximity" state (severity 2.5)
2. THE Proximity state SHALL NOT pause the agent (same behavior as Crossroads)
3. THE Proximity state SHALL NOT trigger Slack notifications at default verbosity (level 2)
4. THE Proximity state SHALL display on Baton as 🟡 Warning (same as Crossroads)
5. WHEN line range data is NOT available for a shared file, THE evaluator SHALL fall back to Collision Course (assume worst case for backward compatibility)
6. THE Proximity state message SHALL include: the file name, both users' line ranges, and confirmation of no overlap

**References:** UC-2.25, UC-2.45, UC-2.50

**NOTE:** This requirement depends on `konductor-line-level-collision` spec being implemented first.
