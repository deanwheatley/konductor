# Client Bundle Autoupdate — Comprehensive Test Plan

## System Under Test

The Konductor client bundle autoupdate system, consisting of:

- **BundleRegistry** — scans `installers/` for versioned `.tgz` files, indexes in memory
- **InstallerChannelStore** — maps channels (dev/uat/prod) to bundle tarballs via admin assignment
- **Version comparison** — on every registration/status call, resolves user's effective channel, gets that channel's version, compares to client's version
- **Client watcher** (`konductor-watcher.mjs`) — reads `.konductor-version`, sends as header, runs `runAutoUpdate()` when `updateRequired: true`
- **Bundle serving endpoints** — `/bundle/installer-{channel}.tgz`, `/bundle/installer-latest.tgz`, `/bundle/installer.tgz`
- **Admin API** — channel assignment, promotion, rollback, bundle deletion

## Current Environment

| Item | Value |
|------|-------|
| Server package version | `0.5.2` |
| Client version (testrepo) | `0.5.1` |
| Available bundles in `installers/` | 0.3.0-beta.1, 0.4.0, 0.4.1, 0.4.3, 0.4.4, 0.5.0, 0.5.1 |
| Global default channel | `prod` |
| User `deanwheatley` override | none |
| Server HTTP fallback port | 3011 |
| Server HTTPS port | 3010 |

## How Effective Channel Resolution Works

```
User override (history-users.json → installerChannel field)
  → falls back to global default (settings.json → defaultChannel)
    → falls back to "prod"

Special: "latest" pseudo-channel → BundleRegistry.getLatest() (most recent createdAt)
```

## API Endpoints Used

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `PUT /api/admin/channels/{ch}/assign` | Admin cookie/header | Assign registry bundle to channel |
| `POST /api/admin/channels/promote` | Admin | Copy source channel → destination |
| `POST /api/admin/channels/rollback` | Admin | Revert channel to previous version |
| `DELETE /api/admin/bundles/{version}` | Admin | Delete bundle from registry |
| `GET /api/admin/channels` | Admin | List channel metadata |
| `GET /api/admin/bundles` | Admin | List registry bundles |
| `PUT /api/admin/users/{userId}` | Admin | Set user's installerChannel override |
| `PUT /api/admin/settings/{key}` | Admin | Change global defaultChannel |
| `POST /api/register` | API key | Register session (watcher uses this) |
| `POST /api/status` | API key | Check status (watcher polls this) |
| `GET /bundle/installer-{channel}.tgz` | None | Download channel-specific bundle |
| `GET /bundle/installer-latest.tgz` | None | Download latest bundle |
| `GET /bundle/installer.tgz` | None | Download prod bundle (backward compat) |

## Test Conventions

- **BASE_URL**: `http://localhost:3011`
- **API_KEY**: `kd-a7f3b9c2e1d4`
- **AUTH_HEADER**: `Authorization: Bearer kd-a7f3b9c2e1d4`
- **ADMIN_HEADER**: `X-Konductor-User: deanwheatley`
- **USER_ID**: `deanwheatley`
- **REPO**: `deanwheatley/testrepo`

All admin API calls require both `AUTH_HEADER` and `ADMIN_HEADER`.

All `/api/register` and `/api/status` calls require `AUTH_HEADER`.

Client version is sent via `X-Konductor-Client-Version` header.

---

## Setup: Reset State Before Each Group

Before each test group, run these steps to ensure clean state:

```bash
# 1. Verify server is running
curl -s http://localhost:3011/health | jq .

# 2. Check available bundles in registry
curl -s -H "Authorization: Bearer kd-a7f3b9c2e1d4" \
  -H "X-Konductor-User: deanwheatley" \
  http://localhost:3011/api/admin/bundles | jq .

# 3. Check current channel assignments
curl -s -H "Authorization: Bearer kd-a7f3b9c2e1d4" \
  -H "X-Konductor-User: deanwheatley" \
  http://localhost:3011/api/admin/channels | jq .

# 4. Check current user record
curl -s -H "Authorization: Bearer kd-a7f3b9c2e1d4" \
  -H "X-Konductor-User: deanwheatley" \
  http://localhost:3011/api/admin/users | jq '.users[] | select(.userId=="deanwheatley")'

# 5. Check current default channel setting
curl -s -H "Authorization: Bearer kd-a7f3b9c2e1d4" \
  -H "X-Konductor-User: deanwheatley" \
  http://localhost:3011/api/admin/settings | jq '.settings[] | select(.key=="defaultChannel")'
```

### Helper: Assign Bundle to Channel

```bash
# Assign version $VER to channel $CH
curl -s -X PUT \
  -H "Authorization: Bearer kd-a7f3b9c2e1d4" \
  -H "X-Konductor-User: deanwheatley" \
  -H "Content-Type: application/json" \
  -d "{\"version\":\"$VER\"}" \
  http://localhost:3011/api/admin/channels/$CH/assign | jq .
```

### Helper: Set User Channel Override

```bash
# Set user $USER to channel $CH (dev|uat|prod|latest)
curl -s -X PUT \
  -H "Authorization: Bearer kd-a7f3b9c2e1d4" \
  -H "X-Konductor-User: deanwheatley" \
  -H "Content-Type: application/json" \
  -d "{\"installerChannel\":\"$CH\"}" \
  http://localhost:3011/api/admin/users/$USER | jq .
```

### Helper: Clear User Channel Override

```bash
# Clear override (revert to global default)
curl -s -X PUT \
  -H "Authorization: Bearer kd-a7f3b9c2e1d4" \
  -H "X-Konductor-User: deanwheatley" \
  -H "Content-Type: application/json" \
  -d "{\"installerChannel\":\"\"}" \
  http://localhost:3011/api/admin/users/deanwheatley | jq .
```

### Helper: Check updateRequired via /api/register

```bash
# Register with client version $CV and check response
curl -s -X POST \
  -H "Authorization: Bearer kd-a7f3b9c2e1d4" \
  -H "X-Konductor-Client-Version: $CV" \
  -H "Content-Type: application/json" \
  -d '{"userId":"deanwheatley","repo":"deanwheatley/testrepo","branch":"main","files":["test.txt"]}' \
  http://localhost:3011/api/register | jq '{updateRequired, serverVersion, updateUrl, bundleStale, staleMessage}'
```

