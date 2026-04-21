# Konductor Client Bundle Installer (Windows)
param([switch]$Global, [switch]$Workspace)
$ErrorActionPreference = "Stop"
$BundleDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Detect workspace root
$WorkspaceRoot = (Get-Location).Path
$checkDir = $WorkspaceRoot
while ($checkDir -ne [System.IO.Path]::GetPathRoot($checkDir)) {
    if ((Test-Path (Join-Path $checkDir ".git")) -or (Test-Path (Join-Path $checkDir ".kiro"))) {
        $WorkspaceRoot = $checkDir
        break
    }
    $checkDir = Split-Path $checkDir -Parent
}
if (-not $Global -and -not $Workspace) { $Global = $true; $Workspace = $true }

if ($Global) {
    Write-Host "Global setup:"
    Write-Host "  Cleaning previous install..."
    @((Join-Path $HOME ".kiro" "steering" "konductor-collision-awareness.md"), (Join-Path $HOME ".gemini" "konductor-collision-awareness.md")) | ForEach-Object { if (Test-Path $_) { Remove-Item $_ -Force } }

    $KiroSettings = Join-Path $HOME ".kiro" "settings"; $McpJson = Join-Path $KiroSettings "mcp.json"
    if (-not (Test-Path $KiroSettings)) { New-Item -ItemType Directory -Path $KiroSettings -Force | Out-Null }
    if (Test-Path $McpJson) {
        try {
            $cfg = Get-Content $McpJson -Raw | ConvertFrom-Json
            if (-not $cfg.mcpServers) { $cfg | Add-Member -NotePropertyName mcpServers -NotePropertyValue @{} }
            $cfg.mcpServers | Add-Member -NotePropertyName konductor -NotePropertyValue @{ url="http://localhost:3010/sse"; headers=@{Authorization="Bearer YOUR_API_KEY"}; autoApprove=@("register_session","check_status","deregister_session","list_sessions") } -Force
            $cfg | ConvertTo-Json -Depth 10 | Set-Content $McpJson
            Write-Host "  [ok] MCP config updated"
        } catch { Write-Host "  [warn] Could not update MCP config." }
    } else { Copy-Item (Join-Path $BundleDir "kiro" "settings" "mcp.json") $McpJson; Write-Host "  [ok] MCP config installed" }
    Write-Host "       Edit ~/.kiro/settings/mcp.json to set your API key."

    $sd = Join-Path $HOME ".kiro" "steering"; if (-not (Test-Path $sd)) { New-Item -ItemType Directory -Path $sd -Force | Out-Null }
    Copy-Item (Join-Path $BundleDir "kiro" "steering" "konductor-collision-awareness.md") (Join-Path $sd "konductor-collision-awareness.md"); Write-Host "  [ok] Kiro global rule installed"

    $gd = Join-Path $HOME ".gemini"; if (-not (Test-Path $gd)) { New-Item -ItemType Directory -Path $gd -Force | Out-Null }
    Copy-Item (Join-Path $BundleDir "agent" "rules" "konductor-collision-awareness.md") (Join-Path $gd "konductor-collision-awareness.md"); Write-Host "  [ok] Antigravity global rule installed"
    Write-Host ""
}

