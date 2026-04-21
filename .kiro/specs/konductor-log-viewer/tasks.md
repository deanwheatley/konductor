# Implementation Plan

- [ ] 1. Create log reader module and round-trip tests
  - [ ] 1.1 Implement `log-reader.ts` with `parseLogLine`, `formatLogLine`, and `readLogFile` functions
    - Reuse the existing `LogEntry` type and log line regex from `logger.ts`
    - `readLogFile` reads the file, parses each line, skips malformed lines, returns newest-first up to `maxEntries`
    - `parseLogLine` returns `LogEntry | null` (null for malformed)
    - `formatLogLine` produces the canonical `[TIMESTAMP] [CATEGORY] [ACTOR] message` string
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 2.2, 2.3_
  - [ ] 1.2 Write property test: parse/format round-trip identity
    - **Property 5: Parse/format round-trip identity**
    - **Validates: Requirements 8.1, 8.2, 8.3**
  - [ ] 1.3 Write property test: malformed lines are rejected
    - **Property 6: Malformed lines are rejected**
    - **Validates: Requirements 8.4**
  - [ ] 1.4 Write property test: log file reader limits to N entries newest-first
    - **Property 1: Log file reader limits to N entries newest-first**
    - **Validates: Requirements 2.2**

- [ ] 2. Checkpoint - Make sure all tests are passing
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 3. Create client-side filter/sort logic and property tests
  - [ ] 3.1 Implement filter and sort functions in `log-viewer-filter.ts`
    - `filterEntries(entries, { categories, actorFilter, messageFilter })` — AND logic across all filters
    - `sortEntries(entries, column, direction)` — lexicographic sort by any column
    - Pure functions, no DOM dependency, testable in isolation
    - _Requirements: 3.1, 4.1, 5.1, 6.1, 6.2, 6.3, 9.1_
  - [ ] 3.2 Write property test: combined filter applies AND logic
    - **Property 2: Combined filter applies AND logic**
    - **Validates: Requirements 3.1, 4.1, 5.1, 9.1**
  - [ ] 3.3 Write property test: sorting produces correctly ordered results
    - **Property 3: Sorting produces correctly ordered results**
    - **Validates: Requirements 6.1, 6.2**
  - [ ] 3.4 Write property test: sorting preserves the filtered entry set
    - **Property 4: Sorting preserves the filtered entry set**
    - **Validates: Requirements 6.3**

- [ ] 4. Checkpoint - Make sure all tests are passing
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Build the log viewer page and admin routes
  - [ ] 5.1 Implement `log-viewer-page-builder.ts` with `buildLogViewerPage(username)`
    - Full HTML page with table (Timestamp, Category, Actor, Message columns)
    - Filter controls: category multi-select, actor text input, message search input
    - Sort on column header click with direction toggle
    - SSE connection for live tailing with disconnected indicator
    - Reuse admin dashboard styles and dark theme
    - _Requirements: 2.1, 3.1, 3.3, 4.1, 5.1, 6.1, 6.2, 7.1, 7.2, 7.3_
  - [ ] 5.2 Add routes to `admin-routes.ts`
    - `GET /admin/logs` — serve log viewer page (auth + admin check, redirect if unauthenticated)
    - `GET /api/admin/logs` — return JSON `{ entries, totalLines, skippedLines }`
    - `GET /api/admin/logs/stream` — SSE stream using `fs.watch` on the log file, parse new lines, send as JSON events
    - _Requirements: 1.2, 1.3, 2.1, 2.2, 2.3, 7.1_
  - [ ] 5.3 Add "View Logs" button to `buildSystemSettingsPanel()` in `admin-page-builder.ts`
    - Add an `<a>` styled as a button linking to `/admin/logs` (opens in new tab)
    - _Requirements: 1.1, 1.2_
  - [ ] 5.4 Write unit tests for log viewer routes
    - Test auth redirect for unauthenticated `/admin/logs`
    - Test 403 for non-admin `/api/admin/logs`
    - Test JSON response shape for `/api/admin/logs`
    - Test "View Logs" button exists in admin dashboard HTML
    - _Requirements: 1.1, 1.2, 1.3, 2.1_

- [ ] 6. Final Checkpoint - Make sure all tests are passing
  - Ensure all tests pass, ask the user if questions arise.
