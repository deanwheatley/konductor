# Requirements Document

## Introduction

Phase 6 of the Konductor project adds server-side Slack integration for collision notifications. The Konductor server posts collision alerts directly to Slack channels using a bot token, eliminating the need for client-side OAuth flows or per-user Slack authentication. Each repository tracked by Konductor has its own Slack channel configuration, editable from the Baton repo page or via the client "konductor," chat prefix. Slack authentication (bot token, optional SSO/OAuth for richer identity) is configured globally by the admin via the Baton admin dashboard. When any Slack configuration changes for a repo, all connected clients working in that repo receive a real-time notification in their chat window and in the server log with a link to the new Slack channel.

This design assumes a 1:1 relationship between a Konductor server instance and an organization — the server serves one team/org, and all repos on that server share the same Slack workspace credentials.

## Dependencies

- `konductor-baton` — provides the per-repo web dashboard where Slack channel configuration is displayed and editable
- `konductor-admin` — provides the admin dashboard where Slack authentication credentials are configured
- `konductor-mcp-server` — provides the collision evaluation engine that triggers Slack notifications
- `konductor-enhanced-chat` — provides the "konductor," chat prefix routing for client-side Slack commands
- `konductor-long-term-memory` — provides the `ISessionHistoryStore` for persisting per-repo Slack settings

## Glossary

- **Konductor**: The Work Coordination MCP Server that tracks concurrent development activity and evaluates collision risk
- **Slack Bot Token**: A Slack API token (`xoxb-...`) obtained by installing a Slack App to a workspace, used by the server to post messages to channels
- **Slack Channel**: A Slack channel where collision notifications are posted; configured per-repo
- **Collision State**: One of: solo, neighbors, crossroads, collision_course, merge_hell — representing escalating levels of overlap risk
- **Notification Verbosity**: A numeric level (0–5) controlling which collision states trigger Slack notifications, configurable per-repo
- **Slack Config Change Notification**: A real-time message sent to all connected clients working in a repo when that repo's Slack channel or verbosity setting changes
- **Baton Repo Page**: The per-repository web dashboard at `/repo/:repoName` where Slack settings are displayed and editable
- **Admin Dashboard**: The admin web page at `/admin` where global Slack authentication credentials are configured

## Requirements

### Requirement 1: Server-Side Slack Notifications

**User Story:** As a software engineer, I want the Konductor server to post collision notifications to a Slack channel, so that my team is aware of potential merge conflicts even when not looking at their IDEs.

#### Acceptance Criteria

1. WHEN the Konductor server evaluates a collision state that meets or exceeds the configured verbosity threshold for a repo, THE server SHALL post a notification message to the repo's configured Slack channel
2. WHEN posting a Slack notification, THE server SHALL authenticate with Slack using the globally configured bot token
3. WHEN posting a Slack notification, THE server SHALL include the collision state (with emoji), repository name, branch, affected files, and the names of all involved engineers in the message
4. WHEN posting a Slack notification, THE server SHALL always append the footer: `*konductor collision alert for <repo>*` in the message context block
5. WHEN the collision state de-escalates below the verbosity threshold for a repo, THE server SHALL post a follow-up message indicating the conflict has been resolved
6. WHEN the Slack bot token is not configured or is invalid, THE server SHALL log a warning and skip Slack notifications without disrupting collision evaluation or other server functionality
7. WHEN the Slack API returns an error (rate limit, channel not found, token revoked), THE server SHALL log the error, skip the notification, and retry on the next collision event — never blocking or crashing

### Requirement 2: Per-Repo Slack Channel Configuration

**User Story:** As a software engineer, I want each repository to have its own Slack channel for collision notifications, so that alerts go to the right team channel.

#### Acceptance Criteria

1. WHEN a repo has a Slack channel configured in the settings store, THE server SHALL use that channel for posting notifications for that repo
2. WHEN a repo has no Slack channel configured, THE server SHALL use a default channel name of `konductor-alerts-[repo_name]` where `[repo_name]` is the repository name (not owner/repo) sanitized to Slack channel naming rules (lowercase, alphanumeric and hyphens only, max 80 chars, no leading hyphen)
3. WHEN a repo has a verbosity level configured, THE server SHALL use that level; otherwise THE server SHALL default to level 2 (collision_course and merge_hell)
4. THE per-repo Slack settings SHALL be persisted in the `ISessionHistoryStore` settings table with category `slack` and keys prefixed by the repo name

### Requirement 3: Baton Repo Page — Slack Integration Panel

