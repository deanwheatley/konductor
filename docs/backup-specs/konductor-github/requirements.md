# Requirements Document

## Introduction

The Konductor GitHub Integration extends collision awareness beyond real-time sessions to cover three asymmetric collision scenarios that the current system cannot detect:

1. **PR collisions** — a developer actively coding on files that overlap with an open pull request they didn't author
2. **Cross-branch commit collisions** — a developer working on files recently modified on other branches (even without a PR)
3. **Same-branch commit collisions** — a developer working on files with recent commits by others on the same branch

These scenarios represent real collision risk outside of live Konductor sessions. A teammate may not be online, but their open PR or recent commits still represent pending changes that could conflict.

This feature integrates with the existing Konductor Baton dashboard (see `konductor-baton` spec), filling the "GitHub Integration Coming Soon" placeholders in the Open PRs and Repo History sections. It also enriches all existing MCP query tools and client-side collision messages with source attribution.

## Dependencies

- `konductor-enhanced-chat` — query tools (who_is_active, who_overlaps, etc.) that this feature extends
- `konductor-baton` — web dashboard that displays GitHub data in Open PRs and Repo History sections
- `konductor-npx-installer` — client installer and auto-update mechanism

## Glossary

- **Active Session**: A work session explicitly registered by an agent or file watcher
- **Passive Session**: A work session automatically created from GitHub data (PR or commit activity)
- **PR Session**: A passive session derived from an open GitHub pull request's changed files
- **Commit Session**: A passive session derived from recent commits on a branch
- **GitHub Personal Access Token (PAT)**: An authentication token for the GitHub API, stored in an env var referenced by the YAML config
- **Self-Collision**: A false positive where a user is flagged as colliding with their own PR or commits

## Requirements

### Requirement 1: PR Tracking as Passive Sessions

**User Story:** As a software engineer, I want the Konductor to track open pull requests as passive work sessions, so that I am aware of pending changes that could conflict with my active work even when the PR author is not online.

#### Acceptance Criteria

1. WHEN the Konductor is configured with GitHub credentials and a list of repositories, THE Konductor SHALL poll the GitHub API for open pull requests at a configurable interval (default: 60s)
2. WHEN an open pull request is detected, THE Konductor SHALL create a passive session containing the PR author, repository, head branch, target branch, and list of changed files
3. WHEN a pull request is merged or closed, THE Konductor SHALL remove the corresponding passive session
4. WHEN a pull request is updated with new commits, THE Konductor SHALL update the passive session to reflect the current set of changed files
5. WHEN a pull request is in draft state, THE Konductor SHALL create the passive session but mark it as draft (lower collision severity)
6. WHEN a pull request has been approved, THE Konductor SHALL mark the passive session as approved (higher collision severity — imminent merge)
7. WHEN the PR author has an active Konductor session in the same repo, THE Konductor SHALL NOT create a duplicate passive session (self-collision suppression)

### Requirement 2: Recent Commit Tracking

**User Story:** As a software engineer, I want the Konductor to detect recent commits on branches I care about, so that I am aware of changes pushed by teammates who may not have an open PR or an active session.

#### Acceptance Criteria

1. WHEN configured, THE Konductor SHALL poll the GitHub API for recent commits on configured branches within a configurable lookback window (default: 24 hours)
2. WHEN recent commits by other users are detected, THE Konductor SHALL create a commit-based passive session containing the commit author, repository, branch, and changed files
3. WHEN the lookback window expires with no new activity, THE Konductor SHALL remove the corresponding commit session
4. WHEN a commit author already has an active session or PR session covering the same files, THE Konductor SHALL NOT create a redundant commit session (deduplication)

### Requirement 3: Collision Evaluation with Mixed Session Types

**User Story:** As a software engineer, I want collision state evaluation to include both active and passive sessions, so that I get a complete picture of conflict risk.

#### Acceptance Criteria

1. WHEN evaluating collision state, THE CollisionEvaluator SHALL consider active sessions, PR sessions, and commit sessions together
2. WHEN a collision involves a PR session, THE result SHALL indicate source `github_pr` with PR number, URL, target branch, draft status, and review status
3. WHEN a collision involves a commit session, THE result SHALL indicate source `github_commit` with branch name and commit date range
4. WHEN evaluating severity, approved PRs SHALL increase severity, draft PRs SHALL decrease severity
5. WHEN a user's active session overlaps with a PR targeting the user's current branch, THE evaluator SHALL treat this as higher risk
6. WHEN a user collides with their own PR or commits, THE evaluator SHALL suppress the collision

