# Requirements Document

## Introduction

The Konductor Verbose Logging feature adds structured, human-readable activity logging to the Konductor MCP Server. When enabled via environment variables, the server outputs a rolling log of all significant events to the terminal (stderr), giving operators real-time visibility into connections, session activity, collision state changes, configuration reloads, and server lifecycle events. The logging system is designed to be non-intrusive — disabled by default, and when enabled, it writes to stderr so it does not interfere with stdio MCP transport.

## Glossary

- **Konductor**: The Work Coordination MCP Server that tracks concurrent development activity and evaluates collision risk across repositories
- **Verbose Logging**: A mode where the Konductor outputs detailed structured log entries for all significant events
- **Log Entry**: A single structured line of output containing a timestamp, category, actor, and message
- **Log Category**: A classification of the event type (CONN, SESSION, COLLISION, CONFIG, SERVER, QUERY)
- **Actor**: The user or system component that triggered the event
- **Terminal Logging**: Writing log entries to stderr for display in the operator's terminal

## Requirements

### Requirement 1

**User Story:** As a server operator, I want to enable verbose logging via environment variables, so that I can control logging behavior without changing code or config files.

#### Acceptance Criteria

1. WHEN the `VERBOSE_LOGGING` environment variable is set to `true`, THE Konductor SHALL enable verbose logging and output all log categories
2. WHEN the `VERBOSE_LOGGING` environment variable is absent or set to `false`, THE Konductor SHALL suppress all verbose log output
3. WHEN the `LOG_TO_TERMINAL` environment variable is set to `true`, THE Konductor SHALL write log entries to stderr
4. WHEN the Konductor is running in stdio transport mode, THE Konductor SHALL write log entries exclusively to stderr to avoid corrupting the MCP protocol stream on stdout
5. WHEN the `LOG_TO_FILE` environment variable is set to `true`, THE Konductor SHALL append log entries to the file specified by the `LOG_FILENAME` environment variable
6. WHEN the `LOG_TO_FILE` environment variable is set to `true` and `LOG_FILENAME` is absent, THE Konductor SHALL default the log filename to `konductor.log`

### Requirement 2

**User Story:** As a server operator, I want each log entry to follow a consistent structured format, so that I can quickly scan and parse the rolling log output.

#### Acceptance Criteria

1. THE Konductor SHALL format each log entry as `[TIMESTAMP] [CATEGORY] [ACTOR] message`
2. THE Konductor SHALL format timestamps in ISO 8601 local time with second precision (e.g. `2026-04-10 14:32:01`)
3. THE Konductor SHALL use one of the following log categories: CONN, SESSION, COLLISION, CONFIG, SERVER, QUERY
4. THE Konductor SHALL identify the actor as either `User: <userId>` for user-initiated events or `System` for server-initiated events
5. WHEN a log entry is formatted and then parsed, THE Konductor SHALL produce a log object with equivalent timestamp, category, actor, and message fields (round-trip consistency)

### Requirement 3

**User Story:** As a server operator, I want to see connection events in the log, so that I can monitor who is connecting to and disconnecting from the server.

#### Acceptance Criteria

1. WHEN an SSE client connects, THE Konductor SHALL log a CONN entry containing the client IP address and hostname (if resolvable)
2. WHEN an SSE client authenticates with a valid API key, THE Konductor SHALL log a CONN entry confirming authentication
3. WHEN an SSE client disconnects, THE Konductor SHALL log a CONN entry indicating the disconnection
4. WHEN an SSE client provides an invalid or missing API key, THE Konductor SHALL log a CONN entry with the rejection reason and client IP address

### Requirement 4

**User Story:** As a server operator, I want to see session lifecycle events in the log, so that I can track which users are registering, updating, and ending work sessions.

#### Acceptance Criteria

1. WHEN a user registers a new work session, THE Konductor SHALL log a SESSION entry containing the user ID, session ID, repository, and branch
2. WHEN a user registers a session, THE Konductor SHALL log a SESSION entry listing the file paths included in the session
3. WHEN a user updates a session's file list, THE Konductor SHALL log a SESSION entry containing the session ID and the new file list
4. WHEN a user deregisters a session, THE Konductor SHALL log a SESSION entry containing the user ID and session ID
5. WHEN the system cleans up stale sessions, THE Konductor SHALL log a SESSION entry containing the count of removed sessions and the configured timeout value

### Requirement 5

**User Story:** As a server operator, I want to see collision state changes in the log, so that I can monitor overlap risk across the team in real time.

#### Acceptance Criteria

1. WHEN a collision state is evaluated for a user, THE Konductor SHALL log a COLLISION entry containing the user ID, repository, and resulting collision state name
2. WHEN the collision state is Neighbors or higher, THE Konductor SHALL include the overlapping user IDs in the COLLISION log entry
3. WHEN the collision state is Collision Course or Merge Hell, THE Konductor SHALL include the shared file paths and branch names in the COLLISION log entry
4. WHEN a collision state triggers a configured action (warn or block), THE Konductor SHALL log a COLLISION entry indicating the action type and affected users

### Requirement 6

**User Story:** As a server operator, I want to see configuration events in the log, so that I can confirm config loads and catch reload errors.

#### Acceptance Criteria

1. WHEN the Konductor loads a configuration file on startup, THE Konductor SHALL log a CONFIG entry containing the file path and key config values (timeout)
2. WHEN the Konductor hot-reloads a configuration file, THE Konductor SHALL log a CONFIG entry describing the changed values
3. WHEN a configuration file fails to parse, THE Konductor SHALL log a CONFIG entry containing the error reason and confirm that the previous config is retained

### Requirement 7

**User Story:** As a server operator, I want to see server lifecycle events in the log, so that I can confirm startup, transport mode, and session restoration.

#### Acceptance Criteria

1. WHEN the Konductor starts, THE Konductor SHALL log a SERVER entry containing the transport mode (stdio or SSE), port (if SSE), and whether verbose logging is enabled
2. WHEN the Konductor restores sessions from persistent storage on startup, THE Konductor SHALL log a SERVER entry containing the count of restored sessions
3. WHEN a health check request is received, THE Konductor SHALL log a SERVER entry containing the requester's IP address

### Requirement 8

**User Story:** As a server operator, I want to see query events in the log, so that I can track status checks and session listing requests.

#### Acceptance Criteria

1. WHEN a user invokes the check_status tool, THE Konductor SHALL log a QUERY entry containing the user ID, repository, and resulting collision state
2. WHEN a user invokes the list_sessions tool, THE Konductor SHALL log a QUERY entry containing the repository and the count of active sessions returned
