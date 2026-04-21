# Requirements: Konductor Live Share Integration

## Introduction

When Konductor detects a Collision Course or Merge Hell situation, users currently receive a warning and a suggestion to coordinate. But coordination today means switching to Slack, finding the other person, and manually setting up a pairing session. This feature bridges that gap by integrating VS Code Live Share directly into the Konductor collision workflow — allowing users to request, initiate, and join collaborative editing sessions without leaving their IDE.

The feature is designed in three phases: Slack-based collaboration requests (immediate value, low effort), server-relayed link exchange via the Baton dashboard (robust, async-friendly), and full IDE-native Live Share automation (the dream — contingent on IDE API availability).

## Dependencies

- `konductor-mcp-server` — session manager, collision evaluator, Baton event emitter, Slack notifier
- `konductor-collision-awareness` steering rule — collision notification flow where Live Share suggestions are surfaced
- VS Code Live Share extension (`ms-vsliveshare.vsliveshare`) — required on both parties' IDEs for Phase 3
- Slack integration (Phase 6) — used for collaboration request delivery in Phase 1
- Baton dashboard — used for collaboration request UI in Phase 2

## Glossary

- **Collaboration Request (Collab Request)**: A server-stored record indicating that one user wants to pair with another on specific files in a repo. Has a lifecycle: `pending` → `accepted` / `declined` / `expired`.
- **Live Share Session**: A VS Code Live Share collaborative editing session identified by a join URI (e.g., `https://prod.liveshare.vsengsaas.visualstudio.com/join?...`).
- **Initiator**: The user who requests the Live Share session (says `"konductor, live share with bob"`).
- **Recipient**: The user being invited to collaborate.
- **Share Link**: The Live Share join URI that the recipient uses to join the session.
- **Link Relay**: The server-side mechanism that stores and forwards a Live Share join URI from the initiator to the recipient.

## Requirements

### Requirement 1: Steering Rule Command — "konductor, live share with [user]"

**User Story:** As a developer who just hit a collision, I want to say "konductor, live share with bob" and have Konductor handle the coordination for me, so I don't have to context-switch to Slack or email.

#### Acceptance Criteria

1. WHEN the user says `"konductor, live share with <user>"` (case-insensitive, with or without `@` prefix on the username), THE agent SHALL parse the target username and initiate a collaboration request.
2. THE agent SHALL validate that the target user has an active session or recent activity in the same repo (via `who_is_active` or `user_activity`). IF the target user is not found, respond: `⚠️ Konductor: <user> doesn't appear to be active in this repo. They may be offline.`
3. WHEN the target user is valid, THE agent SHALL call the `create_collab_request` MCP tool with `{ initiator, recipient, repo, branch, files, collisionState }`.
4. THE agent SHALL print: `🤝 Konductor: Collaboration request sent to <user>. They'll be notified via Slack and their next Konductor check-in.`
5. WHEN the user says `"konductor, live share"` without specifying a user AND a collision is active, THE agent SHALL use the overlapping user(s) from the current collision state as the default recipient(s).
6. WHEN the user says `"konductor, live share"` without specifying a user AND no collision is active (Solo state), THE agent SHALL respond: `⚠️ Konductor: No active collisions detected. Specify a user: "konductor, live share with <user>"`
7. WHEN multiple users are in collision and no target is specified, THE agent SHALL auto-select the highest-severity overlapping user, display all collision partners with their severity, and proceed with the highest-risk partner. The agent SHALL inform the user they can override: `Say "konductor, live share with <other user>" to pair with someone else.`
8. WHEN the `create_collab_request` MCP tool call fails (server unreachable, timeout), THE agent SHALL display: `⚠️ Konductor: Server not reachable. Can't send collaboration request right now. Try again when the server is back online, or reach out to <user> directly.`
9. THE steering rule help output SHALL include the new command: `"konductor, live share with <user>"` — request a pairing session.