### Helper: Check updateRequired via /api/status

```bash
# Status check with client version $CV
curl -s -X POST \
  -H "Authorization: Bearer kd-a7f3b9c2e1d4" \
  -H "X-Konductor-Client-Version: $CV" \
  -H "Content-Type: application/json" \
  -d '{"userId":"deanwheatley","repo":"deanwheatley/testrepo"}' \
  http://localhost:3011/api/status | jq '{updateRequired, serverVersion, updateUrl}'
```

---

## Group 1: Channel Assignment → updateRequired Signal

**Purpose**: Verify that assigning a bundle version to a channel correctly triggers (or doesn't trigger) `updateRequired` based on the user's effective channel and client version.

**Precondition**: Clear all channel assignments (restart server), clear user override.

### Test 1.1 — Prod assigned, client matches

```
Setup:  Assign 0.5.1 to prod. User override=none, default=prod.
Action: /api/register with X-Konductor-Client-Version: 0.5.1
Expect: updateRequired absent or false. Client is current.
```

### Test 1.2 — Prod assigned older, client is newer

```
Setup:  Assign 0.5.0 to prod. User override=none, default=prod.
Action: /api/register with X-Konductor-Client-Version: 0.5.1
Expect: updateRequired absent. compareVersions returns "newer".
```

### Test 1.3 — Prod assigned much older, client is newer

```
Setup:  Assign 0.4.4 to prod. User override=none, default=prod.
Action: /api/register with X-Konductor-Client-Version: 0.5.1
Expect: updateRequired absent. Client is newer than channel.
```

### Test 1.4 — Dev assigned, user on dev, client matches

```
Setup:  Assign 0.5.1 to dev. Set user override=dev.
Action: /api/register with X-Konductor-Client-Version: 0.5.1
Expect: updateRequired absent. Client matches dev channel.
```

### Test 1.5 — Dev assigned, user on dev, client outdated

```
Setup:  Assign 0.5.1 to dev. Set user override=dev.
Action: /api/register with X-Konductor-Client-Version: 0.4.4
Expect: updateRequired=true, serverVersion=0.5.1, updateUrl contains "installer-dev.tgz"
```

### Test 1.6 — Dev and Prod assigned differently, user on prod (default)

```
Setup:  Assign 0.5.0 to dev, 0.5.1 to prod. User override=none, default=prod.
Action: /api/register with X-Konductor-Client-Version: 0.5.1
Expect: updateRequired absent. User is on prod=0.5.1, matches.
```

### Test 1.7 — Dev and Prod assigned differently, user overridden to dev

```
Setup:  Assign 0.5.0 to dev, 0.5.1 to prod. Set user override=dev.
Action: /api/register with X-Konductor-Client-Version: 0.5.1
Expect: updateRequired absent. User is on dev=0.5.0, client 0.5.1 is newer.
```

### Test 1.8 — UAT assigned, user on uat, client outdated

```
Setup:  Assign 0.5.0 to uat. Set user override=uat.
Action: /api/register with X-Konductor-Client-Version: 0.4.4
Expect: updateRequired=true, serverVersion=0.5.0, updateUrl contains "installer-uat.tgz"
```

### Test 1.9 — UAT assigned, user on uat, client matches

```
Setup:  Assign 0.5.1 to uat. Set user override=uat.
Action: /api/register with X-Konductor-Client-Version: 0.5.1
Expect: updateRequired absent.
```

### Test 1.10 — No channel assigned, user on prod (default)

```
Setup:  No channels assigned (fresh restart). User override=none, default=prod.
Action: /api/register with X-Konductor-Client-Version: 0.5.1
Expect: updateRequired absent. getEffectiveChannelVersion returns null → skip.
```

### Test 1.11 — No channel assigned, user overridden to dev

```
Setup:  No channels assigned. Set user override=dev.
Action: /api/register with X-Konductor-Client-Version: 0.5.1
Expect: updateRequired absent. Dev has no version → null → skip.
```

### Test 1.12 — No channel assigned, user on latest, registry empty

```
Setup:  No channels assigned, registry empty. Set user override=latest.
Action: /api/register with X-Konductor-Client-Version: 0.5.1
Expect: updateRequired absent. Latest resolves to null → skip.
Note:   Registry won't be empty in our env (bundles exist in installers/).
        To truly test, would need to remove all .tgz files from installers/.
```

### Test 1.13 — All three channels assigned, user on each

```
Setup:  Assign 0.4.4 to dev, 0.5.0 to uat, 0.5.1 to prod.
Action: For each user override (dev, uat, prod, none):
        /api/register with X-Konductor-Client-Version: 0.5.0

Expected results:
  override=dev  → updateRequired absent (client 0.5.0 > dev 0.4.4)
  override=uat  → updateRequired absent (client 0.5.0 = uat 0.5.0)
  override=prod → updateRequired=true, serverVersion=0.5.1
  override=none → updateRequired=true, serverVersion=0.5.1 (default=prod)
```

### Test 1.14 — All three channels same version

```
Setup:  Assign 0.5.1 to dev, uat, and prod.
Action: For each user override (dev, uat, prod, latest, none):
        /api/register with X-Konductor-Client-Version: 0.5.1

Expected: updateRequired absent for all. All channels resolve to 0.5.1.
```

### Test 1.15 — All three channels same version, client outdated

```
Setup:  Assign 0.5.1 to dev, uat, and prod.
Action: For each user override (dev, uat, prod, none):
        /api/register with X-Konductor-Client-Version: 0.4.4

Expected results:
  override=dev  → updateRequired=true, serverVersion=0.5.1, updateUrl has "installer-dev.tgz"
  override=uat  → updateRequired=true, serverVersion=0.5.1, updateUrl has "installer-uat.tgz"
  override=prod → updateRequired=true, serverVersion=0.5.1, updateUrl has "installer.tgz"
  override=none → updateRequired=true, serverVersion=0.5.1, updateUrl has "installer.tgz"
```

---

## Group 2: "Latest" Pseudo-Channel

**Purpose**: Verify that the "latest" pseudo-channel resolves to the bundle with the most recent `createdAt` in the BundleRegistry, independent of channel assignments.

**Precondition**: User override set to "latest". Registry has bundles from `installers/`.

### Test 2.1 — Latest resolves to newest bundle, client outdated

```
Setup:  Set user override=latest. Registry has 0.5.0 and 0.5.1.
        BundleRegistry.getLatest() should return 0.5.1 (newest createdAt).
Action: /api/register with X-Konductor-Client-Version: 0.5.0
Expect: updateRequired=true, serverVersion=0.5.1, updateUrl contains "installer-latest.tgz"
```

### Test 2.2 — Latest resolves to newest bundle, client matches

```
Setup:  Set user override=latest. Registry has 0.5.0 and 0.5.1.
Action: /api/register with X-Konductor-Client-Version: 0.5.1
Expect: updateRequired absent. Client matches latest.
```

### Test 2.3 — Latest resolves to only bundle, client is newer

```
Setup:  Set user override=latest. Registry has only 0.5.0 (hypothetical).
Action: /api/register with X-Konductor-Client-Version: 0.5.1
Expect: updateRequired absent. Client is newer than latest.
Note:   Hard to test without removing bundles from installers/.
```

### Test 2.4 — Latest with empty registry

```
Setup:  Set user override=latest. Registry is empty.
Action: /api/register with X-Konductor-Client-Version: 0.5.1
Expect: updateRequired absent. getLatest() returns null → skip.
Note:   Requires removing all .tgz from installers/ or disabling local store.
```

### Test 2.5 — Latest ignores channel assignments entirely

```
Setup:  Set user override=latest. Assign 0.4.4 to prod, 0.5.0 to dev.
        Registry has 0.5.1 as newest.
Action: /api/register with X-Konductor-Client-Version: 0.5.0
Expect: updateRequired=true, serverVersion=0.5.1.
        Latest uses BundleRegistry, NOT InstallerChannelStore.
```

### Test 2.6 — Latest vs prod user see different versions

```
Setup:  Assign 0.4.4 to prod. Registry has 0.5.1 as newest.
        User A override=latest, User B override=none (default=prod).
Action: /api/register with X-Konductor-Client-Version: 0.5.0 for each.
Expect:
  User A (latest): updateRequired=true, serverVersion=0.5.1
  User B (prod):   updateRequired absent (client 0.5.0 > prod 0.4.4)
```

---

## Group 3: Global Default Channel Change

**Purpose**: Verify that changing the global `defaultChannel` setting affects users with no per-user override, and does NOT affect users with overrides.

**Precondition**: Assign different versions to dev, uat, prod.

### Test 3.1 — Change default prod→dev, user gets dev version

```
Setup:  Assign 0.5.1 to dev, 0.5.0 to prod. User override=none, default=prod.
Action: Change defaultChannel to "dev" via PUT /api/admin/settings/defaultChannel
        Then /api/register with X-Konductor-Client-Version: 0.5.0
Expect: updateRequired=true, serverVersion=0.5.1. User now resolves to dev.
```

### Test 3.2 — Change default prod→dev, client already newer than dev

```
Setup:  Assign 0.5.0 to dev, 0.5.1 to prod. User override=none, default=prod.
Action: Change defaultChannel to "dev".
        Then /api/register with X-Konductor-Client-Version: 0.5.1
Expect: updateRequired absent. Client 0.5.1 > dev 0.5.0.
```

### Test 3.3 — Change default prod→uat

```
Setup:  Assign 0.5.1 to uat, 0.5.0 to prod. User override=none, default=prod.
Action: Change defaultChannel to "uat".
        Then /api/register with X-Konductor-Client-Version: 0.5.0
Expect: updateRequired=true, serverVersion=0.5.1. User now resolves to uat.
```

### Test 3.4 — Default change does NOT affect user with override

```
Setup:  Assign 0.5.1 to dev, 0.5.0 to prod. Set user override=dev.
Action: Change defaultChannel from "prod" to "uat" (uat has nothing assigned).
        Then /api/register with X-Konductor-Client-Version: 0.5.0
Expect: updateRequired=true, serverVersion=0.5.1. Override=dev wins, default ignored.
```

### Test 3.5 — User with prod override unaffected by default change

```
Setup:  Assign 0.5.1 to dev, 0.5.0 to prod. Set user override=prod.
Action: Change defaultChannel to "dev".
        Then /api/register with X-Konductor-Client-Version: 0.5.0
Expect: updateRequired absent. Override=prod=0.5.0, client matches.
```

### Test 3.6 — Change default to unassigned channel

```
Setup:  Only prod has a bundle (0.5.0). Dev and uat empty. User override=none.
Action: Change defaultChannel to "dev".
        Then /api/register with X-Konductor-Client-Version: 0.5.0
Expect: updateRequired absent. Dev has no version → null → skip.
```

### Test 3.7 — Change default back to prod (restore)

```
Setup:  After test 3.6, change defaultChannel back to "prod".
Action: /api/register with X-Konductor-Client-Version: 0.4.4
Expect: updateRequired=true, serverVersion=0.5.0. Back on prod.
Cleanup: Always restore defaultChannel to "prod" after this group.
```

---

## Group 4: Promotion Flow

**Purpose**: Verify that promoting a bundle from one channel to another updates the destination channel's version and triggers correct update signals.

### Test 4.1 — Promote dev→uat, user on uat gets update

```
Setup:  Assign 0.5.1 to dev. UAT empty. Set user override=uat.
Action: POST /api/admin/channels/promote {"source":"dev","destination":"uat"}
        Then /api/register with X-Konductor-Client-Version: 0.5.0
Expect: updateRequired=true, serverVersion=0.5.1. UAT now has 0.5.1.
```

### Test 4.2 — Promote dev→uat, user on prod unaffected

```
Setup:  Assign 0.5.1 to dev, 0.5.0 to prod. Set user override=prod.
Action: POST /api/admin/channels/promote {"source":"dev","destination":"uat"}
        Then /api/register with X-Konductor-Client-Version: 0.5.0
Expect: updateRequired absent. User on prod=0.5.0, matches client.
```

### Test 4.3 — Promote uat→prod, default users get update

```
Setup:  Assign 0.5.1 to uat, 0.5.0 to prod. User override=none, default=prod.
Action: POST /api/admin/channels/promote {"source":"uat","destination":"prod"}
        Then /api/register with X-Konductor-Client-Version: 0.5.0
Expect: updateRequired=true, serverVersion=0.5.1. Prod now has 0.5.1.
```

### Test 4.4 — Promote dev→prod directly (skip uat)

```
Setup:  Assign 0.5.1 to dev, 0.4.4 to prod. User override=none, default=prod.
Action: POST /api/admin/channels/promote {"source":"dev","destination":"prod"}
        Then /api/register with X-Konductor-Client-Version: 0.5.0
Expect: updateRequired=true, serverVersion=0.5.1. Prod jumped to 0.5.1.
```

### Test 4.5 — Promote older version overwrites newer (downgrade)

```
Setup:  Assign 0.5.0 to dev, 0.5.1 to uat. Set user override=uat.
Action: POST /api/admin/channels/promote {"source":"dev","destination":"uat"}
        Then /api/register with X-Konductor-Client-Version: 0.5.1
Expect: updateRequired absent. UAT now 0.5.0, client 0.5.1 is "newer".
        Note: This is a downgrade scenario — no forced downgrade mechanism.
```

### Test 4.6 — Full pipeline: dev→uat→prod

```
Setup:  Assign 0.5.1 to dev only. UAT and prod empty.
Action:
  1. Promote dev→uat. Verify uat now has 0.5.1.
  2. Promote uat→prod. Verify prod now has 0.5.1.
  3. /api/register with X-Konductor-Client-Version: 0.5.0, user on prod.
Expect: updateRequired=true, serverVersion=0.5.1 after step 3.
```

### Test 4.7 — Promote from empty channel fails

```
Setup:  Dev has no bundle assigned.
Action: POST /api/admin/channels/promote {"source":"dev","destination":"uat"}
Expect: HTTP 400 error: "Source channel "dev" has no tarball"
```

---

## Group 5: Rollback Flow

**Purpose**: Verify rollback behavior and its interaction with version comparison.

### Test 5.1 — Rollback prod, client was on new version (no forced downgrade)

```
Setup:  Assign 0.5.0 to prod, then assign 0.5.1 to prod (creates rollback point).
        User override=none, default=prod.
Action: POST /api/admin/channels/rollback {"channel":"prod"}
        Then /api/register with X-Konductor-Client-Version: 0.5.1
Expect: updateRequired absent. Prod rolled back to 0.5.0, client 0.5.1 is "newer".
        KNOWN LIMITATION: No forced downgrade mechanism.
```

### Test 5.2 — Rollback prod, client matches rolled-back version

```
Setup:  Same as 5.1 (prod rolled back to 0.5.0).
Action: /api/register with X-Konductor-Client-Version: 0.5.0
Expect: updateRequired absent. Client matches rolled-back version.
```

### Test 5.3 — Rollback dev, user on dev, client was on new version

```
Setup:  Assign 0.5.0 to dev, then assign 0.5.1 to dev. Set user override=dev.
Action: POST /api/admin/channels/rollback {"channel":"dev"}
        Then /api/register with X-Konductor-Client-Version: 0.5.1
Expect: updateRequired absent. Dev rolled back to 0.5.0, client "newer".
```

### Test 5.4 — Rollback dev, user on dev, client older than both versions

```
Setup:  Same as 5.3 (dev rolled back to 0.5.0). Set user override=dev.
Action: /api/register with X-Konductor-Client-Version: 0.4.4
Expect: updateRequired=true, serverVersion=0.5.0. Client < rolled-back version.
```

### Test 5.5 — Rollback with no previous version fails

```
Setup:  Assign 0.5.1 to uat (first assignment, no previous).
Action: POST /api/admin/channels/rollback {"channel":"uat"}
Expect: HTTP 400 error: "No previous version available for rollback"
```

### Test 5.6 — Rollback prod does not affect dev/uat users

```
Setup:  Assign 0.5.0 then 0.5.1 to prod. Assign 0.5.1 to dev. Set user override=dev.
Action: POST /api/admin/channels/rollback {"channel":"prod"}
        Then /api/register with X-Konductor-Client-Version: 0.5.0
Expect: updateRequired=true, serverVersion=0.5.1. User on dev, prod rollback irrelevant.
```

---

## Group 6: Bundle Deletion → Stale Flow

**Purpose**: Verify that deleting a bundle from the registry correctly marks affected channels as stale and returns `bundleStale: true` to affected users.

### Test 6.1 — Delete bundle assigned to prod, user on prod

```
Setup:  Assign 0.5.1 to prod. User override=none, default=prod.
Action: DELETE /api/admin/bundles/0.5.1
        Then /api/register with X-Konductor-Client-Version: 0.5.1
Expect: bundleStale=true, staleMessage mentions "0.5.1" and "prod".
        updateRequired absent (stale channel has no valid version).
```

### Test 6.2 — Delete bundle assigned to both dev and prod

```
Setup:  Assign 0.5.1 to dev AND prod. Set user override=dev.
Action: DELETE /api/admin/bundles/0.5.1
        Then /api/register with X-Konductor-Client-Version: 0.5.1
Expect: bundleStale=true. Both dev and prod are stale.
        Verify GET /api/admin/channels shows both as __stale__:0.5.1.
```

### Test 6.3 — Delete bundle assigned to dev only, user on prod

```
Setup:  Assign 0.5.0 to dev, 0.5.1 to prod. User override=none, default=prod.
Action: DELETE /api/admin/bundles/0.5.0
        Then /api/register with X-Konductor-Client-Version: 0.5.0
Expect: bundleStale absent. Prod is unaffected (still has 0.5.1).
        updateRequired=true, serverVersion=0.5.1 (client < prod).
```

### Test 6.4 — Delete bundle assigned to dev, user on dev

```
Setup:  Assign 0.5.0 to dev, 0.5.1 to prod. Set user override=dev.
Action: DELETE /api/admin/bundles/0.5.0
        Then /api/register with X-Konductor-Client-Version: 0.5.0
Expect: bundleStale=true, staleMessage mentions "0.5.0" and "dev".
```

### Test 6.5 — Delete bundle NOT assigned to any channel

```
Setup:  Assign 0.5.1 to prod. Do NOT assign 0.5.0 to anything.
Action: DELETE /api/admin/bundles/0.5.0
        Then /api/register with X-Konductor-Client-Version: 0.5.0
Expect: bundleStale absent. No channels affected.
        updateRequired=true, serverVersion=0.5.1 (client < prod).
```

### Test 6.6 — Delete bundle assigned to prod, user on latest

```
Setup:  Assign 0.5.1 to prod. Set user override=latest.
Action: DELETE /api/admin/bundles/0.5.1
        Then /api/register with X-Konductor-Client-Version: 0.5.1
Expect: bundleStale absent. "latest" is never stale per checkChannelStale().
        Note: The bundle IS removed from registry, so getLatest() now returns
        the next newest (e.g. 0.5.0). updateRequired depends on that comparison.
```

### Test 6.7 — Delete bundle, verify channel metadata shows stale marker

```
Setup:  Assign 0.5.1 to prod.
Action: DELETE /api/admin/bundles/0.5.1
        Then GET /api/admin/channels
Expect: prod channel metadata shows version "__stale__:0.5.1".
```

### Test 6.8 — Delete bundle, verify stale tarball is 0 bytes

```
Setup:  Assign 0.5.1 to prod.
Action: DELETE /api/admin/bundles/0.5.1
        Then GET /bundle/installer-prod.tgz (or /bundle/installer.tgz)
Expect: Response is 0 bytes (empty tarball). This is a KNOWN ISSUE —
        should ideally return 404 instead of serving empty content.
```

---

## Group 7: Stale Resolution

**Purpose**: Verify that assigning a new version to a stale channel clears the stale state and resumes normal update signaling.

### Test 7.1 — Resolve stale prod by assigning new version

```
Setup:  From Group 6.1 (prod is stale after 0.5.1 deletion).
Action: Assign 0.5.0 to prod.
        Then /api/register with X-Konductor-Client-Version: 0.4.4
Expect: bundleStale absent. updateRequired=true, serverVersion=0.5.0.
```

### Test 7.2 — Resolve stale dev by assigning new version

```
Setup:  From Group 6.4 (dev is stale after 0.5.0 deletion). User override=dev.
Action: Assign 0.4.4 to dev.
        Then /api/register with X-Konductor-Client-Version: 0.4.0
Expect: bundleStale absent. updateRequired=true, serverVersion=0.4.4.
```

### Test 7.3 — Resolve stale by re-adding deleted bundle and reassigning

```
Setup:  Prod is stale (0.5.1 was deleted).
        Copy a bundle back into installers/ as installer-0.5.1.tgz.
        POST /api/admin/bundles/rescan to re-discover it.
Action: Assign 0.5.1 to prod.
        Then /api/register with X-Konductor-Client-Version: 0.5.0
Expect: bundleStale absent. updateRequired=true, serverVersion=0.5.1.
```

### Test 7.4 — Stale channel, then promote from non-stale channel

```
Setup:  Prod is stale. Dev has 0.5.0 assigned (not stale).
Action: POST /api/admin/channels/promote {"source":"dev","destination":"prod"}
        Then /api/register with X-Konductor-Client-Version: 0.4.4
Expect: bundleStale absent. Prod now has 0.5.0. updateRequired=true.
```

---

## Group 8: Direct NPX Install Commands

**Purpose**: Verify that running the channel-specific install commands downloads and installs the correct bundle version. These are the commands an admin would give to users.

**Precondition**: Server running. Channels assigned. Tests run from `testrepo/` directory.

### Test 8.1 — Install from prod channel

```
Setup:  Assign 0.5.1 to prod.
Action: npx http://localhost:3011/bundle/installer-prod.tgz --server http://localhost:3011 --api-key kd-a7f3b9c2e1d4
Expect: Installer runs successfully.
Verify: cat .konductor-version → "0.5.1"
```

### Test 8.2 — Install from dev channel

```
Setup:  Assign 0.5.0 to dev.
Action: npx http://localhost:3011/bundle/installer-dev.tgz --server http://localhost:3011 --api-key kd-a7f3b9c2e1d4
Expect: Installer runs successfully.
Verify: cat .konductor-version → "0.5.0"
```

### Test 8.3 — Install from uat channel

```
Setup:  Assign 0.4.4 to uat.
Action: npx http://localhost:3011/bundle/installer-uat.tgz --server http://localhost:3011 --api-key kd-a7f3b9c2e1d4
Expect: Installer runs successfully.
Verify: cat .konductor-version → "0.4.4"
```

### Test 8.4 — Install from default endpoint (backward compat, serves prod)

```
Setup:  Assign 0.5.1 to prod.
Action: npx http://localhost:3011/bundle/installer.tgz --server http://localhost:3011 --api-key kd-a7f3b9c2e1d4
Expect: Installer runs successfully. Downloads prod tarball.
Verify: cat .konductor-version → "0.5.1"
```

### Test 8.5 — Install from latest endpoint

```
Setup:  Registry has 0.5.1 as newest bundle.
Action: npx http://localhost:3011/bundle/installer-latest.tgz --server http://localhost:3011 --api-key kd-a7f3b9c2e1d4
Expect: Installer runs successfully. Downloads newest registry bundle.
Verify: cat .konductor-version → "0.5.1"
```

### Test 8.6 — Install from unassigned dev channel (404)

```
Setup:  Dev channel has no bundle assigned.
Action: npx http://localhost:3011/bundle/installer-dev.tgz --server http://localhost:3011 --api-key kd-a7f3b9c2e1d4
Expect: npx fails. Server returns 404: "Channel "dev" has no installer available"
Verify: .konductor-version unchanged from before.
```

### Test 8.7 — Install from stale prod channel (0-byte tarball)

```
Setup:  Prod is stale (bundle was deleted, channel has 0-byte placeholder).
Action: npx http://localhost:3011/bundle/installer-prod.tgz --server http://localhost:3011 --api-key kd-a7f3b9c2e1d4
Expect: npx fails or installs broken package (0-byte tarball).
        KNOWN ISSUE: Should return 404 instead of serving empty content.
Verify: .konductor-version unchanged or installer errors out.
```

### Test 8.8 — Install from latest with empty registry (404)

```
Setup:  Registry is empty (no .tgz files in installers/).
Action: npx http://localhost:3011/bundle/installer-latest.tgz --server http://localhost:3011 --api-key kd-a7f3b9c2e1d4
Expect: npx fails. Server returns 404: "No bundles available in the registry"
Note:   Hard to test without removing all bundles from installers/.
```

### Test 8.9 — Change prod version, re-install gets new version

```
Setup:  Assign 0.5.0 to prod. Install via 8.4. Verify version=0.5.0.
Action: Assign 0.5.1 to prod.
        Re-run: npx http://localhost:3011/bundle/installer.tgz --server http://localhost:3011 --api-key kd-a7f3b9c2e1d4
Expect: Installer runs. Now installs 0.5.1.
Verify: cat .konductor-version → "0.5.1"
```

### Test 8.10 — Change dev version, re-install gets new version

```
Setup:  Assign 0.5.0 to dev. Install via 8.2. Verify version=0.5.0.
Action: Assign 0.5.1 to dev.
        Re-run: npx http://localhost:3011/bundle/installer-dev.tgz --server http://localhost:3011 --api-key kd-a7f3b9c2e1d4
Expect: Installer runs. Now installs 0.5.1.
Verify: cat .konductor-version → "0.5.1"
```

### Test 8.11 — Install different channels sequentially, version changes each time

```
Setup:  Assign 0.4.4 to dev, 0.5.0 to uat, 0.5.1 to prod.
Action:
  1. npx .../installer-dev.tgz ... → verify .konductor-version = 0.4.4
  2. npx .../installer-uat.tgz ... → verify .konductor-version = 0.5.0
  3. npx .../installer-prod.tgz ... → verify .konductor-version = 0.5.1
  4. npx .../installer-latest.tgz ... → verify .konductor-version = 0.5.1 (newest in registry)
Expect: Each install overwrites the previous version file.
```

### Test 8.12 — Verify tarball content differs between channels

```
Setup:  Assign 0.4.4 to dev, 0.5.1 to prod.
Action:
  curl -s -o /tmp/dev.tgz http://localhost:3011/bundle/installer-dev.tgz
  curl -s -o /tmp/prod.tgz http://localhost:3011/bundle/installer-prod.tgz
  shasum /tmp/dev.tgz /tmp/prod.tgz
Expect: Different SHA sums (different bundle versions).
```

---

## Group 9: Watcher Auto-Update Behavior

**Purpose**: Verify the file watcher's auto-update logic when it receives `updateRequired` from the server.

**Precondition**: Watcher running in testrepo. Server running with channels assigned.

### Test 9.1 — Watcher triggers auto-update on outdated version

```
Setup:  Set .konductor-version to "0.5.0". Assign 0.5.1 to prod.
        Start watcher: node konductor-watcher.mjs
Action: Touch a file to trigger registration, or wait for poll.
Expect: Watcher log shows "🔄 UPDATING Konductor client v0.5.0 → v0.5.1"
        Watcher runs npx, self-restarts.
Verify: .konductor-version → "0.5.1" after restart.
```

### Test 9.2 — Watcher skips update if already at target version

```
Setup:  Set .konductor-version to "0.5.1". Assign 0.5.1 to prod.
Action: Touch a file to trigger registration.
Expect: No update log. Watcher continues normally.
```

### Test 9.3 — Watcher skips duplicate update (lastUpdateVersion guard)

```
Setup:  Set .konductor-version to "0.5.0". Assign 0.5.1 to prod.
Action: Trigger two rapid registrations.
Expect: First triggers update. Second skips ("Already updated to v0.5.1").
```

### Test 9.4 — Watcher with no version file

```
Setup:  Delete .konductor-version. Assign 0.5.1 to prod.
Action: Start watcher, touch a file.
Expect: CLIENT_VERSION is "". Server sees empty → "outdated".
        Watcher triggers update.
```

### Test 9.5 — BUG: Watcher ignores updateUrl, always downloads prod

```
Setup:  Set user override=dev. Assign 0.5.1 to dev, 0.5.0 to prod.
        Set .konductor-version to "0.5.0".
Action: Touch a file. Server returns updateRequired=true, serverVersion=0.5.1,
        updateUrl=".../bundle/installer-dev.tgz".
Expect: KNOWN BUG — Watcher runs `npx .../bundle/installer.tgz` (hardcoded prod URL).
        It downloads prod (0.5.0) instead of dev (0.5.1).
        After "update", version is still 0.5.0 or the update is a no-op.
Verify: Check watcher log for the npx command URL.
```

### Test 9.6 — Watcher startup version check

```
Setup:  Set .konductor-version to "0.5.0". Assign 0.5.1 to prod.
Action: Start watcher (node konductor-watcher.mjs).
Expect: Startup calls /api/status. If updateRequired=true, triggers update.
Note:   /api/status uses pkgVersion (BUG Group 10), so this may compare
        against 0.5.2 (server package version) instead of channel version.
```

### Test 9.7 — Watcher poll version check (no active session)

```
Setup:  Set .konductor-version to "0.5.0". Assign 0.5.1 to prod.
        Watcher running but no files changed (no active session).
Action: Wait for poll interval (10s default).
Expect: Watcher calls /api/status for version check.
        Same BUG as 9.6 — compares against pkgVersion.
```

---

## Group 10: Version Check Path Consistency

**Purpose**: Verify that ALL endpoints that perform version checks return consistent results. Identify which paths use channel-aware checks vs. hardcoded pkgVersion.

**Precondition**: Assign 0.5.0 to prod. User override=none, default=prod. Client version=0.4.4.

### Test 10.1 — MCP register_session (channel-aware) ✓

```
Action: Call register_session MCP tool with clientVersion: "0.4.4"
Expect: updateRequired=true, serverVersion=0.5.0 (prod channel version).
        NOT 0.5.2 (server package version).
```

### Test 10.2 — REST /api/register (channel-aware) ✓

```
Action: POST /api/register with X-Konductor-Client-Version: 0.4.4
Expect: updateRequired=true, serverVersion=0.5.0 (prod channel version).
```

### Test 10.3 — REST /api/status (BUG: uses pkgVersion)

```
Action: POST /api/status with X-Konductor-Client-Version: 0.4.4
Expect: KNOWN BUG — updateRequired=true, serverVersion=0.5.2 (pkgVersion).
        Should be serverVersion=0.5.0 (prod channel version).
```

### Test 10.4 — REST /api/status with no active session (BUG: uses pkgVersion)

```
Action: POST /api/status with X-Konductor-Client-Version: 0.4.4
        (user has no active session)
Expect: KNOWN BUG — updateRequired=true, serverVersion=0.5.2.
```

### Test 10.5 — MCP check_status (BUG: uses pkgVersion)

```
Action: Call check_status MCP tool with clientVersion: "0.4.4"
Expect: KNOWN BUG — updateRequired=true, serverVersion=0.5.2.
```

### Test 10.6 — MCP client_update_check (BUG: uses pkgVersion)

```
Action: Call client_update_check MCP tool with clientVersion: "0.4.4"
Expect: KNOWN BUG — status="outdated", serverVersion=0.5.2.
        updateCommand uses buildChannelUpdateUrl (partially correct).
```

### Test 10.7 — SSE connect registration (channel-aware) ✓

```
Action: Connect via SSE, register with X-Konductor-Client-Version: 0.4.4
Expect: updateRequired=true, serverVersion=0.5.0 (prod channel version).
```

### Test 10.8 — Consistency check: all paths with client=0.5.0, prod=0.5.0

```
Action: Set prod=0.5.0, client=0.5.0. Call all endpoints.
Expect:
  /api/register:       updateRequired absent (0.5.0 = 0.5.0) ✓
  /api/status:         updateRequired=true, serverVersion=0.5.2 (BUG)
  MCP register_session: updateRequired absent ✓
  MCP check_status:    updateRequired=true, serverVersion=0.5.2 (BUG)
```

### Test 10.9 — Consistency check: all paths with client=0.5.2

```
Action: Set prod=0.5.0, client=0.5.2. Call all endpoints.
Expect:
  /api/register:       updateRequired absent (0.5.2 > 0.5.0) ✓
  /api/status:         updateRequired absent (0.5.2 = pkgVersion 0.5.2) ✓ (accidentally correct)
  MCP register_session: updateRequired absent ✓
  MCP check_status:    updateRequired absent ✓ (accidentally correct)
```

---

## Group 11: Cross-Channel Install Then Auto-Update

**Purpose**: End-to-end flow — install from a specific channel, then verify auto-update triggers when that channel's version changes.

### Test 11.1 — Install prod, then prod version bumped

```
Setup:  Assign 0.5.0 to prod.
Action: npx .../installer-prod.tgz ... → .konductor-version = 0.5.0
        Then assign 0.5.1 to prod.
        Then /api/register with X-Konductor-Client-Version: 0.5.0
Expect: updateRequired=true, serverVersion=0.5.1.
```

### Test 11.2 — Install dev, then dev version bumped (user on dev)

```
Setup:  Assign 0.5.0 to dev. Set user override=dev.
Action: npx .../installer-dev.tgz ... → .konductor-version = 0.5.0
        Then assign 0.5.1 to dev.
        Then /api/register with X-Konductor-Client-Version: 0.5.0
Expect: updateRequired=true, serverVersion=0.5.1, updateUrl has "installer-dev.tgz".
```

### Test 11.3 — Install dev, then prod version bumped (user on dev, prod irrelevant)

```
Setup:  Assign 0.5.1 to dev, 0.5.0 to prod. Set user override=dev.
Action: npx .../installer-dev.tgz ... → .konductor-version = 0.5.1
        Then assign 0.5.1 to prod.
        Then /api/register with X-Konductor-Client-Version: 0.5.1
Expect: updateRequired absent. User on dev=0.5.1, matches client.
```

### Test 11.4 — Install prod, then dev bumped (user on prod, dev irrelevant)

```
Setup:  Assign 0.5.1 to prod, 0.5.0 to dev. User override=none, default=prod.
Action: npx .../installer-prod.tgz ... → .konductor-version = 0.5.1
        Then assign 0.5.1 to dev.
        Then /api/register with X-Konductor-Client-Version: 0.5.1
Expect: updateRequired absent. User on prod=0.5.1, dev change irrelevant.
```

### Test 11.5 — Install latest, then new bundle added to registry

```
Setup:  Registry has up to 0.5.0. Set user override=latest.
Action: npx .../installer-latest.tgz ... → .konductor-version = 0.5.0
        Then add installer-0.5.1.tgz to installers/ (or rescan).
        Then /api/register with X-Konductor-Client-Version: 0.5.0
Expect: updateRequired=true, serverVersion=0.5.1.
```

### Test 11.6 — Install uat, switch user to prod, version comparison changes

```
Setup:  Assign 0.5.0 to uat, 0.5.1 to prod. Set user override=uat.
Action: npx .../installer-uat.tgz ... → .konductor-version = 0.5.0
        Then change user override to prod (or clear it, default=prod).
        Then /api/register with X-Konductor-Client-Version: 0.5.0
Expect: updateRequired=true, serverVersion=0.5.1. Now comparing against prod.
```

### Test 11.7 — Install prod, switch user to dev (downgrade scenario)

```
Setup:  Assign 0.5.1 to prod, 0.5.0 to dev. User override=none.
Action: npx .../installer-prod.tgz ... → .konductor-version = 0.5.1
        Then set user override=dev.
        Then /api/register with X-Konductor-Client-Version: 0.5.1
Expect: updateRequired absent. Client 0.5.1 > dev 0.5.0 ("newer").
        No forced downgrade.
```

---

## Group 12: Server Restart — In-Memory Channel Loss

**Purpose**: Verify behavior after server restart, since InstallerChannelStore is in-memory only.

### Test 12.1 — Channel assignments lost after restart

```
Setup:  Assign 0.5.1 to prod. Verify via GET /api/admin/channels.
Action: Restart server (kill + start-konductor.sh).
        GET /api/admin/channels.
Expect: Prod channel is either empty or re-seeded from konductor-setup/ fallback.
        The 0.5.1 assignment is gone.
```

### Test 12.2 — BundleRegistry rescans on restart

```
Setup:  Bundles exist in installers/.
Action: Restart server.
        GET /api/admin/bundles.
Expect: All bundles from installers/ are re-indexed.
        But NO channel assignments exist (must be re-done via admin).
```

### Test 12.3 — /api/register after restart with no channel assignments

```
Setup:  Restart server. No channels assigned.
Action: /api/register with X-Konductor-Client-Version: 0.5.0
Expect: getEffectiveChannelVersion returns null → no update signal.
        updateRequired absent.
```

### Test 12.4 — /api/status after restart (uses pkgVersion)

```
Setup:  Restart server. No channels assigned.
Action: /api/status with X-Konductor-Client-Version: 0.5.0
Expect: updateRequired=true, serverVersion=0.5.2 (pkgVersion).
        BUG: /api/status doesn't use channel-aware check, so it compares
        against 0.5.2 even though no channel has a bundle.
```

### Test 12.5 — User override survives restart (persisted in history-users.json)

```
Setup:  Set user override=dev. Restart server.
Action: GET /api/admin/users → check deanwheatley's installerChannel.
Expect: installerChannel=dev (persisted in history-users.json).
```

### Test 12.6 — Global default survives restart (persisted in settings.json)

```
Setup:  Change defaultChannel to "dev". Restart server.
Action: GET /api/admin/settings → check defaultChannel.
Expect: defaultChannel=dev (persisted in settings.json).
```

---

## Group 13: updateUrl Construction

**Purpose**: Verify that the `updateUrl` in responses points to the correct channel-specific endpoint.

### Test 13.1 — User on prod (default), updateUrl is /bundle/installer.tgz

```
Setup:  Assign 0.5.1 to prod. User override=none, default=prod.
Action: /api/register with X-Konductor-Client-Version: 0.5.0
Expect: updateUrl ends with "/bundle/installer.tgz" (prod backward compat).
```

### Test 13.2 — User on dev, updateUrl is /bundle/installer-dev.tgz

```
Setup:  Assign 0.5.1 to dev. Set user override=dev.
Action: /api/register with X-Konductor-Client-Version: 0.5.0
Expect: updateUrl ends with "/bundle/installer-dev.tgz".
```

### Test 13.3 — User on uat, updateUrl is /bundle/installer-uat.tgz

```
Setup:  Assign 0.5.1 to uat. Set user override=uat.
Action: /api/register with X-Konductor-Client-Version: 0.5.0
Expect: updateUrl ends with "/bundle/installer-uat.tgz".
```

### Test 13.4 — User on latest, updateUrl is /bundle/installer-latest.tgz

```
Setup:  Set user override=latest. Registry has 0.5.1.
Action: /api/register with X-Konductor-Client-Version: 0.5.0
Expect: updateUrl ends with "/bundle/installer-latest.tgz".
```

### Test 13.5 — User on prod with explicit override, updateUrl is /bundle/installer-prod.tgz

```
Setup:  Assign 0.5.1 to prod. Set user override=prod (explicit, not default).
Action: /api/register with X-Konductor-Client-Version: 0.5.0
Expect: updateUrl ends with "/bundle/installer-prod.tgz" (explicit channel URL).
        Note: buildChannelUpdateUrl returns /bundle/installer.tgz for prod.
        Verify whether explicit prod override produces -prod.tgz or plain .tgz.
```

---

## Group 14: Edge Cases

### Test 14.1 — Malformed client version

```
Action: /api/register with X-Konductor-Client-Version: "abc"
Expect: updateRequired=true. compareVersions("abc", ...) returns "outdated".
```

### Test 14.2 — No client version header

```
Action: /api/register WITHOUT X-Konductor-Client-Version header
Expect: updateRequired=true. compareVersions(undefined, ...) returns "outdated".
```

### Test 14.3 — Pre-release client version

```
Action: /api/register with X-Konductor-Client-Version: "0.5.1-beta"
Expect: updateRequired=true. compareVersions regex rejects pre-release.
```

### Test 14.4 — Client version with "v" prefix

```
Action: /api/register with X-Konductor-Client-Version: "v0.5.1"
Expect: updateRequired=true. compareVersions regex rejects "v" prefix.
```

### Test 14.5 — Two-part version string

```
Action: /api/register with X-Konductor-Client-Version: "0.5"
Expect: updateRequired=true. compareVersions regex rejects two-part.
```

### Test 14.6 — Client version newer than everything

```
Setup:  Assign 0.5.1 to prod.
Action: /api/register with X-Konductor-Client-Version: "99.99.99"
Expect: updateRequired absent. Client is "newer".
```

### Test 14.7 — Assign same version to multiple channels

```
Setup:  Assign 0.5.1 to dev, uat, AND prod.
Action: For each user override, /api/register with client 0.5.0.
Expect: All return updateRequired=true, serverVersion=0.5.1.
        updateUrl differs per channel.
```

### Test 14.8 — Rapid channel reassignment

```
Setup:  Assign 0.5.0 to prod. Then immediately assign 0.5.1 to prod.
Action: /api/register with X-Konductor-Client-Version: 0.5.0
Expect: updateRequired=true, serverVersion=0.5.1. Latest assignment wins.
```

---

## Known Bugs Summary

| # | Bug | Affected Tests | Severity |
|---|-----|---------------|----------|
| B1 | `/api/status` uses `pkgVersion` instead of channel-aware version | 10.3, 10.4, 10.8, 12.4 | High — watcher polls this endpoint |
| B2 | MCP `check_status` uses `pkgVersion` | 10.5, 10.8 | Medium — agent uses this |
| B3 | MCP `client_update_check` uses `pkgVersion` | 10.6 | Low — informational tool |
| B4 | Watcher hardcodes `/bundle/installer.tgz` in `runAutoUpdate()` | 9.5 | High — ignores channel-specific updateUrl |
| B5 | Rollback can't force downgrade | 5.1, 5.3 | Medium — design limitation |
| B6 | Channel assignments lost on server restart | 12.1, 12.3 | High — requires admin re-setup |
| B7 | Stale channel serves 0-byte tarball instead of 404 | 6.8, 8.7 | Medium — confusing client behavior |
| B8 | `client_install_info` MCP tool hardcodes `/bundle/installer.tgz` | — | Low — doesn't show channel-specific commands |

---

## Execution Order

Recommended execution order to minimize setup/teardown:

1. **Group 14** (Edge cases — no channel setup needed, quick)
2. **Group 1** (Channel assignment basics)
3. **Group 2** (Latest pseudo-channel)
4. **Group 13** (updateUrl construction — piggyback on Group 1/2 setup)
5. **Group 3** (Global default changes)
6. **Group 4** (Promotion)
7. **Group 5** (Rollback)
8. **Group 6** (Bundle deletion → stale)
9. **Group 7** (Stale resolution)
10. **Group 10** (Version check consistency — documents bugs)
11. **Group 8** (Direct NPX installs — destructive to testrepo, do last)
12. **Group 11** (Cross-channel install + update — builds on Group 8)
13. **Group 9** (Watcher behavior — requires running watcher)
14. **Group 12** (Server restart — do very last, disrupts everything)
