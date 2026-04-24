# Requirements Document

## Introduction

The Konductor client installer is currently distributed as a `konductor_bundle` folder that users must manually copy into their workspace before running the install script. This approach pollutes user projects with source files, creates version drift across installations, and makes updates painful. This spec replaces the copy-and-run model with an `npx`-based installer that downloads the latest bundle from the Konductor server at install time, giving users a one-liner setup command, automatic versioning, and a clean update path.

## Glossary

- **Bundle**: The collection of files deployed to a user's workspace and global config directories (watcher, hooks, steering rules, MCP config templates)
- **Konductor Server**: The running MCP server instance that tracks sessions and evaluates collision risk, also serves the bundle manifest and artifacts
- **Global Setup**: One-time installation of MCP config, global steering rules, and global agent rules into the user's home directory
- **Workspace Setup**: Per-project installation of the file watcher, hooks, steering rules, agent rules, and .gitignore entries into a specific project directory
- **Bundle Manifest**: A JSON document served by the Konductor server that describes the current bundle version and the list of files available for download

## Requirements

### Requirement 1

**User Story:** As a software engineer, I want to install Konductor into my project with a single `npx` command, so that I don't need to manually copy files or know where the bundle lives.

#### Acceptance Criteria

1. WHEN a user runs `npx konductor-setup`, THE installer SHALL perform both global and workspace setup using the same logic as the current `install.sh` / `install.ps1`
2. WHEN a user runs `npx konductor-setup --workspace`, THE installer SHALL perform only workspace setup, skipping global config
3. WHEN a user runs `npx konductor-setup --global`, THE installer SHALL perform only global setup, skipping workspace artifacts
4. WHEN the installer runs, THE installer SHALL detect the workspace root by walking up from the current directory to find `.git` or `.kiro`, matching the current installer behavior
5. WHEN the installer completes, THE installer SHALL print a summary of what was installed and remind the user to verify their API key in `~/.kiro/settings/mcp.json`

### Requirement 2

**User Story:** As a software engineer, I want the npx installer to download the latest bundle from the Konductor server, so that my installation is always up to date without manual file management.

#### Acceptance Criteria

1. WHEN the installer runs, THE installer SHALL fetch a bundle manifest from the Konductor server to determine the current bundle version and file list
2. WHEN the manifest is fetched successfully, THE installer SHALL download each bundle file from the server and stage them in a temporary directory before deploying
3. WHEN the Konductor server is not reachable, THE installer SHALL fall back to using the bundle files embedded in the npm package itself
4. WHEN falling back to embedded files, THE installer SHALL print a warning indicating the server was unreachable and the embedded (potentially older) bundle version is being used
5. WHEN the `--server` flag is provided (e.g., `npx konductor-setup --server https://konductor.example.com:3010`), THE installer SHALL use the specified URL instead of the default

### Requirement 3

**User Story:** As a software engineer, I want to pass my API key during installation, so that I don't have to manually edit config files after setup.

#### Acceptance Criteria

1. WHEN the user provides `--api-key <key>` on the command line, THE installer SHALL write the key into the MCP config (`~/.kiro/settings/mcp.json`) instead of the placeholder `YOUR_API_KEY`
2. WHEN the user does not provide `--api-key`, THE installer SHALL write the placeholder `YOUR_API_KEY` and remind the user to set it manually, matching current behavior
3. WHEN the MCP config already exists and contains a konductor entry with a non-placeholder API key, THE installer SHALL preserve the existing key unless `--api-key` is explicitly provided

### Requirement 4

**User Story:** As a software engineer with multiple projects, I want to run the installer once globally and then quickly enable Konductor per-project, so that repeated setup is fast and doesn't duplicate global config.

#### Acceptance Criteria

1. WHEN global config already exists (MCP config has a konductor entry), THE installer running without flags SHALL detect this and default to workspace-only setup
2. WHEN defaulting to workspace-only setup, THE installer SHALL print a message indicating global config was detected and only workspace setup is being performed
3. WHEN the user explicitly passes `--global`, THE installer SHALL re-run global setup regardless of existing config (clean reinstall)

### Requirement 5

**User Story:** As a software engineer, I want the installer to preserve all existing invariants (watcher launch, .gitignore entries, env file preservation), so that the new distribution method doesn't break the established install behavior.

#### Acceptance Criteria

