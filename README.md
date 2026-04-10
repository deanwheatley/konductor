# Konductor

A Work Coordination MCP Server that solves "collision debt" — the accumulated cost of merge conflicts caused by uncoordinated concurrent development across repositories.

The Konductor tracks which engineers are actively modifying which files, evaluates collision risk using a graduated state model, and surfaces real-time awareness through MCP tools, IDE integration, and team communication channels.

## Collision States

| State | Severity | Meaning |
|-------|----------|---------|
| 🟢 Solo | 0 | You're the only one in this repo |
| 🟢 Neighbors | 1 | Others are in the repo but touching different files |
| 🟡 Crossroads | 2 | Others are working in the same directories |
| 🟠 Collision Course | 3 | Someone is modifying the same files as you |
| 🔴 Merge Hell | 4 | Multiple divergent changes on the same files across branches |

## Project Roadmap

| Phase | Milestone | Status | Description |
|-------|-----------|--------|-------------|
| 1 | **Core MCP Server** | ✅ Complete | Session tracking, collision evaluation, JSON persistence, dual transport (stdio + SSE), configurable rules |
| 2 | **Kiro Steering Rules** | 🔲 Not Started | Steering file that instructs Kiro to automatically register sessions and check collision state |
| 3 | **Actions & Notifications** | 🔲 Not Started | Automated actions (warn, block, suggest rebase) and IDE notification framework |
| 4 | **Konductor Baton** | 🔲 Not Started | Localhost web dashboard with real-time visualization of sessions and conflicts |
| 5 | **GitHub Integration** | 🔲 Not Started | Poll open PRs as passive sessions for asymmetric collision detection |
| 6 | **Slack Integration** | 🔲 Not Started | Collision notifications to Slack channels with @-mentions |
| 7 | **Production Deployment** | 🔲 Not Started | AWS ECS Fargate with EFS, ALB, CloudWatch monitoring |

## Tech Stack

- **Language:** TypeScript 5+
- **Runtime:** Node.js 20+
- **MCP SDK:** `@modelcontextprotocol/sdk`
- **Testing:** Vitest + fast-check (property-based testing)
- **UI Testing:** Playwright (Phase 4+)

## Architecture

```
Kiro Agent ──┐
             ├── stdio / SSE ──→ Konductor MCP Server
Other Agent ─┘                      ├── SessionManager
                                    ├── CollisionEvaluator
                                    ├── SummaryFormatter
                                    ├── ConfigManager
                                    └── PersistenceStore → sessions.json
```

## Specs

Detailed requirements, design, and implementation plans for each phase live in `.kiro/specs/`:

- `.kiro/specs/konductor-mcp-server/` — Phase 1
- `.kiro/specs/konductor-steering-rules/` — Phase 2
- `.kiro/specs/konductor-actions/` — Phase 3
- `.kiro/specs/konductor-baton/` — Phase 4
- `.kiro/specs/konductor-github/` — Phase 5
- `.kiro/specs/konductor-slack/` — Phase 6
- `.kiro/specs/konductor-production/` — Phase 7

## Current Status

Phase 1 (Core MCP Server) is complete. All components are implemented and tested in `konductor/`. See `konductor/README.md` for usage and configuration details.
