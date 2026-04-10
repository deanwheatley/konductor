# Requirements Document

## Introduction

Phase 2 of the Konductor project creates Kiro steering rules that instruct the AI coding agent to automatically interact with the Konductor MCP Server during development workflows. The steering rules ensure that every Kiro session registers its work, checks collision state before and after file modifications, and surfaces collision warnings to the user through the chat window. This phase bridges the Konductor server (Phase 1) with the developer experience inside Kiro.

## Glossary

- **Konductor**: The Work Coordination MCP Server (Phase 1) that tracks concurrent development activity and evaluates collision risk
- **Steering Rule**: A Kiro configuration file (`.kiro/steering/*.md`) that provides instructions and context to the AI agent during development sessions
- **Collision State**: A graduated risk level (Solo, Neighbors, Crossroads, Collision Course, Merge Hell) describing overlap between concurrent development activities
- **Work Session**: A registered period of active development tracked by the Konductor
- **Chat Window**: The Kiro conversation interface where the agent communicates with the user

## Requirements

### Requirement 1

**User Story:** As a software engineer using Kiro, I want my agent to automatically register my work session with the Konductor, so that other engineers gain awareness of what I am working on without manual effort.

#### Acceptance Criteria

1. WHEN a Kiro session begins modifying files in a repository, THE steering rule SHALL instruct the agent to invoke the Konductor `register_session` tool with the user identifier, repository name, branch name, and list of files being modified
2. WHEN the agent modifies additional files during a session, THE steering rule SHALL instruct the agent to update the registered session with the new file list
3. WHEN a Kiro session ends or the user explicitly stops work, THE steering rule SHALL instruct the agent to invoke the Konductor `deregister_session` tool

### Requirement 2

**User Story:** As a software engineer, I want Kiro to check collision state before making file changes, so that I am warned about potential merge conflicts before they happen.

#### Acceptance Criteria

1. WHEN the agent is about to modify a file, THE steering rule SHALL instruct the agent to invoke the Konductor `check_status` tool for the target files
2. WHEN the `check_status` response indicates "Solo" or "Neighbors" state, THE steering rule SHALL instruct the agent to proceed with the modification and display a brief status indicator in the chat
3. WHEN the `check_status` response indicates "Crossroads" state, THE steering rule SHALL instruct the agent to display a warning message in the chat identifying the overlapping directories and users before proceeding
4. WHEN the `check_status` response indicates "Collision Course" state, THE steering rule SHALL instruct the agent to display a prominent warning in the chat naming the specific files and users in conflict, and ask the user for confirmation before proceeding
5. WHEN the `check_status` response indicates "Merge Hell" state, THE steering rule SHALL instruct the agent to display a critical alert in the chat with full conflict details and recommend the user coordinate with the named engineers before proceeding

### Requirement 3

**User Story:** As a software engineer, I want collision state messages to be clear and actionable, so that I can quickly understand the risk and decide how to proceed.

#### Acceptance Criteria

1. WHEN displaying a collision state message, THE steering rule SHALL use the human-readable summary provided by the Konductor response
2. WHEN the collision state is "Crossroads" or higher, THE steering rule SHALL include the names of other engineers and the specific overlapping files or directories in the message
3. WHEN the collision state is "Collision Course" or "Merge Hell", THE steering rule SHALL include a recommended action (such as "coordinate with [user]" or "consider rebasing") in the message

### Requirement 4

**User Story:** As a team lead, I want the steering rule to be configurable per repository, so that different teams can customize the collision awareness behavior.

#### Acceptance Criteria

1. THE steering rule SHALL be a markdown file located at `.kiro/steering/konductor.md` within the repository workspace
2. WHEN the steering rule file contains configuration parameters (such as which collision states trigger warnings vs. blocks), THE agent SHALL follow those parameters
3. WHEN no steering rule file exists in the workspace, THE agent SHALL operate without Konductor integration
