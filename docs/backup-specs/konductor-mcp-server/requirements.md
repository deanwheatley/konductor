# Requirements Document

## Introduction

The Konductor is a Work Coordination MCP Server designed to solve the "collision debt" problem that arises when multiple software engineers (and their AI coding agents) work concurrently across shared repositories. The Konductor tracks which users are actively modifying which files across GitHub repositories, evaluates collision risk using a graduated state model, and surfaces real-time awareness to engineers via MCP tool integration. The system integrates with Kiro through steering rules, but exposes a standard MCP interface usable by any compatible tool.

## Glossary

- **Konductor**: The Work Coordination MCP Server that tracks concurrent development activity and evaluates collision risk across repositories
- **Collision State**: A graduated risk level describing the degree of overlap between concurrent development activities in a repository
- **Work Session**: A registered period of active development by a user on specific files within a repository, tracked by the Konductor
- **Heartbeat**: A periodic signal sent by a client to the Konductor to indicate continued active work on specific files
- **MCP (Model Context Protocol)**: A protocol for exposing tools and resources to AI agents and development environments
- **Collision Debt**: The accumulated cost of unresolved merge conflicts and integration friction caused by uncoordinated concurrent development
- **Steering Rule**: A Kiro configuration directive that instructs the agent to perform specific actions (such as querying the Konductor) during development workflows

## Requirements

### Requirement 1

**User Story:** As a software engineer, I want to register my active work session with the Konductor, so that other engineers can be aware of what files and repositories I am currently modifying.

#### Acceptance Criteria

1. WHEN a user begins working on files in a repository, THE Konductor SHALL accept a work session registration containing the user identifier, repository name, and list of file paths
2. WHEN a work session registration is received, THE Konductor SHALL store the session with a timestamp and associate the session with the specified user, repository, and files
3. WHEN a user updates the files being modified during an active session, THE Konductor SHALL update the stored session to reflect the current set of active files
4. WHEN a user completes work on a repository, THE Konductor SHALL remove the work session upon receiving an explicit deregistration request
5. IF a work session has not received a heartbeat within a configurable timeout period, THEN THE Konductor SHALL mark the session as stale and exclude the session from active collision calculations

### Requirement 2

**User Story:** As a software engineer, I want to query the Konductor for the current collision state of my work, so that I can understand the risk of merge conflicts before they happen.

#### Acceptance Criteria

1. WHEN a user queries the collision state for a repository and set of files, THE Konductor SHALL return the current collision state and a list of overlapping work sessions
2. WHEN no other users have active sessions in the same repository, THE Konductor SHALL return the "Solo" collision state
3. WHEN other users have active sessions in the same repository but on different files, THE Konductor SHALL return the "Neighbors" collision state
4. WHEN other users have active sessions on files in the same directory as the querying user, THE Konductor SHALL return the "Crossroads" collision state
5. WHEN other users have active sessions on one or more of the same files as the querying user, THE Konductor SHALL return the "Collision Course" collision state
6. WHEN multiple users have divergent modifications on the same files across different branches, THE Konductor SHALL return the "Merge Hell" collision state

### Requirement 3

**User Story:** As a software engineer, I want the Konductor to provide detailed context about who is working on what, so that I can coordinate directly with teammates when collision risk is elevated.

#### Acceptance Criteria

1. WHEN the collision state is "Neighbors" or higher, THE Konductor SHALL include in the response the usernames, file paths, and branch names of all overlapping work sessions
2. WHEN the collision state is "Crossroads" or higher, THE Konductor SHALL include the specific directories where work overlaps
3. WHEN the collision state is "Collision Course" or higher, THE Konductor SHALL include the exact file paths that are shared between the querying user and other active sessions

### Requirement 4

**User Story:** As a team lead, I want to configure collision state thresholds and rules, so that the Konductor behavior can be tuned to match our team's workflow and risk tolerance.

#### Acceptance Criteria

1. WHEN the Konductor starts, THE Konductor SHALL load collision state rules from a YAML configuration file
2. WHEN the configuration file defines custom heartbeat timeout values, THE Konductor SHALL use the configured timeout instead of the default value
3. WHEN the configuration file defines state-specific actions (such as warning messages or submission blocks), THE Konductor SHALL apply those actions when the corresponding collision state is reached
4. WHEN the configuration file is modified, THE Konductor SHALL reload the configuration without requiring a server restart

