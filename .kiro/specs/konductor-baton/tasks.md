# Implementation Plan

- [x] 1. Define Baton types and data models
  - [x] 1.1 Create `konductor/src/baton-types.ts` with HealthStatus enum, BatonNotification, BatonNotificationUser, QueryLogEntry, RepoSummary, RepoBranch, RepoActiveUser, BatonEvent, RepoHistoryEntry interfaces, and freshness color scale constants
    - Include the `computeHealthStatus(states: CollisionState[]): HealthStatus` pure function
    - Include the `computeFreshnessLevel(lastHeartbeat: string, intervalMinutes: number): number` pure function
    - Include default freshness color hex array and interval constant
    - _Requirements: 2.3, 2.7, 2.8_
  - [x] 1.2 Write property test for health status rubric
    - **Property 3: Health status rubric correctness**
    - **Validates: Requirements 2.3**
  - [x] 1.3 Write unit tests for freshness level computation
    - Test boundary values at each of the 10 levels
    - Test with custom interval values
    - _Requirements: 2.7, 2.8_

- [x] 2. Implement NotificationStore with serialization
  - [x] 2.1 Create `konductor/src/baton-notification-store.ts` implementing INotificationStore
    - In-memory Map keyed by notification ID
    - `add()`, `getActive()`, `getResolved()`, `resolve()` methods
    - `serialize()` / `deserialize()` for JSON persistence
    - `prettyPrint()` / `parse()` for human-readable round-trip format
    - _Requirements: 3.5, 9.1, 9.2, 9.3, 9.4, 9.5_
  - [x] 2.2 Write property test for notification resolve invariant
    - **Property 5: Resolving a notification moves it from active to resolved**
    - **Validates: Requirements 3.5**
  - [x] 2.3 Write property test for JSON serialization round-trip
    - **Property 8: Notification JSON serialization round-trip**
    - **Validates: Requirements 9.3**
  - [x] 2.4 Write property test for pretty-print round-trip
    - **Property 9: Notification pretty-print round-trip**
    - **Validates: Requirements 9.5**

- [x] 3. Implement QueryLogStore
  - [x] 3.1 Create `konductor/src/baton-query-log.ts` implementing IQueryLogStore
    - In-memory ring buffer (max 1000 entries per repo)
    - `add()` and `getEntries(repo)` methods
    - _Requirements: 4.1, 4.2_
  - [x] 3.2 Write property test for query log addition and retrieval
    - **Property 6: Query log entry addition and retrieval**
    - **Validates: Requirements 4.1, 4.2**

- [x] 4. Implement BatonEventEmitter
  - [x] 4.1 Create `konductor/src/baton-event-emitter.ts` implementing IBatonEventEmitter
    - Lightweight pub/sub filtered by repo
    - `emit()`, `subscribe(repo, callback)` returning unsubscribe function
    - _Requirements: 7.1, 7.2_

- [x] 5. Checkpoint - Make sure all tests are passing
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement repo summary builder and URL builder
  - [x] 6.1 Create `konductor/src/baton-repo-summary.ts` with `buildRepoSummary()` function
    - Takes SessionManager, CollisionEvaluator, repo string, and freshness config
    - Returns RepoSummary with healthStatus, branches, users with lastHeartbeat, session/user counts
    - Reads `BATON_FRESHNESS_INTERVAL_MINUTES` and `BATON_FRESHNESS_COLORS` from env
    - _Requirements: 2.1, 2.2, 2.3, 2.7, 2.8_
  - [x] 6.2 Create `konductor/src/baton-url.ts` with `buildRepoPageUrl()` function
    - Takes host, port, and repo in `owner/repo` format
    - Returns URL matching `http://<host>:<port>/repo/<owner>/<repo>`
    - _Requirements: 6.1, 6.3_
  - [x] 6.3 Write property test for repo summary completeness
    - **Property 2: Repo summary contains repo name, GitHub link, and all active branches**
    - **Validates: Requirements 2.1, 2.2**
  - [x] 6.4 Write property test for URL pattern
    - **Property 7: Repo page URL in registration response follows correct pattern**
    - **Validates: Requirements 6.1, 6.3**

