# Requirements Document

## Introduction

Phase 6 of the Konductor project adds Slack channel integration for collision notifications. When collision risk reaches configured thresholds, the Konductor sends messages to designated Slack channels, @-mentioning the relevant engineers. This extends the notification framework from Phase 3 beyond the IDE to a team communication platform where coordination naturally happens.

## Glossary

- **Konductor**: The Work Coordination MCP Server that tracks concurrent development activity and evaluates collision risk
- **Slack Webhook**: An incoming webhook URL configured in a Slack workspace that allows external services to post messages to a channel
- **Slack Notification**: A message posted to a Slack channel by the Konductor when collision risk reaches a configured threshold
- **User Mapping**: A configuration that maps Konductor user IDs to Slack user IDs for @-mention functionality

## Requirements

### Requirement 1

**User Story:** As a software engineer, I want to receive Slack notifications when collision risk is elevated, so that I am aware of potential merge conflicts even when I am not actively looking at my IDE.

#### Acceptance Criteria

1. WHEN the collision state for a session reaches the configured Slack notification threshold, THE Konductor SHALL post a message to the configured Slack channel via webhook
2. WHEN posting a Slack notification, THE Konductor SHALL @-mention the Slack users involved in the collision using the configured user mapping
3. WHEN posting a Slack notification, THE Konductor SHALL include the collision state, repository name, affected files, and the names of all involved engineers in the message
4. WHEN the collision state de-escalates below the threshold, THE Konductor SHALL post a follow-up message indicating the conflict has been resolved

### Requirement 2

**User Story:** As a team lead, I want to configure which Slack channels receive notifications for which repositories, so that notifications go to the right team channels.

#### Acceptance Criteria

1. WHEN the configuration file includes a `slack` section with webhook URLs and repository-to-channel mappings, THE Konductor SHALL use those mappings to route notifications
2. WHEN a repository has no specific channel mapping, THE Konductor SHALL use the default channel if one is configured
3. WHEN no `slack` section exists in the configuration, THE Konductor SHALL operate without Slack integration

### Requirement 3

**User Story:** As a team lead, I want to map Konductor user IDs to Slack user IDs, so that notifications correctly @-mention the right people.

#### Acceptance Criteria

1. WHEN the configuration file includes a `slack.user_mapping` section, THE Konductor SHALL use the mapping to resolve Konductor user IDs to Slack user IDs for @-mentions
2. WHEN a Konductor user ID has no Slack mapping, THE Konductor SHALL include the Konductor user ID as plain text instead of an @-mention

### Requirement 4

**User Story:** As a team lead, I want Slack integration documented in the README, so that team members can configure and understand the notification behavior.

#### Acceptance Criteria

1. WHEN Slack integration is implemented, THE README.md SHALL include a section describing how to configure Slack webhooks, channel mappings, user mappings, and notification thresholds
2. WHEN the README.md documents Slack integration, THE README.md SHALL include example configuration YAML and example Slack message format