### Requirement 5

**User Story:** As a software engineer using Kiro, I want the Konductor to be accessible as an MCP server, so that my AI coding agent can automatically check collision state during development.

#### Acceptance Criteria

1. THE Konductor SHALL expose its functionality through MCP-compliant tool definitions
2. WHEN an MCP client invokes the "register_session" tool, THE Konductor SHALL register the work session and return a confirmation with the session identifier
3. WHEN an MCP client invokes the "check_status" tool, THE Konductor SHALL return the current collision state, overlapping sessions, and any applicable rule actions
4. WHEN an MCP client invokes the "deregister_session" tool, THE Konductor SHALL remove the specified work session and return a confirmation
5. WHEN an MCP client invokes the "list_sessions" tool for a repository, THE Konductor SHALL return all active work sessions for that repository

### Requirement 6

**User Story:** As a software engineer, I want the Konductor to persist session data reliably, so that collision awareness survives server restarts and transient failures.

#### Acceptance Criteria

1. THE Konductor SHALL persist all active work sessions to a durable storage backend
2. WHEN the Konductor restarts, THE Konductor SHALL restore all non-stale work sessions from persistent storage
3. WHEN serializing work sessions to storage, THE Konductor SHALL encode sessions using JSON
4. WHEN deserializing work sessions from storage, THE Konductor SHALL decode sessions from JSON and validate the session structure
5. WHEN a work session is serialized and then deserialized, THE Konductor SHALL produce a work session equivalent to the original (round-trip consistency)

### Requirement 7

**User Story:** As a software engineer, I want the Konductor to provide a human-readable summary of the current collision state, so that I can quickly understand the situation without parsing raw data.

#### Acceptance Criteria

1. WHEN returning a collision state response, THE Konductor SHALL include a human-readable summary message describing the state and relevant context
2. WHEN the collision state is "Solo", THE Konductor SHALL return a summary indicating the user is the only active engineer in the repository
3. WHEN the collision state is "Collision Course" or "Merge Hell", THE Konductor SHALL return a summary that names the specific users and files involved in the overlap
4. WHEN formatting a summary, THE Konductor SHALL produce a summary that can be parsed back into its structured components (collision state, users, and files)

### Requirement 8

**User Story:** As a software engineer, I want comprehensive user-facing documentation for the Konductor, so that I can set up, configure, and use the server without needing to read source code.

#### Acceptance Criteria

1. THE Konductor project SHALL include a README.md file that describes the purpose, quick start instructions, configuration options, available MCP tools, and architecture overview
2. WHEN a new MCP tool or configuration option is implemented, THE README.md SHALL be updated in the same implementation step to document the new capability
3. WHEN the README.md documents configuration options, THE README.md SHALL include default values and example YAML snippets for each option
4. WHEN the README.md documents MCP tools, THE README.md SHALL include the tool name, input parameters, output format, and a usage example for each tool

### Requirement 9

**User Story:** As a software engineer, I want the Konductor to support both local and remote access, so that teammates on my network can connect their Kiro agents to a single shared Konductor instance running on my machine.

#### Acceptance Criteria

1. THE Konductor SHALL support stdio transport for local single-user access
2. THE Konductor SHALL support SSE (Server-Sent Events) transport on a configurable port for remote multi-user access
3. WHEN the Konductor starts in SSE mode, THE Konductor SHALL listen on the configured port and accept connections from MCP clients over HTTP
4. WHEN a remote MCP client connects via SSE, THE Konductor SHALL authenticate the client using a shared API key provided in the request header
5. IF an SSE client provides an invalid or missing API key, THEN THE Konductor SHALL reject the connection with an authentication error

### Future Phases

The following capabilities are planned for subsequent phases and have their own dedicated specs:
- **Phase 2:** Kiro steering rules integration (`.kiro/specs/konductor-steering-rules/`)
- **Phase 3:** Enhanced configuration and automated actions (`.kiro/specs/konductor-actions/`)
- **Phase 4:** Konductor Baton dashboard (`.kiro/specs/konductor-baton/`)
- **Phase 5:** GitHub PR integration (`.kiro/specs/konductor-github/`)
- **Phase 6:** Slack channel integration (`.kiro/specs/konductor-slack/`)
- **Phase 7:** Production deployment on AWS (`.kiro/specs/konductor-production/`)
