# Implementation Plan

## Track 1: Repo Page Enhancements

- [x] 1. Enhance Collab Request Cards with Live Session Indicators (Req 1, 2)
  - [x] 1.1 Add live session badges to `renderCollabRequestRow()` in `baton-page-builder.ts`
    - When `status === "link_shared"`: render a pulsing `🟢 Live` badge with green left border on the card
    - When `status === "accepted"`: render a `⏳ Waiting for Link` badge
    - Add CSS for `.live-badge` (pulsing animation), `.waiting-badge`, and green left border on live cards
    - Update the client-side `renderCollabRequests()` JS function with matching logic
    - _Requirements: 1.1, 1.2_
  - [x] 1.2 Write property test for status-specific indicator rendering
    - **Property 1: Status-specific indicator rendering**
    - **Validates: Requirements 1.1, 1.2**
    - Use fast-check to generate `CollabRequest` objects with random statuses
    - Verify `renderCollabRequestRow()` output contains "Live" for `link_shared`, "Waiting" for `accepted`
  - [x] 1.3 Add pairing icon to user pills in `renderSummary()` client-side JS
    - Cross-reference `collabRequests` array with user list in summary
    - If a user is initiator or recipient of a `link_shared` or `accepted` request, append 🤝 icon to their pill
    - _Requirements: 1.3, 1.4_
  - [x] 1.4 Add Recommended Actions card to `renderSummary()` client-side JS
    - Only render when `healthStatus` is `"warning"` or `"alerting"`
    - Show contextual suggestions: "Start a Live Share session" with `konductor, live share with <user>` command, "Get coordination advice" with `konductor, who should I coordinate with?`, "Check risk level" with `konductor, am I safe to push?`
    - Extract overlapping user name from summary data for the live share command
    - Add CSS for `.recommended-actions`, `.recommended-actions-header`, `.action-item`
    - Hide when health is `"healthy"`
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [x] 1.5 Write unit tests for enhanced rendering
    - Test `renderCollabRequestRow()` with each status produces correct badge HTML
    - Test recommended actions card appears only for warning/alerting health
    - _Requirements: 1.1, 1.2, 2.1, 2.4_

- [x] 2. Checkpoint — Repo page enhancements
  - Ensure all tests pass, ask the user if questions arise.

## Track 2: Regression Test Plan & Use Case Coverage

- [x] 3. Add Live Share section to Regression Test Plan (Req 3)
  - [x] 3.1 Add Section 13: Live Share Integration to `REGRESSION-TEST-PLAN.md`
    - Map all 30 use cases from `konductor-live-share/use-cases.md` to test entries
    - Assign test IDs T-356 through T-395+
    - Cover: collab request CRUD (API), Baton panel rendering (Playwright), SSE updates (Playwright), Slack delivery (API), agent check-in piggyback (API), watcher terminal (Shell), graceful degradation (API), edge cases (API), IDE automation (Agent/manual)
    - _Requirements: 3.1, 3.2, 3.3_
  - [x] 3.2 Update summary table in `REGRESSION-TEST-PLAN.md`
    - Add Section 13 row with test counts by priority
    - Update total counts
    - _Requirements: 3.4_

- [x] 4. Checkpoint — Regression test plan
  - Ensure all tests pass, ask the user if questions arise.

## Track 3: Automated Tests

- [x] 5. Playwright E2E Tests for Collab Panel (Req 4)
  - [x] 5.1 Create `e2e/collab-requests.spec.ts` with test server setup
    - Use existing `startTestServer`/`stopTestServer` pattern from `helpers.ts`
    - Add `addCollabRequest()` helper to `helpers.ts` that creates requests via `CollabRequestStore`
    - _Requirements: 4.2, 4.3_
  - [x] 5.2 Write Playwright tests for collab panel
    - Test: collab panel visible on repo page (`#collab-panel` exists)
    - Test: empty state shows "No active collaboration requests."
    - Test: pending request card renders with initiator, recipient, files, collision state, status, age
    - Test: `link_shared` request shows "Live" badge and "Join Session" button
    - Test: `accepted` request shows "Waiting for Link" badge
    - Test: SSE `collab_request_update` event updates panel in real-time
    - Test: user pills show 🤝 icon for users in active collab requests
    - Test: recommended actions card visible when health is warning/alerting
    - Test: recommended actions card hidden when health is healthy
    - _Requirements: 4.1_
  - [x] 5.3 Write unit tests for addCollabRequest helper
    - Verify helper creates requests with correct fields
    - _Requirements: 4.3_

- [x] 6. Client Verification — Collab REST Endpoints (Req 5)
  - [x] 6.1 Add collab request tests to `testrepo/client-verification.mjs`
    - Test `GET /api/repo/testrepo/collab-requests` returns `{ requests: [] }` or array
    - Test Baton HTML contains "Collaboration Requests" section
    - _Requirements: 5.1, 5.3_

- [x] 7. Checkpoint — All automated tests
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Run Full Regression Suite
  - [x] 8.1 Run existing Playwright E2E tests
    - `npx playwright test` in `konductor/konductor`
    - Verify all existing baton-dashboard, admin-dashboard, and slack-integration tests pass
  - [x] 8.2 Run client-verification from testrepo
    - `node client-verification.mjs` in `testrepo`
    - Verify all API tests pass including new collab request tests
  - [x] 8.3 Run vitest unit tests
    - `npx vitest run` in `konductor/konductor`
    - Verify all unit tests pass including new property tests and render tests

- [x] 9. Final Checkpoint
  - Ensure all tests pass, ask the user if questions arise.
