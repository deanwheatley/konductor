# Requirements: Live Share Dashboard Visibility & Regression Coverage

## Introduction

The Konductor Live Share feature (konductor-live-share spec) introduced collaboration requests, link sharing, and IDE automation. However, the Baton dashboard's Collaboration Requests panel currently shows request status but lacks visibility into which users are actively in a Live Share session and what recommended actions are available. Additionally, the regression test plan has zero coverage for the live-share feature, and no Playwright E2E tests exist for the collab request panel or REST endpoints.

This spec addresses three gaps:
1. Enhancing the Baton repo page to show active Live Share sessions and recommended actions
2. Adding comprehensive live-share use cases to the regression test plan
3. Implementing Playwright E2E tests and client-verification API tests for the live-share feature

## Glossary

- **Baton Dashboard**: The per-repository web page served by Konductor at `/repo/:repoName`, showing real-time session, collision, and notification data.
- **Collaboration Request**: A server-stored record indicating one user wants to pair with another. Lifecycle: `pending` → `accepted` / `declined` / `expired` / `link_shared`.
- **Active Live Share Session**: A collaboration request with status `link_shared`, indicating both parties have exchanged a Live Share join URI and may be actively pairing.
- **Recommended Action**: A contextual suggestion displayed on the dashboard when a collision is detected, guiding users toward resolution (e.g., "Start a Live Share session", "Rebase", "Coordinate").
- **Regression Test Plan**: The document at `docs/use-cases/REGRESSION-TEST-PLAN.md` mapping every use case to a specific test with ID, priority, method, and expected result.
- **Collab Request Panel**: The "Collaboration Requests" section on the Baton repo page that renders non-expired collab requests.

## Requirements

### Requirement 1: Active Live Share Session Indicator

**User Story:** As a developer viewing the Baton dashboard, I want to see which users are currently in an active Live Share session, so that I know who is pairing and on what files.

#### Acceptance Criteria

1. WHEN a collaboration request has status `link_shared`, THE Baton repo page SHALL display an "Active Session" indicator on that request card with a distinct visual style (e.g., green pulsing dot or "🟢 Live" badge).
2. WHEN a collaboration request has status `accepted` (link not yet shared), THE Baton repo page SHALL display a "Waiting for Link" indicator on that request card.
3. WHEN the Repository Summary section renders active users, THE Baton repo page SHALL annotate user pills with a pairing icon (e.g., 🤝) for users who are part of an active `link_shared` collaboration request.
4. WHEN no collaboration requests have status `link_shared` or `accepted`, THE Baton repo page SHALL display the standard Collaboration Requests panel without session indicators.

### Requirement 2: Recommended Actions on Dashboard

**User Story:** As a developer viewing the Baton dashboard during a collision, I want to see recommended actions for resolving the collision, so that I can take action directly from the dashboard.

#### Acceptance Criteria

1. WHEN the repo health status is `warning` or `alerting` (Collision Course or Merge Hell), THE Baton repo page SHALL display a "Recommended Actions" section within the Repository Summary panel.
2. THE Recommended Actions section SHALL include contextual suggestions based on the collision state: "Start a Live Share session" for Collision Course, "Coordinate immediately" for Merge Hell.
3. EACH recommended action SHALL include the chat command the user can type in their IDE (e.g., `konductor, live share with <user>`).
4. WHEN the collision state is `healthy` or `solo`, THE Baton repo page SHALL hide the Recommended Actions section.

### Requirement 3: Regression Test Plan — Live Share Coverage

**User Story:** As a QA engineer, I want every live-share use case mapped to a regression test, so that no live-share behavior goes untested.

#### Acceptance Criteria

1. THE regression test plan SHALL include a "Section 13: Live Share Integration" covering all 30 use cases from `konductor-live-share/use-cases.md`.
2. EACH test entry SHALL have a unique ID (T-356 onwards), use case reference, priority, method, description, and expected result.
3. THE test entries SHALL cover: collab request creation (API), collab request response (API), share link relay (API), Baton panel rendering (Playwright), SSE real-time updates (Playwright), Slack notification delivery (API), agent check-in piggyback (API), watcher terminal notification (Shell), graceful degradation (API), and edge cases (API).
4. THE regression test plan summary table SHALL be updated with the new section's test counts.

### Requirement 4: Playwright E2E Tests — Collab Request Panel

**User Story:** As a developer, I want Playwright tests verifying the Baton dashboard's Collaboration Requests panel, so that UI regressions are caught automatically.

#### Acceptance Criteria

1. THE Playwright test suite SHALL include tests for: collab panel visibility, empty state rendering, request card rendering with all fields, status badge styling, "Join Session" button for `link_shared` requests, SSE real-time updates for `collab_request_update` events, and active session indicators.
2. THE Playwright tests SHALL use the existing test server helper pattern (port 3199, `startTestServer`/`stopTestServer`).
3. THE Playwright tests SHALL seed collab requests via the `CollabRequestStore` directly (same pattern as notification seeding).

### Requirement 5: Client Verification — Collab Request REST Endpoints

**User Story:** As a developer, I want API-level tests in `client-verification.mjs` for the collab request REST endpoints, so that the API contract is verified from a real client perspective.

#### Acceptance Criteria

1. THE client verification script SHALL test `GET /api/repo/:repoName/collab-requests` returning an array of requests.
2. THE client verification script SHALL test `POST /api/collab-requests/:requestId/respond` with accept and decline actions.
3. THE client verification script SHALL verify that the Baton repo page HTML contains the "Collaboration Requests" section.