### Requirement 2: Proactive Live Share Suggestion

**User Story:** As a developer, I want Konductor to suggest Live Share when I'm in a high-risk collision, so I don't have to remember the command exists.

#### Acceptance Criteria

1. WHEN the collision state is **Collision Course**, THE agent SHALL append to the collision notification: `💡 Tip: Say "konductor, live share with <overlapping user>" to start a pairing session.`
2. WHEN the collision state is **Merge Hell**, THE agent SHALL append a stronger suggestion: `🤝 Strongly recommend pairing. Say "konductor, live share with <overlapping user>" to coordinate in real-time.`
3. THE Live Share suggestion SHALL appear after the existing coordination tip (`"konductor, who should I coordinate with?"`), not replace it.
4. WHEN multiple users are in collision, THE suggestion SHALL name the highest-severity overlapping user.

### Requirement 3: Server-Side Collaboration Request Store

**User Story:** As a server operator, I want collaboration requests stored on the server with a defined lifecycle, so that requests can be delivered asynchronously to recipients who may not be online at the moment of the request.

#### Acceptance Criteria

1. THE server SHALL maintain an in-memory store of collaboration requests with the schema: `{ requestId: UUID, initiator: string, recipient: string, repo: string, branch: string, files: string[], collisionState: CollisionState, shareLink?: string, status: "pending" | "accepted" | "declined" | "expired" | "link_shared", createdAt: ISO8601, updatedAt: ISO8601 }`.
2. THE `create_collab_request` MCP tool SHALL create a new request with status `pending` and return the `requestId`.
3. WHEN a request has been `pending` for more than 30 minutes (configurable via `KONDUCTOR_COLLAB_REQUEST_TTL`), THE server SHALL mark it as `expired`.
4. THE `list_collab_requests` MCP tool SHALL return all non-expired requests for a given user (as initiator or recipient), sorted newest-first.
5. THE `respond_collab_request` MCP tool SHALL accept `{ requestId, action: "accept" | "decline" }` and update the request status.
6. THE `share_link` MCP tool SHALL accept `{ requestId, shareLink: string }` and update the request with the Live Share join URI, setting status to `link_shared`.
7. WHEN a request status changes, THE server SHALL emit a Baton SSE event `collab_request_update` with the full request object.
8. WHEN a `create_collab_request` call specifies an initiator→recipient+repo combination that already has a `pending` request, THE server SHALL return the existing request's `requestId` instead of creating a duplicate (idempotent behavior).
9. WHEN the server detects mutual pending requests (A→B and B→A for the same repo), THE server SHALL auto-accept both requests and notify both parties.
10. WHEN a request is marked `expired`, THE server SHALL include the expiry in the initiator's next `pendingCollabRequests` response (status: `expired`) so the agent can notify them. Expired requests SHALL be included in responses for one additional check-in cycle after expiry, then removed.
11. A pending collaboration request SHALL NOT be automatically cancelled when the underlying collision resolves. The request remains pending until it is accepted, declined, or expires via TTL.

### Requirement 4: Slack Notification Delivery (Phase 1)

**User Story:** As a developer, I want the collaboration request to reach the recipient via Slack immediately, so they can respond even if they're not looking at their IDE.

#### Acceptance Criteria

1. WHEN a collaboration request is created AND Slack is configured for the repo, THE server SHALL send a Slack DM (or channel message if DM is not possible) to the recipient.
2. THE Slack message SHALL include: initiator name, repo, conflicting files, collision severity, and a call-to-action: "Open your IDE and say `konductor, accept collab from <initiator>`".
3. WHEN a share link is attached to the request, THE server SHALL send a follow-up Slack message to the recipient with the join link.
4. THE Slack notification SHALL respect the repo's Slack verbosity setting — collab requests are sent at verbosity ≥ 1.
5. WHEN Slack is not configured, THE agent SHALL inform the initiator: `⚠️ Konductor: Slack not configured for this repo. <user> will see the request on their next Konductor check-in or on the Baton dashboard.`

