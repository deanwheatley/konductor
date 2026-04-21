# Regression Test Findings

## Section 1: Client Connection

### Results: 36/36 tests PASS (after fixes)

### Bugs Found & Fixed

#### BUG-001: Admin dashboard bypasses auth when KONDUCTOR_ADMIN_AUTH=false (T-112) — FIXED
- **File**: `src/admin-routes.ts`
- **Fix**: Removed blanket auth bypass. Now requires cookie or API key header even in dev mode. `KONDUCTOR_ADMIN_AUTH=false` only bypasses admin role check.

### Test Fixes Applied

- FIX-001: Slack integration test env leak — clear `SLACK_BOT_TOKEN` before "no token" test
- FIX-002: Bundle registry property test — filter filesystem-unsafe chars from generator
- FIX-003: Playwright e2e helpers — explicitly set `KONDUCTOR_ADMIN_AUTH=true` in test setup
- FIX-004: Slack panel locator — use `getByRole("heading")` instead of `getByText`

## Section 2: Collision Scenarios

### Results: 27/27 API tests PASS (after fixes)

### Bugs Found & Fixed

#### BUG-002: No REST API deregister endpoint (T-056) — FIXED
- **File**: `src/index.ts`
- **Fix**: Added `POST /api/deregister` REST endpoint accepting `{ sessionId }`, returns `{ success, sessionId }` or 404.

#### BUG-003: `sharedFiles` not in register_session response (T-047) — FIXED
- **File**: `src/index.ts`
- **Fix**: Added `sharedFiles: result.sharedFiles` to both MCP and REST register response payloads.

### Design Notes (not bugs)
- NOTE-001: Parent/child directory (`src/` vs `src/utils/`) returns `neighbors` not `crossroads` — correct behavior, test plan updated
- NOTE-002: Root-level files share same directory — tests updated to use files in different parent dirs

## Overall Test Results

| Suite | Result |
|-------|--------|
| Unit Tests (vitest) | 721/721 PASS (49 files) |
| Playwright E2E | 92/92 PASS (3 spec files) |
| Client Verification | 56/57 PASS (watcher not running — expected) |
| Section 2 API Tests | 9/9 PASS |

### Files Modified
- `src/admin-routes.ts` — auth bypass fix
- `src/index.ts` — added sharedFiles to register response, added /api/deregister endpoint
- `src/slack-integration.test.ts` — env leak fix
- `src/bundle-registry.property.test.ts` — generator fix
- `e2e/admin-dashboard.spec.ts` — locator fix
- `e2e/helpers.ts` — env leak fix
- `testrepo/client-verification.mjs` — added sharedFiles and deregister tests
- `docs/use-cases/REGRESSION-TEST-PLAN.md` — updated test expectations
