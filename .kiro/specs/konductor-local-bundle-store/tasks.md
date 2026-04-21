# Implementation Tasks

## Task 1: BundleRegistry core + manifest extraction
- [x] Create `src/bundle-registry.ts` with `BundleRegistry` class
- [x] Implement `scanLocalStore(dir)`: read `installers/`, parse `installer-<semver>.tgz` filenames, validate semver
- [x] Implement tarball manifest extraction: open `.tgz`, find `package/bundle-manifest.json`, parse JSON
- [x] Implement fallback metadata: use filename for version, file mtime for createdAt, "unknown" author, empty summary
- [x] Implement `list()`: return all bundles sorted by semver precedence (newest first)
- [x] Implement `get(version)`: return tarball buffer + metadata
- [x] Implement `getLatest()`: return bundle with most recent createdAt
- [x] Implement `has(version)`: check existence
- [x] Implement `delete(version)`: remove from registry, delete file from disk, return stale channels
- [x] Implement `updateChannelRefs()`: track which channels reference each version
- [x] Create `installers/` directory at startup if missing, log instructions
- [x] Handle edge cases: invalid semver (skip + warn), corrupt tgz (fallback metadata), duplicate versions (warn + use first)

## Task 2: BundleRegistry tests
- [x] Create `src/bundle-registry.test.ts` — unit tests for scan, list, get, delete, stale propagation, manifest extraction, fallback metadata
- [x] Create `src/bundle-registry.property.test.ts` — property tests for Properties 1–5 using fast-check (100 iterations each)
- [x] Test edge cases: empty directory, no manifest in tgz, invalid semver filenames, duplicate versions

## Task 3: Integrate BundleRegistry into server startup
- [x] In `index.ts` `createComponents()`: instantiate `BundleRegistry`, call `scanLocalStore()` when `KONDUCTOR_SERVE_CLIENT_BUNDLES_FROM_LOCAL_STORE=true`
- [x] After scan: if registry is non-empty, skip the `konductor-setup/` npm pack fallback
- [x] If registry is empty: fall back to current behavior (pack `konductor-setup/`, seed Prod)
- [x] Remove the old local store scanning code (the `channelFiles` / versioned files logic currently in `createComponents`)
- [x] Pass `BundleRegistry` instance to `startSseServer` deps and `handleAdminRoute` deps
- [x] Log startup summary: N bundles discovered, versions listed

## Task 4: Channel assignment API endpoint
- [x] Add `PUT /api/admin/channels/:channel/assign` to `admin-routes.ts`
- [x] Accept `{ version: string }`, validate channel name and version exists in registry
- [x] Call `InstallerChannelStore.setTarball(channel, registry.get(version).tarball, version)`
- [-] Update registry channel refs
- [x] Emit `admin_channel_change` SSE event
- [x] Log the assignment
- [x] Return `{ success: true, channel, version }`
- [x] Error cases: invalid channel (400), version not in registry (404), registry empty (400)

## Task 5: Bundle list and delete API endpoints
- [x] Add `GET /api/admin/bundles` to `admin-routes.ts` (or new `bundle-routes.ts`)
- [x] Return registry `list()` with metadata, sorted by semver
- [x] Add `DELETE /api/admin/bundles/:version` — call `registry.delete(version)`
- [x] If delete returns stale channels: mark those channels stale in `InstallerChannelStore`, emit SSE events
- [x] When `KONDUCTOR_SERVE_CLIENT_BUNDLES_FROM_LOCAL_STORE=true`: delete the `.tgz` file from disk
- [x] Error cases: version not found (404), delete fails (500)
- [x] Add tests for both endpoints

