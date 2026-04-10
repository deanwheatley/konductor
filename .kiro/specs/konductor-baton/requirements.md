# Requirements Document

## Introduction

Phase 4 of the Konductor project introduces the Konductor Baton — a localhost web dashboard that visualizes real-time work coordination data from the Konductor MCP Server. The Baton provides a team-wide view of active development sessions, collision states, and file-level conflict indicators across all tracked repositories. The dashboard is served by the Konductor process itself and accessed via a web browser.

## Glossary

- **Konductor Baton**: A localhost web dashboard that visualizes Konductor session and collision data in real-time
- **Konductor**: The Work Coordination MCP Server (Phase 1) that tracks concurrent development activity
- **Collision State**: A graduated risk level (Solo, Neighbors, Crossroads, Collision Course, Merge Hell) describing overlap between concurrent development activities
- **Conflict Indicator**: A visual marker on the dashboard showing the severity of collision risk for a specific file or directory
- **Session Card**: A UI element displaying a single user's active work session with repository, branch, and file details

## Requirements

### Requirement 1

**User Story:** As a team lead, I want to view a real-time dashboard of all active work sessions, so that I can see at a glance who is working on what across our repositories.

#### Acceptance Criteria

1. WHEN a user navigates to the Baton URL in a browser, THE Baton SHALL display a list of all active work sessions grouped by repository
2. WHEN a new work session is registered with the Konductor, THE Baton SHALL update the display within 5 seconds to include the new session
3. WHEN a work session is deregistered or becomes stale, THE Baton SHALL remove the session from the display within 5 seconds
4. WHEN displaying a work session, THE Baton SHALL show the user name, repository, branch, file list, session duration, and current collision state

### Requirement 2

**User Story:** As a software engineer, I want to see a visual indicator of collision severity for each file, so that I can quickly identify which files are at risk of merge conflicts.

#### Acceptance Criteria

1. WHEN displaying files within a session, THE Baton SHALL color-code each file based on the collision state affecting that file (green for Solo, yellow for Crossroads, orange for Collision Course, red for Merge Hell)
2. WHEN a file is involved in a collision with another user's session, THE Baton SHALL display the name of the other user next to the file
3. WHEN hovering over a conflict indicator, THE Baton SHALL display a tooltip with the full collision details (users, branches, and collision state)

### Requirement 3

**User Story:** As a team lead, I want to see a repository-level summary of collision risk, so that I can identify which repositories have the most coordination challenges.

#### Acceptance Criteria

1. WHEN displaying the repository list, THE Baton SHALL show the highest collision state across all sessions in each repository
2. WHEN displaying the repository list, THE Baton SHALL show the count of active sessions and unique users per repository
3. WHEN a repository has sessions at "Collision Course" or higher, THE Baton SHALL visually highlight that repository in the list

### Requirement 4

**User Story:** As a software engineer, I want the Baton to be accessible without additional setup, so that I can start using the dashboard immediately after the Konductor is running.

#### Acceptance Criteria

1. WHEN the Konductor starts in SSE mode, THE Konductor SHALL serve the Baton web application on the same port at the root path
2. THE Baton SHALL be a single-page application that requires no additional build steps or dependencies beyond the Konductor server
3. WHEN the Baton loads, THE Baton SHALL connect to the Konductor via SSE for real-time session updates

### Requirement 5

**User Story:** As a team lead, I want the Baton dashboard to be documented in the README, so that team members can find and use the dashboard.

#### Acceptance Criteria

1. WHEN the Baton feature is implemented, THE README.md SHALL include a section describing how to access the dashboard, what information the dashboard displays, and a screenshot or description of the interface
