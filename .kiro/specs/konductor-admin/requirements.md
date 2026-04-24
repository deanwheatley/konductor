# Requirements Document

## Introduction

The Konductor Admin Dashboard is a web-based administration interface served by the Konductor MCP Server alongside the existing Baton repo pages. The admin page provides system configuration, global client settings, user management, client install command display, and multi-version installer channel management. Admin access is determined by a combination of the `KONDUCTOR_ADMINS` environment variable (which takes precedence) and the `admin` flag in the user record. The admin dashboard shares the same storage backend (SQLite or in-memory) established by the `konductor-long-term-memory` feature and follows the same visual design language as the Baton repo pages. Browser-based access uses cookie-based session authentication with a login form.

## Dependencies

- `konductor-long-term-memory` — provides the dual storage backend (SQLite/in-memory), user record auto-creation, and the `ISessionHistoryStore` interface
- `konductor-baton` — provides the visual design language, collapsible panel pattern, and SSE real-time update infrastructure
- `konductor-npx-installer` — provides the installer tarball build and serving mechanism that this feature extends to support multiple channels

## Glossary

- **Konductor**: The Work Coordination MCP Server that tracks concurrent development activity and evaluates collision risk across repositories
- **Admin Dashboard**: A web page served at `/admin` that provides system configuration, user management, installer channel management, and client install commands
- **Admin User**: A user who is listed in the `KONDUCTOR_ADMINS` environment variable or whose user record has the `admin` flag set to `true`, granting access to the admin dashboard
- **KONDUCTOR_ADMINS**: A comma-separated environment variable listing userIds and/or email addresses of users who are always treated as admin, regardless of the database `admin` flag
- **Installer Channel**: One of three release tracks (Dev, UAT, Prod) that determines which version of the client installer a user receives
- **Channel Promotion**: The act of copying an installer tarball from one channel to the next (Dev → UAT → Prod)
- **Channel Rollback**: The act of reverting a channel's installer tarball to the previous version from that channel's history
- **Global Default Channel**: The installer channel assigned to users who do not have a per-user override (configurable by admin, default: Prod)
- **User Record**: A row in the users table containing identity, preferences, installer channel assignment, and administrative flags
- **Baton**: The existing web dashboard feature that provides per-repository visibility into development activity
- **Pill Badge**: A rounded, color-coded inline label used to display status information (reused from Baton design)
- **Freshness Color Scale**: A configurable color gradient from green (most recent) to black (least recent) used for time-based pill badges
- **KONDUCTOR_EXTERNAL_URL**: An environment variable containing the externally reachable URL of the Konductor server (e.g. `https://konductor.example.com`); when set, the server operates in cloud mode
- **Cloud Mode**: The server is accessible via an external URL; determined by the presence of `KONDUCTOR_EXTERNAL_URL`
- **Local Mode**: The server is running on localhost; the default when `KONDUCTOR_EXTERNAL_URL` is not set. The server determines its local URL from its configured port and detects the machine's network-accessible IP for the remote install command
- **JIRA Ticket Identifier**: A project key and issue number (e.g. `PROJ-123`) extracted from the branch name of a user's session using the pattern `<prefix>/<TICKET>-<description>`
- **Session Cookie**: An httpOnly cookie set after successful login that authenticates browser requests to the admin dashboard

## Requirements

### Requirement 1: Admin Page Access Control

**User Story:** As a server operator, I want only admin users to access the admin dashboard, so that sensitive configuration and user management are restricted to authorized personnel.

#### Acceptance Criteria

1. WHEN a user navigates to `/admin`, THE Konductor SHALL check whether the requesting user is an admin by evaluating the `KONDUCTOR_ADMINS` environment variable first, then the user record's `admin` flag
2. WHEN the requesting user's userId or email matches an entry in `KONDUCTOR_ADMINS`, THE Konductor SHALL treat the user as admin regardless of the database `admin` flag
3. WHEN the requesting user has `admin: true` in the user record, THE Konductor SHALL serve the admin dashboard page
4. WHEN the requesting user is not listed in `KONDUCTOR_ADMINS` and has `admin: false` or no user record exists, THE Konductor SHALL return a 403 Forbidden response with a message indicating admin access is required
5. WHEN `KONDUCTOR_ADMINS` is not set and the first user record is created in an empty system, THE Konductor SHALL set the `admin` flag to `true` for that user (bootstrap admin)
6. THE `KONDUCTOR_ADMINS` environment variable SHALL accept a comma-separated list of userIds and email addresses, with whitespace trimmed from each entry