if ($Workspace) {
    Write-Host "Workspace setup:"
    Write-Host "  Cleaning previous install..."
    Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match "konductor-watcher" } | Stop-Process -Force -ErrorAction SilentlyContinue
    @((Join-Path $WorkspaceRoot ".kiro" "steering" "konductor-collision-awareness.md"),(Join-Path $WorkspaceRoot ".kiro" "hooks" "konductor-file-save.hook.md"),(Join-Path $WorkspaceRoot ".agent" "rules" "konductor-collision-awareness.md"),(Join-Path $WorkspaceRoot "konductor-watcher.mjs"),(Join-Path $WorkspaceRoot ".konductor-watcher.log")) | ForEach-Object { if (Test-Path $_) { Remove-Item $_ -Force } }

    $sd = Join-Path $WorkspaceRoot ".kiro" "steering"; if (-not (Test-Path $sd)) { New-Item -ItemType Directory -Path $sd -Force | Out-Null }
    Copy-Item (Join-Path $BundleDir "kiro" "steering" "konductor-collision-awareness.md") (Join-Path $sd "konductor-collision-awareness.md"); Write-Host "  [ok] Kiro steering rule installed"

    $hd = Join-Path $WorkspaceRoot ".kiro" "hooks"; if (-not (Test-Path $hd)) { New-Item -ItemType Directory -Path $hd -Force | Out-Null }
    Copy-Item (Join-Path $BundleDir "kiro" "hooks" "konductor-file-save.hook.md") (Join-Path $hd "konductor-file-save.hook.md")
    Copy-Item (Join-Path $BundleDir "kiro" "hooks" "konductor-session-start.hook.md") (Join-Path $hd "konductor-session-start.hook.md")
    Write-Host "  [ok] Kiro hooks installed"

    $ad = Join-Path $WorkspaceRoot ".agent" "rules"; if (-not (Test-Path $ad)) { New-Item -ItemType Directory -Path $ad -Force | Out-Null }
    Copy-Item (Join-Path $BundleDir "agent" "rules" "konductor-collision-awareness.md") (Join-Path $ad "konductor-collision-awareness.md"); Write-Host "  [ok] Antigravity rule installed"

    Copy-Item (Join-Path $BundleDir "konductor-watcher.mjs") (Join-Path $WorkspaceRoot "konductor-watcher.mjs"); Write-Host "  [ok] File watcher installed"

    $ef = Join-Path $WorkspaceRoot ".konductor-watcher.env"
    if (Test-Path $ef) { Write-Host "  [ok] Watcher config preserved" }
    else { @"
# Konductor Watcher Configuration
# Server URL and API key are read from mcp.json automatically.
KONDUCTOR_LOG_LEVEL=info
KONDUCTOR_LOG_TO_TERMINAL=true
KONDUCTOR_POLL_INTERVAL=10
# KONDUCTOR_LOG_MAX_SIZE=10MB
"@ | Set-Content -Path $ef -NoNewline; Write-Host "  [ok] Watcher config created" }

    # Add Konductor runtime artifacts to .gitignore
    $Gitignore = Join-Path $WorkspaceRoot ".gitignore"
    $KonductorIgnores = @(
        "konductor-watcher.mjs"
        "konductor-watcher-launcher.sh"
        "konductor-watchdog.sh"
        ".konductor-watcher.env"
        ".konductor-watcher.log"
        ".konductor-watchdog.pid"
    )
    if (-not (Test-Path $Gitignore)) { New-Item -ItemType File -Path $Gitignore -Force | Out-Null }
    $content = Get-Content $Gitignore -Raw -ErrorAction SilentlyContinue
    if (-not $content) { $content = "" }
    $added = 0
    foreach ($entry in $KonductorIgnores) {
        if ($content -notmatch "(?m)^$([regex]::Escape($entry))$") {
            if ($added -eq 0 -and $content -notmatch "# Konductor") {
                Add-Content -Path $Gitignore -Value "`n# Konductor (auto-added by installer)"
            }
            Add-Content -Path $Gitignore -Value $entry
            $added++
        }
    }
    if ($added -gt 0) { Write-Host "  [ok] Added $added Konductor entries to .gitignore" }
    else { Write-Host "  [ok] .gitignore already has Konductor entries" }

    # Launch file watcher
    # CRITICAL: The installer MUST always launch the file watcher.
    # The session-start hook provides restart-on-reopen, but the installer
    # is responsible for the initial launch so the watcher is running immediately.
    $wp = Join-Path $WorkspaceRoot "konductor-watcher.mjs"
    if ((Get-Command node -ErrorAction SilentlyContinue) -and (Test-Path $wp)) {
        Start-Process -FilePath "node" -ArgumentList $wp -WorkingDirectory $WorkspaceRoot -WindowStyle Hidden
        Write-Host "  [ok] File watcher launched"
    } else { Write-Host "  [warn] Node.js not found — install Node.js 20+ to enable the file watcher" }
    Write-Host ""
}

Write-Host "Done!"
if ($Global -and $Workspace) {
    Write-Host ""
    Write-Host "  ╔══════════════════════════════════════════════════════════╗"
    Write-Host "  ║  WARNING: Set your API key before connecting!            ║"
    Write-Host "  ║                                                          ║"
    Write-Host "  ║  Edit ~/.kiro/settings/mcp.json and replace              ║"
    Write-Host "  ║  YOUR_API_KEY with the key from the Konductor server.    ║"
    Write-Host "  ╚══════════════════════════════════════════════════════════╝"
    Write-Host ""
    Write-Host "  Configuration:"
    Write-Host "    MCP connection:     ~/.kiro/settings/mcp.json"
    Write-Host "    Watcher behavior:   .konductor-watcher.env"
    Write-Host "    Server config:      konductor.yaml (on server)"
    Write-Host ""
    Write-Host "  Settings in .konductor-watcher.env:"
    Write-Host "    KONDUCTOR_LOG_LEVEL         info or debug"
    Write-Host "    KONDUCTOR_POLL_INTERVAL      seconds between polls"
    Write-Host "    KONDUCTOR_LOG_FILE           optional file logging"
    Write-Host "    KONDUCTOR_LOG_MAX_SIZE       log rotation size (def: 10MB)"
    Write-Host "    KONDUCTOR_WATCH_EXTENSIONS   restrict file types"
    Write-Host "    KONDUCTOR_USER               override detected username"
    Write-Host ""
    Write-Host "  ┌──────────────────────────────────────────────────────────┐"
    Write-Host "  │  💬 TALKING TO KONDUCTOR                                │"
    Write-Host "  ├──────────────────────────────────────────────────────────┤"
    Write-Host "  │                                                          │"
    Write-Host "  │  Prefix your message with `"konductor,`" to interact:     │"
    Write-Host "  │                                                          │"
    Write-Host "  │    konductor, help                                       │"
    Write-Host "  │    konductor, who's active?                              │"
    Write-Host "  │    konductor, are you running?                           │"
    Write-Host "  │                                                          │"
    Write-Host "  │  Background operations (session registration, collision  │"
    Write-Host "  │  checks) happen automatically — no prefix needed.        │"
    Write-Host "  │                                                          │"
    Write-Host "  └──────────────────────────────────────────────────────────┘"
    Write-Host ""
    Write-Host "For additional projects: .\install.ps1 -Workspace"
}
