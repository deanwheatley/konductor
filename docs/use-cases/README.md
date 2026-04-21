# Konductor Use Cases

Comprehensive use-case documentation organized by feature area and user role. These use cases serve as the authoritative source for regression testing.

## Structure

| File | Scope |
|------|-------|
| `01-client-connection.md` | Client onboarding, connection lifecycle, reconnection |
| `02-collision-scenarios.md` | All collision states with concrete multi-user scenarios |
| `03-file-watcher.md` | Watcher lifecycle, auto-update, offline behavior |
| `04-admin-dashboard.md` | Admin panel operations, settings, user management |
| `05-bundle-management.md` | Bundle store, channels, promotion, rollback |
| `06-baton-dashboard.md` | Repo page, real-time updates, notifications |
| `07-slack-integration.md` | Slack notifications, per-repo config, verbosity |
| `08-github-integration.md` | PR polling, commit polling, passive sessions |
| `09-chat-commands.md` | All "konductor," prefixed commands |
| `10-steering-rules.md` | Agent behavior, auto-registration, collision checks |
| `11-auto-update-and-versioning.md` | Version management, channel updates, rollback propagation |
| `12-notifications.md` | Full notification lifecycle across all delivery channels |

## Roles

- **Client**: A developer using Kiro/Antigravity with Konductor connected
- **Admin**: A user with admin access (via `KONDUCTOR_ADMINS` env or database flag)
- **Server Operator**: The person running the Konductor server

## Testing with testrepo

When `testrepo` is available in the workspace, regression tests SHOULD use it as the client project for end-to-end testing. The testrepo has:
- A working Konductor client installation (watcher, hooks, steering, MCP config)
- A `client-verification.mjs` script for API-level smoke tests
- Sample files in `docs/` for triggering file change events

## Test Execution Notes

- Use Playwright for browser-based tests (Baton dashboard, admin panel)
- Use the `client-verification.mjs` pattern for API-level tests
- Use testrepo's file watcher for client-side behavior verification
- The Konductor server must be running for all tests (start via `start-konductor.sh`)
