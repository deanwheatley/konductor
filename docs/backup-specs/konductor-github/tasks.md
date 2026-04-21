# Implementation Plan

## Phase 1: Data Model & Core Infrastructure

- [x] 1. Extend WorkSession type with passive session fields
  - [x] 1.1 Add optional fields to `WorkSession` in `types.ts`: `source`, `prNumber`, `prUrl`, `prTargetBranch`, `prDraft`, `prApproved`, `commitDateRange`
  - [x] 1.2 Add `GITHUB` to `LogCategory` type in `logger.ts`
  - [x] 1.3 Add GitHub-specific log methods: `logGitHubPoll`, `logPrSessionCreated`, `logPrSessionRemoved`, `logCommitSessionCreated`, `logCommitSessionRemoved`
  - [x] 1.4 Update `PersistenceStore` to skip passive sessions on save (ephemeral — not persisted)
  - [x] 1.5 Write unit tests verifying passive sessions are excluded from persistence
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 2. Extend configuration for GitHub integration
  - [x] 2.1 Add `GitHubConfig` interface to `types.ts`: `tokenEnv`, `pollIntervalSeconds`, `includeDrafts`, `commitLookbackHours`, `repositories[]` with per-repo `commitBranches`
  - [x] 2.2 Extend `ConfigManager` to parse the `github` section from `konductor.yaml`
  - [x] 2.3 Ensure `ConfigManager` hot-reload triggers re-initialization of pollers when GitHub config changes
  - [x] 2.4 Add `GITHUB_TOKEN` to `.env.local.example`
  - [x] 2.5 Write unit tests for GitHub config parsing (present, absent, partial, invalid)
  - _Requirements: 5.1, 5.2, 5.4, 5.5, 5.6_

- [x] 3. Checkpoint — verify types and config compile and all existing tests pass

## Phase 2: GitHub Pollers

- [x] 4. Implement GitHubPoller
  - [x] 4.1 Create `github-poller.ts` with `GitHubPoller` class: constructor accepts `GitHubConfig`, `SessionManager`, `KonductorLogger`
  - [x] 4.2 Implement `pollPRs(repo)`: fetch open PRs via GitHub API, fetch changed files per PR, extract metadata (author, branch, target, draft, reviews)
  - [x] 4.3 Implement PR session lifecycle: create on new PR, update on file changes, remove on close/merge
  - [x] 4.4 Implement `start()` / `stop()` with configurable interval timer
  - [x] 4.5 Implement rate limit handling: respect `X-RateLimit-Remaining`, back off when low
  - [x] 4.6 Write unit tests with mocked GitHub API responses for all PR lifecycle events
  - [x] 4.7 Write property test: PR sessions match currently open PRs minus self-collision suppressions (Property 2)
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 5.3_

- [x] 5. Implement CommitPoller
  - [x] 5.1 Create `commit-poller.ts` with `CommitPoller` class
  - [x] 5.2 Implement `pollCommits(repo, branch)`: fetch recent commits within lookback window, group by author, aggregate changed files
  - [x] 5.3 Implement commit session lifecycle: create on new commits, remove when lookback expires
  - [x] 5.4 Write unit tests with mocked GitHub API responses
  - _Requirements: 2.1, 2.2, 2.3_

- [x] 6. Implement DeduplicationFilter
  - [x] 6.1 Create `deduplication-filter.ts` with `DeduplicationFilter` class
  - [x] 6.2 Implement self-collision suppression: skip passive session if user has active session in same repo
  - [x] 6.3 Implement PR-supersedes-commits: skip commit session if user has PR session covering same files
  - [x] 6.4 Implement active-supersedes-passive: skip own PR/commit sessions when active session exists
  - [x] 6.5 Write unit tests for all three deduplication rules
  - [x] 6.6 Write property test: self-collision never reported (Property 3)
  - [x] 6.7 Write property test: deduplication prevents redundant sessions (Property 6)
  - _Requirements: 1.7, 2.4, 3.6_

- [x] 7. Checkpoint — verify pollers and dedup work with mocked API, all tests pass

## Phase 3: Collision Evaluation & Formatting

- [x] 8. Extend CollisionEvaluator for mixed session types
  - [x] 8.1 Update `evaluate()` to include passive sessions in overlap detection (source-agnostic file matching)
  - [x] 8.2 Add severity weighting: approved PR → escalate, draft PR → de-escalate, PR targeting user's branch → escalate
  - [x] 8.3 Add `OverlappingSessionDetail` type with source attribution fields
  - [x] 8.4 Write property test: source-agnostic overlap detection (Property 1)
  - [x] 8.5 Write property test: severity weighting is monotonic (Property 4)
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 9. Extend SummaryFormatter for source-attributed messages
  - [x] 9.1 Update `format()` to generate per-source context lines (live session, PR, commits)
  - [x] 9.2 Handle mixed-source collisions with separate context per overlapping session
  - [x] 9.3 Handle Merge Hell with cross-branch source explanation
  - [x] 9.4 Write unit tests for all message formats: active-only, PR, approved PR, draft PR, commits, mixed, Merge Hell
  - [x] 9.5 Write property test: source attribution in all messages (Property 5)
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