### Requirement 4: Enhanced Client Collision Messages

**User Story:** As a software engineer, I want collision notifications to explain *how* I am colliding — live session, open PR, or recent commits — so I know what action to take.

#### Acceptance Criteria

1. WHEN collision involves only active sessions, message reads: `🟠 Warning — <user> is actively editing <files> on <branch>.`
2. WHEN collision involves a PR, message reads: `🟠 Warning — <user>'s PR #<number> (<url>) modifies <files>, targeting <target_branch>.`
3. WHEN collision involves an approved PR, message reads: `🔴 Critical — <user>'s PR #<number> is approved and targets <target_branch>. Merge is imminent.`
4. WHEN collision involves a draft PR, message reads: `🟡 Heads up — <user> has a draft PR #<number> touching <files>. Low risk but worth tracking.`
5. WHEN collision involves commits, message reads: `🟠 Warning — <user> pushed commits to <branch> (<date_range>) modifying <files>.`
6. WHEN multiple source types collide simultaneously, each source gets its own context line
7. WHEN Merge Hell involves mixed sources, the message explains the cross-branch nature with source context

### Requirement 5: Configuration

**User Story:** As a team lead, I want to configure which repositories are monitored for GitHub activity, so that the Konductor only tracks relevant repos without excessive API usage.

#### Acceptance Criteria

1. WHEN `konductor.yaml` includes a `github` section, THE Konductor SHALL poll those repositories for PRs and commits
2. WHEN no `github` section exists, THE Konductor SHALL operate without GitHub integration
3. WHEN the GitHub API returns an error or rate limit, THE Konductor SHALL log the error and retry next interval without disrupting active session tracking
4. THE GitHub PAT SHALL be stored in an environment variable referenced by `token_env` in the YAML config (default: `GITHUB_TOKEN`)
5. Configuration SHALL support per-repo branch lists for commit polling, `commit_lookback_hours` (default: 24), `poll_interval_seconds` (default: 60), and `include_drafts` (default: true)
6. THE Konductor SHALL hot-reload GitHub config changes via the existing `ConfigManager` file-watch mechanism

### Requirement 6: Query Tool Enhancements

**User Story:** As a software engineer, I want existing query tools to surface GitHub-sourced data, so that "who's on my files?" shows PR and commit overlaps alongside live sessions.

#### Acceptance Criteria

1. `who_overlaps` SHALL include session source type and metadata (PR number/URL or commit date range) for each overlap
2. `repo_hotspots` SHALL include files touched by passive sessions with source attribution
3. `coordination_advice` SHALL distinguish "talk to them now (live)" vs "review their PR" vs "check their commits"
4. `risk_assessment` SHALL factor in PR review status and source diversity
5. `who_is_active` SHALL include passive session users with a `source` field distinguishing them from active users
6. `active_branches` SHALL include branches with PR or commit activity even if no active session exists

### Requirement 7: Baton Dashboard Integration

**User Story:** As a developer, I want the Baton dashboard to display GitHub data, so that I can see open PRs and repo history alongside live collision state.

#### Acceptance Criteria

1. WHEN GitHub integration is configured, THE Baton Open PRs section SHALL display a table with Hours Open, Branch (linked), PR Number (linked), User (linked), Draft/Approved status, and file count
2. WHEN GitHub integration is configured, THE Baton Repo History section SHALL display commits, PRs, and merges with Timestamp, Action, User (linked), Branch, and Summary
3. WHEN a PR is opened, updated, merged, or closed, THE Baton SHALL receive a real-time SSE event and update the Open PRs and Repo History sections
4. WHEN a collision involves a passive session, THE Baton notifications table SHALL include the source type and relevant metadata in the Summary column
5. THE Baton health status computation SHALL include passive session overlaps when determining Alerting/Warning/Healthy

### Requirement 8: Documentation

**User Story:** As a software engineer, I want GitHub integration documented in the README.

#### Acceptance Criteria

1. THE README SHALL include a section on configuring GitHub credentials, repository list, polling interval, commit lookback, and branch filtering
2. THE README SHALL include example `konductor.yaml` with the `github` section
3. THE README SHALL include example client messages for each collision type (PR, approved PR, draft PR, commits, mixed)