**User Story:** As a developer, I want to see and change the Slack channel for my repo on the Baton dashboard, so that I can control where collision alerts go without asking an admin.

#### Acceptance Criteria

1. WHEN the Baton repo page loads, THE page SHALL display a "Slack Integration" panel showing the current Slack channel name, verbosity level, and whether Slack is enabled (bot token configured)
2. WHEN Slack is not configured (no bot token), THE panel SHALL display a message: "Slack integration not configured. Ask your admin to set up Slack credentials in the Admin Dashboard."
3. WHEN Slack is configured, THE panel SHALL display an editable channel name field and a verbosity dropdown (0–5 with labels)
4. WHEN a user changes the Slack channel or verbosity and clicks Save, THE Baton SHALL update the per-repo Slack settings via the API
5. WHEN the Slack channel is changed, THE panel SHALL display a clickable link to the Slack channel in the format `https://slack.com/app_redirect?channel=<channel_name>` (or the workspace-specific URL if available)
6. THE Slack Integration panel SHALL be collapsible and expandable, matching the existing Baton panel design
7. THE Slack Integration panel SHALL update in real time via SSE when another user or the admin changes the Slack settings for this repo
8. WHEN the Slack channel or verbosity is changed via the Baton repo page, THE server SHALL send a "Test notification" to the new channel confirming the configuration change

### Requirement 4: Client Notification on Slack Config Changes

**User Story:** As a developer, I want to be notified in my IDE when the Slack channel for my repo changes, so that I know where collision alerts are going.

#### Acceptance Criteria

1. WHEN the Slack channel or verbosity setting changes for a repo, THE server SHALL emit an SSE event to all connected clients that have active sessions in that repo
2. WHEN a client receives a Slack config change event, THE steering rule SHALL instruct the agent to display: `📢 Konductor: Slack alerts for <repo> now go to #<channel> (verbosity: <level>). <slack_channel_link>`
3. WHEN a client receives a Slack config change event, THE server SHALL log a CONFIG entry: `[CONFIG] [SYSTEM] Slack channel for <repo> changed to #<channel> (verbosity: <level>) by <userId>`
4. THE Slack config change notification SHALL be delivered to clients within 5 seconds of the change being saved

### Requirement 5: Notification Verbosity

**User Story:** As a team lead, I want to control the verbosity of Slack notifications per repo, so that teams only get notified at the severity levels that matter to them.

#### Acceptance Criteria

1. WHEN a repo has `slack_verbosity` set to N (0–5), THE server SHALL only send Slack notifications for collision states at or above the corresponding severity level
2. THE verbosity levels SHALL map as follows:
   - 0 = no Slack notifications (disabled for this repo)
   - 1 = merge_hell only
   - 2 = collision_course + merge_hell (DEFAULT)
   - 3 = crossroads + collision_course + merge_hell
   - 4 = neighbors + crossroads + collision_course + merge_hell
   - 5 = everything including solo
3. WHEN `slack_verbosity` is not set for a repo, THE server SHALL default to level 2

### Requirement 6: Admin Dashboard — Slack Authentication Panel

**User Story:** As an admin, I want to configure Slack authentication credentials from the admin dashboard, so that the server can post to Slack channels without editing environment variables.

#### Acceptance Criteria

1. THE admin dashboard SHALL include a "Slack Integration" panel that displays the current Slack authentication status (configured/not configured, token validity, workspace name)
2. THE Slack Integration panel SHALL support configuring a Slack Bot Token directly (paste `xoxb-...` token)
3. THE Slack Integration panel SHALL support Slack OAuth/SSO app installation flow as an alternative to manual token entry: the admin clicks "Install Slack App", is redirected to Slack's OAuth consent screen, authorizes the Konductor app, and the server stores the resulting bot token automatically
4. WHEN the admin enters or updates a bot token, THE server SHALL validate the token by calling `auth.test` on the Slack API and display the workspace name and bot user on success, or an error message on failure
5. WHEN the bot token is configured via the admin dashboard, THE server SHALL persist it in the settings store (encrypted) with category `slack` and key `bot_token`
6. WHEN the `SLACK_BOT_TOKEN` environment variable is set, THE admin panel SHALL display the token status as read-only with a label indicating the source is an environment variable
7. THE environment variable `SLACK_BOT_TOKEN` SHALL take precedence over the database-stored token
8. THE Slack Integration panel SHALL be collapsible and expandable, matching the existing admin panel design
9. WHEN the Slack OAuth flow is used, THE server SHALL store the OAuth `client_id` and `client_secret` in the settings store (encrypted) for token refresh purposes
10. THE admin panel SHALL display a "Test" button that sends a test message to a specified channel to verify the integration is working