### Requirement 2: Browser Authentication

**User Story:** As an admin, I want to access the admin dashboard from a web browser, so that I can manage Konductor without needing to send custom HTTP headers.

#### Acceptance Criteria

1. WHEN a user navigates to `/admin` without a valid session cookie or Authorization header, THE Konductor SHALL redirect the user to a `/login` page
2. WHEN a user submits valid credentials (userId and API key) on the login page, THE Konductor SHALL set an httpOnly session cookie and redirect the user to `/admin`
3. WHEN a user submits invalid credentials on the login page, THE Konductor SHALL display an error message and remain on the login page
4. THE Konductor SHALL accept authentication via session cookie (browser) or via `Authorization` header combined with `X-Konductor-User` header (programmatic access)
5. WHEN a session cookie expires or is invalidated, THE Konductor SHALL redirect the user to the login page on the next request
### Requirement 3: System Settings Panel

**User Story:** As an admin, I want to view and modify system settings from the dashboard, so that I can tune Konductor behavior without editing config files or environment variables.

#### Acceptance Criteria

1. WHEN the admin dashboard loads, THE System Settings panel SHALL display current values for: heartbeat timeout, session retention days, purge interval hours, verbose logging status, log level, and storage mode
2. WHEN an admin modifies a system setting and clicks Save, THE Konductor SHALL persist the updated value and apply the change without requiring a server restart
3. WHEN a system setting is modified, THE Konductor SHALL log a CONFIG entry describing the change
4. THE System Settings panel SHALL display settings that originate from environment variables as read-only with a label indicating the source
5. THE System Settings panel SHALL be collapsible and expandable, matching the Baton panel design

### Requirement 4: Global Client Settings Panel

**User Story:** As an admin, I want to manage installer channels and global client settings, so that I can control which version of the client installer users receive.

#### Acceptance Criteria

1. WHEN the admin dashboard loads, THE Global Client Settings panel SHALL display the current installer version for each channel (Dev, UAT, Prod) and the global default channel
2. THE Global Client Settings panel SHALL include a combo box that allows the admin to set the global default channel to one of: Dev, UAT, or Prod
3. WHEN the admin selects a new global default channel and clicks Save, THE Konductor SHALL update the global default and serve that channel's installer to users without a per-user override
4. THE Global Client Settings panel SHALL display a "Promote" button between adjacent channels: "Promote Dev → UAT" and "Promote UAT → Prod"
5. WHEN the admin clicks a Promote button and confirms the action, THE Konductor SHALL copy the source channel's installer tarball to the destination channel, update the version metadata, and retain the previous tarball as a rollback point
6. WHEN a promotion completes, THE Konductor SHALL log a SERVER entry describing the promotion (source channel, destination channel, version)
7. THE Global Client Settings panel SHALL display a "Rollback" button for each channel that has a previous version available
8. WHEN the admin clicks a Rollback button and confirms the action, THE Konductor SHALL revert the channel's installer tarball to the previous version and update the version metadata
9. THE Global Client Settings panel SHALL be collapsible and expandable, matching the Baton panel design
10. THE Global Client Settings panel SHALL display the stale activity threshold setting (number of days after which user repo activity is hidden from the user table)

### Requirement 5: Client Install Commands Panel

**User Story:** As an admin, I want the dashboard to display the exact install commands users need to run, so that onboarding new team members is quick and error-free.

#### Acceptance Criteria

