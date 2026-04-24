# Requirements: Enhanced Chat Support

## Introduction

Konductor currently provides collision awareness through automatic session registration and status polling. This feature extends the system so users can ask natural language questions about repo activity, collision risk, and coordination — and get actionable answers directly in their IDE chat.

The feature is split into phases based on what data is available:
- **Phase 1 (Now)**: Awareness + Risk queries using existing session data
- **Phase 2 (Long-term memory)**: History queries using session retention (depends on konductor-long-term-memory spec)
- **Phase 3 (GitHub integration)**: PR/branch queries using GitHub API (depends on konductor-github spec)

## Glossary

- **Active session**: A currently registered work session (not expired or deregistered)
- **Collision risk**: A score or state indicating how close a user is to a conflict
- **Hotspot**: A file or directory with multiple active users
- **Coordination target**: A user the current user should talk to before merging

---

## Phase 1: Awareness & Risk (implementable now)

### Requirement 1: Who's working here?

**User Story:** As a developer, I want to ask "who else is working in this repo?" and get a clear answer listing active users, their branches, and files.

#### Acceptance Criteria

1. THE system SHALL provide a `who_is_active` MCP tool that returns all active sessions for a given repo
2. THE response SHALL include each user's userId, branch, file list, and session duration
3. THE steering rule SHALL instruct the agent to call this tool when the user asks questions like "who else is here?", "who's working on this repo?", "show me active users"
4. THE agent SHALL format the response as a readable list, not raw JSON

### Requirement 2: Who's on my files?

**User Story:** As a developer, I want to ask "who is editing the same files as me?" and see exactly which users overlap with my work.

#### Acceptance Criteria

1. THE system SHALL provide a `who_overlaps` MCP tool that takes a userId and repo, and returns overlapping users with their shared files
2. THE response SHALL include the collision state, overlapping userIds, shared file paths, and each user's branch
3. THE steering rule SHALL instruct the agent to call this tool when the user asks "who's on my files?", "who else is editing src/index.ts?", "do I have any conflicts?"
4. WHEN there are no overlaps, THE agent SHALL respond with "You're solo — no one else is touching your files."

### Requirement 3: What's a specific user working on?

**User Story:** As a developer, I want to ask "what is bob working on?" and see their active session details.

#### Acceptance Criteria

1. THE system SHALL provide a `user_activity` MCP tool that takes a userId and returns all their active sessions across repos
2. THE response SHALL include repo, branch, files, session start time, and last heartbeat
3. WHEN the user has no active sessions, THE response SHALL indicate they are not currently active

### Requirement 4: Collision risk score

**User Story:** As a developer, I want to ask "how close am I to merge hell?" and get a risk assessment.

#### Acceptance Criteria

1. THE system SHALL provide a `risk_assessment` MCP tool that takes a userId and repo, and returns a risk analysis
2. THE risk analysis SHALL include:
   - Current collision state and severity (0-4)
   - Number of overlapping users
   - Number of shared files
   - Whether overlapping users are on different branches (merge hell risk)
   - A human-readable risk summary (e.g. "Low risk — 1 user in repo, no file overlap" or "High risk — 2 users editing src/index.ts on different branches")
3. THE steering rule SHALL instruct the agent to call this tool when the user asks "how risky is my situation?", "am I safe to push?", "how close am I to merge hell?"

### Requirement 5: Repo hotspots

**User Story:** As a developer, I want to ask "what's the riskiest file in this repo?" and see which files have the most concurrent editors.

#### Acceptance Criteria

1. THE system SHALL provide a `repo_hotspots` MCP tool that takes a repo and returns files ranked by collision risk
2. THE ranking SHALL consider: number of active editors, whether editors are on different branches, directory-level overlap
3. THE response SHALL include each hotspot file, the users editing it, their branches, and the resulting collision state
4. WHEN there are no hotspots (solo or no overlap), THE response SHALL indicate the repo is clear

### Requirement 6: Active branches

**User Story:** As a developer, I want to ask "what branches are active?" and see all branches with active sessions.

#### Acceptance Criteria

1. THE system SHALL provide a `active_branches` MCP tool that takes a repo and returns all branches with active sessions
2. THE response SHALL include each branch name, the users on it, and the files being edited
3. THE response SHALL flag branches that have file overlap with other branches (merge hell candidates)

### Requirement 7: Coordination suggestions

**User Story:** As a developer, I want to ask "who should I coordinate with?" and get actionable advice.

#### Acceptance Criteria

1. THE system SHALL provide a `coordination_advice` MCP tool that takes a userId and repo
2. THE response SHALL list users the developer should coordinate with, ranked by urgency:
   - Merge hell users first (different branch, same files)
   - Collision course users second (same branch, same files)
   - Crossroads users third (same directories)
3. FOR each coordination target, THE response SHALL include: userId, branch, shared files, and a suggested action ("merge before pushing", "sync on file ownership", "keep an eye on directory")

---

## Phase 2: History Queries (depends on long-term memory)

### Requirement 8: Recent activity

**User Story:** As a developer, I want to ask "what changed in the last hour?" and see recent session activity.

#### Acceptance Criteria

1. THE system SHALL provide a `recent_activity` MCP tool that takes a repo and time range
2. THE response SHALL include sessions registered, updated, and deregistered within the time range
3. THE response SHALL include file-level changes (which files were added/removed from sessions)

### Requirement 9: File history

**User Story:** As a developer, I want to ask "who was working on src/index.ts today?" and see the history.

