# Feature Completeness Rule

## When implementing any feature or fixing any bug, always update:

1. **Use-case documents** (`docs/use-cases/`) — add or update use cases that describe the new behavior from the user's perspective
2. **Regression test plan** (`docs/use-cases/REGRESSION-TEST-PLAN.md`) — add test IDs for every new behavior, update existing tests whose expectations changed, remove "MISSING" tags for features that are now implemented
3. **Client verification script** (`testrepo/client-verification.mjs`) — add API-level tests for any new or changed REST endpoints
4. **Regression findings** (`.kiro/specs/konductor-bugs-and-missing-features/regression-findings.md`) — update status of fixed bugs and note new findings

## Applies to:

- New REST API endpoints
- Changed response payloads (new fields, removed fields, changed formats)
- New MCP tools or changed tool parameters/responses
- New watcher behaviors (offline queue, branch detection, etc.)
- New steering rule commands or changed routing
- New admin dashboard features or panels
- New Baton dashboard sections or SSE events
- Bug fixes that change observable behavior

## Do not skip this even for "small" changes. A missing test is a future regression.
