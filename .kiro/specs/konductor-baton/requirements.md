# Requirements Document

## Introduction

The Konductor Baton is a web-based dashboard served by the Konductor MCP Server that provides per-repository visibility into concurrent development activity. Each repository tracked by Konductor gets its own dedicated page at a predictable URL (`/repo/:repoName`). The repo page surfaces real-time collision state, notifications and alerts, user query logs, open pull requests, and repository history. Users receive the URL to their repo page when their client connects to Konductor and can request the URL at any time via IDE chat. A separate admin page is planned for future phases.

## Glossary

- **Konductor Baton**: The web dashboard feature of the Konductor MCP Server that provides per-repository visibility into development activity
- **Repo Page**: A dedicated web page for a single repository, accessible at `/repo/:repoName`
- **Collision State**: A graduated risk level (Solo, Neighbors, Crossroads, Collision Course, Merge Hell) describing overlap between concurrent development sessions
- **Health Status**: A simplified three-level indicator (Healthy, Warning, Alerting) derived from the collision states of all users in a repository
- **Notification**: A timestamped record of a collision state change or coordination event within a repository
- **Query Log**: A record of user-initiated queries (who_is_active, who_overlaps, risk_assessment, etc.) directed at a specific repository
- **Konductor**: The Work Coordination MCP Server that tracks concurrent development activity
- **Session**: A registered work session representing a user actively modifying files in a repository on a specific branch

## Requirements

### Requirement 1

**User Story:** As a developer, I want a dedicated web page for my repository, so that I can see all coordination activity relevant to my repo in one place.

#### Acceptance Criteria

1. WHEN a user navigates to `/repo/:repoName`, THE Baton SHALL render a page displaying the repository summary, notifications, query log, open PRs, and repo history sections for that repository
2. WHEN the Konductor server starts in SSE mode, THE Konductor SHALL serve the Baton web application on the same HTTP port used for MCP transport
3. THE Baton SHALL be a single-page application that requires no additional build steps or dependencies beyond the Konductor server
4. WHEN a user navigates to a repo URL for a repository with no active sessions, THE Baton SHALL display the page with empty sections and a message indicating no active sessions
5. WHEN the browser window is resized, THE Baton SHALL scale all panels and tables to fill the available width using a fluid layout

### Requirement 2

**User Story:** As a developer, I want to see a summary of my repository's health at a glance, so that I can quickly assess whether coordination is needed.

#### Acceptance Criteria

1. WHEN displaying the repo summary, THE Baton SHALL show the repository name and a link to the GitHub repository page
2. WHEN displaying the repo summary, THE Baton SHALL list all branches with active sessions where each branch name links to the corresponding GitHub branch
3. WHEN displaying the repo summary, THE Baton SHALL compute and display a Health Status using the following rubric: Alerting when any user is in Merge Hell or Collision Course, Warning when any user is in Crossroads or Neighbors, and Healthy when no users are active or all users are in Solo
4. WHEN the Health Status is Alerting, THE Baton SHALL display the status panel with a red background and white text
5. WHEN the Health Status is Warning, THE Baton SHALL display the status panel with a yellow background and dark text
6. WHEN the Health Status is Healthy, THE Baton SHALL display the status panel with a green background and white text
7. WHEN displaying the repo summary, THE Baton SHALL list all active users as pill-shaped badges color-coded by recency of their last heartbeat using a configurable 10-level color scale from green (most recent) to black (least recent)
8. THE Baton SHALL read the heartbeat freshness interval and color scale configuration from the Konductor server environment variables (default 10 minutes per level), with the intent to migrate this configuration to a database and admin page in a future phase

### Requirement 3

**User Story:** As a developer, I want to see real-time notifications about collision events in my repository, so that I can respond to coordination needs promptly.

#### Acceptance Criteria

1. WHEN a collision state change occurs in the repository, THE Baton SHALL add a new row to the notifications table within 5 seconds
2. WHEN displaying the notifications table, THE Baton SHALL show columns for Timestamp, Notification Type (Healthy, Warning, Alerting), State (Solo, Neighbors, Crossroads, Collision Course, Merge Hell), Branch (linked to GitHub), JIRAs (ticket identifiers if known, "unknown" otherwise), Summary, Users (linked to GitHub profiles), and a Resolve button
3. WHEN displaying the Users column, THE Baton SHALL show each user name as a link to the user's GitHub profile
4. WHEN a notification summary exceeds a readable length, THE Baton SHALL truncate the text and provide a "see more" control that expands to show the full summary
5. WHEN a user clicks the Resolve button and confirms the action, THE Baton SHALL mark the notification as resolved and move the notification to a separate resolved history view
6. THE Baton SHALL allow the user to sort the notifications table by any column
7. THE Baton SHALL allow the user to filter the notifications table by Notification Type, State, and Users