### Requirement 5: Recipient Agent Notification (Phase 1)

**User Story:** As a developer who receives a collaboration request, I want my Konductor agent to notify me automatically, so I can accept or decline without checking Slack.

#### Acceptance Criteria

1. WHEN the recipient's agent calls `register_session` or `check_status`, THE server response SHALL include a `pendingCollabRequests` array with any pending requests for that user.
2. WHEN the agent receives pending collab requests, IT SHALL display: `🤝 Konductor: <initiator> wants to pair with you on <files> (collision: <state>). Say "konductor, accept collab from <initiator>" or "konductor, decline collab from <initiator>".`
3. WHEN the user says `"konductor, accept collab from <user>"`, THE agent SHALL call `respond_collab_request` with action `accept` and print: `🟢 Konductor: Accepted. Start a Live Share session and say "konductor, share link <url>" to send it to <initiator>.`
4. WHEN the user says `"konductor, decline collab from <user>"`, THE agent SHALL call `respond_collab_request` with action `decline` and print: `👋 Konductor: Declined. <initiator> will be notified.`
5. WHEN a request is accepted or declined, THE initiator's next agent check-in SHALL include the status update, and the agent SHALL display: `🟢 Konductor: <recipient> accepted your collaboration request.` or `👋 Konductor: <recipient> declined your collaboration request.`
6. WHEN multiple pending collab requests exist for the same recipient, THE agent SHALL display all of them in a numbered list sorted by recency, with collision severity indicated for each.
7. WHEN a request the initiator created has expired, THE agent SHALL display on the initiator's next check-in: `⏰ Konductor: Your collaboration request to <recipient> expired (no response after <TTL> min). Say "konductor, live share with <recipient>" to try again.`
8. THE file watcher (`konductor-watcher.mjs`) SHALL parse `pendingCollabRequests` from `/api/register` and `/api/status` responses and log collab requests to the watcher terminal, so the recipient is notified even if the IDE chat panel is not in focus. The watcher SHALL deduplicate by `requestId` to avoid re-logging the same request.

### Requirement 6: Share Link Relay (Phase 2)

**User Story:** As a developer who accepted a collaboration request, I want to paste my Live Share link and have Konductor forward it to the other person, so we don't need a separate communication channel.

#### Acceptance Criteria

1. WHEN the user says `"konductor, share link <url>"`, THE agent SHALL validate the URL looks like a Live Share join link (contains `liveshare` or `vsengsaas.visualstudio.com`) and call the `share_link` MCP tool.
2. THE agent SHALL resolve the `requestId` automatically by finding the most recent accepted collab request where the current user is the recipient. IF no accepted request is found, THE agent SHALL inform the user: `⚠️ Konductor: No accepted collaboration request found. Accept a request first, then share the link.`
3. THE server SHALL store the link on the request and emit a `collab_request_update` SSE event.
4. THE initiator's agent SHALL receive the link on next check-in and display: `🔗 Konductor: <recipient> shared a Live Share link: <url>. Open it to join the session.`
5. IF Slack is configured, THE server SHALL also send the link to the initiator via Slack DM.
6. WHEN the user says `"konductor, share link"` without a URL AND a Live Share session is active in the IDE, THE agent SHALL attempt to retrieve the link from the IDE (Phase 3 dependency — see Requirement 8).

### Requirement 7: Baton Dashboard — Collaboration Requests Panel (Phase 2)

**User Story:** As a developer, I want to see pending collaboration requests on the Baton dashboard, so I have a visual overview of who wants to pair and can click to join.

#### Acceptance Criteria

