---
inclusion: fileMatch
fileMatchPattern: "**/konductor_bundle/{install.*,kiro/hooks/konductor-session-start.hook.md}"
---

# Konductor Installer & Hook Invariants

These rules are non-negotiable. Every change to install.sh, install.ps1, or the session-start hook MUST preserve them.

## The installer MUST launch the file watcher

The workspace setup section of both install.sh and install.ps1 MUST end by launching the file watcher process. This is the primary way users get a running watcher after installation.

- install.sh: `nohup node "$WORKSPACE_ROOT/konductor-watcher.mjs" > /dev/null 2>&1 &`
- install.ps1: `Start-Process -FilePath "node" -ArgumentList $wp -WorkingDirectory $WorkspaceRoot`

**Never remove, comment out, or replace the watcher launch with a "the hook will handle it" comment.** This has caused regressions 3 times.

## The session-start hook MUST restart the watcher on Kiro reopen

The session-start hook (`konductor-session-start.hook.md`) MUST:

1. Check if the watcher is already running via `pgrep`
2. If not running, launch it as a **detached background process** (`detached:true, stdio:'ignore'`) and call `.unref()`
3. Exit immediately — the hook command MUST complete quickly

**The hook MUST NOT run the watcher as a foreground/child process.** Hook commands that never exit will block the IDE. This has caused regressions 3 times.

**The hook MUST NOT use `stdio: 'inherit'`.** This keeps the hook process alive waiting for the child, which blocks session start.

The correct pattern is:
```javascript
const c = spawn('node', [wp], {cwd:process.cwd(), detached:true, stdio:'ignore'});
c.unref();
```

## The installer MUST add Konductor artifacts to .gitignore

Runtime files copied to the workspace root must be added to .gitignore so users don't accidentally commit them.

## The installer MUST preserve .konductor-watcher.env

If the user already has a `.konductor-watcher.env`, the installer must not overwrite it.