### Requirement 7: Client Chat Commands for Slack

**User Story:** As a developer, I want to view and change Slack settings for my repo via the "konductor," chat prefix, so that I can manage Slack without opening the Baton dashboard.

#### Acceptance Criteria

1. WHEN the user says "konductor, show slack config" or "konductor, slack status", THE agent SHALL display the current Slack channel, verbosity level, and whether Slack is enabled for the current repo
2. WHEN the user says "konductor, change slack channel to X", THE agent SHALL call the server API to update the Slack channel for the current repo and confirm the change
3. WHEN the user says "konductor, change slack verbosity to X", THE agent SHALL call the server API to update the verbosity for the current repo and confirm the change
4. WHEN the user says "konductor, disable slack" or "konductor, enable slack", THE agent SHALL set the verbosity to 0 or 2 respectively for the current repo
5. ALL Slack chat commands SHALL trigger the same config change notification flow as Baton repo page changes (Requirement 4)

### Requirement 8: Slack Message Format

**User Story:** As a software engineer, I want Slack collision notifications to be clear and actionable, so that I can quickly understand the risk and take action.

#### Acceptance Criteria

1. THE Slack message SHALL use Slack Block Kit for rich formatting with a header block, section block, and context block
2. THE header block SHALL contain the collision state emoji and repo name (e.g., `🟠 Collision Course — org/my-project`)
3. THE section block SHALL contain the involved users, affected files (as inline code), and branch names
4. THE context block SHALL contain the footer: `*konductor collision alert for <repo>*`
5. THE de-escalation message SHALL contain: `✅ Collision resolved on <repo> — previously <emoji> <previous_state>`
6. THE emoji mapping SHALL match the existing steering rule conventions: 🟢 solo/neighbors, 🟡 crossroads, 🟠 collision_course, 🔴 merge_hell

### Requirement 9: De-escalation Tracking

**User Story:** As a software engineer, I want to be notified when a collision I was warned about has been resolved, so that I know the risk has passed.

#### Acceptance Criteria

1. THE server SHALL track the last notified collision state per repo to detect de-escalation
2. WHEN the collision state for a repo drops from a level that was above the verbosity threshold to a level below it, THE server SHALL post exactly one de-escalation message to the Slack channel
3. WHEN the collision state drops but remains above the verbosity threshold, THE server SHALL NOT post a de-escalation message (only post when crossing below the threshold)
4. THE de-escalation state tracking SHALL be held in memory (lost on restart — acceptable since collision state is re-evaluated on next registration)

### Requirement 10: Documentation

**User Story:** As a server operator, I want Slack integration documented in the README, so that team members can understand and configure the notification behavior.

#### Acceptance Criteria

1. WHEN Slack integration is implemented, THE README.md SHALL include a section describing: how to configure the Slack bot token (admin dashboard or env var), per-repo channel configuration (Baton page or chat commands), verbosity levels, and message format
2. THE README.md SHALL include example `konductor.yaml` entries if any Slack config lives there
3. THE README.md SHALL include example Slack message screenshots or Block Kit JSON
4. THE steering rule SHALL be updated to include the new Slack-related chat commands in the management command routing table and help output

### Requirement 11: Slack Settings API

**User Story:** As a developer using the Baton dashboard or chat commands, I want API endpoints for reading and updating per-repo Slack settings, so that both the web UI and the agent can manage Slack configuration.

#### Acceptance Criteria

1. THE server SHALL expose `GET /api/repo/:repoName/slack` that returns the current Slack channel, verbosity, and enabled status for the repo
2. THE server SHALL expose `PUT /api/repo/:repoName/slack` that accepts `{ channel?: string, verbosity?: number }` and updates the per-repo Slack settings
3. WHEN `PUT /api/repo/:repoName/slack` is called, THE server SHALL validate the channel name against Slack naming rules and the verbosity against the 0–5 range
4. WHEN `PUT /api/repo/:repoName/slack` succeeds, THE server SHALL emit a `slack_config_change` SSE event to all Baton repo page subscribers and all connected MCP clients with sessions in that repo
5. THE server SHALL expose a `GET /api/admin/slack` endpoint (admin-only) that returns the global Slack authentication status
6. THE server SHALL expose a `PUT /api/admin/slack` endpoint (admin-only) that accepts bot token or OAuth credentials
7. THE Slack settings API endpoints (`/api/repo/:repoName/slack`) SHALL require authentication (session cookie or Authorization header) but SHALL NOT require admin access — any authenticated user can change their repo's Slack channel