1. THE Baton repo page SHALL include a "Collaboration Requests" section showing all non-expired requests for the repo.
2. EACH request SHALL display: initiator, recipient, files, collision state, status, age, and share link (if available).
3. THE share link SHALL be rendered as a clickable "Join Session" button.
4. THE section SHALL update in real-time via SSE `collab_request_update` events.
5. WHEN there are no pending requests, THE section SHALL display: "No active collaboration requests."

### Requirement 8: IDE Live Share Detection (Phase 3)

**User Story:** As a developer, I want Konductor to detect whether VS Code Live Share is installed in my IDE, so it can guide me through setup if needed.

#### Acceptance Criteria

1. WHEN the user initiates a live share command, THE agent SHALL check if the Live Share extension is available by running the appropriate IDE command (e.g., `code --list-extensions | grep ms-vsliveshare` for VS Code).
2. IF Live Share is NOT installed, THE agent SHALL offer to install it: `📦 Konductor: Live Share is not installed. Install it? (say "yes" to proceed)`. On confirmation, run `code --install-extension ms-vsliveshare.vsliveshare` (or the Kiro equivalent if available).
3. IF the IDE is Kiro and Kiro exposes an extension management API, THE agent SHALL use that API instead of CLI commands.
4. THE agent SHALL cache the Live Share installation status for the duration of the session (don't re-check every command).
5. IF the IDE does not support programmatic extension installation (no CLI, no API), THE agent SHALL print: `📦 Konductor: Please install the "Live Share" extension from the marketplace, then try again.`

### Requirement 9: IDE Live Share Session Automation (Phase 3)

**User Story:** As a developer, I want Konductor to start a Live Share session for me and automatically share the join link, so the entire flow is hands-free.

#### Acceptance Criteria

1. WHEN the user accepts a collab request (or initiates one) AND Live Share is installed, THE agent SHALL attempt to start a Live Share session by executing the IDE command `liveshare.start` (VS Code command palette command).
2. IF the IDE exposes a Live Share API (e.g., `vscode.extensions.getExtension('ms-vsliveshare.vsliveshare').exports.share()`), THE agent SHALL use the API to start the session and capture the returned join URI programmatically.
3. IF the join URI is captured programmatically, THE agent SHALL automatically call `share_link` to relay it to the other party. Print: `🔗 Konductor: Live Share session started. Link sent to <user>.`
4. IF the join URI cannot be captured programmatically (API not available, command-only), THE agent SHALL instruct the user: `📋 Konductor: Live Share session started. Copy the join link from the Live Share panel and say "konductor, share link <url>".`
5. WHEN the user says `"konductor, join <url>"` or clicks a join link, THE agent SHALL attempt to execute the IDE command `liveshare.join` with the URI.
6. IF Live Share requires authentication (first-time use), THE agent SHALL detect the auth prompt and inform the user: `🔑 Konductor: Live Share needs you to sign in with your Microsoft or GitHub account. Complete the sign-in, then try again.`

### Requirement 10: Backward Compatibility and Graceful Degradation

**User Story:** As a developer using an IDE that doesn't support Live Share (or without the extension installed), I want the collaboration request flow to still work via Slack and the dashboard, so I'm never blocked.

#### Acceptance Criteria

1. ALL Phase 1 and Phase 2 functionality (Slack notifications, agent check-in delivery, link relay, dashboard panel) SHALL work independently of whether Live Share is installed.
2. WHEN Live Share automation fails (extension not installed, API not available, command fails), THE agent SHALL fall back to the manual link exchange flow (Requirement 6) without error.
3. THE `create_collab_request` MCP tool SHALL NOT require Live Share to be installed — it is a server-side coordination mechanism.
4. WHEN the recipient is using a different IDE than the initiator, THE share link SHALL still work (Live Share join links are IDE-agnostic — they open in a browser if the extension isn't installed).
5. THE feature SHALL degrade gracefully across phases: Phase 3 features are additive on top of Phase 1+2, never required.

### Requirement 11: Configuration

**User Story:** As a server operator, I want to configure collaboration request behavior, so I can tune TTLs and disable the feature if needed.

#### Acceptance Criteria

1. THE server SHALL support the following environment variables:
   - `KONDUCTOR_COLLAB_ENABLED` (default: `true`) — master toggle for the collaboration request feature
   - `KONDUCTOR_COLLAB_REQUEST_TTL` (default: `1800` seconds / 30 minutes) — time before pending requests expire
   - `KONDUCTOR_COLLAB_SLACK_DM` (default: `true`) — whether to send Slack DMs for collab requests (vs. channel-only)
2. WHEN `KONDUCTOR_COLLAB_ENABLED` is `false`, THE `create_collab_request` tool SHALL return an error: `Collaboration requests are disabled on this server.`
3. THE admin dashboard SHALL include a toggle for enabling/disabling collaboration requests per-repo (future — not required for initial implementation).

## Phase 3 Research: IDE Integration Feasibility

### VS Code Live Share API

The `ms-vsliveshare.vsliveshare` extension exposes a public Node.js API when accessed via `vscode.extensions.getExtension()`:

```typescript
interface LiveShareExtensionApi {
  share(options?: ShareOptions): Promise<Uri>;  // Start session, returns join URI
  join(link: Uri): Promise<void>;               // Join an existing session
  end(): Promise<void>;                         // End the current session
  session: Session;                             // Current session state
  onDidChangeSession: Event<SessionChangeEvent>; // Session lifecycle events
}
```

Key capabilities:
- `share()` returns the join URI programmatically — no clipboard/UI scraping needed
- `join(uri)` can join a session from a URI without user interaction (after initial auth)
- `session.id` and `session.peerCount` provide session state
- `onDidChangeSession` fires on start/join/end — useful for automatic deregistration

### VS Code CLI

- `code --list-extensions` — check if Live Share is installed
- `code --install-extension ms-vsliveshare.vsliveshare` — install without user interaction
- `code --execute-command liveshare.start` — trigger the command, but does NOT return the join URI to stdout

### Kiro Considerations

Kiro is not VS Code. The following are open questions that determine Phase 3 feasibility:

1. **Extension marketplace access**: Can Kiro install VS Code extensions from the marketplace? If yes, `ms-vsliveshare.vsliveshare` can be installed programmatically.
2. **Extension API access**: Does Kiro expose `vscode.extensions.getExtension()` or an equivalent? If yes, the Live Share API can be called directly from agent tool execution.
3. **Command palette execution**: Can the agent execute arbitrary IDE commands (like `liveshare.start`)? The agent can run shell commands, but IDE commands are different.
4. **CLI availability**: Does Kiro have a CLI binary (like `code` for VS Code) that supports `--list-extensions` and `--install-extension`?

### Feasibility Assessment

| Capability | VS Code | Kiro (estimated) | Fallback |
|---|---|---|---|
| Detect Live Share installed | ✅ `code --list-extensions` | ❓ Needs Kiro CLI or API | Manual check by user |
| Install Live Share | ✅ `code --install-extension` | ❓ Needs Kiro CLI or API | User installs manually |
| Start session + get URI | ✅ Extension API `share()` | ❓ Needs extension API access | User starts manually, pastes link |
| Join session from URI | ✅ Extension API `join(uri)` | ❓ Needs extension API access | User clicks link (opens browser) |
| Detect session state | ✅ `onDidChangeSession` | ❓ Needs event subscription | Polling via agent check-in |

### Recommendation

Phase 3 should be implemented as an **optional enhancement layer** that auto-detects IDE capabilities at runtime:

1. Try Kiro-native APIs first (if they exist)
2. Fall back to VS Code CLI (`code` binary) if available
3. Fall back to manual instructions if neither works

This means Phase 3 code should be written but will gracefully degrade to Phase 2 behavior on IDEs that don't support programmatic Live Share control. The requirements (8, 9, 10) are written with this degradation in mind.
