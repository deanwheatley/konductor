# Requirements Document

## Introduction

The Konductor Log Viewer is a dedicated admin page accessible from the System Settings panel of the admin dashboard. It provides a real-time, sortable, and filterable view of the Konductor server logs. The page reads the structured log file (`konductor.log`) and presents entries in a table format, allowing administrators to filter by category (CONN, SESSION, STATUS, CONFIG, SERVER, QUERY, GITHUB), actor (specific users, SYSTEM, or Transport IDs), and message content. The page also supports live-tailing via SSE so new log entries appear without manual refresh.

## Glossary

- **Log Viewer**: A dedicated HTML page that displays structured log entries from the Konductor server log file in a sortable, filterable table.
- **Log Entry**: A single structured line from the log file in the format `[TIMESTAMP] [CATEGORY] [ACTOR] message`.
- **Category**: The classification of a log entry — one of CONN, SESSION, STATUS, CONFIG, SERVER, QUERY, or GITHUB.
- **Actor**: The entity that generated the log entry — either "SYSTEM", "User: <userId>", or "Transport: <sessionId>".
- **Admin Dashboard**: The existing authenticated admin interface at `/admin`.
- **System Settings Panel**: The collapsible panel within the admin dashboard that displays server configuration.
- **Log API**: The HTTP endpoint that serves parsed log entries as JSON for the Log Viewer page.
- **Log Parser**: The module that reads the log file and converts raw text lines into structured LogEntry objects.
- **Log Printer**: The module that converts structured LogEntry objects back into the canonical log line format for display or export.

## Requirements

### Requirement 1

**User Story:** As an administrator, I want to access the log viewer from the admin dashboard, so that I can quickly navigate to server logs without remembering a separate URL.

#### Acceptance Criteria

1. WHEN an authenticated admin loads the admin dashboard THEN the System Settings panel SHALL display a "View Logs" button that links to the log viewer page.
2. WHEN an admin clicks the "View Logs" button THEN the Log Viewer SHALL open as a dedicated page at the `/admin/logs` URL path.
3. WHEN an unauthenticated user navigates to `/admin/logs` THEN the Log Viewer SHALL redirect the user to the login page.

### Requirement 2

**User Story:** As an administrator, I want to view log entries in a structured table, so that I can quickly scan server activity.

#### Acceptance Criteria

1. WHEN the Log Viewer page loads THEN the Log Viewer SHALL display log entries in a table with columns for Timestamp, Category, Actor, and Message.
2. WHEN the log file contains entries THEN the Log Viewer SHALL display the most recent 500 entries by default, ordered newest-first.
3. WHEN the log file is empty or missing THEN the Log Viewer SHALL display an empty state message indicating no log entries are available.

### Requirement 3

**User Story:** As an administrator, I want to filter log entries by category, so that I can focus on specific types of server activity.

#### Acceptance Criteria

1. WHEN an admin selects one or more categories from the category filter THEN the Log Viewer SHALL display only entries matching the selected categories.
2. WHEN no category filter is selected THEN the Log Viewer SHALL display entries from all categories.
3. WHEN a category filter is applied THEN the Log Viewer SHALL update the displayed count to reflect the number of visible entries.

### Requirement 4

**User Story:** As an administrator, I want to filter log entries by actor, so that I can trace activity for a specific user or system component.

#### Acceptance Criteria

1. WHEN an admin types a username or actor identifier into the actor filter THEN the Log Viewer SHALL display only entries where the actor field contains the filter text (case-insensitive).
2. WHEN the actor filter is cleared THEN the Log Viewer SHALL display entries from all actors.

### Requirement 5

**User Story:** As an administrator, I want to search log messages by keyword, so that I can find specific events or errors.

#### Acceptance Criteria

1. WHEN an admin types text into the message search field THEN the Log Viewer SHALL display only entries where the message field contains the search text (case-insensitive).
2. WHEN the message search field is cleared THEN the Log Viewer SHALL display all entries (subject to other active filters).

### Requirement 6

**User Story:** As an administrator, I want to sort log entries by any column, so that I can organize the data in a way that helps my investigation.

#### Acceptance Criteria

1. WHEN an admin clicks a column header THEN the Log Viewer SHALL sort entries by that column in ascending order.
2. WHEN an admin clicks the same column header again THEN the Log Viewer SHALL reverse the sort direction to descending order.
3. WHEN sorting is applied THEN the Log Viewer SHALL maintain all active filters while reordering the displayed entries.

### Requirement 7

**User Story:** As an administrator, I want log entries to appear in real-time, so that I can monitor live server activity without refreshing the page.

#### Acceptance Criteria

1. WHEN the Log Viewer page is open and a new log entry is written THEN the Log Viewer SHALL append the new entry to the display within 2 seconds.
2. WHEN live updates are received THEN the Log Viewer SHALL apply all active filters and sort order to newly received entries.
3. WHEN the SSE connection is lost THEN the Log Viewer SHALL display a disconnected indicator and attempt reconnection with exponential backoff.

### Requirement 8

**User Story:** As an administrator, I want the log viewer to parse and display log entries correctly, so that I can trust the data shown matches the raw log file.

#### Acceptance Criteria

1. WHEN the Log Parser reads a well-formed log line THEN the Log Parser SHALL produce a LogEntry object with timestamp, category, actor, and message fields that match the original line.
2. WHEN the Log Printer formats a LogEntry object THEN the Log Printer SHALL produce a string identical to the original log line format `[TIMESTAMP] [CATEGORY] [ACTOR] message`.
3. WHEN the Log Parser reads a line and the Log Printer formats the resulting LogEntry THEN the round-trip output SHALL be identical to the original input line.
4. WHEN the Log Parser encounters a malformed line THEN the Log Parser SHALL skip the line and continue processing subsequent entries.

### Requirement 9

**User Story:** As an administrator, I want combined filters to work together, so that I can narrow down to exactly the log entries I need.

#### Acceptance Criteria

1. WHEN multiple filters are active simultaneously (category, actor, message) THEN the Log Viewer SHALL display only entries that satisfy all active filter conditions (AND logic).
2. WHEN all filters are cleared THEN the Log Viewer SHALL display the full set of loaded entries.
