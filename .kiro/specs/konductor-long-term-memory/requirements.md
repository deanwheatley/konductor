# Requirements Document

## Introduction

Currently, Konductor only tracks active sessions — once a session is deregistered or times out, all record of it is lost. This means if user Bob starts working on a file, stops for 2 days, and user Shane starts working on the same file, there is no collision detected because Bob's session expired. This feature adds persistent session history so that Konductor can detect conflicts across time gaps, answer historical queries (Enhanced Chat Phase 2), and provide richer context in the Baton dashboard.

The storage backend uses an in-memory store for this phase. A future spec will add a durable database backend (SQLite or similar) for production use. Both the in-memory store and the future database store will implement the same `ISessionHistoryStore` interface so that all consumers (CollisionEvaluator, QueryEngine, Baton dashboard) are storage-agnostic.

## Glossary

- **Konductor**: The Work Coordination MCP Server that tracks concurrent development activity and evaluates collision risk across repositories
- **Session History Store**: The persistent backend that retains session records beyond their active lifetime, implemented as an in-memory map (this phase) with a database implementation planned for a future phase
- **Historical Session**: A session record retained in the Session History Store after the session has expired or been deregistered
- **Active Session**: A currently registered work session managed by the SessionManager (not expired or deregistered)
- **Stale Overlap**: A collision state where an active session overlaps with a historical (expired but retained) session whose files were not committed
- **Committed Session**: A historical session whose files have been committed and pushed, resolving the potential for conflict
- **Retention Period**: The configurable number of days that historical sessions are kept before being purged (default: 30 days)
- **Collision State**: A graduated risk level (Solo, Neighbors, Crossroads, Collision Course, Merge Hell) describing overlap between concurrent development activities
- **Passive Session**: A work session automatically created from GitHub data (PR or commit activity), managed by the GitHub integration feature
- **User Record**: A row in the users store auto-created on first connection, storing identity, preferences, and administrative flags for future use by the admin dashboard feature

## Requirements

### Requirement 1: In-Memory Storage Backend

**User Story:** As a server operator, I want session history stored in memory with a well-defined interface, so that the system works locally and can be extended with a durable database in a future phase.

#### Acceptance Criteria

1. THE Konductor SHALL use an in-memory Session History Store that holds all historical sessions in a JavaScript Map
2. THE Konductor SHALL expose a single `ISessionHistoryStore` interface that the in-memory implementation satisfies and that a future database implementation can also satisfy
3. WHEN the Konductor restarts, THE in-memory Session History Store SHALL start with an empty history (data is lost on restart by design for this phase)

### Requirement 2: Session History Persistence

**User Story:** As a software engineer, I want all session activity to be recorded in the history store, so that Konductor can detect conflicts across time gaps within a server lifetime.

#### Acceptance Criteria

1. WHEN a work session is registered via `register_session`, THE Session History Store SHALL record the session with its userId, repo, branch, files, timestamps, and a status of `active`
2. WHEN a work session is deregistered via `deregister_session`, THE Session History Store SHALL update the session status to `expired` and record the deregistration timestamp
3. WHEN a work session times out due to heartbeat expiry, THE Session History Store SHALL update the session status to `expired` and record the expiry timestamp
4. WHEN a session's file list is updated during an active session, THE Session History Store SHALL record the updated file list
5. WHEN a passive session (source `github_pr` or `github_commit`) is created by the GitHub integration, THE Session History Store SHALL NOT record the passive session in history (passive sessions are ephemeral and re-created each poll cycle)

### Requirement 3: Retention and Purging

**User Story:** As a server operator, I want historical sessions to be automatically purged after a configurable period, so that memory does not grow unbounded.

#### Acceptance Criteria

1. THE Konductor SHALL retain historical sessions for a configurable number of days defined by `session_retention_days` in `konductor.yaml` (default: 30)
2. WHEN the Konductor starts, THE Session History Store SHALL start with an empty state (in-memory mode)
3. THE Session History Store SHALL purge expired sessions older than the retention period on a periodic schedule (default: every 6 hours)
4. WHEN the retention period configuration is changed via hot-reload, THE Session History Store SHALL apply the new retention period on the next purge cycle
5. WHEN a purge operation completes, THE Konductor SHALL log a SESSION entry containing the count of purged sessions and the retention period

### Requirement 4: Historical Collision Detection

**User Story:** As a software engineer, I want Konductor to warn me when I start working on files that another engineer recently worked on but did not commit, so that I can avoid duplicating effort or creating conflicts.

#### Acceptance Criteria

1. WHEN evaluating collision state for an active session, THE CollisionEvaluator SHALL also query the Session History Store for expired-but-retained sessions that overlap on the same files in the same repo
2. WHEN an expired historical session overlaps with an active session and the historical session is not marked as committed, THE collision response SHALL include a `staleOverlaps` array containing the historical user's userId, branch, files, and session expiry timestamp
3. THE collision response SHALL distinguish between active overlaps (from live sessions) and historical overlaps (from the Session History Store) using separate response fields
4. WHEN all overlapping historical sessions for a file are marked as committed, THE CollisionEvaluator SHALL NOT include those sessions in the `staleOverlaps` response
5. WHEN a historical overlap is detected, THE SummaryFormatter SHALL include a message indicating the historical user and the time since their session expired