1. WHEN workspace setup completes, THE installer SHALL launch the file watcher as a background process, matching the invariant in `konductor-installer-invariants.md`
2. WHEN `.konductor-watcher.env` already exists in the workspace, THE installer SHALL preserve it and not overwrite it
3. WHEN workspace setup completes, THE installer SHALL add Konductor runtime artifacts to `.gitignore` if not already present
4. WHEN workspace setup completes, THE installer SHALL clean up any previous installation artifacts before deploying new ones (clean reinstall)
5. THE installer SHALL deploy the same set of files to the same locations as the current `install.sh` and `install.ps1` (watcher, launcher, watchdog, hooks, steering rules, agent rules)

### Requirement 6

**User Story:** As a software engineer, I want to check which version of Konductor is installed and update it easily, so that I can stay current without guessing.

#### Acceptance Criteria

1. WHEN a user runs `npx konductor-setup --version`, THE installer SHALL print the installed npm package version
2. WHEN a user runs `npx konductor-setup --check-update`, THE installer SHALL compare the installed package version against the server's bundle manifest version and report whether an update is available
3. WHEN a user runs `npx konductor-setup` and the server reports a newer bundle version than what is currently deployed in the workspace, THE installer SHALL update the workspace artifacts to the latest version

### Requirement 7

**User Story:** As the Konductor server operator, I want to serve the bundle manifest and files from the server, so that users always get the version matching their server.

#### Acceptance Criteria

1. THE Konductor server SHALL expose a `GET /bundle/manifest.json` endpoint that returns the current bundle version and a list of file paths available for download
2. THE Konductor server SHALL expose a `GET /bundle/files/<path>` endpoint that serves individual bundle files
3. WHEN the bundle manifest endpoint is called, THE server SHALL return a JSON document containing `version` (semver string) and `files` (array of relative file paths)
4. THE bundle endpoints SHALL NOT require authentication, so that the installer can fetch the bundle before the user has configured their API key
5. WHEN a requested bundle file does not exist, THE server SHALL return HTTP 404

### Requirement 8

**User Story:** As a software engineer, I want the npx installer to work cross-platform (macOS, Linux, Windows), so that the same command works regardless of my operating system.

#### Acceptance Criteria

1. THE installer SHALL be implemented in Node.js (no bash/PowerShell dependency for the core logic), ensuring cross-platform compatibility
2. WHEN running on Windows, THE installer SHALL handle path separators and file permissions correctly
3. WHEN launching the file watcher on any platform, THE installer SHALL use the appropriate process spawning method for the OS (matching current `install.sh` and `install.ps1` behavior)
4. THE npm package SHALL declare `"bin"` entry pointing to the installer script so that `npx` can invoke it directly

### Requirement 9

**User Story:** As a software engineer, I want the Konductor server to automatically check my client installation version when I connect, and trigger an update if I'm out of date, so that I never run stale tooling without realizing it.

#### Acceptance Criteria

1. WHEN a client connects to the Konductor server (via SSE or first MCP tool call), THE server SHALL compare the client's reported bundle version against the server's current bundle version
2. WHEN the client does not report a version (e.g., pre-npx installations or missing header), THE server SHALL treat the client as outdated
3. WHEN the client's bundle version is older than the server's bundle version, THE server SHALL include an `updateRequired` flag and the server's bundle version in the response
4. WHEN the steering rule receives a response with `updateRequired: true`, THE agent SHALL automatically run `npx konductor-setup@latest --workspace` to update the workspace artifacts and notify the user: `🔄 Konductor: Client updated to v<version>.`
5. WHEN the automatic update completes successfully, THE agent SHALL re-register the session without requiring user intervention
6. WHEN the automatic update fails (e.g., npx not available, network error), THE agent SHALL warn the user: `⚠️ Konductor: Client is outdated (v<old> → v<new>). Run "npx konductor-setup" to update.`
7. THE client SHALL report its bundle version to the server via an `X-Konductor-Client-Version` header on SSE connections and as a `clientVersion` field in MCP tool call inputs

### Requirement 10

**User Story:** As a software engineer, I want the steering rule's "setup konductor" command to use the new npx installer, so that the agent-driven setup path also benefits from the improved distribution.

#### Acceptance Criteria

1. WHEN the user says "setup konductor" in chat, THE steering rule SHALL instruct the agent to run `npx konductor-setup` instead of `bash konductor_bundle/install.sh`
2. WHEN the Konductor server URL is known from context, THE steering rule SHALL pass it via `--server` flag
3. WHEN the user's API key is known from context, THE steering rule SHALL pass it via `--api-key` flag

