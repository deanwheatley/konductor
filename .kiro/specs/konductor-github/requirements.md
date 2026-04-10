# Requirements Document

## Introduction

Phase 5 of the Konductor project integrates GitHub pull request data into the collision awareness system. This extends the Konductor beyond real-time concurrent development to cover asymmetric use cases — where a developer may not be actively coding but has pending PRs that represent collision risk. The Konductor polls or receives webhooks from GitHub to track open PR file changes as passive work sessions.

## Glossary

- **Konductor**: The Work Coordination MCP Server that tracks concurrent development activity and evaluates collision risk
- **Passive Session**: A work session automatically created from a GitHub pull request, representing files that are pending merge but not actively being edited
- **Active Session**: A work session explicitly registered by an agent or user (Phase 1 behavior)
- **PR Session**: A passive session derived from an open GitHub pull request's changed files
- **GitHub Personal Access Token (PAT)**: An authentication token used to access the GitHub API

## Requirements

### Requirement 1

**User Story:** As a software engineer, I want the Konductor to track open pull requests as passive work sessions, so that I am aware of pending changes that could conflict with my active work.

#### Acceptance Criteria

1. WHEN the Konductor is configured with GitHub credentials and a list of repositories, THE Konductor SHALL poll the GitHub API for open pull requests in those repositories
2. WHEN an open pull request is detected, THE Konductor SHALL create a passive session containing the PR author, repository, branch, and list of changed files
3. WHEN a pull request is merged or closed, THE Konductor SHALL remove the corresponding passive session
4. WHEN a pull request is updated with new commits, THE Konductor SHALL update the passive session to reflect the current set of changed files

### Requirement 2

**User Story:** As a software engineer, I want collision state evaluation to include both active and passive sessions, so that I get a complete picture of conflict risk.

#### Acceptance Criteria

1. WHEN evaluating collision state, THE CollisionEvaluator SHALL consider both active sessions (from agent registration) and passive sessions (from GitHub PRs)
2. WHEN a collision involves a passive session, THE Konductor SHALL indicate in the response that the overlapping session originates from a pending pull request
3. WHEN displaying collision details for a passive session, THE Konductor SHALL include the pull request number and URL

### Requirement 3

**User Story:** As a team lead, I want to configure which repositories are monitored for PR activity, so that the Konductor only tracks relevant repositories.

#### Acceptance Criteria

1. WHEN the configuration file includes a `github` section with repository list and polling interval, THE Konductor SHALL poll those repositories at the configured interval
2. WHEN the configuration file does not include a `github` section, THE Konductor SHALL operate without GitHub integration (Phase 1 behavior only)
3. WHEN the GitHub API returns an error or rate limit response, THE Konductor SHALL log the error and retry at the next polling interval without disrupting active session tracking

### Requirement 4

**User Story:** As a software engineer, I want GitHub integration documented in the README, so that I can configure and use PR-based collision awareness.

#### Acceptance Criteria

1. WHEN GitHub integration is implemented, THE README.md SHALL include a section describing how to configure GitHub credentials, repository list, and polling interval
2. WHEN the README.md documents GitHub integration, THE README.md SHALL include example configuration YAML and expected behavior for each PR lifecycle event