### Requirement 4

**User Story:** As a developer, I want to see a log of user queries directed at my repository, so that I can understand what questions people are asking about coordination.

#### Acceptance Criteria

1. WHEN a user query tool (who_is_active, who_overlaps, risk_assessment, repo_hotspots, active_branches, coordination_advice) is invoked for the repository, THE Baton SHALL add a new row to the query log table
2. WHEN displaying the query log table, THE Baton SHALL show columns for Timestamp, User (linked to GitHub profile), Branch (linked to GitHub), Query Type, and Parameters
3. THE Baton SHALL allow the user to sort the query log table by any column
4. THE Baton SHALL allow the user to filter the query log table by User and Query Type

### Requirement 5

**User Story:** As a developer, I want to see open pull requests for my repository, so that I can understand what code is pending review alongside active development.

#### Acceptance Criteria

1. WHEN the GitHub integration is not configured, THE Baton SHALL display a placeholder message reading "GitHub Integration Coming Soon" in the Open PRs section
2. WHEN the GitHub integration is configured, THE Baton SHALL display a table with columns for Hours Open, Branch (linked to GitHub), PR Number (linked to GitHub), and User (linked to GitHub profile)

### Requirement 10

**User Story:** As a developer, I want to see a history of git activity (commits, PRs, merges) for my repository, so that I can understand the pace and nature of recent changes.

#### Acceptance Criteria

1. WHEN the GitHub integration is not configured, THE Baton SHALL display a placeholder message reading "GitHub Integration Coming Soon" in the Repo History section
2. WHEN the GitHub integration is configured, THE Baton SHALL display a sortable and filterable table with columns for Timestamp, Action (Commit, PR, Merge), User (linked to GitHub profile), and Summary
3. THE Baton SHALL allow the user to sort the repo history table by any column
4. THE Baton SHALL allow the user to filter the repo history table by Action and User

### Requirement 11

**User Story:** As a developer, I want to collapse and expand dashboard sections, so that I can focus on the information most relevant to me.

#### Acceptance Criteria

1. THE Baton SHALL allow the user to collapse each section (Notifications, Query Log, Open PRs, Repo History) into a single header bar by clicking the section header
2. WHEN a section is collapsed, THE Baton SHALL display the section name and a summary count badge in the header bar
3. WHEN a user clicks a collapsed section header, THE Baton SHALL expand the section to show its full content
4. THE Baton SHALL keep the Repository Summary section always expanded and not collapsible

### Requirement 6

**User Story:** As a developer, I want to receive the URL to my repo page when my client connects, so that I can access the dashboard without searching for the URL.

#### Acceptance Criteria

1. WHEN a client registers a session via the register_session MCP tool, THE Konductor SHALL include the repo page URL in the response payload
2. WHEN a user asks Konductor for the repo page URL via IDE chat, THE Konductor client steering rule SHALL provide the URL from the most recent registration response
3. THE repo page URL SHALL follow the pattern `http://<host>:<port>/repo/<repoName>` where host, port, and repoName are derived from the server configuration and session registration

### Requirement 7

**User Story:** As a developer, I want the Baton to update in real time, so that I see the latest coordination state without refreshing the page.

#### Acceptance Criteria

1. WHEN the Baton page loads, THE Baton SHALL establish an SSE connection to the Konductor server for real-time event streaming
2. WHEN a session is registered, updated, or deregistered in the repository, THE Baton SHALL reflect the change in the repo summary and notifications table within 5 seconds
3. WHEN the SSE connection is lost, THE Baton SHALL display a visible disconnection indicator and attempt to reconnect automatically

### Requirement 8

**User Story:** As a developer, I want the Baton dashboard to be documented in the README, so that team members can find and use the dashboard.

#### Acceptance Criteria

1. WHEN the Baton feature is implemented, THE README.md SHALL include a section describing how to access the repo page, what information the repo page displays, and the URL pattern for repo pages

### Requirement 9

**User Story:** As a developer, I want the Baton to serialize notification data to JSON and deserialize notification data from JSON, so that notifications can be persisted and restored across server restarts.

#### Acceptance Criteria

1. THE Baton SHALL serialize each notification record to JSON for persistence
2. THE Baton SHALL deserialize JSON notification records back into notification objects
3. WHEN a notification is serialized to JSON and then deserialized, THE Baton SHALL produce a notification object equivalent to the original
4. THE Baton SHALL provide a pretty-printer that formats notification records as human-readable text
5. WHEN a notification is pretty-printed and then parsed, THE Baton SHALL produce a notification object equivalent to the original
