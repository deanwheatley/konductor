# UI Test Coverage Requirements

## Backend-Frontend Test Parity

When adding or modifying backend tests (Python pytest), always consider whether corresponding UI tests (Playwright) are needed to verify the user-facing behavior.

### When to Add UI Tests

**Always add UI tests when**:
- Backend test creates or modifies data that users interact with (bookmarks, conversations, settings)
- Backend test validates business logic that affects UI behavior (cache strategies, authentication, permissions)
- Backend test sets up state that should be visible in the browser (messages, notifications, status indicators)
- Backend test involves user workflows (login, bookmark execution, conversation management)

**UI tests may not be needed when**:
- Backend test is purely internal (database migrations, utility functions, data validation)
- Backend test covers API endpoints not directly used by the UI
- Backend test validates server-side security or performance that has no UI manifestation

### Test Pattern: Backend Setup + UI Verification

1. **Backend Test**: Creates test data, validates structure and persistence
2. **UI Test**: Uses data created by backend test, verifies user interactions and UI feedback

### Anti-Patterns to Avoid

- Don't add backend test without considering UI impact
- Don't assume backend validation is sufficient for user-facing features
- Don't skip UI tests because "backend tests pass"
- Don't create UI tests that don't use real backend data
