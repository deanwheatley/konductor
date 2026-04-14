# Konductor Client Bundle Installer (Windows)
#
# Usage:
#   .\install.ps1              # full setup
#   .\install.ps1 -Global      # one-time: MCP config
#   .\install.ps1 -Workspace   # per-project: steering + hook + watcher

param([switch]$Global, [switch]$Workspace)
$ErrorActionPreference = "Stop"
$BundleDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$WorkspaceRoot = "."

if (-not $Global -and -not $Workspace) { $Global = $true; $Workspace = $true }

if ($Global) {
    Write-Host "Global setup (~/.kiro/settings/mcp.json):"
    $KiroSettings = Join-Path $HOME ".kiro" "settings"
    $McpJson = Join-Path $KiroSettings "mcp.json"
    if (-not (Test-Path $KiroSettings)) { New-Item -ItemType Directory -Path $KiroSettings -Force | Out-Null }
    if (Test-Path $McpJson) {
        if ((Get-Content $McpJson -Raw) -match '"konductor"') {
            Write-Host "  [skip] Konductor already configured"
        } else {
            Write-Host "  [warn] MCP config exists but missing konductor entry. Add manually."
        }
    } else {
        Copy-Item (Join-Path $BundleDir "kiro" "settings" "mcp.json") $McpJson
        Write-Host "  [ok] MCP config installed. Edit to set URL + API key."
    }

    # Global steering rule (applies to all workspaces)
    $GlobalSteering = Join-Path $HOME ".kiro" "steering"
    $GlobalSteeringFile = Join-Path $GlobalSteering "konductor-collision-awareness.md"
    if (-not (Test-Path $GlobalSteering)) { New-Item -ItemType Directory -Path $GlobalSteering -Force | Out-Null }
    if (Test-Path $GlobalSteeringFile) {
        Write-Host "  [skip] Global steering rule already exists"
    } else {
        Copy-Item (Join-Path $BundleDir "kiro" "steering" "konductor-collision-awareness.md") $GlobalSteeringFile
        Write-Host "  [ok] Global steering rule installed (applies to all workspaces)"
    }
    Write-Host ""
}

if ($Workspace) {
    Write-Host "Workspace setup (.kiro/ in current directory):"

    # Steering rule
    $sd = Join-Path $WorkspaceRoot ".kiro" "steering"
    $sf = Join-Path $sd "konductor-collision-awareness.md"
    if (-not (Test-Path $sd)) { New-Item -ItemType Directory -Path $sd -Force | Out-Null }
    if (Test-Path $sf) { Write-Host "  [skip] Steering rule exists" }
    else { Copy-Item (Join-Path $BundleDir "kiro" "steering" "konductor-collision-awareness.md") $sf; Write-Host "  [ok] Steering rule installed" }

    # Hook
    $hd = Join-Path $WorkspaceRoot ".kiro" "hooks"
    $hf = Join-Path $hd "konductor-file-save.hook.md"
    if (-not (Test-Path $hd)) { New-Item -ItemType Directory -Path $hd -Force | Out-Null }
    if (Test-Path $hf) { Write-Host "  [skip] Hook exists" }
    else { Copy-Item (Join-Path $BundleDir "kiro" "hooks" "konductor-file-save.hook.md") $hf; Write-Host "  [ok] Hook installed" }

    # Watcher
    $wf = Join-Path $WorkspaceRoot "konductor-watcher.mjs"
    if (Test-Path $wf) { Write-Host "  [skip] Watcher exists" }
    else { Copy-Item (Join-Path $BundleDir "konductor-watcher.mjs") $wf; Write-Host "  [ok] Watcher installed (node konductor-watcher.mjs)" }

    # Env config
    $ef = Join-Path $WorkspaceRoot ".konductor-watcher.env"
    if (Test-Path $ef) { Write-Host "  [skip] Watcher config exists" }
    else {
        @"
# Konductor Watcher Configuration
KONDUCTOR_URL=http://localhost:3010
KONDUCTOR_API_KEY=
KONDUCTOR_LOG_LEVEL=info
KONDUCTOR_POLL_INTERVAL=10
# KONDUCTOR_LOG_FILE=konductor-client.log
# KONDUCTOR_USER=
# KONDUCTOR_REPO=
# KONDUCTOR_BRANCH=
# KONDUCTOR_WATCH_EXTENSIONS=ts,tsx,js,jsx,py,java,go,rs,rb,json,yaml,yml,md,html,css
"@ | Set-Content -Path $ef -NoNewline
        Write-Host "  [ok] Watcher config installed (.konductor-watcher.env)"
    }
    Write-Host ""
}

Write-Host "Done!"
if ($Global -and $Workspace) {
    Write-Host "  To start the file watcher: node konductor-watcher.mjs"
    Write-Host "  For additional projects: .\install.ps1 -Workspace"
}