### Requirement 5: Commit Tracking

**User Story:** As a software engineer, I want Konductor to track when I commit my changes, so that historical collision warnings are cleared for committed work.

#### Acceptance Criteria

1. THE Konductor SHALL expose a `mark_committed` MCP tool that accepts a sessionId or userId+repo and marks the corresponding historical session as committed
2. WHEN a session is marked as committed, THE Session History Store SHALL update the session status to `committed` and record the commit timestamp
3. WHEN a session is marked as committed, THE Session History Store SHALL exclude the session from future historical collision checks
4. THE client watcher SHALL detect git commits by monitoring `.git/refs/heads/<current-branch>` for ref changes and SHALL call the `mark_committed` tool or REST endpoint when a commit is detected
5. WHEN the `mark_committed` tool is called for a session that does not exist in the history store, THE Konductor SHALL return a success response with a message indicating no matching session was found

### Requirement 6: Historical Query Tools (Enhanced Chat Phase 2)

**User Story:** As a software engineer, I want to ask Konductor about recent activity and file history, so that I can understand what happened while I was away.

#### Acceptance Criteria

1. THE Konductor SHALL expose a `recent_activity` MCP tool that accepts a repo and time range and returns sessions registered, updated, and deregistered within that range from the Session History Store
2. THE Konductor SHALL expose a `file_history` MCP tool that accepts a file path, repo, and time range and returns all users who had that file in a session during the range, including their branches, session start/end times, and commit status
3. THE Konductor SHALL expose a `collision_timeline` MCP tool that accepts a userId, repo, and time range and returns collision state transitions with timestamps and the users/files that caused each transition
4. THE historical query tools SHALL return results only from the current server lifetime (history is lost on restart in this phase)

### Requirement 7: Session History Serialization

**User Story:** As a server operator, I want session history data to be reliably serializable, so that it can be exported for debugging and migrated to a database in a future phase.

#### Acceptance Criteria

1. THE Session History Store SHALL provide a method to export historical sessions as JSON for backup or migration purposes
2. THE Session History Store SHALL provide a method to import historical sessions from JSON, validating each record before insertion
3. WHEN a historical session is exported to JSON and then imported back, THE Session History Store SHALL produce session records equivalent to the originals (round-trip consistency)

### Requirement 8: User Record Auto-Creation

**User Story:** As a server operator, I want user records to be automatically created when engineers first connect, so that the system builds a user registry without manual provisioning.

#### Acceptance Criteria

1. WHEN a user calls `register_session` and no user record exists for that userId, THE Konductor SHALL create a user record with the userId, first-seen timestamp, and default settings
2. WHEN a user record already exists, THE Konductor SHALL update the last-seen timestamp and the list of repos accessed
3. THE user record SHALL store: userId, first-seen timestamp, last-seen timestamp, repos accessed (with last-access timestamps), and an admin flag (default: false)
4. THE user records SHALL be held in a JavaScript Map and lost on restart (in-memory mode for this phase)
5. THE user record schema SHALL include an `installer_channel` field (default: `null`, meaning use global default) and a `settings` JSON field for future extensibility by the admin dashboard feature

### Requirement 9: Configuration

**User Story:** As a server operator, I want to configure long-term memory settings in the existing `konductor.yaml`, so that all Konductor configuration remains centralized.

#### Acceptance Criteria

1. WHEN `konductor.yaml` includes a `history` section, THE Konductor SHALL read `session_retention_days` (default: 30) and `purge_interval_hours` (default: 6) from that section
2. WHEN no `history` section exists in `konductor.yaml`, THE Konductor SHALL use default values for all history configuration
3. WHEN the `history` section is modified in `konductor.yaml`, THE ConfigManager SHALL hot-reload the updated values and apply them on the next purge cycle

### Requirement 10: Baton Dashboard Integration

**User Story:** As a developer, I want the Baton dashboard to show historical session data, so that I can see who worked on files recently even if they are no longer active.

#### Acceptance Criteria

1. WHEN the Baton repo page loads, THE Baton SHALL display a "Recent Activity" section showing sessions from the Session History Store for the past 24 hours
2. WHEN a historical overlap is detected during session registration, THE Baton notification SHALL include the historical context (user, time since expiry, commit status)
3. THE Baton SHALL expose a REST endpoint `GET /api/repo/:repoName/history` that returns historical sessions for the repository within a configurable time range

### Requirement 11: Documentation

**User Story:** As a server operator, I want long-term memory documented in the README, so that I can configure and understand the storage behavior.

#### Acceptance Criteria

1. WHEN the long-term memory feature is implemented, THE README.md SHALL include a section describing the in-memory storage mode, configuration options, retention behavior, and historical query tools
2. THE README.md SHALL include example `konductor.yaml` with the `history` section
3. THE README.md SHALL note that a durable database backend is planned for a future phase
