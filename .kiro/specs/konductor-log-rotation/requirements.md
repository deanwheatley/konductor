# Requirements: Log Rotation

## Introduction

The Konductor server and client watcher write log files that can grow unbounded. This feature adds configurable log rotation to prevent disk space issues.

## Requirements

### Requirement 1: Log file size limit

**User Story:** As a server operator, I want log files to be automatically rotated when they reach a configurable size, so that disk space is managed without manual intervention.

#### Acceptance Criteria

1. WHEN `KONDUCTOR_LOG_MAX_SIZE` is set (e.g. `10MB`), THE system SHALL rotate the log file when it reaches that size
2. WHEN the log file reaches the size limit, THE system SHALL rename the current log to `<name>.backup` and start a fresh log
3. WHEN the backup file already exists and a new rotation occurs, THE system SHALL rename the existing backup to `<name>.tobedeleted` and the current log to `<name>.backup`
4. WHEN `<name>.tobedeleted` already exists, THE system SHALL delete it before writing the new one
5. THE default max size SHALL be `10MB` if not configured
6. THE system SHALL check the file size before each write, not on a timer