1. WHEN the admin dashboard loads, THE Client Install Commands panel SHALL display a channel selector (Dev, UAT, Prod) and the corresponding fully self-contained install command(s) for the selected channel
2. WHEN the admin selects a channel, THE panel SHALL update the displayed install command(s) to use the tarball URL for that channel (e.g. `/bundle/installer-dev.tgz` for Dev)
3. WHEN `KONDUCTOR_EXTERNAL_URL` is set (cloud mode), THE panel SHALL display a single install command using the external URL for the selected channel
4. WHEN `KONDUCTOR_EXTERNAL_URL` is not set (local mode), THE panel SHALL display two install commands for the selected channel: one labeled "Local" using the localhost URL and one labeled "Remote" using the machine's network-accessible IP or hostname
5. EACH displayed install command SHALL include a copy button that copies the full command text to the clipboard
6. THE install commands SHALL use the placeholder `YOUR_API_KEY` for the API key parameter instead of pre-filling any user's actual key
7. EACH install command SHALL follow the format: `npx <serverUrl>/bundle/installer-<channel>.tgz --server <serverUrl> --api-key YOUR_API_KEY`
8. THE channel selector SHALL default to the current global default channel
9. THE Client Install Commands panel SHALL be collapsible and expandable, matching the Baton panel design
### Requirement 6: Multi-Channel Installer Serving

**User Story:** As a software engineer, I want to receive the installer version assigned to my channel, so that I get the appropriate release for my role (dev, tester, or production user).

#### Acceptance Criteria

1. WHEN a user requests the installer tarball, THE Konductor SHALL determine the user's effective channel by checking: per-user override first, then global default
2. WHEN the user's effective channel is Dev, THE Konductor SHALL serve the Dev channel tarball from `/bundle/installer-dev.tgz`
3. WHEN the user's effective channel is UAT, THE Konductor SHALL serve the UAT channel tarball from `/bundle/installer-uat.tgz`
4. WHEN the user's effective channel is Prod, THE Konductor SHALL serve the Prod channel tarball from `/bundle/installer-prod.tgz`
5. WHEN the auto-update check in `register_session` detects an outdated client, THE response SHALL include the update URL for the user's effective channel
6. THE existing `/bundle/installer.tgz` endpoint SHALL continue to serve the Prod channel tarball for backward compatibility
7. WHEN a channel has no tarball assigned (e.g. UAT before first promotion), THE Konductor SHALL return a 404 response with a message indicating the channel has no installer available

### Requirement 7: User Management Table

**User Story:** As an admin, I want to view and manage all Konductor users from the dashboard, so that I can monitor activity, assign installer channels, and grant admin access.

#### Acceptance Criteria

1. WHEN the admin dashboard loads, THE User Management panel SHALL display a sortable and filterable table of all user records
2. THE user table SHALL include the following columns: Username (linked to GitHub profile when available), Repos Accessed (color-coded pill badges by last-access recency), Last Seen (color-coded pill badge by recency), Last Activity Summary (color-coded pill badge with JIRA ticket if available), Installer Channel Override (Dev/UAT/Prod dropdown or "Default"), and Admin (toggle)
3. WHEN displaying the Repos Accessed column, THE Konductor SHALL show each repo as a pill badge color-coded using the freshness color scale based on the last-access timestamp for that repo
4. WHEN a repo's last-access timestamp exceeds the stale activity threshold (configurable in System Settings), THE user table SHALL NOT display that repo in the Repos Accessed column
5. WHEN displaying the Last Seen column, THE Konductor SHALL show a pill badge color-coded using the freshness color scale based on the user's last-seen timestamp
6. WHEN displaying the Last Activity Summary column, THE Konductor SHALL show a pill badge containing a brief description of the user's most recent session (repo, branch, file count) and JIRA ticket identifier if available, color-coded by recency
7. THE JIRA ticket identifier SHALL be extracted from the session's branch name using the pattern `<prefix>/<TICKET>-<description>` where `<TICKET>` matches a project key followed by a hyphen and a number (e.g. `PROJ-123`)
8. WHEN an admin changes a user's Installer Channel Override, THE Konductor SHALL update the user record and the user SHALL receive the new channel's installer on their next auto-update check
9. WHEN an admin toggles a user's Admin flag, THE Konductor SHALL update the user record immediately
10. WHEN a user is listed in `KONDUCTOR_ADMINS`, THE admin toggle for that user SHALL be displayed as read-only with a label indicating the admin status is set by environment variable
11. THE User Management panel SHALL be collapsible and expandable, matching the Baton panel design
12. THE user table SHALL support sorting by any column and filtering by Username, Installer Channel, and Admin status
### Requirement 8: Freshness Color Scale Configuration

**User Story:** As an admin, I want to configure the color scale used for time-based pill badges, so that the visual indicators match our team's activity patterns.

#### Acceptance Criteria