## Task 6: Bundle Manager page (HTML + JS)
- [x] Create `src/bundle-page-builder.ts` — generates `/admin/bundles` page HTML
- [x] Follow mockup layout: header with back link, channel summary cards, bundle table
- [x] Reuse `buildAdminStyles()` from `admin-page-builder.ts` for consistent theming
- [x] Add "Local Store Mode" badge when `KONDUCTOR_SERVE_CLIENT_BUNDLES_FROM_LOCAL_STORE=true`
- [x] Bundle table: Version (monospace, green, pre-release in yellow), Channels (pill badges), Size, Created, Uploaded, Author, Notes, Delete button
- [x] Table sorting: click column headers to sort
- [x] Table filtering: text input to filter by version
- [x] Delete button: confirmation dialog with channel/user impact warning
- [x] SSE connection for real-time updates (`bundle_change`, `channel_assign` events)
- [x] Fetch data from `GET /api/admin/bundles` and `GET /api/admin/channels`

## Task 7: Serve Bundle Manager page
- [x] Add `GET /admin/bundles` route to `admin-routes.ts` (or `bundle-routes.ts`)
- [x] Require admin auth (same as `/admin`)
- [x] Call `buildBundleManagerPage()` and serve HTML
- [x] Pass `localStoreMode` flag to the page builder

## Task 8: Update Global Client Settings panel
- [x] Modify `renderChannels()` in `admin-page-builder.ts`: replace "Upload .tgz" buttons with version dropdowns
- [x] Fetch registry versions from `GET /api/admin/bundles` to populate dropdowns
- [x] Each channel card shows: channel name, assigned version (or "Not assigned"), dropdown to change
- [x] Add "Save" button per channel that calls `PUT /api/admin/channels/:channel/assign`
- [x] Add "Manage Bundles" button that navigates to `/admin/bundles`
- [x] When registry is empty: dropdowns show "No bundles available" and are disabled
- [x] SSE handler: refresh channel cards on `bundle_change` and `channel_assign` events

## Task 9: Update Client Install Commands panel
- [x] Ensure `renderInstallCommands()` checks `channelAvailability` from the API (already partially done)
- [x] Show "n/a: No installer is available for X channel" when a channel has no version assigned
- [x] Update dynamically when channel assignments change (SSE events trigger re-fetch)

## Task 10: Update User Management panel
- [x] Add "Latest" option to the Channel Override dropdown in user table rows
- [x] Add "Latest" option to the channel filter dropdown
- [x] Handle "latest" in `updateUserChannel()` — send to API as `installerChannel: "latest"`

## Task 11: Stale client handling in register_session
- [x] In `register_session` (MCP tool and REST API): after version check, check if the user's effective channel is stale
- [x] If stale: add `bundleStale: true` and `staleMessage` to the response
- [x] When stale channel is resolved (new version assigned): normal `updateRequired` flow kicks in
- [x] Update steering rule documentation to handle `bundleStale` responses

## Task 12: Latest pseudo-channel serving
- [x] `/bundle/installer-latest.tgz` endpoint: serve `registry.getLatest().tarball`
- [x] In `buildChannelUpdateUrl()`: handle "latest" channel → `/bundle/installer-latest.tgz`
- [x] In `resolveEffectiveChannel()`: handle "latest" as a valid override value
- [x] When user's override is "latest": `register_session` version check uses the latest bundle's version

## Task 13: bundle-manifest.json generation in konductor-setup
- [x] Add a build step to `konductor-setup/` that generates `bundle-manifest.json`
- [x] Source: `package.json` version, `git config user.name` for author, `new Date().toISOString()` for createdAt, first entry from CHANGELOG.md for summary
- [x] Include `bundle-manifest.json` in the `files` array in `package.json`
- [x] Verify the manifest is present in the packed `.tgz`

## Task 14: Integration tests
- [x] Test full flow: scan local store → assign versions to channels → serve tarballs → delete bundle → stale state → reassign → recovery
- [x] Test Bundle Manager page renders correctly with auth
- [x] Test channel assignment API with SSE event emission
- [x] Test backward compatibility: `/bundle/installer.tgz` still serves Prod
- [x] Test empty registry fallback to `konductor-setup/` pack

## Task 15: Documentation
- [x] Update `konductor/README.md` with Local Bundle Store section
- [x] Document `KONDUCTOR_SERVE_CLIENT_BUNDLES_FROM_LOCAL_STORE` env var
- [x] Document `installers/` directory structure and naming convention
- [x] Document Bundle Manager page and channel assignment workflow
- [x] Document `bundle-manifest.json` format
