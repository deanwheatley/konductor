# Requirements Document

## Introduction

The Konductor Cloud Installer Registry provides persistent, upload-based installer bundle management for cloud-hosted Konductor deployments. Admins upload versioned client installer bundles through the admin dashboard or CI/CD API, and assign specific versions to release channels (Dev, UAT, Prod). Bundles are stored persistently (SQLite + disk or S3) and survive server restarts. Versioning follows Semantic Versioning 2.0.0 (semver). This spec covers the cloud deployment use case where `KONDUCTOR_SERVE_CLIENT_BUNDLES_FROM_LOCAL_STORE` is `false` or unset. The local development use case is covered by the `konductor-local-bundle-store` spec.

## Dependencies

- `konductor-admin` — provides the admin dashboard, authentication, settings store, SSE events, and the Global Client Settings panel
- `konductor-npx-installer` — provides the installer tarball format, client auto-update mechanism, and `/bundle/installer-*.tgz` serving endpoints
- `konductor-long-term-memory` — provides the SQLite storage backend for persistent bundle metadata
- `konductor-local-bundle-store` — provides the shared bundle registry interface, Bundle Manager page, channel assignment UI, and stale client handling that this spec extends with upload and persistent storage

## Glossary

- **Cloud Installer Registry**: A persistent store of versioned installer bundles backed by SQLite metadata and disk/S3 file storage
- **Bundle Upload**: The act of submitting a `.tgz` installer bundle with a version string through the admin dashboard or API
- **Bundle Manifest**: A JSON file (`bundle-manifest.json`) embedded inside each `.tgz` bundle containing version, author, creation date, and feature summary (shared with local-bundle-store spec)
- **Persistent Storage**: SQLite for metadata + filesystem or S3 for tarball binary storage, surviving server restarts
- **Semver**: Semantic Versioning 2.0.0 — `MAJOR.MINOR.PATCH[-prerelease][+build]`

## Requirements

### Requirement 1: Bundle Upload

**User Story:** As an admin, I want to upload installer bundles through the admin dashboard, so that new versions are available for channel assignment without server access.

#### Acceptance Criteria

1. THE Bundle Manager page SHALL include an upload area that accepts a `.tgz` file
2. WHEN the admin uploads a bundle, THE server SHALL extract `bundle-manifest.json` from the tarball to determine version, author, and summary
3. WHEN the tarball does not contain `bundle-manifest.json`, THE server SHALL prompt the admin for a version string and use the upload timestamp and admin userId for metadata
4. WHEN the admin uploads a bundle with a version that already exists in the registry, THE server SHALL reject the upload with an error indicating the version already exists (immutable versions)
5. WHEN the upload succeeds, THE server SHALL persist the tarball to disk (or S3) and store metadata in SQLite
6. THE upload API endpoint SHALL be `POST /api/admin/bundles` accepting multipart form data or JSON with base64-encoded tarball
7. WHEN the upload completes, THE server SHALL emit an SSE event so the admin dashboard and Bundle Manager page update in real time

### Requirement 2: Persistent Storage

**User Story:** As a server operator, I want uploaded bundles to survive server restarts, so that channel assignments and bundle data are not lost.

#### Acceptance Criteria

1. WHEN using SQLite storage, THE server SHALL store bundle metadata (version, upload timestamp, SHA-256 hash, file size, author, summary, file path) in a `bundles` table
2. WHEN using SQLite storage, THE server SHALL store tarball files on disk in a configurable directory (default: `bundles/` in the working directory)
3. WHEN the server starts, THE server SHALL load all bundle metadata from SQLite and verify that referenced tarball files exist on disk, logging warnings for any missing files
4. WHEN using in-memory storage (no SQLite), THE server SHALL hold bundles in memory (lost on restart), matching the local-bundle-store behavior
5. THE storage backend SHALL be determined by the existing `KONDUCTOR_STORAGE_MODE` setting (sqlite or memory)

### Requirement 3: Bundle Deletion with Persistence

**User Story:** As an admin, I want to delete bundles from the cloud registry with the same stale-client handling as the local store.

#### Acceptance Criteria

1. WHEN a bundle is deleted, THE server SHALL remove the tarball file from disk (or S3) and delete the metadata row from SQLite
2. THE stale client handling SHALL follow the same rules as the `konductor-local-bundle-store` spec (Requirement 7): warn clients, don't block, auto-recover when a new version is assigned
3. WHEN a bundle assigned to a channel is deleted, THE server SHALL notify affected users via SSE and the next `register_session` response

### Requirement 4: CI/CD Integration

**User Story:** As a DevOps engineer, I want to upload bundles from CI/CD pipelines, so that new builds are automatically available for channel assignment.

#### Acceptance Criteria

1. THE `POST /api/admin/bundles` endpoint SHALL accept uploads authenticated via `Authorization: Bearer <apiKey>` + `X-Konductor-User` header (same as other admin API endpoints)
2. THE endpoint SHALL return the bundle metadata (version, hash, size) on success, enabling CI scripts to verify the upload
3. THE `PUT /api/admin/channels/:channel/assign` endpoint SHALL allow CI scripts to assign a newly uploaded version to a channel in the same pipeline
4. THE API SHALL support a combined upload-and-assign operation: `POST /api/admin/bundles` with an optional `assignTo` field (array of channel names) that assigns the uploaded version to the specified channels in one call

### Requirement 5: Shared Interface with Local Bundle Store

**User Story:** As a server operator, I want the cloud registry and local bundle store to share the same admin UI and API interface, so that switching between local and cloud mode requires no UI changes.

#### Acceptance Criteria

1. THE Bundle Manager page (`/admin/bundles`) SHALL work identically for both local and cloud modes, with the only difference being the "Local Store Mode" badge and the upload area behavior
2. WHEN in cloud mode, THE upload area SHALL accept file uploads through the browser
3. WHEN in local store mode, THE upload area SHALL be replaced with instructions to drop files in the `installers/` directory
4. THE channel assignment dropdowns, bundle table, and all API endpoints SHALL use the same interface regardless of storage backend
5. THE `GET /api/admin/bundles` response format SHALL be identical for both modes
