# Implementation Plan

- [x] 1. Create collision awareness steering rule
  - [x] 1.1 Create steering rule with automatic session registration
    - Create `steering/konductor-collision-awareness.md` with `inclusion: always` front-matter
    - Implement automatic `register_session` on file create/modify
    - Implement automatic `deregister_session` on task completion
    - Implement session update when file list changes mid-task
    - _Requirements: 1.1, 1.2, 1.3_
  - [x] 1.2 Implement collision state checking and notifications
    - Add collision state check after registration
    - Solo/Neighbors: brief confirmation, proceed automatically
    - Crossroads: warning with directories and users, proceed
    - Collision Course: prominent warning, ask for confirmation
    - Merge Hell: critical alert, recommend coordination
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - [x] 1.3 Implement clear, actionable messages
    - Use emoji-prefixed notifications for quick scanning
    - Include user names, files, branches in warnings
    - Include recommended actions for high-severity states
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 2. Implement server unavailable handling
  - Warn user when Konductor server is not reachable
  - Print per-file warning when disconnected
  - Notify on reconnection
  - _Requirements: 2.1 (graceful degradation)_

- [x] 3. Implement identity detection and persistence
  - Auto-detect userId from GitHub CLI, git config, or hostname
  - Persist resolved userId to `.konductor-watcher.env`
  - Auto-detect repo and branch from git
  - _Requirements: 1.1_

- [x] 4. Implement setup command
  - Steering rule recognizes "setup konductor" and runs the installer
  - Supports macOS/Linux (bash) and Windows (PowerShell)
  - _Requirements: 4.1, 4.2_

- [x] 5. Install steering rule to workspace and global locations
  - Installer copies to `.kiro/steering/` (workspace) and `~/.kiro/steering/` (global)
  - Installer copies to `.agent/rules/` (Antigravity workspace) and `~/.gemini/` (Antigravity global)
  - _Requirements: 4.1, 4.3_

- [x] 6. Final checkpoint
  - All steering rule features implemented and tested
