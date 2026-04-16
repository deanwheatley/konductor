---
inclusion: always
---

# Pre-Change Requirements Check

## Rule

Before modifying any file in the `konductor/` directory (server code, bundle files, steering rules, or tests), you MUST:

1. Read the relevant spec requirements at `.kiro/specs/konductor-npx-installer/requirements.md`
2. Identify which requirements are affected by the proposed change
3. Verify the change does not violate any acceptance criteria
4. Pay special attention to:
   - Requirement 5: Installer invariants (watcher launch, .gitignore, env preservation, same file set)
   - Requirement 9: Client version checking and auto-update flow
   - Requirement 8: Cross-platform compatibility

## Common Pitfalls

- The `konductor-setup` package is NOT published to npm. All `npx` commands must use the tarball URL: `npx <serverUrl>/bundle/installer.tgz`
- The `startSseServer` deps type must include ALL components passed from `main()` (including `queryEngine`) or per-client MCP instances will be missing tools
- Steering rules exist in 4 locations that must stay in sync: `steering/`, `.agent/rules/`, `konductor/konductor_bundle/kiro/steering/`, `konductor/konductor_bundle/agent/rules/`
- The file watcher is a client-side component — don't start it in the server workspace
- Logger actor labels: `SYSTEM` for server internals, `Transport: <id>` for anonymous SSE connections, `User: <name>` for identified users
