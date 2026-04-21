# Bundle Management Use Cases

## Overview

The Bundle Manager page (`/admin/bundles`) provides full visibility into the local bundle registry. Admins can view all available versions, see channel assignments, and delete bundles.

---

## UC-5.1: Admin Views Bundle Manager Page

**Actor:** Admin  
**Precondition:** Local bundle store enabled, bundles in `installers/` directory  
**Trigger:** Admin navigates to `/admin/bundles`

**Steps:**
1. Admin clicks "Manage Bundles" from Global Client Settings panel (or navigates directly)
2. Page loads with:
   - Header: "🎼 Bundle Manager" + "Local Store Mode" badge (yellow)
   - Channel summary cards: Dev, UAT, Prod, Latest (showing assigned versions)
   - Bundle table with all discovered versions
3. Table sorted by semver (newest first)
4. Each row shows: Version, Channels (pill badges), Size, Created, Uploaded ("n/a (local)"), Author, Notes, Delete button

**Expected Result:**
- All bundles from `installers/` directory displayed
- Channel assignments shown as colored pills
- Metadata from `bundle-manifest.json` displayed
- "Back to Admin Dashboard" link works

---

## UC-5.2: Admin Sorts Bundle Table

**Actor:** Admin  
**Precondition:** Bundle Manager page loaded  
**Trigger:** Admin clicks column header

**Steps:**
1. Admin clicks "Created" column header
2. Table sorts by creation date (newest first)
3. Arrow indicator (▼) appears on column
4. Admin clicks again → sorts ascending (▲)
5. Admin clicks "Version" → sorts by semver precedence

**Expected Result:**
- Sorting works on all sortable columns (Version, Size, Created, Author)
- Direction toggles on repeated clicks
- Visual indicator shows current sort

---

## UC-5.3: Admin Filters Bundles by Version

**Actor:** Admin  
**Precondition:** Bundle Manager page loaded with multiple versions  
**Trigger:** Admin types in filter input

**Steps:**
1. Admin types "beta" in filter input
2. Table filters to show only versions containing "beta" (e.g., `1.0.0-beta.1`, `2.0.0-beta.2`)
3. Admin clears filter → all bundles shown again

**Expected Result:**
- Case-insensitive filtering
- Matches anywhere in version string
- Real-time filtering (no submit button needed)

---

## UC-5.4: Admin Deletes Unassigned Bundle

**Actor:** Admin  
**Precondition:** Bundle `1.0.0` exists but is not assigned to any channel  
**Trigger:** Admin clicks Delete on `1.0.0` row

**Steps:**
1. Admin clicks red Delete button on `1.0.0`
2. Confirmation dialog: "This bundle is not assigned to any channel. Safe to delete."
3. Admin clicks "Delete" to confirm
4. Server removes bundle from registry
5. Server deletes `installers/installer-1.0.0.tgz` from disk
6. SSE event emitted → table updates
7. Bundle disappears from table

**Expected Result:**
- Bundle removed from registry and disk
- No impact on any users
- Table updates in real time

---

## UC-5.5: Admin Deletes Bundle Assigned to Channel

**Actor:** Admin  
**Precondition:** Bundle `1.2.0` is assigned to UAT channel, 3 users on UAT  
**Trigger:** Admin clicks Delete on `1.2.0` row

**Steps:**
1. Admin clicks Delete on `1.2.0`
2. Confirmation dialog shows:
   - "This bundle is assigned to: UAT (3 users)"
   - "Deleting will put these users in a stale state until a replacement is assigned."
3. Admin clicks "Delete" to confirm
4. Server removes bundle from registry and disk
5. UAT channel enters "stale" state
6. SSE event emitted
7. On next registration, UAT users receive `bundleStale: true`
8. Users see: `⚠️ Konductor: Your installer bundle was removed by an admin. Waiting for a replacement...`

**Expected Result:**
- Clear warning about user impact before deletion
- Channel enters stale state
- Users warned but NOT blocked
- MCP tools continue working

