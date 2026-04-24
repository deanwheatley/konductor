# Requirements Document

## Introduction

The Konductor Local Bundle Store provides a filesystem-backed installer bundle registry for local development. When `KONDUCTOR_SERVE_CLIENT_BUNDLES_FROM_LOCAL_STORE=true`, the server scans a local `installers/` directory for versioned `.tgz` bundles, populates an in-memory registry, and serves them through the admin dashboard's Bundle Manager page. Admins assign specific versions to channels (Dev, UAT, Prod) via dropdowns. Bundle metadata (version, size, creation date, feature summary) is extracted automatically from the tarball's embedded `bundle-manifest.json`. Deleting a bundle that is assigned to a channel triggers a "stale" state for affected clients — they receive a warning and are offered the replacement bundle once the admin assigns a new version.

This spec covers the local development use case only. Cloud-hosted bundle storage with upload capability is covered by the `konductor-installer-registry` spec.

## Dependencies

- `konductor-admin` — provides the admin dashboard, authentication, settings store, SSE events, and the Global Client Settings panel
- `konductor-npx-installer` — provides the installer tarball format, client auto-update mechanism, and `/bundle/installer-*.tgz` serving endpoints

## Glossary

- **Local Bundle Store**: A filesystem directory (`installers/` relative to the server working directory) containing versioned `.tgz` installer bundles
- **Bundle Registry**: An in-memory index of all bundles discovered in the local store, keyed by semver version
- **Bundle Manifest**: A JSON file (`bundle-manifest.json`) embedded inside each `.tgz` bundle containing version, author, creation date, and a feature summary
- **Channel Assignment**: The mapping from a release channel (Dev, UAT, Prod) to a specific version in the bundle registry
- **Latest Pseudo-Channel**: A per-user channel override that always resolves to the most recently created bundle in the registry (by creation date)
- **Stale Client**: A client whose assigned channel points to a bundle version that has been deleted from the registry; the client receives a warning and is offered the replacement once available
- **Semver**: Semantic Versioning 2.0.0 — `MAJOR.MINOR.PATCH[-prerelease][+build]`
- **KONDUCTOR_SERVE_CLIENT_BUNDLES_FROM_LOCAL_STORE**: Environment variable; when `true`, enables the local bundle store
- **KONDUCTOR_STARTUP_LOCAL**: Environment variable; when `true`, indicates local development mode (relaxed auth, pre-filled login, local store)

## UI Reference

The mockup at `konductor/konductor/mockups/bundle-manager.html` serves as the authoritative UI guide for the Bundle Manager page. All UI implementation SHALL match the mockup's layout, color scheme, component structure, and interaction patterns. The mockup defines:

- Channel assignment summary cards (top row: Dev, UAT, Prod, Latest)
- Bundle table with columns: Version, Channels (pill badges), Size, Created, Uploaded, Author, Notes, Actions
- "Local Store Mode" badge (yellow)
- Dark theme matching the existing admin dashboard
- Delete confirmation dialogs with user impact warnings

## Requirements

### Requirement 1: Local Store Discovery

**User Story:** As a developer running Konductor locally, I want the server to automatically discover installer bundles from a local directory, so that I can test bundles by simply dropping `.tgz` files into a folder.

#### Acceptance Criteria

1. WHEN `KONDUCTOR_SERVE_CLIENT_BUNDLES_FROM_LOCAL_STORE=true`, THE server SHALL scan the `installers/` directory (relative to the server working directory) at startup
2. THE server SHALL recognize files matching the pattern `installer-<version>.tgz` where `<version>` is a valid semver string (e.g. `installer-1.2.0.tgz`, `installer-1.0.0-beta.1.tgz`)
3. WHEN a `.tgz` file's version cannot be parsed as valid semver, THE server SHALL log a warning and skip that file
4. WHEN the `installers/` directory does not exist, THE server SHALL create it and log a message indicating where to place bundle files
5. WHEN no `.tgz` files are found in the local store, THE server SHALL fall back to packing `konductor-setup/` and seeding the Prod channel (current behavior)
6. THE server SHALL log each discovered bundle at startup with its version, file size, and creation date

### Requirement 2: Bundle Manifest

**User Story:** As a developer, I want each bundle to contain metadata about its contents, so that the admin dashboard can display meaningful information without manual data entry.

#### Acceptance Criteria