- [x] 10. Checkpoint — verify collision evaluation and formatting, all tests pass

## Phase 4: Query Tool Enhancements

- [x] 11. Extend QueryEngine for passive sessions
  - [x] 11.1 Update `whoIsActive` to include passive session users with `source` field
  - [x] 11.2 Update `whoOverlaps` to include source type and metadata per overlap
  - [x] 11.3 Update `repoHotspots` to include passive session files with source attribution
  - [x] 11.4 Update `coordinationAdvice` to distinguish "review their PR" vs "talk to them" vs "check their commits"
  - [x] 11.5 Update `riskAssessment` to factor in PR review status and source diversity
  - [x] 11.6 Update `activeBranches` to include branches with PR/commit activity
  - [x] 11.7 Update `userActivity` to include passive sessions across repos
  - [x] 11.8 Write unit tests for each enhanced query tool with mixed session data
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [x] 12. Checkpoint — verify all query tools return correct data with passive sessions

## Phase 5: Baton Dashboard Integration

- [x] 13. Implement Open PRs section in Baton
  - [x] 13.1 Add `/api/github/prs/:repo` REST endpoint returning open PRs for a repo
  - [x] 13.2 Update `baton-page-builder.ts` to render the Open PRs table: Hours Open, Branch (linked), PR # (linked), User (linked), Status, Files count
  - [x] 13.3 Replace "GitHub Integration Coming Soon" placeholder with the PR table
  - [x] 13.4 Add SSE event type `github_pr_change` for real-time PR updates
  - [x] 13.5 Write unit tests for the PR table rendering and SSE events
  - _Requirements: 7.1, 7.3_

- [x] 14. Implement Repo History section in Baton
  - [x] 14.1 Add `/api/github/history/:repo` REST endpoint returning recent commits, PRs, and merges
  - [x] 14.2 Update `baton-page-builder.ts` to render the Repo History table: Timestamp, Action, User (linked), Branch, Summary
  - [x] 14.3 Replace "GitHub Integration Coming Soon" placeholder with the history table
  - [x] 14.4 Write unit tests for the history table rendering
  - _Requirements: 7.2_

- [x] 15. Update Baton notifications and health status
  - [x] 15.1 Update `baton-notification-store.ts` to include source context in notification summaries for passive session collisions
  - [x] 15.2 Update health status computation to include passive session overlaps
  - [x] 15.3 Write property test: Baton receives real-time GitHub events (Property 8)
  - _Requirements: 7.4, 7.5_

- [x] 16. Checkpoint — verify Baton displays GitHub data correctly

## Phase 6: Server Wiring & Integration

- [x] 17. Wire pollers into server startup
  - [x] 17.1 Instantiate `GitHubPoller` and `CommitPoller` in `createComponents()` when GitHub config is present
  - [x] 17.2 Start pollers after server starts listening
  - [x] 17.3 Stop pollers on server shutdown
  - [x] 17.4 Wire `ConfigManager` hot-reload to restart pollers on config change
  - [x] 17.5 Write property test: graceful degradation on API failure (Property 7)
  - _Requirements: 5.1, 5.2, 5.3, 5.6_

- [-] 18. Integration tests
  - [x] 18.1 End-to-end test: poll → dedup → session → collision → message with mocked GitHub API
  - [ ] 18.2 Test config hot-reload: add/remove repos, change polling interval
  - [ ] 18.3 Test edge cases: API rate limiting, empty PR file lists, paginated PRs (300+ files), mismatched commit author usernames

- [x] 19. Checkpoint — full integration test suite passes

## Phase 7: Documentation & Version Bump

- [x] 20. Update README
  - [x] 20.1 Add GitHub Integration section: configuration, credentials, example YAML
  - [x] 20.2 Add example client messages for each collision type
  - [x] 20.3 Update env vars table with `GITHUB_TOKEN`
  - [x] 20.4 Update Baton section to describe Open PRs and Repo History
  - _Requirements: 8.1, 8.2, 8.3_

- [x] 21. Update steering rules
  - [x] 21.1 Update collision notification section in all 4 steering rule copies to include source-attributed messages
  - [x] 21.2 Add "konductor, show PRs" and "konductor, show history" query routing

- [x] 22. Version bump and final checkpoint
  - [x] 22.1 Bump `konductor/package.json` and `konductor-setup/package.json`
  - [x] 22.2 Run full test suite — all tests must pass
  - [x] 22.3 Rebuild and restart server to verify