---

## UC-5.6: Admin Resolves Stale Channel

**Actor:** Admin  
**Precondition:** UAT channel is stale (bundle was deleted)  
**Trigger:** Admin assigns new version to UAT

**Steps:**
1. Admin goes to Global Client Settings panel
2. UAT dropdown shows available versions
3. Admin selects `1.3.0` for UAT
4. Clicks Save
5. UAT channel exits stale state
6. On next registration, UAT users receive `updateRequired: true`
7. Users auto-update to `1.3.0`

**Expected Result:**
- Stale state resolved
- Users automatically receive new bundle
- No manual intervention needed on client side

---

## UC-5.7: Bundle Manager Real-Time Updates

**Actor:** Two admins viewing Bundle Manager  
**Precondition:** Both on `/admin/bundles`  
**Trigger:** Admin A assigns a version to Dev

**Steps:**
1. Admin A assigns `2.0.0` to Dev channel
2. Server emits `admin_channel_change` SSE event
3. Admin B's page receives event
4. Admin B's channel summary cards update (Dev now shows `2.0.0`)
5. Admin B's bundle table updates (Dev pill appears on `2.0.0` row)

**Expected Result:**
- Real-time sync between admin sessions
- No page refresh needed
- SSE connection status indicator visible

---

## UC-5.8: Empty Bundle Registry

**Actor:** Admin  
**Precondition:** `installers/` directory is empty  
**Trigger:** Admin opens Bundle Manager

**Steps:**
1. Server starts with empty `installers/` directory
2. Server falls back to packing `konductor-setup/` and seeding Prod
3. Admin opens Bundle Manager
4. Channel dropdowns show "No bundles available" (disabled)
5. "Manage Bundles" button still accessible
6. Bundle table shows no rows

**Expected Result:**
- Graceful handling of empty registry
- Fallback behavior works (Prod still served from packed `konductor-setup/`)
- Admin can still navigate to Bundle Manager

---

## UC-5.9: Latest Pseudo-Channel

**Actor:** Admin  
**Precondition:** User "tester" assigned to "Latest" channel  
**Trigger:** New bundle added to `installers/`

**Steps:**
1. Admin assigns "tester" to "Latest" channel override
2. New bundle `2.1.0` placed in `installers/` directory
3. Server restarts (registry repopulated)
4. "Latest" resolves to `2.1.0` (most recent by `createdAt`)
5. On tester's next registration, `updateRequired: true`
6. Tester auto-updates to `2.1.0`

**Expected Result:**
- "Latest" always resolves to newest bundle by creation date
- Users on Latest get updates whenever a new bundle appears
- `/bundle/installer-latest.tgz` serves the correct bundle

---

## UC-5.10: Invalid Bundle Files Skipped

**Actor:** Server operator  
**Precondition:** `installers/` contains some invalid files  
**Trigger:** Server starts

**Steps:**
1. `installers/` contains:
   - `installer-1.0.0.tgz` ✓ (valid)
   - `installer-v2.0.tgz` ✗ (leading `v`, missing patch)
   - `my-bundle.tgz` ✗ (wrong prefix)
   - `installer-dev.tgz` ✗ (reserved channel name)
2. Server scans directory
3. Server logs warnings for invalid files
4. Only `installer-1.0.0.tgz` added to registry

**Expected Result:**
- Valid bundles discovered
- Invalid files logged with reason and skipped
- Server doesn't crash on bad files

---

## UC-5.11: Duplicate Version Handling

**Actor:** Server operator  
**Precondition:** Two files with same version in `installers/`  
**Trigger:** Server starts

**Steps:**
1. `installers/` contains `installer-1.0.0.tgz` and a copy `installer-1.0.0 (1).tgz`
2. Server scans directory
3. Server detects duplicate version `1.0.0`
4. Server logs warning and uses first one found
5. Only one entry in registry for `1.0.0`

**Expected Result:**
- No crash on duplicates
- Warning logged
- First file wins
