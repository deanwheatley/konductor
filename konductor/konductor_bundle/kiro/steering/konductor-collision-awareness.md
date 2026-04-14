---
inclusion: always
---

# Konductor Collision Awareness

This rule is always active. The agent handles all Konductor interactions automatically. The user never needs to call Konductor tools directly.

## Setup Command

When the user says "setup konductor" (or similar like "install konductor", "configure konductor"), run the install script to set up everything they need:

1. Find the install script. It lives at `konductor/konductor_bundle/` relative to the Konductor repo root. If the user is in a different workspace, ask them for the path to the Konductor repo.

2. Detect the OS. On macOS/Linux run the bash script, on Windows run the PowerShell script:
   - macOS / Linux: `bash /path/to/konductor/konductor_bundle/install.sh`
   - Windows: `powershell -ExecutionPolicy Bypass -File /path/to/konductor/konductor_bundle/install.ps1`

3. After the script runs, remind the user to edit `~/.kiro/settings/mcp.json` to set the correct server URL and API key. Show them the format:
   ```json
   {
     "mcpServers": {
       "konductor": {
         "url": "http://localhost:3010/sse",
         "headers": {
           "Authorization": "Bearer YOUR_API_KEY"
         },
         "autoApprove": ["register_session", "check_status", "deregister_session", "list_sessions"]
       }
     }
   }
   ```

4. If the global MCP config already exists (script says "already configured"), just run the workspace portion:
   - macOS / Linux: `bash /path/to/konductor/konductor_bundle/install.sh --workspace`
   - Windows: `powershell -ExecutionPolicy Bypass -File /path/to/konductor/konductor_bundle/install.ps1 -Workspace`

5. Confirm setup is complete: `✅ Konductor: Setup complete. Collision awareness is now active in this workspace.`

6. Remind the user to start the file watcher in a separate terminal for background collision monitoring:
   ```bash
   ./konductor-watcher.sh
   ```
   The watcher provides color-coded collision notifications even when the user isn't chatting with the agent. Edit `.konductor-watcher.env` to set the API key.

## Identity

Determine the user identity and repository context automatically using this priority chain:

- `userId`: Try each in order, use the first that succeeds:
  1. `KONDUCTOR_USER` in `.konductor-watcher.env` (already resolved and persisted)
  2. `gh api user --jq .login` (GitHub CLI — gives the actual GitHub username, e.g. "deanwheatley")
  3. `git config user.name` (git display name — may be a full name like "Dean Wheatley")
  4. System hostname as a last resort
- `repo`: Run `git remote get-url origin` and extract the `owner/repo` portion (strip any `.git` suffix and hosting prefix)
- `branch`: Run `git branch --show-current`

Cache these values for the duration of the session. Do not ask the user for them.

## Persist Identity

On first session start, if `KONDUCTOR_USER` is empty or commented out in `.konductor-watcher.env`, resolve the userId using the priority chain above and write it into the file. This ensures the watcher and agent always use the same identity without re-detecting every time.

To persist: read `.konductor-watcher.env`, find the `KONDUCTOR_USER=` line (or the commented `# KONDUCTOR_USER=` line), and replace it with `KONDUCTOR_USER=<resolved_username>`. Do this silently — no need to ask the user.

## Automatic Registration

Whenever you are about to create or modify files as part of a task:

1. Silently call `register_session` with the userId, repo, branch, and the full list of files you plan to touch.
2. Print a short one-line confirmation to the user: `🟢 Konductor: Registered session on <repo>#<branch> (<N> files)`
3. Store the returned `sessionId` so you can deregister later.

Do not ask the user for permission to register. Just do it.

## Automatic Collision Check

After registering (or re-registering), check the returned `collisionState` and notify the user based on severity:

- **Solo**: No notification needed beyond the registration confirmation.
- **Neighbors**: `🟢 Konductor: Others are active in this repo but working on different files. Proceeding.`
- **Crossroads**: `🟡 Konductor: Heads up — others are working in the same directories. Proceeding with caution.`
- **Collision Course**: `🟠 Konductor: Warning — <overlapping users> are modifying the same files: <shared files>. Proceed?` — Wait for the user to confirm before making changes.
- **Merge Hell**: `🔴 Konductor: Critical overlap — <overlapping users> have divergent changes on <shared files> across branches <branches>. Strongly recommend coordinating before continuing.` — Wait for the user to confirm.

Only pause and ask for confirmation at Collision Course or Merge Hell. All other states proceed automatically.

## Automatic Session Updates

If the set of files you are modifying changes during a task (you start editing files not in the original list), silently call `register_session` again with the updated file list. Print: `🔄 Konductor: Updated session — now tracking <N> files`

Re-check the collision state and notify as above.

## Automatic Deregistration

When a task is fully complete and you are done modifying files, silently call `deregister_session` with the stored sessionId. Print: `✅ Konductor: Session closed.`

If the user ends the conversation or moves on without completing the task, still deregister.

## Rules

- Never ask the user to call Konductor tools themselves.
- Never skip registration because it seems unnecessary — always register when modifying files.
- Keep Konductor notifications short and emoji-prefixed so they are easy to scan.
- If Konductor tools are unavailable (server down, not configured), silently skip and do not block the user's work.