- [x] 7. Build the repo page HTML generator
  - [x] 7.1 Create `konductor/src/baton-page-builder.ts` with `buildRepoPage()` function
    - Generates complete HTML document with embedded CSS and JS matching the mockup design
    - Five sections: Repository Summary (always visible), Notifications & Alerts, Query Log, Open PRs, Repo History (all collapsible)
    - Responsive fluid layout with flex/grid, no fixed widths
    - Dark theme matching mockup colors
    - Health status color-coded badge in summary header
    - Active users as freshness-colored pills with "Xm ago" labels
    - Branch tags linking to GitHub
    - Notifications table with Type/State badges, Branch links, JIRA column, truncated summaries with "see more", user links, resolve buttons
    - Query log table with user links, branch links, query type badges, monospace params
    - Open PRs and Repo History sections with "GitHub Integration Coming Soon" placeholders
    - Filter bars above notifications and query log tables
    - Sortable column headers with sort arrows
    - Active/History tab toggle for notifications
    - Collapsible section headers with chevron icons and count badges
    - Connection status bar at top
    - Client-side JS for SSE connection, data fetching, sorting, filtering, collapse/expand, resolve confirmation
    - SSE reconnect with exponential backoff and disconnection banner
    - _Requirements: 1.1, 1.3, 1.5, 2.1, 2.2, 2.4, 2.5, 2.6, 2.7, 3.2, 3.3, 3.4, 3.6, 3.7, 4.2, 4.3, 4.4, 5.1, 7.1, 7.3, 10.1, 11.1, 11.2, 11.3, 11.4_
  - [x] 7.2 Write property test for page section completeness
    - **Property 1: Repo page contains all five sections**
    - **Validates: Requirements 1.1**
  - [x] 7.3 Write property test for notification rendering
    - **Property 4: Notification rendering contains all required fields and correct links**
    - **Validates: Requirements 3.2, 3.3**

- [x] 8. Checkpoint - Make sure all tests are passing
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Wire Baton API endpoints into the HTTP server
  - [x] 9.1 Add Baton API routes to `konductor/src/index.ts`
    - `GET /repo/:owner/:repo` — serve repo page HTML from buildRepoPage()
    - `GET /api/repo/:owner/:repo` — return repo summary JSON from buildRepoSummary()
    - `GET /api/repo/:owner/:repo/notifications` — return notifications from NotificationStore (with ?status query param)
    - `GET /api/repo/:owner/:repo/log` — return query log entries from QueryLogStore
    - `POST /api/repo/:owner/:repo/notifications/:id/resolve` — resolve notification
    - `GET /api/repo/:owner/:repo/events` — SSE stream from BatonEventEmitter
    - Handle 404 for invalid repo URL patterns
    - Initialize NotificationStore, QueryLogStore, BatonEventEmitter in createComponents()
    - _Requirements: 1.1, 1.2, 1.4, 3.5, 7.1_
  - [x] 9.2 Hook NotificationStore into session registration flow
    - After collision evaluation in register_session, create a BatonNotification if collision state changed
    - Emit `notification_added` event via BatonEventEmitter
    - Emit `session_change` event on register/update/deregister
    - _Requirements: 3.1, 7.2_
  - [x] 9.3 Hook QueryLogStore into query tool invocations
    - In each query tool handler (who_is_active, who_overlaps, etc.), add a QueryLogEntry to the store
    - Emit `query_logged` event via BatonEventEmitter
    - _Requirements: 4.1_

- [x] 10. Add repo page URL to registration response
  - [x] 10.1 Modify register_session response in `konductor/src/index.ts` to include `repoPageUrl` field
    - Use buildRepoPageUrl() with server host and port
    - Include in both MCP tool response and REST API response
    - _Requirements: 6.1, 6.3_

- [x] 11. Checkpoint - Make sure all tests are passing
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Update README documentation
  - [x] 12.1 Add Baton dashboard section to `konductor/README.md`
    - Describe how to access the repo page (URL pattern)
    - List what information each section displays
    - Document the freshness color scale configuration env vars
    - _Requirements: 8.1_

- [x] 13. Final Checkpoint - Make sure all tests are passing
  - Ensure all tests pass, ask the user if questions arise.
