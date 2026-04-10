# Requirements Document

## Introduction

Phase 3 of the Konductor project enhances the configuration system to support automated actions and an IDE notification framework. When collision risk reaches configured thresholds, the Konductor triggers actions such as IDE notifications, warning escalations, and optional submission blocks. This phase transforms the Konductor from a passive awareness tool into an active coordination assistant.

## Glossary

- **Konductor**: The Work Coordination MCP Server that tracks concurrent development activity and evaluates collision risk
- **Automated Action**: A configurable response triggered by the Konductor when a collision state threshold is reached
- **IDE Notification**: A message surfaced to the user within their development environment (Kiro) through the MCP response
- **Submission Block**: A configurable rule that prevents new session registrations or file modifications when collision risk exceeds a threshold
- **Action Rule**: A configuration entry that maps a collision state to one or more automated actions

## Requirements

### Requirement 1

**User Story:** As a team lead, I want to define automated actions for each collision state, so that the Konductor can proactively guide engineers based on our team's risk tolerance.

#### Acceptance Criteria

1. WHEN the configuration file defines action rules for a collision state, THE Konductor SHALL execute those actions when the corresponding state is reached during a `check_status` or `register_session` invocation
2. WHEN an action rule specifies a "warn" action type, THE Konductor SHALL include the warning message in the tool response for the MCP client to display
3. WHEN an action rule specifies a "block" action type, THE Konductor SHALL reject the operation and return an error response with the block reason
4. WHEN an action rule specifies a "suggest_rebase" action type, THE Konductor SHALL include a rebase suggestion with the target branch in the tool response

### Requirement 2

**User Story:** As a software engineer, I want to receive IDE notifications when collision risk changes, so that I am aware of emerging conflicts without manually checking.

#### Acceptance Criteria

1. WHEN a new session registration causes the collision state for existing sessions to escalate, THE Konductor SHALL include a notification payload in the response indicating the state change for affected users
2. WHEN the collision state for a user's session de-escalates (due to another user deregistering), THE Konductor SHALL include a notification payload indicating the improved state
3. WHEN a notification is generated, THE Konductor SHALL include the previous state, new state, and a human-readable explanation of the change

### Requirement 3

**User Story:** As a team lead, I want to configure notification thresholds, so that engineers are only notified when collision risk reaches a level that warrants attention.

#### Acceptance Criteria

1. WHEN the configuration file defines a notification threshold, THE Konductor SHALL generate notifications only for state changes at or above the configured threshold
2. WHEN no notification threshold is configured, THE Konductor SHALL default to generating notifications at "Crossroads" and above
3. WHEN the configuration file defines per-repository notification overrides, THE Konductor SHALL apply the repository-specific threshold for sessions in that repository

### Requirement 4

**User Story:** As a software engineer, I want action and notification configurations to be serialized and deserialized reliably, so that configuration changes are preserved correctly.

#### Acceptance Criteria

1. WHEN action rules are serialized to YAML and deserialized back, THE Konductor SHALL produce action rules equivalent to the original (round-trip consistency)
2. WHEN notification threshold configuration is serialized to YAML and deserialized back, THE Konductor SHALL produce threshold configuration equivalent to the original