#### Acceptance Criteria

1. THE system SHALL provide a `file_history` MCP tool that takes a file path, repo, and time range
2. THE response SHALL include all users who had that file in a session during the time range
3. THE response SHALL include their branches, session start/end times, and whether they committed

### Requirement 10: Collision timeline

**User Story:** As a developer, I want to ask "show me the collision timeline" and see how collision states changed over time.

#### Acceptance Criteria

1. THE system SHALL provide a `collision_timeline` MCP tool that takes a userId, repo, and time range
2. THE response SHALL include state transitions with timestamps (e.g. solo → neighbors at 10:00, neighbors → collision_course at 10:15)
3. THE response SHALL include which users/files caused each transition

---

## Phase 3: PR & Branch Queries (depends on GitHub integration)

### Requirement 11: Open PRs touching my files

**User Story:** As a developer, I want to ask "what PRs are open that touch my files?" and see potential merge conflicts before they happen.

#### Acceptance Criteria

1. THE system SHALL provide a `related_prs` MCP tool that takes a userId and repo
2. THE response SHALL query GitHub for open PRs and compare their changed files against the user's active session files
3. THE response SHALL include PR number, title, author, branch, and the overlapping files
4. THE response SHALL flag PRs that are likely to conflict with the user's work

### Requirement 12: Merge readiness

**User Story:** As a developer, I want to ask "should I wait to merge?" and get advice based on active sessions and open PRs.

#### Acceptance Criteria

1. THE system SHALL provide a `merge_readiness` MCP tool that takes a userId, repo, and branch
2. THE response SHALL consider: active sessions on the same files, open PRs touching the same files, branch divergence
3. THE response SHALL return a recommendation: "safe to merge", "coordinate with X first", or "wait — active conflicts"

---

## Steering Rule Updates

### Requirement 13: Activation prefix

**User Story:** As a developer, I want to talk to Konductor by prefixing my message with "konductor," so that the agent knows when I'm addressing Konductor versus making a general request.

#### Acceptance Criteria

1. THE steering rule SHALL instruct the agent to recognize messages starting with "konductor," (case-insensitive) as Konductor commands
2. THE agent SHALL route "konductor,"-prefixed messages to the appropriate MCP tool or management action
3. THE agent SHALL continue performing automatic background operations (session registration, collision checks) without requiring the prefix
4. WHEN a "konductor,"-prefixed message does not match any known command, THE agent SHALL respond with a helpful suggestion pointing to "konductor, help"

### Requirement 14: Natural language routing

THE steering rule SHALL instruct the agent to recognize natural language questions prefixed with "konductor," and route them to the appropriate MCP tool:

| User says (examples) | Tool to call |
|---|---|
| "konductor, who else is working here?" / "konductor, who else is using konductor right now?" / "konductor, what other users are active in my repo?" | `who_is_active` |
| "konductor, who's on my files?" | `who_overlaps` |
| "konductor, what is bob working on?" | `user_activity` |
| "konductor, how risky is my situation?" | `risk_assessment` |
| "konductor, what's the hottest file?" | `repo_hotspots` |
| "konductor, what branches are active?" | `active_branches` |
| "konductor, who should I talk to?" | `coordination_advice` |
| "konductor, what changed recently?" | `recent_activity` (Phase 2) |
| "konductor, who worked on this file?" | `file_history` (Phase 2) |
| "konductor, what PRs touch my files?" | `related_prs` (Phase 3) |
| "konductor, should I merge now?" | `merge_readiness` (Phase 3) |

THE agent SHALL format all responses in a human-readable way with emoji indicators for severity, not raw JSON.

### Requirement 15: Management commands

**User Story:** As a developer, I want to manage Konductor's configuration, status, and lifecycle by talking to it in chat, so that I never have to manually edit config files or run shell commands.

#### Acceptance Criteria

1. THE steering rule SHALL instruct the agent to recognize management commands prefixed with "konductor," and execute the appropriate action
2. THE system SHALL support the following status commands: "are you running?", "status"
3. THE system SHALL support the following lifecycle commands: "turn on", "turn off", "restart", "reinstall", "setup"
4. THE system SHALL support the following configuration commands: "change my API key to X", "change my logging level to X", "enable file logging", "disable file logging", "change poll interval to X", "watch only X extensions", "watch all files", "change my username to X"
5. THE system SHALL support the following informational commands: "what config options are there?", "show my config", "what can I ask you to do?", "help", "who am I?"
6. WHEN a configuration change requires a watcher restart, THE agent SHALL restart the watcher automatically after applying the change

### Requirement 16: Proactive suggestions

THE steering rule SHALL instruct the agent to proactively suggest coordination when it detects high-risk situations during normal registration:

1. WHEN collision state is collision_course or merge_hell, THE agent SHALL suggest: "You might want to ask 'konductor, who should I coordinate with?' for details."
2. WHEN multiple users are on different branches with shared files, THE agent SHALL suggest: "Ask 'konductor, am I safe to push?' before merging."

### Requirement 17: Installer post-install message

**User Story:** As a new Konductor user, I want to know how to interact with Konductor after installation, so that I can start using it immediately.

#### Acceptance Criteria

1. WHEN the installer completes, THE install script SHALL display a message informing the user they can talk to Konductor by prefixing messages with "konductor,"
2. THE post-install message SHALL include example commands: "konductor, help", "konductor, who's active?", "konductor, are you running?"