1. THE Konductor SHALL use a configurable freshness color scale for all time-based pill badges (repos accessed, last seen, last activity)
2. THE freshness color scale SHALL default to a 10-level gradient from green (most recent) to black (least recent), matching the Baton repo page user badges
3. WHEN the admin modifies the freshness interval (minutes per color level) in System Settings, THE Konductor SHALL apply the new interval to all pill badge rendering
4. THE freshness color scale configuration SHALL be stored in the settings table and hot-reloadable

### Requirement 9: Installer Channel Storage

**User Story:** As a server operator, I want installer channel data persisted reliably, so that channel assignments and tarball metadata survive server restarts.

#### Acceptance Criteria

1. WHEN using SQLite storage, THE Konductor SHALL store installer channel metadata (channel name, version, upload timestamp, tarball hash) in an `installer_channels` table
2. WHEN using SQLite storage, THE Konductor SHALL store installer tarballs as files on disk in a configurable directory (default: `installers/` in the working directory), with the database storing the file path and metadata
3. WHEN using in-memory storage, THE Konductor SHALL hold installer channel metadata and tarballs in memory (lost on restart)
4. WHEN a channel tarball is promoted and then read back, THE Konductor SHALL serve a tarball identical to the one that was promoted (round-trip consistency)
5. WHEN the Konductor starts with SQLite storage, THE Konductor SHALL verify that all referenced tarball files exist on disk and log a warning for any missing files
6. WHEN a promotion occurs, THE Konductor SHALL retain the previous tarball for the destination channel to support rollback
7. WHEN a rollback is performed and the restored tarball is read back, THE Konductor SHALL serve a tarball identical to the previous version (round-trip consistency)

### Requirement 10: Admin Dashboard Real-Time Updates

**User Story:** As an admin, I want the admin dashboard to update in real time, so that I see user activity and setting changes without refreshing the page.

#### Acceptance Criteria

1. WHEN the admin dashboard loads, THE page SHALL establish an SSE connection to the Konductor server for real-time event streaming
2. WHEN a user record is created or updated (new session, channel change, admin toggle), THE admin dashboard SHALL reflect the change in the user table within 5 seconds
3. WHEN a system setting or global client setting is changed, THE admin dashboard SHALL reflect the change in the corresponding panel within 5 seconds
4. WHEN the SSE connection is lost, THE admin dashboard SHALL display a visible disconnection indicator and attempt to reconnect automatically

### Requirement 11: Settings Storage

**User Story:** As a server operator, I want admin-configured settings persisted reliably, so that system and client settings survive server restarts.

#### Acceptance Criteria

1. WHEN using SQLite storage, THE Konductor SHALL store admin-configured settings in a `settings` table with key-value pairs and a category column
2. WHEN a setting is written to the database and then read back, THE Konductor SHALL produce a value equivalent to the original (round-trip consistency)
3. WHEN using in-memory storage, THE settings SHALL be held in a JavaScript Map and lost on restart
4. WHEN the Konductor starts, THE settings from the database SHALL be merged with environment variables, with environment variables taking precedence for overlapping keys

### Requirement 12: Settings Serialization

**User Story:** As a server operator, I want settings to be serialized and deserialized correctly, so that configuration values are not corrupted during storage and retrieval.

#### Acceptance Criteria

1. WHEN a setting value is stored, THE Konductor SHALL serialize the value to a string representation using JSON encoding
2. WHEN a setting value is retrieved, THE Konductor SHALL deserialize the string representation back to the original type using JSON decoding
3. WHEN a setting value is serialized and then deserialized, THE Konductor SHALL produce a value equivalent to the original (round-trip consistency)

### Requirement 13: Documentation

**User Story:** As a server operator, I want the admin dashboard documented in the README, so that team members can understand how to access and use the admin features.

#### Acceptance Criteria

1. WHEN the admin dashboard is implemented, THE README.md SHALL include a section describing how to access the admin page, the available panels, and the installer channel management workflow
2. THE README.md SHALL include documentation on the promotion and rollback flow (Dev → UAT → Prod, with rollback) with examples
3. THE README.md SHALL include documentation on user management (auto-creation, channel assignment, admin flag, `KONDUCTOR_ADMINS` env var)
4. THE README.md SHALL include documentation on the `KONDUCTOR_EXTERNAL_URL` environment variable and its effect on install command display