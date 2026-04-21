# Implementation Plan

- [x] 1. Define query result types and QueryEngine interface
  - [x] 1.1 Create `query-engine.types.ts` with all result type interfaces
    - Define `ActiveUserInfo`, `ActiveUsersResult`, `OverlapInfo`, `OverlapResult`, `UserSessionInfo`, `UserActivityResult`, `RiskResult`, `HotspotInfo`, `HotspotsResult`, `BranchInfo`, `BranchesResult`, `CoordinationTarget`, `CoordinationResult`
    - Export the `IQueryEngine` interface
    - _Requirements: 1.1, 1.2, 2.1, 2.2, 3.1, 3.2, 4.1, 4.2, 5.1, 5.3, 6.1, 6.2, 7.1, 7.3_

- [x] 2. Implement QueryEngine core methods
  - [x] 2.1 Implement `whoIsActive` and `whoOverlaps` methods
    - Create `query-engine.ts` with constructor accepting SessionManager, CollisionEvaluator, ConfigManager
    - Implement `whoIsActive(repo)`: fetch active sessions, map to ActiveUserInfo with duration calculation
    - Implement `whoOverlaps(userId, repo)`: find user's session, compute per-user file overlap, determine collision state per overlap
    - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.4_
  - [x] 2.2 Write property test: who_is_active returns all active users with complete data
    - **Property 1: who_is_active returns all active users with complete data**
    - **Validates: Requirements 1.1, 1.2**
  - [x] 2.3 Write property test: who_overlaps returns exactly the overlapping users
    - **Property 2: who_overlaps returns exactly the overlapping users with complete data**
    - **Validates: Requirements 2.1, 2.2, 2.4**
  - [x] 2.4 Implement `userActivity` and `riskAssessment` methods
    - Implement `userActivity(userId)`: scan all repos for user's sessions (requires SessionManager to expose all sessions or accept a scan method)
    - Implement `riskAssessment(userId, repo)`: compute collision state, derive severity, count overlaps, check cross-branch, generate summary string
    - _Requirements: 3.1, 3.2, 3.3, 4.1, 4.2_
  - [x] 2.5 Write property test: user_activity returns all sessions across repos
    - **Property 3: user_activity returns all sessions across repos with complete data**
    - **Validates: Requirements 3.1, 3.2, 3.3**
  - [x] 2.6 Write property test: risk_assessment returns internally consistent risk data
    - **Property 4: risk_assessment returns internally consistent risk data**
    - **Validates: Requirements 4.1, 4.2**
  - [x] 2.7 Implement `repoHotspots`, `activeBranches`, and `coordinationAdvice` methods
    - Implement `repoHotspots(repo)`: build file→editors map, rank by editor count descending, determine collision state per file
    - Implement `activeBranches(repo)`: group sessions by branch, compute cross-branch file overlap flags
    - Implement `coordinationAdvice(userId, repo)`: identify overlapping users, classify urgency (high/medium/low), generate suggested actions, sort by urgency
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 7.1, 7.2, 7.3_
  - [x] 2.8 Write property test: repo_hotspots ranked by editor count
    - **Property 5: repo_hotspots are ranked by editor count with complete data**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
  - [x] 2.9 Write property test: active_branches returns all distinct branches with correct overlap flags
    - **Property 6: active_branches returns all distinct branches with correct overlap flags**
    - **Validates: Requirements 6.1, 6.2, 6.3**
  - [x] 2.10 Write property test: coordination_advice targets ranked by urgency
    - **Property 7: coordination_advice targets are ranked by urgency with complete data**
    - **Validates: Requirements 7.1, 7.2, 7.3**

- [x] 3. Checkpoint - Make sure all tests are passing
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Extend SessionManager for cross-repo queries
  - [x] 4.1 Add `getAllActiveSessions` method to SessionManager
    - Add method that returns all non-stale sessions across all repos (needed by `userActivity`)
    - Update `ISessionManager` interface in `types.ts`
    - _Requirements: 3.1_
  - [x] 4.2 Write unit tests for `getAllActiveSessions`
    - Test with sessions across multiple repos, verify stale filtering works
    - _Requirements: 3.1_

- [x] 5. Register new MCP tools in index.ts
  - [x] 5.1 Wire up all seven query tools as MCP tool definitions
    - Instantiate QueryEngine in `createComponents` and pass to `buildMcpServer`
    - Register `who_is_active`, `who_overlaps`, `user_activity`, `risk_assessment`, `repo_hotspots`, `active_branches`, `coordination_advice` with zod schemas and handlers
    - Add input validation (reuse existing `validateRepo` helper)
    - Add logging calls for each query tool invocation
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1_
  - [x] 5.2 Write unit tests for MCP tool integration
    - Test each tool handler returns correct JSON structure
    - Test input validation (invalid repo format, missing userId)
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1_

- [x] 6. Checkpoint - Make sure all tests are passing
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Update steering rule with activation prefix and routing
  - [x] 7.1 Add "konductor," activation prefix section to steering rule
    - Add section explaining the "konductor," prefix requirement for user-initiated interactions
    - Clarify that automatic background operations (registration, collision checks) do not require the prefix
    - Add fallback behavior for unrecognized "konductor," commands → suggest "konductor, help"
    - _Requirements: 13.1, 13.2, 13.3, 13.4_
  - [x] 7.2 Add query routing table to steering rule
    - Add natural language → MCP tool mapping table with example phrases
    - Add formatting instructions (emoji prefixes, readable lists, no raw JSON)
    - _Requirements: 14_
  - [x] 7.3 Add management command routing to steering rule
    - Add status commands: "are you running?", "status"
    - Add lifecycle commands: "turn on", "turn off", "restart", "reinstall", "setup"
    - Add configuration commands: "change API key", "change logging level", "enable/disable file logging", "change poll interval", "watch extensions", "change username"
    - Add informational commands: "config options", "show config", "help", "who am I?"
    - Include implementation details for each command (which files to edit, which commands to run)
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6_
  - [x] 7.4 Add proactive suggestion instructions to steering rule
    - Add instructions for suggesting coordination at collision_course or merge_hell
    - Add instructions for suggesting merge safety checks when cross-branch overlap detected
    - _Requirements: 16.1, 16.2_

- [x] 8. Update installer post-install message
  - [x] 8.1 Add "konductor," prefix instructions to install.sh output
    - Add a section to the post-install output informing users about the "konductor," prefix
    - Include example commands: "konductor, help", "konductor, who's active?", "konductor, are you running?"
    - _Requirements: 17.1, 17.2_
  - [x] 8.2 Add "konductor," prefix instructions to install.ps1 output
    - Mirror the same post-install message in the PowerShell installer
    - _Requirements: 17.1, 17.2_

- [x] 9. Update auto-approve list in MCP config template
  - [x] 9.1 Add new query tools to autoApprove in mcp.json template
    - Add `who_is_active`, `who_overlaps`, `user_activity`, `risk_assessment`, `repo_hotspots`, `active_branches`, `coordination_advice` to the autoApprove array in `konductor_bundle/kiro/settings/mcp.json`
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1_

- [x] 10. Update README documentation
  - [x] 10.1 Update konductor README with new tools and chat commands
    - Add "Talking to Konductor" section explaining the "konductor," prefix
    - Document all seven query tools with example usage
    - Document all management commands with examples
    - Update the MCP tool reference table
    - _Requirements: 13, 14, 15_

- [x] 11. Final Checkpoint - Make sure all tests are passing
  - Ensure all tests pass, ask the user if questions arise.
