/**
 * Admin Dashboard — Page HTML Generator
 *
 * Generates complete HTML documents for the admin login page and
 * admin dashboard. The dashboard includes five collapsible panels:
 * - System Settings
 * - Global Client Settings (channels, promote/rollback)
 * - Client Install Commands
 * - User Management (sortable/filterable table)
 * - Freshness Color Scale preview
 *
 * Follows the same visual design language as the Baton repo pages.
 *
 * Requirements: 3.1, 3.5, 4.1, 4.2, 4.4, 4.7, 4.9, 5.1, 5.5, 5.9,
 *              7.1, 7.2, 7.11, 5.4, 7.12, 10.1, 10.4
 */

import { escapeHtml } from "./baton-page-builder.js";
import { DEFAULT_FRESHNESS_COLORS, DEFAULT_FRESHNESS_INTERVAL_MINUTES } from "./baton-types.js";

// ---------------------------------------------------------------------------
// Login Page
// ---------------------------------------------------------------------------

/**
 * Build the login page HTML.
 * @param errorMessage  Optional error to display (e.g. "Invalid credentials")
 * @param prefill       Optional pre-filled credentials (for local dev mode)
 */
export function buildLoginPage(errorMessage?: string, prefill?: { userId?: string; apiKey?: string }): string {
  const errorHtml = errorMessage
    ? `<div class="error-message">${escapeHtml(errorMessage)}</div>`
    : "";
  const userIdValue = prefill?.userId ? ` value="${escapeHtml(prefill.userId)}"` : "";
  const apiKeyValue = prefill?.apiKey ? ` value="${escapeHtml(prefill.apiKey)}"` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🎼 Konductor Admin — Login</title>
${buildAdminStyles()}
</head>
<body class="login-body">
<div class="login-card">
  <h1>🎼 Konductor Admin</h1>
  ${errorHtml}
  <form method="POST" action="/login">
    <label for="userId">User ID</label>
    <input type="text" id="userId" name="userId" required autocomplete="username"${userIdValue}>
    <label for="apiKey">API Key</label>
    <input type="password" id="apiKey" name="apiKey" required autocomplete="current-password"${apiKeyValue}>
    <button type="submit">Sign In</button>
  </form>
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Admin Dashboard
// ---------------------------------------------------------------------------

/**
 * Build the full admin dashboard HTML page.
 * @param username  The authenticated admin's userId (for header display)
 */
export function buildAdminDashboard(username: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🎼 Konductor Admin Dashboard</title>
${buildAdminStyles()}
</head>
<body>
${buildAdminHeader(username)}
<div class="connection-bar" id="connection-bar">● Connected — live updates active</div>
<div class="main">
  ${buildSystemSettingsPanel()}
  ${buildGlobalClientSettingsPanel()}
  ${buildSlackIntegrationPanel()}
  ${buildInstallCommandsPanel()}
  ${buildUserManagementPanel()}
  ${buildFreshnessPreviewPanel()}
</div>
${buildAdminScript()}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function buildAdminHeader(username: string): string {
  return `<div class="header">
  <span class="logo">🎼</span>
  <h1>Konductor Admin</h1>
  <span class="header-spacer"></span>
  <span class="user-identity">
    <span class="user-name">${escapeHtml(username)}</span>
    <a class="logout-link" href="/login">Logout</a>
  </span>
</div>`;
}

// ---------------------------------------------------------------------------
// Panel: System Settings (Requirements 3.1, 3.5)
// ---------------------------------------------------------------------------

function buildSystemSettingsPanel(): string {
  return `<div class="panel" id="settings-panel">
  <div class="panel-header collapsible" onclick="togglePanel('settings-panel')">
    <h2><span class="collapse-icon">▼</span> System Settings</h2>
  </div>
  <div class="panel-content">
    <div class="panel-body">
      <form id="settings-form" onsubmit="return saveSettings(event)">
        <div class="settings-grid" id="settings-grid">
          <div class="empty-state">Loading settings…</div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Save Settings</button>
          <button type="button" class="btn btn-sm" disabled title="COMING SOON" style="opacity:0.5;cursor:not-allowed;margin-left:auto;background:#3a3a3a;color:#888">📋 View Logs</button>
          <span id="settings-status" class="status-msg"></span>
        </div>
      </form>
    </div>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// Panel: Global Client Settings (Requirements 4.1, 4.2, 4.4, 4.7, 4.9)
// ---------------------------------------------------------------------------

function buildGlobalClientSettingsPanel(): string {
  return `<div class="panel" id="channels-panel">
  <div class="panel-header collapsible" onclick="togglePanel('channels-panel')">
    <h2><span class="collapse-icon">▼</span> Global Client Settings</h2>
  </div>
  <div class="panel-content">
    <div class="panel-body">
      <div class="channels-grid" id="channels-grid">
        <div class="empty-state">Loading channel data…</div>
      </div>
      <div class="channel-actions" id="channel-actions" style="display:none">
        <div class="default-channel-row">
          <label for="default-channel-select">Global Default Channel:</label>
          <select id="default-channel-select">
            <option value="dev">Dev</option>
            <option value="uat">UAT</option>
            <option value="prod" selected>Prod</option>
          </select>
          <button class="btn btn-primary" onclick="saveDefaultChannel()">Save</button>
          <a href="/admin/bundles" class="btn btn-warning" style="text-decoration:none;margin-left:auto">Manage Bundles</a>
        </div>
        <div class="promote-row">
          <button class="btn btn-warning" onclick="promoteChannel('dev','uat')">Promote Dev → UAT</button>
          <button class="btn btn-warning" onclick="promoteChannel('uat','prod')">Promote UAT → Prod</button>
        </div>
        <div class="rollback-row" id="rollback-row"></div>
      </div>
      <span id="channels-status" class="status-msg"></span>
    </div>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// Panel: Slack Integration (Requirements 6.1, 6.2, 6.3, 6.4, 6.6, 6.8, 6.10)
// ---------------------------------------------------------------------------

function buildSlackIntegrationPanel(): string {
  return `<div class="panel" id="slack-panel">
  <div class="panel-header collapsible" onclick="togglePanel('slack-panel')">
    <h2><span class="collapse-icon">▼</span> Slack Integration</h2>
  </div>
  <div class="panel-content">
    <div class="panel-body">
      <div id="slack-status-display" class="slack-status">
        <div class="empty-state">Loading Slack status…</div>
      </div>
      <div class="slack-disable-row">
        <label class="slack-disable-label">
          <input type="checkbox" id="slack-disable-checkbox" onchange="toggleSlackDisabled(this.checked)">
          <span>Disable Slack Integration</span>
        </label>
      </div>
      <div id="slack-auth-section">
        <div class="slack-auth-mode">
          <label class="slack-radio-label">
            <input type="radio" name="slack-auth-mode" value="bot_token" checked onchange="switchSlackAuthMode('bot_token')"> Bot Token (manual)
          </label>
          <label class="slack-radio-label">
            <input type="radio" name="slack-auth-mode" value="oauth" onchange="switchSlackAuthMode('oauth')"> Slack App (OAuth)
          </label>
        </div>
        <div id="slack-bot-token-section" class="slack-mode-section">
          <div class="setting-field">
            <label for="slack-bot-token">Bot Token</label>
            <div class="slack-token-row">
              <input type="password" id="slack-bot-token" placeholder="xoxb-..." autocomplete="off">
              <button class="btn btn-primary btn-sm" id="slack-validate-btn" onclick="validateSlackToken()">Validate</button>
            </div>
            <div id="slack-token-source" class="source-label" style="display:none"></div>
          </div>
          <div id="slack-validation-status" class="slack-validation-msg"></div>
        </div>
        <div id="slack-oauth-section" class="slack-mode-section" style="display:none">
          <div class="setting-field">
            <label for="slack-oauth-client-id">Client ID</label>
            <input type="text" id="slack-oauth-client-id" placeholder="Your Slack App Client ID">
          </div>
          <div class="setting-field">
            <label for="slack-oauth-client-secret">Client Secret</label>
            <input type="password" id="slack-oauth-client-secret" placeholder="Your Slack App Client Secret">
          </div>
          <button class="btn btn-primary" id="slack-install-app-btn" onclick="installSlackApp()">Install Slack App</button>
        </div>
        <div class="slack-actions">
          <button class="btn btn-primary" id="slack-save-btn" onclick="saveSlackConfig()">Save</button>
          <span id="slack-save-status" class="status-msg"></span>
        </div>
      </div>
      <div class="slack-test-section" id="slack-test-section">
        <label for="slack-test-channel">Test Message</label>
        <div class="slack-test-row">
          <input type="text" id="slack-test-channel" placeholder="#channel-name">
          <button class="btn btn-warning btn-sm" id="slack-test-btn" onclick="sendSlackTestMessage()">Send</button>
        </div>
        <span id="slack-test-status" class="status-msg"></span>
      </div>
    </div>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// Panel: Client Install Commands (Requirements 5.1, 5.5, 5.9)
// ---------------------------------------------------------------------------

function buildInstallCommandsPanel(): string {
  return `<div class="panel" id="install-panel">
  <div class="panel-header collapsible" onclick="togglePanel('install-panel')">
    <h2><span class="collapse-icon">▼</span> Client Install Commands</h2>
  </div>
  <div class="panel-content">
    <div class="panel-body">
      <div class="install-controls">
        <label for="install-channel-select">Channel:</label>
        <select id="install-channel-select" onchange="renderInstallCommands()">
          <option value="dev">Dev</option>
          <option value="uat">UAT</option>
          <option value="prod">Prod</option>
        </select>
      </div>
      <div id="install-commands-display" class="install-commands">
        <div class="empty-state">Loading install commands…</div>
      </div>
    </div>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// Panel: User Management (Requirements 7.1, 7.2, 7.11)
// ---------------------------------------------------------------------------

function buildUserManagementPanel(): string {
  return `<div class="panel" id="users-panel">
  <div class="panel-header collapsible" onclick="togglePanel('users-panel')">
    <h2><span class="collapse-icon">▼</span> User Management <span class="count-badge" id="users-count">0 users</span></h2>
  </div>
  <div class="panel-content">
    <div class="filter-bar">
      <label>Filter:</label>
      <input type="text" id="user-filter-name" placeholder="Username…" oninput="renderUsers()">
      <select id="user-filter-channel" onchange="renderUsers()">
        <option value="">All Channels</option>
        <option value="latest">Latest</option>
        <option value="dev">Dev</option>
        <option value="uat">UAT</option>
        <option value="prod">Prod</option>
        <option value="default">Default</option>
      </select>
      <select id="user-filter-admin" onchange="renderUsers()">
        <option value="">All Roles</option>
        <option value="true">Admin</option>
        <option value="false">Non-Admin</option>
      </select>
      <button class="reset-btn" onclick="resetUserFilters()">Reset</button>
    </div>
    <div class="table-wrapper">
      <table id="users-table">
        <thead>
          <tr>
            <th onclick="sortUsers(0)">Username <span class="sort-arrow" id="sort-0"></span></th>
            <th onclick="sortUsers(1)">Last Seen <span class="sort-arrow" id="sort-1"></span></th>
            <th onclick="sortUsers(2)">Channel Override <span class="sort-arrow" id="sort-2"></span></th>
            <th onclick="sortUsers(3)">Admin <span class="sort-arrow" id="sort-3"></span></th>
          </tr>
        </thead>
        <tbody id="users-body">
          <tr><td colspan="4" class="empty-state">Loading users…</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// Panel: Freshness Color Scale Preview
// ---------------------------------------------------------------------------

function buildFreshnessPreviewPanel(): string {
  return `<div class="panel" id="freshness-panel">
  <div class="panel-header collapsible" onclick="togglePanel('freshness-panel')">
    <h2><span class="collapse-icon">▼</span> Freshness Color Scale</h2>
  </div>
  <div class="panel-content">
    <div class="panel-body">
      <div class="freshness-preview" id="freshness-preview">
        ${DEFAULT_FRESHNESS_COLORS.map((color, i) => {
          const minutes = i * DEFAULT_FRESHNESS_INTERVAL_MINUTES;
          const nextMinutes = (i + 1) * DEFAULT_FRESHNESS_INTERVAL_MINUTES;
          const label = i === 0 ? `0–${nextMinutes}m` : `${minutes}–${nextMinutes}m`;
          return `<div class="freshness-swatch" style="background:${color}"><span class="swatch-label">${label}</span></div>`;
        }).join("\n        ")}
      </div>
      <p class="freshness-note">Interval: ${DEFAULT_FRESHNESS_INTERVAL_MINUTES} minutes per level. Configure in System Settings.</p>
    </div>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

export function buildAdminStyles(): string {
  return `<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #0f0f0f;
  color: #e0e0e0;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
body.login-body {
  align-items: center;
  justify-content: center;
  background: #1a1a2e;
}
.header {
  background: #1a1a2e;
  padding: 16px 24px;
  display: flex;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid #2a2a3e;
}
.header .logo { font-size: 24px; }
.header h1 { font-size: 18px; font-weight: 600; color: #fff; }
.header-spacer { flex: 1; }
.user-identity { display: flex; align-items: center; gap: 8px; }
.user-name { color: #ccc; font-size: 13px; }
.logout-link { color: #8b8bff; text-decoration: none; font-size: 13px; }
.logout-link:hover { text-decoration: underline; }
.connection-bar {
  background: #16a34a;
  color: #fff;
  text-align: center;
  padding: 4px;
  font-size: 12px;
}
.connection-bar.disconnected { background: #dc2626; }
.main {
  flex: 1;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 1200px;
  width: 100%;
  margin: 0 auto;
}
.panel {
  background: #1a1a1a;
  border: 1px solid #2a2a2a;
  border-radius: 8px;
  overflow: hidden;
}
.panel-header {
  padding: 12px 16px;
  background: #222;
  border-bottom: 1px solid #2a2a2a;
  cursor: default;
}
.panel-header.collapsible { cursor: pointer; user-select: none; }
.panel-header.collapsible:hover { background: #282828; }
.panel-header h2 {
  font-size: 14px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #aaa;
  display: flex;
  align-items: center;
  gap: 8px;
}
.panel-body { padding: 16px; }
.panel-content { overflow: hidden; transition: max-height 0.3s ease; }
.collapsed .panel-content { max-height: 0 !important; overflow: hidden; }
.collapsed .panel-header { border-bottom: none; }
.collapse-icon { font-size: 10px; color: #666; transition: transform 0.2s; }
.collapsed .collapse-icon { transform: rotate(-90deg); }
.count-badge {
  background: #2a2a3e;
  color: #888;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: normal;
}

/* Login */
.login-card {
  background: #16213e;
  border-radius: 12px;
  padding: 2rem;
  width: 100%;
  max-width: 400px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.3);
}
.login-card h1 { font-size: 1.5rem; margin-bottom: 1.5rem; text-align: center; color: #4fc3f7; }
.login-card label { display: block; margin-bottom: 0.25rem; font-size: 0.875rem; color: #aaa; }
.login-card input {
  width: 100%;
  padding: 0.75rem;
  margin-bottom: 1rem;
  border: 1px solid #333;
  border-radius: 6px;
  background: #0f3460;
  color: #e0e0e0;
  font-size: 1rem;
}
.login-card input:focus { outline: none; border-color: #4fc3f7; }
.login-card button {
  width: 100%;
  padding: 0.75rem;
  background: #4fc3f7;
  color: #1a1a2e;
  border: none;
  border-radius: 6px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
}
.login-card button:hover { background: #81d4fa; }
.error-message {
  background: #d32f2f33;
  border: 1px solid #d32f2f;
  border-radius: 6px;
  padding: 0.75rem;
  margin-bottom: 1rem;
  color: #ef9a9a;
  font-size: 0.875rem;
}

/* Settings */
.settings-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 16px;
}
.setting-field label {
  display: block;
  font-size: 11px;
  text-transform: uppercase;
  color: #888;
  margin-bottom: 4px;
}
.setting-field input, .setting-field select {
  width: 100%;
  padding: 8px;
  background: #2a2a2a;
  border: 1px solid #3a3a3a;
  border-radius: 4px;
  color: #e0e0e0;
  font-size: 13px;
}
.setting-field input:disabled, .setting-field select:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.setting-field .source-label {
  font-size: 10px;
  color: #f59e0b;
  margin-top: 2px;
}
.form-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* Buttons */
.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.btn-primary { background: #4fc3f7; color: #1a1a2e; }
.btn-primary:hover { background: #81d4fa; }
.btn-warning { background: #f59e0b; color: #1a1a2e; }
.btn-warning:hover { background: #fbbf24; }
.btn-danger { background: #dc2626; color: #fff; }
.btn-danger:hover { background: #ef4444; }
.btn-sm { padding: 4px 10px; font-size: 12px; }
.status-msg { font-size: 12px; color: #4ade80; }
.status-msg.error { color: #f87171; }

/* Channels */
.channels-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}
.channel-card {
  background: #222;
  border: 1px solid #333;
  border-radius: 6px;
  padding: 12px;
}
.channel-card h3 {
  font-size: 13px;
  text-transform: uppercase;
  color: #aaa;
  margin-bottom: 8px;
}
.channel-card .version { font-size: 16px; font-weight: 600; color: #fff; }
.channel-card .meta { font-size: 11px; color: #666; margin-top: 4px; }
.default-channel-row, .promote-row, .rollback-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.default-channel-row label { font-size: 13px; color: #aaa; }
.default-channel-row select {
  padding: 6px 10px;
  background: #2a2a2a;
  border: 1px solid #3a3a3a;
  border-radius: 4px;
  color: #e0e0e0;
  font-size: 13px;
}

/* Install Commands */
.install-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.install-controls label { font-size: 13px; color: #aaa; }
.install-controls select {
  padding: 6px 10px;
  background: #2a2a2a;
  border: 1px solid #3a3a3a;
  border-radius: 4px;
  color: #e0e0e0;
  font-size: 13px;
}
.install-commands .command-block {
  background: #1e1e2e;
  border: 1px solid #333;
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.command-block .cmd-label {
  font-size: 11px;
  text-transform: uppercase;
  color: #888;
  min-width: 60px;
}
.command-block code {
  flex: 1;
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 12px;
  color: #4ade80;
  word-break: break-all;
}
.command-block .copy-btn {
  background: #3a3a3a;
  border: none;
  color: #aaa;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
}
.command-block .copy-btn:hover { background: #4a4a4a; color: #fff; }

/* User Table */
.filter-bar {
  display: flex;
  gap: 8px;
  padding: 8px 16px;
  background: #1a1a1a;
  border-bottom: 1px solid #2a2a2a;
  flex-wrap: wrap;
  align-items: center;
}
.filter-bar label { font-size: 11px; color: #888; text-transform: uppercase; }
.filter-bar select, .filter-bar input {
  background: #2a2a2a;
  border: 1px solid #3a3a3a;
  color: #e0e0e0;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
}
.reset-btn {
  background: #3a3a3a;
  border: none;
  color: #aaa;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}
.reset-btn:hover { background: #4a4a4a; }
.table-wrapper { overflow-x: auto; width: 100%; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th {
  text-align: left;
  padding: 10px 12px;
  background: #222;
  color: #aaa;
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  border-bottom: 1px solid #2a2a2a;
}
th:hover { color: #fff; }
.sort-arrow { margin-left: 4px; font-size: 10px; }
td {
  padding: 10px 12px;
  border-bottom: 1px solid #1f1f1f;
  vertical-align: middle;
}
tr:hover td { background: #1f1f2f; }
.empty-state { text-align: center; padding: 24px; color: #666; font-size: 13px; }
.user-link { color: #8b8bff; text-decoration: none; }
.user-link:hover { text-decoration: underline; }
.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
}
.badge-env { background: #f59e0b33; color: #fbbf24; }
.user-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #fff;
  padding: 3px 12px;
  border-radius: 12px;
  font-size: 13px;
}

/* Freshness Preview */
.freshness-preview {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.freshness-swatch {
  width: 80px;
  height: 36px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.swatch-label { font-size: 10px; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.5); }
.freshness-note { font-size: 12px; color: #666; margin-top: 8px; }

/* Slack Integration */
.slack-status { margin-bottom: 16px; }
.slack-status .status-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  margin-bottom: 8px;
}
.slack-disable-row {
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid #2a2a2a;
}
.slack-disable-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #f59e0b;
  cursor: pointer;
  font-weight: 600;
}
.slack-disable-label input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
}
.slack-disabled #slack-auth-section,
.slack-disabled .slack-test-section {
  opacity: 0.4;
  pointer-events: none;
  filter: grayscale(0.5);
}
.slack-auth-mode {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
}
.slack-radio-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #ccc;
  cursor: pointer;
}
.slack-mode-section { margin-bottom: 16px; }
.slack-token-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.slack-token-row input { flex: 1; }
.slack-validation-msg {
  font-size: 12px;
  margin-top: 6px;
  min-height: 18px;
}
.slack-validation-msg.success { color: #4ade80; }
.slack-validation-msg.error { color: #f87171; }
.slack-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding-top: 8px;
  border-top: 1px solid #2a2a2a;
}
.slack-test-section {
  padding-top: 12px;
  border-top: 1px solid #2a2a2a;
}
.slack-test-section label {
  display: block;
  font-size: 11px;
  text-transform: uppercase;
  color: #888;
  margin-bottom: 6px;
}
.slack-test-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.slack-test-row input {
  flex: 1;
  padding: 8px;
  background: #2a2a2a;
  border: 1px solid #3a3a3a;
  border-radius: 4px;
  color: #e0e0e0;
  font-size: 13px;
}

@media (max-width: 768px) {
  .main { padding: 12px; gap: 12px; }
  .settings-grid { grid-template-columns: 1fr; }
  .channels-grid { grid-template-columns: 1fr; }
  .filter-bar { flex-direction: column; align-items: stretch; }
}
</style>`;
}


// ---------------------------------------------------------------------------
// Client-Side JavaScript (Requirements 5.4, 5.5, 7.12, 10.1, 10.4)
// ---------------------------------------------------------------------------

function buildAdminScript(): string {
  return `<script>
(function() {
  // -----------------------------------------------------------------------
  // State
  // -----------------------------------------------------------------------
  let settings = [];
  let channels = {};
  let installData = null;
  let users = [];
  let userSort = { col: 0, asc: true };
  let registryVersions = [];

  // -----------------------------------------------------------------------
  // SSE Connection (Requirements 10.1, 10.4)
  // -----------------------------------------------------------------------
  let sse = null;
  let sseRetryDelay = 1000;
  const SSE_MAX_DELAY = 30000;

  function connectSSE() {
    sse = new EventSource("/api/admin/events");
    sse.onopen = function() {
      sseRetryDelay = 1000;
      setConnected(true);
    };
    sse.onmessage = function(event) {
      try {
        const evt = JSON.parse(event.data);
        handleSSEEvent(evt);
      } catch (e) {}
    };
    sse.onerror = function() {
      setConnected(false);
      sse.close();
      setTimeout(connectSSE, sseRetryDelay);
      sseRetryDelay = Math.min(sseRetryDelay * 2, SSE_MAX_DELAY);
    };
  }

  function handleSSEEvent(evt) {
    switch (evt.type) {
      case "admin_settings_change":
        fetchSettings();
        break;
      case "admin_user_change":
        fetchUsers();
        break;
      case "admin_channel_change":
        fetchChannels();
        fetchInstallCommands();
        fetchBundles();
        break;
      case "bundle_change":
        fetchBundles();
        fetchChannels();
        fetchInstallCommands();
        break;
      case "slack_config_change":
        fetchSlackStatus();
        break;
    }
  }

  function setConnected(connected) {
    var bar = document.getElementById("connection-bar");
    if (connected) {
      bar.className = "connection-bar";
      bar.textContent = "● Connected — live updates active";
    } else {
      bar.className = "connection-bar disconnected";
      bar.textContent = "● Disconnected — reconnecting...";
    }
  }

  // -----------------------------------------------------------------------
  // Panel Collapse
  // -----------------------------------------------------------------------
  window.togglePanel = function(panelId) {
    var panel = document.getElementById(panelId);
    if (panel) panel.classList.toggle("collapsed");
  };

  // -----------------------------------------------------------------------
  // Fetch Data
  // -----------------------------------------------------------------------
  async function fetchSettings() {
    try {
      const res = await fetch("/api/admin/settings");
      if (res.ok) {
        const data = await res.json();
        settings = data.settings || [];
        renderSettings();
      }
    } catch (e) {}
  }

  async function fetchChannels() {
    try {
      const res = await fetch("/api/admin/channels");
      if (res.ok) {
        const data = await res.json();
        channels = data.channels || {};
        renderChannels();
      }
    } catch (e) {}
  }

  async function fetchInstallCommands() {
    try {
      const res = await fetch("/api/admin/install-commands");
      if (res.ok) {
        installData = await res.json();
        // Set channel selector to default channel
        var sel = document.getElementById("install-channel-select");
        if (sel && installData.defaultChannel) {
          sel.value = installData.defaultChannel;
        }
        renderInstallCommands();
      }
    } catch (e) {}
  }

  async function fetchUsers() {
    try {
      const res = await fetch("/api/admin/users");
      if (res.ok) {
        const data = await res.json();
        users = data.users || [];
        renderUsers();
      }
    } catch (e) {}
  }

  async function fetchBundles() {
    try {
      const res = await fetch("/api/admin/bundles");
      if (res.ok) {
        const data = await res.json();
        registryVersions = data.bundles || [];
        renderChannels();
      }
    } catch (e) {}
  }

  // -----------------------------------------------------------------------
  // Render: Settings
  // -----------------------------------------------------------------------
  function renderSettings() {
    var grid = document.getElementById("settings-grid");
    if (!settings.length) {
      grid.innerHTML = '<div class="empty-state">No settings configured</div>';
      return;
    }
    var html = "";
    settings.forEach(function(s) {
      var disabled = s.source === "env" ? " disabled" : "";
      var sourceHtml = s.source === "env" ? '<div class="source-label">Set by environment variable</div>' : "";
      var val = typeof s.value === "boolean" ? s.value : (s.value === null ? "" : String(s.value));
      var inputHtml;
      if (typeof s.value === "boolean") {
        inputHtml = '<select name="' + esc(s.key) + '" data-type="boolean"' + disabled + '>' +
          '<option value="true"' + (s.value ? " selected" : "") + '>true</option>' +
          '<option value="false"' + (!s.value ? " selected" : "") + '>false</option></select>';
      } else {
        inputHtml = '<input type="text" name="' + esc(s.key) + '" value="' + esc(String(val)) + '"' + disabled + '>';
      }
      html += '<div class="setting-field"><label>' + esc(s.key) + '</label>' + inputHtml + sourceHtml + '</div>';
    });
    grid.innerHTML = html;
  }

  // -----------------------------------------------------------------------
  // Render: Channels
  // -----------------------------------------------------------------------
  function renderChannels() {
    var grid = document.getElementById("channels-grid");
    var actions = document.getElementById("channel-actions");
    var rollbackRow = document.getElementById("rollback-row");

    var channelNames = ["dev", "uat", "prod"];
    var hasVersions = registryVersions.length > 0;
    var html = "";
    channelNames.forEach(function(ch) {
      var meta = channels[ch];
      var currentVersion = meta ? meta.version : "";

      // Build version dropdown
      var dropdownHtml;
      if (!hasVersions) {
        dropdownHtml = '<div style="margin-top:8px"><select disabled style="width:100%;padding:6px 10px;background:#2a2a2a;border:1px solid #3a3a3a;border-radius:4px;color:#666;font-size:12px"><option>No bundles available</option></select></div>';
      } else {
        var options = '<option value="">— Select version —</option>';
        registryVersions.forEach(function(b) {
          var selected = b.version === currentVersion ? " selected" : "";
          options += '<option value="' + esc(b.version) + '"' + selected + '>' + esc(b.version) + '</option>';
        });
        dropdownHtml = '<div style="margin-top:8px"><select id="assign-' + ch + '" style="width:100%;padding:6px 10px;background:#2a2a2a;border:1px solid #3a3a3a;border-radius:4px;color:#e0e0e0;font-size:12px">' + options + '</select>' +
          '<button class="btn btn-primary btn-sm" style="margin-top:6px" onclick="assignChannelVersion(\\'' + ch + '\\')">Save</button></div>';
      }

      if (meta && meta.version) {
        var ts = meta.uploadTimestamp ? fmtTs(meta.uploadTimestamp) : "—";
        html += '<div class="channel-card"><h3>' + ch.toUpperCase() + '</h3>' +
          '<div class="version">' + esc(meta.version) + '</div>' +
          '<div class="meta">Updated: ' + esc(ts) + '</div>' + dropdownHtml + '</div>';
      } else {
        html += '<div class="channel-card"><h3>' + ch.toUpperCase() + '</h3>' +
          '<div class="version" style="color:#666">Not assigned</div>' + dropdownHtml + '</div>';
      }
    });
    grid.innerHTML = html;
    actions.style.display = "";

    // Rollback buttons
    var rollbackHtml = "";
    channelNames.forEach(function(ch) {
      var meta = channels[ch];
      if (meta && meta.previousVersion) {
        rollbackHtml += '<button class="btn btn-danger btn-sm" onclick="rollbackChannel(\\'' + ch + '\\')">Rollback ' + ch.toUpperCase() + ' (→ ' + esc(meta.previousVersion) + ')</button>';
      }
    });
    rollbackRow.innerHTML = rollbackHtml;

    // Update default channel selector
    var sel = document.getElementById("default-channel-select");
    var defaultSetting = settings.find(function(s) { return s.key === "defaultChannel"; });
    if (defaultSetting && sel) {
      sel.value = String(defaultSetting.value);
    }
  }

  // -----------------------------------------------------------------------
  // Render: Install Commands (Requirement 5.4, 5.5)
  // -----------------------------------------------------------------------
  window.renderInstallCommands = function() {
    var display = document.getElementById("install-commands-display");
    if (!installData) {
      display.innerHTML = '<div class="empty-state">No install data available</div>';
      return;
    }
    var sel = document.getElementById("install-channel-select");
    var selectedChannel = sel ? sel.value : installData.defaultChannel;
    var channelData = installData.channels.find(function(c) { return c.channel === selectedChannel; });

    // Check channel availability
    var availability = installData.channelAvailability || {};
    if (availability[selectedChannel] === false) {
      var chLabel = selectedChannel.charAt(0).toUpperCase() + selectedChannel.slice(1);
      display.innerHTML = '<div class="empty-state" style="color:#f59e0b">n/a: No installer is available for ' + esc(chLabel) + ' channel</div>';
      return;
    }

    if (!channelData) {
      display.innerHTML = '<div class="empty-state">No commands for this channel</div>';
      return;
    }

    var html = "";
    if (installData.mode === "cloud") {
      html += buildCommandBlock("Cloud", channelData.cloudCommand);
    } else {
      html += buildCommandBlock("Local", channelData.localCommand);
      html += buildCommandBlock("Remote", channelData.remoteCommand);
    }
    display.innerHTML = html;
  };

  function buildCommandBlock(label, cmd) {
    if (!cmd) return "";
    return '<div class="command-block"><span class="cmd-label">' + esc(label) + '</span>' +
      '<code>' + esc(cmd) + '</code>' +
      '<button class="copy-btn" onclick="copyCommand(this, \\'' + esc(cmd).replace(/'/g, "\\\\'") + '\\')">Copy</button></div>';
  }

  // -----------------------------------------------------------------------
  // Render: Users (Requirements 7.1, 7.2, 7.12)
  // -----------------------------------------------------------------------
  window.renderUsers = function() {
    var body = document.getElementById("users-body");
    var countEl = document.getElementById("users-count");

    // Filter
    var nameFilter = (document.getElementById("user-filter-name").value || "").toLowerCase();
    var channelFilter = document.getElementById("user-filter-channel").value;
    var adminFilter = document.getElementById("user-filter-admin").value;

    var filtered = users.filter(function(u) {
      if (nameFilter && u.userId.toLowerCase().indexOf(nameFilter) === -1) return false;
      if (channelFilter) {
        if (channelFilter === "default" && u.installerChannel) return false;
        if (channelFilter !== "default" && u.installerChannel !== channelFilter) return false;
      }
      if (adminFilter === "true" && !u.admin) return false;
      if (adminFilter === "false" && u.admin) return false;
      return true;
    });

    // Sort
    var sortKeys = ["userId", "lastSeen", "installerChannel", "admin"];
    var key = sortKeys[userSort.col] || "userId";
    filtered.sort(function(a, b) {
      var va = a[key] || "";
      var vb = b[key] || "";
      if (typeof va === "boolean") { va = va ? 1 : 0; vb = vb ? 1 : 0; }
      if (va < vb) return userSort.asc ? -1 : 1;
      if (va > vb) return userSort.asc ? 1 : -1;
      return 0;
    });

    if (countEl) countEl.textContent = users.length + " users";

    // Update sort arrows
    for (var i = 0; i < 4; i++) {
      var arrow = document.getElementById("sort-" + i);
      if (arrow) arrow.textContent = userSort.col === i ? (userSort.asc ? "▲" : "▼") : "";
    }

    if (filtered.length === 0) {
      body.innerHTML = '<tr><td colspan="4" class="empty-state">No users found</td></tr>';
      return;
    }

    var html = "";
    filtered.forEach(function(u) {
      var userLink = '<a class="user-link" href="https://github.com/' + esc(u.userId) + '" target="_blank">' + esc(u.userId) + '</a>';
      var lastSeen = u.lastSeen ? fmtTs(u.lastSeen) : "Never";

      // Channel dropdown
      var channelVal = u.installerChannel || "";
      var channelHtml = '<select onchange="updateUserChannel(\\'' + esc(u.userId) + '\\', this.value)">' +
        '<option value=""' + (!channelVal ? " selected" : "") + '>Default</option>' +
        '<option value="latest"' + (channelVal === "latest" ? " selected" : "") + '>Latest</option>' +
        '<option value="dev"' + (channelVal === "dev" ? " selected" : "") + '>Dev</option>' +
        '<option value="uat"' + (channelVal === "uat" ? " selected" : "") + '>UAT</option>' +
        '<option value="prod"' + (channelVal === "prod" ? " selected" : "") + '>Prod</option>' +
        '</select>';

      // Admin toggle
      var adminHtml;
      if (u.adminSource === "env") {
        adminHtml = '<input type="checkbox" checked disabled> <span class="badge badge-env">env</span>';
      } else {
        adminHtml = '<input type="checkbox"' + (u.admin ? " checked" : "") +
          ' onchange="updateUserAdmin(\\'' + esc(u.userId) + '\\', this.checked)">';
      }

      html += '<tr><td>' + userLink + '</td><td>' + esc(lastSeen) + '</td><td>' + channelHtml + '</td><td>' + adminHtml + '</td></tr>';
    });
    body.innerHTML = html;
  };

  window.sortUsers = function(col) {
    if (userSort.col === col) userSort.asc = !userSort.asc;
    else { userSort.col = col; userSort.asc = true; }
    renderUsers();
  };

  window.resetUserFilters = function() {
    document.getElementById("user-filter-name").value = "";
    document.getElementById("user-filter-channel").value = "";
    document.getElementById("user-filter-admin").value = "";
    renderUsers();
  };

  // -----------------------------------------------------------------------
  // Actions: Settings
  // -----------------------------------------------------------------------
  window.saveSettings = async function(event) {
    event.preventDefault();
    var statusEl = document.getElementById("settings-status");
    var form = document.getElementById("settings-form");
    var inputs = form.querySelectorAll("input[name], select[name]");
    var errors = [];

    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      if (el.disabled) continue;
      var key = el.name;
      var raw = el.value;
      var value;
      if (el.dataset && el.dataset.type === "boolean") {
        value = raw === "true";
      } else if (raw === "" || raw === "null") {
        value = null;
      } else if (!isNaN(Number(raw)) && raw.trim() !== "") {
        value = Number(raw);
      } else {
        value = raw;
      }

      try {
        var res = await fetch("/api/admin/settings/" + encodeURIComponent(key), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: value })
        });
        if (!res.ok) {
          var err = await res.json();
          errors.push(key + ": " + (err.error || "failed"));
        }
      } catch (e) {
        errors.push(key + ": network error");
      }
    }

    if (errors.length) {
      statusEl.className = "status-msg error";
      statusEl.textContent = errors.join("; ");
    } else {
      statusEl.className = "status-msg";
      statusEl.textContent = "Settings saved";
      setTimeout(function() { statusEl.textContent = ""; }, 3000);
    }
    fetchSettings();
    return false;
  };

  // -----------------------------------------------------------------------
  // Actions: Channels
  // -----------------------------------------------------------------------
  window.saveDefaultChannel = async function() {
    var sel = document.getElementById("default-channel-select");
    var statusEl = document.getElementById("channels-status");
    try {
      var res = await fetch("/api/admin/settings/defaultChannel", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: sel.value, category: "client" })
      });
      if (res.ok) {
        statusEl.className = "status-msg";
        statusEl.textContent = "Default channel saved";
        setTimeout(function() { statusEl.textContent = ""; }, 3000);
        fetchSettings();
        fetchInstallCommands();
      } else {
        var err = await res.json();
        statusEl.className = "status-msg error";
        statusEl.textContent = err.error || "Failed";
      }
    } catch (e) {
      statusEl.className = "status-msg error";
      statusEl.textContent = "Network error";
    }
  };

  window.promoteChannel = async function(source, destination) {
    if (!confirm("Promote " + source.toUpperCase() + " → " + destination.toUpperCase() + "?")) return;
    var statusEl = document.getElementById("channels-status");
    try {
      var res = await fetch("/api/admin/channels/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: source, destination: destination })
      });
      if (res.ok) {
        statusEl.className = "status-msg";
        statusEl.textContent = "Promoted " + source + " → " + destination;
        setTimeout(function() { statusEl.textContent = ""; }, 3000);
        fetchChannels();
      } else {
        var err = await res.json();
        statusEl.className = "status-msg error";
        statusEl.textContent = err.error || "Promotion failed";
      }
    } catch (e) {
      statusEl.className = "status-msg error";
      statusEl.textContent = "Network error";
    }
  };

  window.rollbackChannel = async function(channel) {
    if (!confirm("Rollback " + channel.toUpperCase() + " to previous version?")) return;
    var statusEl = document.getElementById("channels-status");
    try {
      var res = await fetch("/api/admin/channels/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: channel })
      });
      if (res.ok) {
        statusEl.className = "status-msg";
        statusEl.textContent = "Rolled back " + channel;
        setTimeout(function() { statusEl.textContent = ""; }, 3000);
        fetchChannels();
      } else {
        var err = await res.json();
        statusEl.className = "status-msg error";
        statusEl.textContent = err.error || "Rollback failed";
      }
    } catch (e) {
      statusEl.className = "status-msg error";
      statusEl.textContent = "Network error";
    }
  };

  window.uploadChannelTarball = async function(channel, fileInput) {
    var statusEl = document.getElementById("channels-status");
    var file = fileInput.files && fileInput.files[0];
    if (!file) return;
    var version = prompt("Enter version for this tarball (e.g. 1.2.3):");
    if (!version || !version.trim()) {
      fileInput.value = "";
      return;
    }
    statusEl.className = "status-msg";
    statusEl.textContent = "Uploading to " + channel.toUpperCase() + "...";
    try {
      var arrayBuf = await file.arrayBuffer();
      var base64 = btoa(String.fromCharCode.apply(null, new Uint8Array(arrayBuf)));
      var res = await fetch("/api/admin/channels/" + channel + "/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: version.trim(), tarball: base64 })
      });
      if (res.ok) {
        statusEl.className = "status-msg";
        statusEl.textContent = "Uploaded v" + version.trim() + " to " + channel.toUpperCase();
        setTimeout(function() { statusEl.textContent = ""; }, 3000);
        fetchChannels();
        fetchInstallCommands();
      } else {
        var err = await res.json();
        statusEl.className = "status-msg error";
        statusEl.textContent = err.error || "Upload failed";
      }
    } catch (e) {
      statusEl.className = "status-msg error";
      statusEl.textContent = "Upload error: " + (e.message || "unknown");
    }
    fileInput.value = "";
  };

  window.assignChannelVersion = async function(channel) {
    var statusEl = document.getElementById("channels-status");
    var sel = document.getElementById("assign-" + channel);
    if (!sel) return;
    var version = sel.value;
    if (!version) {
      statusEl.className = "status-msg error";
      statusEl.textContent = "Select a version first";
      setTimeout(function() { statusEl.textContent = ""; }, 3000);
      return;
    }
    statusEl.className = "status-msg";
    statusEl.textContent = "Assigning v" + version + " to " + channel.toUpperCase() + "...";
    try {
      var res = await fetch("/api/admin/channels/" + channel + "/assign", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: version })
      });
      if (res.ok) {
        statusEl.className = "status-msg";
        statusEl.textContent = "Assigned v" + version + " to " + channel.toUpperCase();
        setTimeout(function() { statusEl.textContent = ""; }, 3000);
        fetchChannels();
        fetchInstallCommands();
        fetchBundles();
      } else {
        var err = await res.json();
        statusEl.className = "status-msg error";
        statusEl.textContent = err.error || "Assignment failed";
      }
    } catch (e) {
      statusEl.className = "status-msg error";
      statusEl.textContent = "Network error";
    }
  };

  // -----------------------------------------------------------------------
  // Actions: Users (Requirements 7.8, 7.9)
  // -----------------------------------------------------------------------
  window.updateUserChannel = async function(userId, channel) {
    try {
      await fetch("/api/admin/users/" + encodeURIComponent(userId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installerChannel: channel || null })
      });
      fetchUsers();
    } catch (e) {}
  };

  window.updateUserAdmin = async function(userId, isAdmin) {
    try {
      var res = await fetch("/api/admin/users/" + encodeURIComponent(userId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ admin: isAdmin })
      });
      if (!res.ok) {
        var err = await res.json();
        alert(err.error || "Failed to update admin status");
      }
      fetchUsers();
    } catch (e) {}
  };

  // -----------------------------------------------------------------------
  // Actions: Copy to clipboard (Requirement 5.5)
  // -----------------------------------------------------------------------
  window.copyCommand = async function(btn, text) {
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = "Copied!";
      setTimeout(function() { btn.textContent = "Copy"; }, 2000);
    } catch (e) {
      // Fallback
      var ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      btn.textContent = "Copied!";
      setTimeout(function() { btn.textContent = "Copy"; }, 2000);
    }
  };

  // -----------------------------------------------------------------------
  // Slack Integration (Requirements 6.1, 6.2, 6.3, 6.4, 6.6, 6.8, 6.10)
  // -----------------------------------------------------------------------
  let slackConfig = null;

  async function fetchSlackStatus() {
    try {
      const res = await fetch("/api/admin/slack", { headers: {} });
      if (res.ok) {
        slackConfig = await res.json();
        renderSlackStatus();
      }
    } catch (e) {}
  }

  window.toggleSlackDisabled = function(disabled) {
    var panel = document.getElementById("slack-panel");
    var checkbox = document.getElementById("slack-disable-checkbox");
    if (disabled) {
      panel.classList.add("slack-disabled");
    } else {
      panel.classList.remove("slack-disabled");
    }
    checkbox.checked = disabled;
  };

  function renderSlackStatus() {
    var display = document.getElementById("slack-status-display");
    var sourceEl = document.getElementById("slack-token-source");
    var tokenInput = document.getElementById("slack-bot-token");
    var saveBtn = document.getElementById("slack-save-btn");
    var disableCheckbox = document.getElementById("slack-disable-checkbox");

    if (!slackConfig) {
      display.innerHTML = '<div class="status-indicator">⚪ Status: Unknown</div>';
      return;
    }

    // Handle disabled state: if not configured and no token source, check the disable box
    if (!slackConfig.configured && slackConfig.source === "none") {
      toggleSlackDisabled(true);
      display.innerHTML = '<div class="status-indicator">⚪ Slack integration is disabled</div>';
    } else if (slackConfig.configured) {
      toggleSlackDisabled(false);
      var team = slackConfig.team || "Unknown";
      var bot = slackConfig.botUser || "Unknown";
      display.innerHTML = '<div class="status-indicator">🟢 Connected — Workspace: ' + esc(team) + ', Bot: @' + esc(bot) + '</div>';
    } else {
      toggleSlackDisabled(false);
      display.innerHTML = '<div class="status-indicator">⚪ Not configured — enter a bot token or install a Slack App</div>';
    }

    // Show source indicator
    if (slackConfig.source === "env") {
      sourceEl.style.display = "";
      sourceEl.textContent = "Source: SLACK_BOT_TOKEN env var (read-only)";
      tokenInput.disabled = true;
      tokenInput.placeholder = "Set via environment variable";
      saveBtn.disabled = true;
    } else {
      sourceEl.style.display = slackConfig.source === "database" ? "" : "none";
      if (slackConfig.source === "database") {
        sourceEl.textContent = "Source: database (editable)";
      }
      tokenInput.disabled = false;
      tokenInput.placeholder = "xoxb-...";
      saveBtn.disabled = false;
    }

    // Set auth mode radio
    if (slackConfig.authMode === "oauth") {
      var oauthRadio = document.querySelector('input[name="slack-auth-mode"][value="oauth"]');
      if (oauthRadio) oauthRadio.checked = true;
      switchSlackAuthMode("oauth");
    }
  }

  window.switchSlackAuthMode = function(mode) {
    var botSection = document.getElementById("slack-bot-token-section");
    var oauthSection = document.getElementById("slack-oauth-section");
    if (mode === "bot_token") {
      botSection.style.display = "";
      oauthSection.style.display = "none";
    } else {
      botSection.style.display = "none";
      oauthSection.style.display = "";
    }
  };

  window.validateSlackToken = async function() {
    var tokenInput = document.getElementById("slack-bot-token");
    var statusEl = document.getElementById("slack-validation-status");
    var token = tokenInput.value.trim();
    if (!token) {
      statusEl.className = "slack-validation-msg error";
      statusEl.textContent = "Please enter a bot token";
      return;
    }
    statusEl.className = "slack-validation-msg";
    statusEl.textContent = "Validating...";
    try {
      var res = await fetch("/api/admin/slack", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botToken: token })
      });
      var data = await res.json();
      if (res.ok && data.success) {
        statusEl.className = "slack-validation-msg success";
        statusEl.textContent = "🟢 Valid — Workspace: " + (data.team || "?") + ", Bot: @" + (data.botUser || "?");
        fetchSlackStatus();
      } else {
        statusEl.className = "slack-validation-msg error";
        statusEl.textContent = "❌ " + (data.error || "Validation failed");
      }
    } catch (e) {
      statusEl.className = "slack-validation-msg error";
      statusEl.textContent = "Network error";
    }
  };

  window.saveSlackConfig = async function() {
    var statusEl = document.getElementById("slack-save-status");
    var mode = document.querySelector('input[name="slack-auth-mode"]:checked').value;

    var body;
    if (mode === "bot_token") {
      var token = document.getElementById("slack-bot-token").value.trim();
      if (!token) {
        statusEl.className = "status-msg error";
        statusEl.textContent = "Enter a bot token first";
        return;
      }
      body = { botToken: token };
    } else {
      var clientId = document.getElementById("slack-oauth-client-id").value.trim();
      var clientSecret = document.getElementById("slack-oauth-client-secret").value.trim();
      if (!clientId || !clientSecret) {
        statusEl.className = "status-msg error";
        statusEl.textContent = "Enter both Client ID and Client Secret";
        return;
      }
      body = { oauthClientId: clientId, oauthClientSecret: clientSecret };
    }

    try {
      var res = await fetch("/api/admin/slack", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      var data = await res.json();
      if (res.ok) {
        statusEl.className = "status-msg";
        statusEl.textContent = "Saved";
        setTimeout(function() { statusEl.textContent = ""; }, 3000);
        fetchSlackStatus();
      } else {
        statusEl.className = "status-msg error";
        statusEl.textContent = data.error || "Save failed";
      }
    } catch (e) {
      statusEl.className = "status-msg error";
      statusEl.textContent = "Network error";
    }
  };

  window.installSlackApp = function() {
    var clientId = document.getElementById("slack-oauth-client-id").value.trim();
    if (!clientId) {
      alert("Enter a Client ID first");
      return;
    }
    var redirectUri = window.location.origin + "/auth/slack/callback";
    var state = Math.random().toString(36).slice(2);
    sessionStorage.setItem("slack_oauth_state", state);
    var url = "https://slack.com/oauth/v2/authorize?client_id=" + encodeURIComponent(clientId) +
      "&scope=chat:write,chat:write.public" +
      "&redirect_uri=" + encodeURIComponent(redirectUri) +
      "&state=" + encodeURIComponent(state);
    window.location.href = url;
  };

  window.sendSlackTestMessage = async function() {
    var channelInput = document.getElementById("slack-test-channel");
    var statusEl = document.getElementById("slack-test-status");
    var channel = channelInput.value.trim().replace(/^#/, "");
    if (!channel) {
      statusEl.className = "status-msg error";
      statusEl.textContent = "Enter a channel name";
      return;
    }
    statusEl.className = "status-msg";
    statusEl.textContent = "Sending...";
    try {
      var res = await fetch("/api/admin/slack/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: channel })
      });
      var data = await res.json();
      if (res.ok) {
        statusEl.className = "status-msg";
        statusEl.textContent = "✅ Test message sent";
        setTimeout(function() { statusEl.textContent = ""; }, 3000);
      } else {
        statusEl.className = "status-msg error";
        statusEl.textContent = "❌ " + (data.error || "Failed");
      }
    } catch (e) {
      statusEl.className = "status-msg error";
      statusEl.textContent = "Network error";
    }
  };

  // -----------------------------------------------------------------------
  // Utilities
  // -----------------------------------------------------------------------
  function esc(str) {
    if (str === null || str === undefined) return "";
    var d = document.createElement("div");
    d.textContent = String(str);
    return d.innerHTML;
  }

  function fmtTs(iso) {
    try {
      var d = new Date(iso);
      var pad = function(n) { return String(n).padStart(2, "0"); };
      return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
    } catch (e) { return iso; }
  }

  // -----------------------------------------------------------------------
  // Init
  // -----------------------------------------------------------------------
  fetchSettings();
  fetchChannels();
  fetchBundles();
  fetchInstallCommands();
  fetchUsers();
  fetchSlackStatus();
  connectSSE();
})();
</script>`;
}