1. EACH installer bundle `.tgz` SHALL contain a `bundle-manifest.json` file at the package root with the following fields: `version` (semver string), `createdAt` (ISO 8601 timestamp), `author` (string, optional), `summary` (string — brief description of features/changes, optional)
2. WHEN a bundle does not contain a `bundle-manifest.json`, THE server SHALL extract metadata from the filename (version) and filesystem (creation date from file mtime), with author as "unknown" and summary as empty
3. THE `konductor-setup` build process SHALL generate `bundle-manifest.json` automatically from `package.json` version, git author, current timestamp, and the most recent CHANGELOG entry
4. WHEN displaying bundles in the admin dashboard, THE server SHALL use manifest data for all metadata columns

### Requirement 3: Bundle Registry (In-Memory)

**User Story:** As a server operator, I want all discovered bundles indexed in memory, so that the admin dashboard and channel assignment can reference them by version.

#### Acceptance Criteria

1. THE registry SHALL store each bundle's tarball buffer, version, creation date, file size, author, summary, and SHA-256 hash
2. THE registry SHALL reject duplicate versions — if two files have the same version, THE server SHALL log a warning and use the first one found
3. THE registry SHALL support listing all bundles sorted by semver precedence (newest first)
4. THE registry SHALL support retrieving a specific bundle by version
5. THE registry SHALL track which channels reference each bundle version
6. WHEN the server restarts, THE registry SHALL be repopulated from the local store (in-memory, not persisted)

### Requirement 4: Channel Assignment via Admin Dashboard

**User Story:** As an admin, I want to assign a specific bundle version to each channel via a dropdown in the Global Client Settings panel, so that I control exactly which version Dev, UAT, and Prod users receive.

#### Acceptance Criteria

1. EACH channel card (Dev, UAT, Prod) in the Global Client Settings panel SHALL display a dropdown listing all versions in the registry sorted by semver precedence (newest first)
2. WHEN no bundles exist in the registry, THE dropdown SHALL show "No bundles available" and be disabled
3. WHEN the admin selects a version for a channel and clicks Save, THE server SHALL update the channel's tarball to the selected bundle from the registry
4. THE channel assignment SHALL be independent — the same version can be assigned to multiple channels simultaneously
5. WHEN a channel's assigned version is changed, THE server SHALL emit an SSE event, log the change, and update the Client Install Commands panel
6. THE existing promote (Dev → UAT, UAT → Prod) and rollback buttons SHALL continue to work — promote copies the source channel's assigned version to the destination, rollback reverts to the previous assignment
7. THE Global Client Settings panel SHALL include a "Manage Bundles" button that navigates to the Bundle Manager page

### Requirement 5: Bundle Manager Page

**User Story:** As an admin, I want a dedicated page to view and manage all bundles in the registry, so that I have full visibility into available versions and their channel assignments.

#### Acceptance Criteria

1. THE Bundle Manager page SHALL be served at `/admin/bundles` and require admin authentication
2. THE page SHALL display a channel assignment summary at the top showing the current version assigned to Dev, UAT, Prod, and Latest
3. THE page SHALL display a sortable and filterable table of all bundles with columns: Version, Channels (pill badges), Size, Created Date, Uploaded Date (shows "n/a (local)" when `KONDUCTOR_SERVE_CLIENT_BUNDLES_FROM_LOCAL_STORE=true`), Author, Notes/Summary, Actions
4. THE table SHALL be sortable by any column and filterable by version text
5. WHEN `KONDUCTOR_SERVE_CLIENT_BUNDLES_FROM_LOCAL_STORE=true`, THE page SHALL display a "Local Store Mode" badge indicating bundles are loaded from the `installers/` directory
6. THE page SHALL include a "Back to Admin Dashboard" link in the header
7. THE page SHALL establish an SSE connection for real-time updates when bundles or channel assignments change

### Requirement 6: Bundle Deletion

**User Story:** As an admin, I want to delete bundles that are no longer needed, with clear warnings about the impact on users.

#### Acceptance Criteria

1. EACH bundle row in the Bundle Manager table SHALL have a Delete button
2. WHEN the admin clicks Delete on a bundle that is NOT assigned to any channel, THE server SHALL show a confirmation dialog and delete the bundle from the registry upon confirmation
3. WHEN the admin clicks Delete on a bundle that IS assigned to one or more channels, THE confirmation dialog SHALL list the affected channels and the number of users on each channel, and warn that those users will enter a "stale" state
4. WHEN a bundle assigned to a channel is deleted, THE server SHALL mark the channel as "stale" (no tarball available) and set a `staleReason` message
5. WHEN `KONDUCTOR_SERVE_CLIENT_BUNDLES_FROM_LOCAL_STORE=true`, THE Delete action SHALL remove the `.tgz` file from the `installers/` directory on disk
6. WHEN a bundle is deleted, THE server SHALL emit an SSE event so the admin dashboard and Bundle Manager page update in real time

