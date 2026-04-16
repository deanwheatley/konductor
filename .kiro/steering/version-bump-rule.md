---
inclusion: fileMatch
fileMatchPattern: "konductor-setup/**,konductor/konductor_bundle/**,konductor/src/**,konductor-watcher.mjs"
---

# Version Bump Rule

## Rule

Whenever you modify any file that gets deployed to clients, you MUST bump the patch version in BOTH:

1. `konductor-setup/package.json` — the installer package version
2. `konductor/package.json` — the server version (which the bundle manifest reports)

These two versions should stay in sync.

## Files that trigger a version bump

- Anything in `konductor-setup/` (installer logic, bundle files)
- Anything in `konductor/konductor_bundle/` (steering rules, hooks, watcher, agent rules)
- Anything in `konductor/src/` (server source code)
- `konductor-watcher.mjs` (workspace root copy — also update the bundle copies)

## How to bump

Read the current version from `konductor-setup/package.json`, increment the patch number, and write it back. Do the same for `konductor/package.json`.

Example: `0.1.0` → `0.1.1`, `0.1.1` → `0.1.2`, etc.

## Why

The server compares its `package.json` version against the client's `.konductor-version` file. If they match, no update is triggered. If you change bundle files without bumping the version, clients will never know there's an update available.
