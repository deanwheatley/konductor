# Requirements: Long-Term Session Memory

## Introduction

Currently, Konductor only tracks active sessions — once a session is deregistered or times out, it's gone. This means if user Bob starts working on a file, stops for 2 days, and user Shane starts working on the same file, there's no collision detected because Bob's session expired.

This feature adds persistent session history so that Konductor can detect conflicts across time gaps.

## Status: PLANNED (not yet implemented)

## Key Use Cases

### Use Case 1: Stale but uncommitted work

Bob registers a session on `src/index.ts` on Monday. He stops working (session times out after 5 minutes). On Wednesday, Shane starts working on the same file. Konductor should warn Shane that Bob had uncommitted changes on that file.

### Use Case 2: Session retention

Sessions should be retained for a configurable period (e.g. 30 days) even after they expire. After the retention period, they are purged.

### Use Case 3: Committed vs uncommitted

If Bob committed and pushed his changes before his session expired, the conflict is resolved. Only uncommitted/unpushed work should trigger warnings.

## Requirements

### Requirement 1: Session history store

1. THE system SHALL persist a history of all sessions, including their files, branch, timestamps, and status (active, expired, committed)
2. THE system SHALL retain session history for a configurable number of days (`session_retention_days`, default 30)
3. THE system SHALL purge sessions older than the retention period on startup and periodically

### Requirement 2: Historical collision detection

1. WHEN evaluating collision state, THE system SHALL also check expired-but-retained sessions for file overlap
2. WHEN an expired session overlaps with an active session, THE system SHALL report a new state like "stale_overlap" with the historical user's info
3. THE system SHALL distinguish between "active conflict" and "historical overlap" in the collision response

### Requirement 3: Commit tracking

1. THE system SHALL accept a `commit_session` or `mark_committed` call that marks a session's files as committed
2. WHEN a session is marked as committed, THE system SHALL NOT include it in historical collision checks
3. THE client watcher SHOULD detect git commits and automatically mark sessions as committed

## Design Notes

- The history store could be a separate JSON file (`session-history.json`) or an extension of `sessions.json`
- The collision evaluator needs a new input: historical sessions
- A new collision state (`stale_overlap`) or a flag on existing states would indicate historical vs active conflicts
- The client watcher can detect commits by watching `.git/refs/heads/` for changes