### Requirement 7: Stale Client Handling

**User Story:** As a server operator, I want clients on a deleted bundle to be warned (not blocked), so that accidental deletions don't take down the team.

#### Acceptance Criteria

1. WHEN a client's effective channel has no tarball (stale state), THE `register_session` response SHALL include `bundleStale: true` and a `staleMessage` explaining that the assigned bundle was removed
2. WHEN a client receives `bundleStale: true`, THE steering rule SHALL display a warning: `⚠️ Konductor: Your installer bundle was removed by an admin. Waiting for a replacement...`
3. THE client SHALL NOT be blocked from using Konductor — session registration, collision checks, and all MCP tools SHALL continue to work normally
4. WHEN the admin assigns a new bundle to the stale channel, THE next `register_session` response SHALL include `updateRequired: true` with the new bundle's URL, triggering the standard auto-update flow
5. WHEN a stale channel is resolved (new bundle assigned), THE server SHALL notify affected users via the next SSE event or `register_session` response

### Requirement 8: Latest Pseudo-Channel

**User Story:** As an admin, I want to assign specific users to a "Latest" channel that always serves the newest bundle, so that test users automatically get the latest build.

#### Acceptance Criteria

1. THE user management Channel Override dropdown SHALL include a "Latest" option in addition to Default, Dev, UAT, and Prod
2. WHEN a user's channel override is set to "Latest", THE server SHALL resolve their effective installer to the bundle with the most recent creation date in the registry
3. WHEN a new bundle is added to the registry (new file in `installers/`), users on the "Latest" channel SHALL receive `updateRequired: true` on their next `register_session` call
4. THE `/bundle/installer-latest.tgz` endpoint SHALL serve the most recently created bundle
5. WHEN no bundles exist in the registry, THE "Latest" channel SHALL return 404

### Requirement 9: API Endpoints

**User Story:** As a developer, I want REST API endpoints for bundle and channel management, so that I can script operations and integrate with CI.

#### Acceptance Criteria

1. `GET /api/admin/bundles` SHALL return the list of all bundles in the registry with metadata (version, size, createdAt, author, summary, channels, hash), sorted by semver precedence (newest first)
2. `DELETE /api/admin/bundles/:version` SHALL remove a bundle from the registry and disk (with stale handling if assigned to channels)
3. `PUT /api/admin/channels/:channel/assign` SHALL accept `{ version: string }` and assign the specified bundle to the channel
4. `GET /api/admin/install-commands` SHALL include `channelAvailability` indicating which channels have bundles assigned
5. ALL bundle management endpoints SHALL require admin authentication

### Requirement 10: Backward Compatibility

**User Story:** As a server operator, I want the local bundle store to be backward compatible with the existing channel system.

#### Acceptance Criteria

1. THE existing `/bundle/installer.tgz` endpoint SHALL continue to serve the Prod channel's assigned bundle
2. THE existing `/bundle/installer-{dev,uat,prod}.tgz` endpoints SHALL continue to serve the respective channel's assigned bundle
3. WHEN the server starts with `KONDUCTOR_SERVE_CLIENT_BUNDLES_FROM_LOCAL_STORE=false` or unset, THE server SHALL use the current behavior (pack `konductor-setup/` and seed Prod)
4. THE existing promote and rollback operations SHALL work with registry-backed channels — promote copies the version assignment, rollback reverts to the previous version assignment

### Requirement 11: Admin Dashboard Updates

**User Story:** As an admin, I want the existing admin dashboard to integrate with the bundle registry, so that channel assignment and bundle management are accessible from the main admin page.

#### Acceptance Criteria

1. THE Global Client Settings panel SHALL replace the per-channel "Upload .tgz" buttons with version-selection dropdowns populated from the bundle registry
2. EACH channel card (Dev, UAT, Prod) SHALL show the currently assigned version and a dropdown to change it
3. THE Global Client Settings panel SHALL include a "Manage Bundles" button that navigates to `/admin/bundles`
4. THE Client Install Commands panel SHALL show "n/a: No installer is available for X channel" when a channel has no version assigned, and update dynamically when assignments change
5. THE User Management panel's Channel Override dropdown SHALL include "Latest" as an option alongside Default, Dev, UAT, and Prod
6. THE User Management panel's channel filter dropdown SHALL include "Latest" as a filter option
7. WHEN the bundle registry is empty (no bundles discovered), THE channel dropdowns SHALL show "No bundles available" and be disabled, and the "Manage Bundles" button SHALL still be accessible
