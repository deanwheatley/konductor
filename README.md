# Konductor

A Work Coordination MCP Server that solves "collision debt" — the accumulated cost of merge conflicts caused by uncoordinated concurrent development across repositories.

Konductor tracks which engineers are actively modifying which files, evaluates collision risk using a graduated state model, and surfaces real-time awareness through MCP tools, IDE integration, and team communication channels.

## Quick Start

### Prerequisites

- Node.js 20+
- npm

### 1. Start the server

There's a convenience script at the project root that handles deps, builds, and launches:

```bash
./start-konductor.sh
```

This script:
- Checks for Node.js 20+
- Runs `npm install` in `konductor/` if `node_modules` is missing
- Runs `npm run build` if `dist/` is missing
- Reads `konductor/.env.local` for port, API key, and TLS settings
- Starts the SSE server (default: `https://localhost:3010`)

Flags:
- `--build` — force a TypeScript rebuild before starting
- `--http` — force HTTP even if TLS certs exist

Before first run, set up your environment:

```bash
cp konductor/.env.local.example konductor/.env.local
# Edit .env.local — set KONDUCTOR_API_KEY at minimum
```

For HTTPS (recommended for multi-user), generate TLS certs with `mkcert`:

```bash
brew install mkcert && mkcert -install
mkdir -p konductor/certs
mkcert -key-file konductor/certs/key.pem -cert-file konductor/certs/cert.pem \
  $(hostname) localhost 127.0.0.1 YOUR_LAN_IP
```

Verify it's running:

```bash
curl -sk https://localhost:3010/health
# → {"status":"ok"}
```

### 2. Connect a client

From any project directory, run the one-liner installer:

```bash
npx https://localhost:3010/bundle/installer.tgz --server https://localhost:3010 --api-key YOUR_KEY
```

Replace `localhost` with the server's IP for remote machines. This single command sets up MCP config, steering rules, hooks, agent rules, and the file watcher. Kiro auto-detects the config change — no IDE restart needed.

### 3. Use it

Once connected, collision awareness is automatic. The agent registers sessions when you edit files and warns you about overlaps. You can also ask questions directly:

```
konductor, who else is working here?
konductor, am I safe to push?
konductor, help
```

See [konductor/README.md](konductor/README.md) for the full server documentation, configuration options, Baton dashboard, and GitHub integration setup.

## Collision States

| State | Severity | Meaning |
|-------|----------|---------|
| 🟢 Solo | 0 | You're the only one in this repo |
| 🟢 Neighbors | 1 | Others are in the repo but touching different files |
| 🟡 Crossroads | 2 | Others are working in the same directories |
| 🟠 Collision Course | 3 | Someone is modifying the same files as you |
| 🔴 Merge Hell | 4 | Multiple divergent changes on the same files across branches |

## Project Structure

This is a monorepo. The root directory serves as both the project umbrella and a dogfooding workspace (Konductor is installed as a client in its own repo). Each subfolder has a distinct role:

| Directory | What it is | Details |
|-----------|-----------|---------|
| [`konductor/`](konductor/) | MCP Server (TypeScript/Node.js) | The core server — session tracking, collision evaluation, Baton dashboard, GitHub integration, query engine. Has its own `package.json`, build pipeline, and test suite. See [konductor/README.md](konductor/README.md). |
| [`konductor-setup/`](konductor-setup/) | npx Installer Package | The client installer served as a tarball from the running server. Users run `npx <serverUrl>/bundle/installer.tgz` to set up their workspace. |
| `steering/` | Global Steering Rules | Kiro steering rules deployed by the installer to `~/.kiro/steering/`. These instruct the AI agent to automatically register sessions and check collision state. |
| `.kiro/steering/` | Workspace Steering Rules | Steering rules active in this workspace — includes collision awareness, documentation standards, coding practices, and more. |
| `.kiro/specs/` | Feature Specifications | Requirements, design, and task documents for every feature. See [Specs](#specs) below. |
| `.agent/rules/` | Agent Rules | Collision awareness rules for non-Kiro agents (e.g. Antigravity). |
| `your-repo/` | Test Workspace | A demo/test workspace for trying out the client installer. |

Root-level files like `konductor-watcher.mjs`, `.konductor-watcher.env`, and `.konductor-version` are client-side artifacts installed into this workspace — the result of dogfooding Konductor on its own repo.

## Tech Stack

- **Language:** TypeScript 5+
- **Runtime:** Node.js 20+
- **MCP SDK:** `@modelcontextprotocol/sdk`
- **Testing:** Vitest + fast-check (property-based testing)
- **UI Testing:** Playwright
- **Dashboard:** Server-rendered HTML + SSE for real-time updates

## Architecture

```
Kiro Agent ──┐
             ├── stdio / SSE ──→ Konductor MCP Server
Other Agent ─┘                      ├── SessionManager
File Watcher ── heartbeats ──→      ├── CollisionEvaluator
GitHub API ←── polling ──────→      ├── GitHubPoller / CommitPoller
                                    ├── QueryEngine
                                    ├── SummaryFormatter
                                    ├── ConfigManager (hot-reload)
                                    ├── BatonDashboard (per-repo pages)
                                    └── PersistenceStore → sessions.json
```

## Specs

Detailed requirements, design, and implementation plans for each feature live in `.kiro/specs/`. Here's the current status:

### Implemented

| Spec | Description | Tasks |
|------|-------------|-------|
| [`konductor-mcp-server`](.kiro/specs/konductor-mcp-server/) | Core MCP server — session tracking, collision evaluation, JSON persistence, dual transport (stdio + SSE), configurable rules | 11/11 ✅ |
| [`konductor-steering-rules`](.kiro/specs/konductor-steering-rules/) | Kiro steering rules for automatic session registration and collision checking | 6/6 ✅ |
| [`konductor-logging`](.kiro/specs/konductor-logging/) | Structured verbose logging with actor labels, category filtering, and stderr output | 7/7 ✅ |
| [`konductor-npx-installer`](.kiro/specs/konductor-npx-installer/) | One-command `npx` installer replacing the old copy-and-run bundle approach | 15/15 ✅ |
| [`konductor-enhanced-chat`](.kiro/specs/konductor-enhanced-chat/) | Natural language queries — "who's on my files?", "am I safe to push?", coordination advice | 11/11 ✅ |
| [`konductor-baton`](.kiro/specs/konductor-baton/) | Per-repo web dashboard with real-time collision state, notifications, query logs | 13/13 ✅ |
| [`konductor-baton-auth`](.kiro/specs/konductor-baton-auth/) | GitHub OAuth access control for the Baton dashboard | 11/11 ✅ |
| [`konductor-log-rotation`](.kiro/specs/konductor-log-rotation/) | Automatic log rotation with configurable size limits (three-file scheme) | 7/7 ✅ |

### In Progress

| Spec | Description | Tasks |
|------|-------------|-------|
| [`konductor-github`](.kiro/specs/konductor-github/) | GitHub integration — poll open PRs and recent commits as passive sessions for asymmetric collision detection | 21/22 (integration test edge cases remaining) |
| [`konductor-long-term-memory`](.kiro/specs/konductor-long-term-memory/) | Persistent session history — detect conflicts across time gaps, historical queries, richer Baton context | 0/13 (not yet started) |

### Planned (No Tasks Yet)

| Spec | Description |
|------|-------------|
| [`konductor-actions`](.kiro/specs/konductor-actions/) | Automated actions and IDE notifications — warn, block, suggest rebase at configured thresholds |
| [`konductor-admin`](.kiro/specs/konductor-admin/) | Web-based admin dashboard — system config, user management, installer channels |
| [`konductor-conflict-resolution`](.kiro/specs/konductor-conflict-resolution/) | Client-side merge detection to automatically clear resolved conflicts |
| [`konductor-slack`](.kiro/specs/konductor-slack/) | Client-driven Slack notifications with per-project channel config |
| [`konductor-production`](.kiro/specs/konductor-production/) | AWS ECS Fargate deployment with EFS, ALB, CloudWatch, CDK infrastructure |

## Steering Rules

Steering rules are markdown files that provide persistent instructions to the AI agent. They live in `.kiro/steering/` and are automatically included in every agent interaction.

This workspace has the following active steering rules:

| Rule | Purpose |
|------|---------|
| [`konductor-collision-awareness`](.kiro/steering/konductor-collision-awareness.md) | Core Konductor integration — automatic session registration, collision checks, chat commands |
| [`documentation-standards`](.kiro/steering/documentation-standards.md) | Keep READMEs and changelogs up to date as part of every implementation task |
| [`coding-practices`](.kiro/steering/coding-practices.md) | Code standards — resource management, error handling, property-based testing patterns |
| [`development-patterns`](.kiro/steering/development-patterns.md) | System startup, code organization, safe deployment strategy |
| [`git-commit-standards`](.kiro/steering/git-commit-standards.md) | AI-generated content tagging in commits and PRs |
| [`pre-change-requirements-check`](.kiro/steering/pre-change-requirements-check.md) | Verify spec requirements before modifying konductor/ files |
| [`konductor-installer-invariants`](.kiro/steering/konductor-installer-invariants.md) | Installer safety checks — watcher launch, .gitignore, env preservation |
| [`version-bump-rule`](.kiro/steering/version-bump-rule.md) | Version bump policy for releases |
| [`project-overview`](.kiro/steering/project-overview.md) | High-level project context for the AI agent |
| [`claude`](.kiro/steering/claude.md) | Technical architecture reference for AI assistants |
| [`authentication-security`](.kiro/steering/authentication-security.md) | Auth patterns and security guidelines |
| [`ui-test-coverage`](.kiro/steering/ui-test-coverage.md) | Backend-frontend test parity requirements |
| [`testing-credentials`](.kiro/steering/testing-credentials.md) | Test account credentials and conventions |
| [`frontend-testing`](.kiro/steering/frontend-testing.md) | Frontend/Playwright testing standards |
| [`intervention-patterns`](.kiro/steering/intervention-patterns.md) | Patterns for agent intervention and escalation |
| [`ai-features`](.kiro/steering/ai-features.md) | AI feature development guidelines |
| [`cli-deployment`](.kiro/steering/cli-deployment.md) | CLI deployment patterns |

The Konductor server subfolder also has its own steering rule at [`konductor/.kiro/steering/konductor-server-dev.md`](konductor/.kiro/steering/konductor-server-dev.md) for server-specific development context.

## Current Status

v0.4.0 — The core server, steering rules, logging, npx installer, enhanced chat, Baton dashboard (with auth), log rotation, and GitHub integration are all implemented. Long-term session memory is next up.
