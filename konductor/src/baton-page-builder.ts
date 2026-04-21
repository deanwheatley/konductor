/**
 * Baton Dashboard — Repo Page HTML Generator
 *
 * Generates a complete HTML document with embedded CSS and JS for the
 * per-repository dashboard. The page connects to the Konductor SSE
 * endpoint for real-time updates and renders five sections:
 * - Repository Summary (always visible)
 * - Notifications & Alerts (collapsible, with Active/History tabs)
 * - Query Log (collapsible)
 * - Open PRs (collapsible, placeholder)
 * - Repo History (collapsible, placeholder)
 */

import type { BatonNotification } from "./baton-types.js";
import { DEFAULT_FRESHNESS_COLORS, DEFAULT_FRESHNESS_INTERVAL_MINUTES } from "./baton-types.js";
import { extractRepoName } from "./baton-url.js";

/**
 * Build the complete repo page HTML for a given repository.
 *
 * @param repo      Repository in "owner/repo" format
 * @param serverUrl Base URL of the Konductor server (e.g. "http://localhost:3100")
 * @param user      Optional user info for header display. When provided: show avatar + username + logout.
 *                  When null: show "Authentication disabled". When undefined: no user display (backward compatible).
 * @returns         Complete HTML document string
 */
export function buildRepoPage(repo: string, serverUrl: string, user?: { username: string; avatarUrl: string } | null): string {
  const [owner, repoName] = repo.split("/");
  const githubUrl = `https://github.com/${owner}/${repoName}`;
  const repoShort = extractRepoName(repo);
  // Use relative URLs so the page works regardless of which hostname/IP the user browses to
  const apiBase = `/api/repo/${repoShort}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🎵 Konductor Baton — ${escapeHtml(repoShort)}</title>
${buildStyles()}
</head>
<body>

${buildHeader(repo, repoShort, githubUrl, user)}
<div class="connection-bar" id="connection-bar">● Connected — live updates active</div>
<div class="main">
  <div id="summary-section"></div>
  <div id="notifications-section"></div>
  <div id="querylog-section"></div>
  ${buildCollabRequestsSection()}
  ${buildOpenPRsSection()}
  ${buildHistorySection()}
  ${buildSlackIntegrationSection()}
</div>

${buildScript(repo, apiBase, githubUrl, repoShort)}
</body>
</html>`;
}


// ---------------------------------------------------------------------------
// HTML Helpers
// ---------------------------------------------------------------------------

/** Escape HTML special characters to prevent XSS. */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function buildHeader(repo: string, repoShort: string, githubUrl: string, user?: { username: string; avatarUrl: string } | null): string {
  let userHtml = "";
  if (user !== undefined) {
    if (user === null) {
      userHtml = `<span class="auth-disabled">Authentication disabled</span>`;
    } else {
      userHtml = `<span class="user-identity"><img class="user-avatar" src="${escapeHtml(user.avatarUrl)}" alt="${escapeHtml(user.username)}" /><span class="user-name">${escapeHtml(user.username)}</span><a class="logout-link" href="/auth/logout">Logout</a></span>`;
    }
  }
  return `<div class="header">
  <span class="logo">🎵</span>
  <h1>Konductor Baton — ${escapeHtml(repoShort)}</h1>
  <a class="repo-link" href="${escapeHtml(githubUrl)}" target="_blank">↗ GitHub</a>
  ${userHtml}
</div>`;
}

// ---------------------------------------------------------------------------
// Placeholder Sections (future use)
// ---------------------------------------------------------------------------

function buildPlaceholderSection(id: string, title: string): string {
  return `<div class="panel" id="${id}">
    <div class="panel-header collapsible" onclick="togglePanel('${id}')">
      <h2><span class="collapse-icon">▼</span> ${escapeHtml(title)} <span class="count-badge">coming soon</span></h2>
    </div>
    <div class="panel-content">
      <div class="panel-body">
        <div class="coming-soon">
          <div class="icon">🚧</div>
          <p>GitHub Integration Coming Soon!</p>
        </div>
      </div>
    </div>
  </div>`;
}


// ---------------------------------------------------------------------------
// Collaboration Requests Section (Requirement 7.1–7.5)
// ---------------------------------------------------------------------------

/**
 * Build the Collaboration Requests panel for the Baton repo page.
 * Shows non-expired collab requests with initiator, recipient, files,
 * collision state, status, age, and share link (if available).
 *
 * Requirements: 7.1, 7.2, 7.3, 7.5
 */
export function buildCollabRequestsSection(): string {
  return `<div class="panel" id="collab-panel">
    <div class="panel-header collapsible" onclick="togglePanel('collab-panel')">
      <h2><span class="collapse-icon">▼</span> Collaboration Requests <span class="count-badge" id="collab-count">0 requests</span></h2>
    </div>
    <div class="panel-content">
      <div class="panel-body" id="collab-panel-body">
        <div class="empty-state">No active collaboration requests.</div>
      </div>
    </div>
  </div>`;
}

/**
 * Render a single collaboration request as an HTML card string.
 * Exported for unit testing.
 *
 * Requirements: 7.2, 7.3
 */
export function renderCollabRequestRow(request: {
  requestId: string;
  initiator: string;
  recipient: string;
  files: string[];
  collisionState: string;
  status: string;
  createdAt: string;
  shareLink?: string;
}): string {
  const statusClass = request.status === "accepted" || request.status === "link_shared"
    ? "collab-status-accepted"
    : request.status === "declined"
    ? "collab-status-declined"
    : request.status === "expired"
    ? "collab-status-expired"
    : "collab-status-pending";

  const stateDisplay = request.collisionState
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c: string) => c.toUpperCase());

  const age = formatAge(request.createdAt);
  const filesDisplay = request.files.map((f) => escapeHtml(f)).join(", ");
  const filesRaw = request.files.join(", ");

  const shareLinkHtml = request.shareLink
    ? ` <a class="collab-join-btn" href="${escapeHtml(request.shareLink)}" target="_blank">Join Session</a>`
    : "";

  // Live session indicators (Requirements 1.1, 1.2)
  let statusBadgeHtml: string;
  const isLive = request.status === "link_shared";
  const isWaiting = request.status === "accepted";
  if (isLive) {
    statusBadgeHtml = `<span class="live-badge"><span class="live-dot"></span> Live</span>`;
  } else if (isWaiting) {
    statusBadgeHtml = `<span class="waiting-badge">⏳ Waiting for Link</span>`;
  } else {
    const statusLabel = request.status.charAt(0).toUpperCase() + request.status.slice(1);
    statusBadgeHtml = `<span class="collab-status ${statusClass}">${escapeHtml(statusLabel)}</span>`;
  }

  // Green left border for live cards
  const cardBorderStyle = isLive ? ` style="border-left: 3px solid #16a34a;"` : "";

  return `<div class="collab-card"${cardBorderStyle} data-request-id="${escapeHtml(request.requestId)}">
    <div class="collab-card-header">
      <span class="collab-users"><a class="user-link" href="https://github.com/${escapeHtml(request.initiator)}">${escapeHtml(request.initiator)}</a> → <a class="user-link" href="https://github.com/${escapeHtml(request.recipient)}">${escapeHtml(request.recipient)}</a></span>
      ${statusBadgeHtml}
    </div>
    <div class="collab-card-body">
      <span class="collab-files" title="${escapeHtml(filesRaw)}">📂 ${filesDisplay}</span>
      <span class="collab-meta"><span class="state-badge">${escapeHtml(stateDisplay)}</span> · ${escapeHtml(age)}</span>${shareLinkHtml}
    </div>
  </div>`;
}

/** Format a createdAt timestamp as a human-readable age string. */
function formatAge(createdAt: string): string {
  try {
    const ms = Date.now() - new Date(createdAt).getTime();
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return "unknown";
  }
}


// ---------------------------------------------------------------------------
// Open PRs Section (Requirement 7.1)
// ---------------------------------------------------------------------------

/**
 * Build the Open PRs panel with an empty table that will be populated
 * client-side via the /api/github/prs/:repo endpoint.
 *
 * Columns: Hours Open, Branch (linked), PR # (linked), User (linked), Status, Files
 * Requirement 7.1
 */
export function buildOpenPRsSection(): string {
  return `<div class="panel" id="prs-panel">
    <div class="panel-header collapsible" onclick="togglePanel('prs-panel')">
      <h2><span class="collapse-icon">▼</span> Open PRs <span class="count-badge" id="prs-count">0 PRs</span></h2>
    </div>
    <div class="panel-content">
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Hours Open</th>
              <th>Branch</th>
              <th>PR #</th>
              <th>User</th>
              <th>Status</th>
              <th>Files</th>
            </tr>
          </thead>
          <tbody id="prs-body">
            <tr><td colspan="6" class="empty-state">Loading…</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>`;
}

/**
 * Render a single open PR entry as a table row HTML string.
 * Exported for unit testing.
 */
export function renderPRRow(entry: { prNumber: number; prUrl: string; user: string; branch: string; targetBranch: string; status: string; filesCount: number; hoursOpen: number }, githubBase: string): string {
  const statusClass = entry.status === "approved" ? "badge-alerting"
    : entry.status === "draft" ? "badge-healthy"
    : "badge-warning";
  const statusLabel = entry.status.charAt(0).toUpperCase() + entry.status.slice(1);
  const hoursDisplay = entry.hoursOpen < 1 ? "<1h" : `${Math.round(entry.hoursOpen)}h`;
  return `<tr>
    <td style="white-space:nowrap;">${escapeHtml(hoursDisplay)}</td>
    <td><a class="branch-link" href="${escapeHtml(githubBase)}/tree/${escapeHtml(entry.branch)}">${escapeHtml(entry.branch)}</a> → ${escapeHtml(entry.targetBranch)}</td>
    <td><a class="user-link" href="${escapeHtml(entry.prUrl)}">#${entry.prNumber}</a></td>
    <td><a class="user-link" href="https://github.com/${escapeHtml(entry.user)}">${escapeHtml(entry.user)}</a></td>
    <td><span class="badge ${statusClass}">${escapeHtml(statusLabel)}</span></td>
    <td>${entry.filesCount}</td>
  </tr>`;
}


// ---------------------------------------------------------------------------
// Repo History Section
// ---------------------------------------------------------------------------

/**
 * Build the Repo History panel with an empty table that will be populated
 * client-side via the /api/github/history/:repo endpoint.
 *
 * Columns: Timestamp, Action, User (linked), Branch, Summary
 * Requirement 7.2
 */
export function buildHistorySection(): string {
  return `<div class="panel" id="history-panel">
    <div class="panel-header collapsible" onclick="togglePanel('history-panel')">
      <h2><span class="collapse-icon">▼</span> Repo History <span class="count-badge" id="history-count">0 entries</span></h2>
    </div>
    <div class="panel-content">
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Action</th>
              <th>User</th>
              <th>Branch</th>
              <th>Summary</th>
            </tr>
          </thead>
          <tbody id="history-body">
            <tr><td colspan="5" class="empty-state">Loading…</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>`;
}

/**
 * Render a single history entry as a table row HTML string.
 * Exported for unit testing.
 */
export function renderHistoryRow(entry: { timestamp: string; action: string; user: string; branch: string; summary: string }, githubBase: string): string {
  const ts = formatTimestamp(entry.timestamp);
  const actionClass = entry.action.startsWith("PR Approved") ? "badge-alerting"
    : entry.action.startsWith("PR") ? "badge-warning"
    : "badge-healthy";
  return `<tr>
    <td style="white-space:nowrap;">${escapeHtml(ts)}</td>
    <td><span class="badge ${actionClass}">${escapeHtml(entry.action)}</span></td>
    <td><a class="user-link" href="https://github.com/${escapeHtml(entry.user)}">${escapeHtml(entry.user)}</a></td>
    <td><a class="branch-link" href="${escapeHtml(githubBase)}/tree/${escapeHtml(entry.branch)}">${escapeHtml(entry.branch)}</a></td>
    <td>${escapeHtml(entry.summary)}</td>
  </tr>`;
}


// ---------------------------------------------------------------------------
// Slack Integration Section (Requirement 3.1–3.8)
// ---------------------------------------------------------------------------

/**
 * Build the Slack Integration panel for the Baton repo page.
 * Shows configuration status, editable channel/verbosity, and action buttons.
 * When Slack is not configured, shows a warning directing admin to the Admin Dashboard.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8
 */
export function buildSlackIntegrationSection(): string {
  return `<div class="panel" id="slack-panel">
    <div class="panel-header collapsible" onclick="togglePanel('slack-panel')">
      <h2><span class="collapse-icon">▼</span> Slack Integration <span class="count-badge" id="slack-status-badge">loading</span></h2>
    </div>
    <div class="panel-content">
      <div class="panel-body" id="slack-panel-body">
        <div class="empty-state">Loading Slack configuration…</div>
      </div>
    </div>
  </div>`;
}


// ---------------------------------------------------------------------------
// Notification Rendering (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Render a single notification as a table row HTML string.
 * Exported for property-based testing.
 */
export function renderNotificationRow(notification: BatonNotification, githubBase: string): string {
  const typeLower = notification.notificationType;
  const typeLabel = typeLower.charAt(0).toUpperCase() + typeLower.slice(1);
  const stateDisplay = formatCollisionState(notification.collisionState);

  // Gather unique branches from users
  const branches = [...new Set(notification.users.map((u) => u.branch))];
  const branchLinks = branches
    .map((b) => `<a class="branch-link" href="${escapeHtml(githubBase)}/tree/${escapeHtml(b)}">${escapeHtml(b)}</a>`)
    .join(", ");

  const jirasDisplay = notification.jiras.length > 0
    ? notification.jiras.map(escapeHtml).join(", ")
    : "unknown";

  const summaryEscaped = escapeHtml(notification.summary);
  const summaryHtml = notification.summary.length > 120
    ? `<div class="summary-text">${summaryEscaped}</div><button class="see-more" onclick="this.previousElementSibling.style.webkitLineClamp='unset';this.previousElementSibling.style.overflow='visible';this.remove();">see more…</button>`
    : `<div>${summaryEscaped}</div>`;

  const userLinks = notification.users
    .map((u) => `<a class="user-link" href="https://github.com/${escapeHtml(u.userId)}">${escapeHtml(u.userId)}</a>`)
    .join(", ");

  const resolveBtn = notification.resolved
    ? `<span class="resolved-label">Resolved</span>`
    : `<button class="resolve-btn" onclick="resolveNotification('${escapeHtml(notification.id)}')">✓ Resolve</button>`;

  return `<tr class="notif-row-${typeLower}">
    <td style="white-space:nowrap;">${escapeHtml(formatTimestamp(notification.timestamp))}</td>
    <td><span class="badge badge-${typeLower}">${escapeHtml(typeLabel)}</span></td>
    <td><span class="state-badge">${escapeHtml(stateDisplay)}</span></td>
    <td>${branchLinks}</td>
    <td>${jirasDisplay}</td>
    <td>${summaryHtml}</td>
    <td>${userLinks}</td>
    <td>${resolveBtn}</td>
  </tr>`;
}

function formatCollisionState(state: string): string {
  return state
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
}


// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function buildStyles(): string {
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
  .header .repo-link {
    color: #8b8bff;
    text-decoration: none;
    font-size: 14px;
    margin-left: auto;
  }
  .header .repo-link:hover { text-decoration: underline; }
  .user-identity {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: 12px;
  }
  .user-avatar {
    width: 24px;
    height: 24px;
    border-radius: 50%;
  }
  .user-name {
    color: #ccc;
    font-size: 13px;
  }
  .logout-link {
    color: #8b8bff;
    text-decoration: none;
    font-size: 13px;
  }
  .logout-link:hover { text-decoration: underline; }
  .auth-disabled {
    color: #888;
    font-size: 13px;
    margin-left: 12px;
  }
  .connection-bar {
    background: #16a34a;
    color: #fff;
    text-align: center;
    padding: 4px;
    font-size: 12px;
  }
  .connection-bar.disconnected {
    background: #dc2626;
  }
  .main {
    flex: 1;
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-width: 1400px;
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
    display: flex;
    align-items: center;
    justify-content: space-between;
    cursor: default;
  }
  .panel-header.collapsible {
    cursor: pointer;
    user-select: none;
  }
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
  .panel-content {
    overflow: hidden;
    transition: max-height 0.3s ease;
  }
  .collapsed .panel-content {
    max-height: 0 !important;
    overflow: hidden;
  }
  .collapsed .panel-header { border-bottom: none; }
  .collapse-icon {
    font-size: 10px;
    color: #666;
    transition: transform 0.2s;
  }
  .collapsed .collapse-icon { transform: rotate(-90deg); }
  .health-status {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 16px;
    border-radius: 20px;
    font-weight: 600;
    font-size: 14px;
  }
  .health-healthy { background: #16a34a; color: #fff; }
  .health-warning { background: #eab308; color: #1a1a1a; }
  .health-alerting { background: #dc2626; color: #fff; }
  .summary-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-top: 12px;
  }
  .summary-item label {
    display: block;
    font-size: 11px;
    text-transform: uppercase;
    color: #888;
    margin-bottom: 4px;
  }
  .summary-item .value { font-size: 14px; }
  .summary-item a { color: #8b8bff; text-decoration: none; }
  .summary-item a:hover { text-decoration: underline; }
  .branch-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    list-style: none;
  }
  .branch-tag {
    background: #2a2a3e;
    padding: 3px 10px;
    border-radius: 12px;
    font-size: 13px;
  }
  .branch-tag a { color: #8b8bff; text-decoration: none; }
  .branch-tag a:hover { text-decoration: underline; }
  .user-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: #fff;
    padding: 3px 12px;
    border-radius: 12px;
    font-size: 13px;
  }
  .user-pill a { color: #fff; text-decoration: none; }
  .user-pill .ago { font-size: 10px; opacity: 0.8; }
  .user-pill.not-connected {
    animation: blink-pill 1.5s ease-in-out infinite;
    position: relative;
    cursor: help;
  }
  .user-pill.not-connected .tooltip {
    display: none;
    position: absolute;
    bottom: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    background: #333;
    color: #fff;
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 11px;
    white-space: nowrap;
    pointer-events: none;
    z-index: 10;
  }
  .user-pill.not-connected:hover .tooltip { display: block; }
  @keyframes blink-pill {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }
  .tab-controls { display: flex; gap: 0; }
  .tab-btn {
    background: none;
    border: none;
    color: #888;
    padding: 6px 16px;
    cursor: pointer;
    font-size: 13px;
    border-bottom: 2px solid transparent;
  }
  .tab-btn.active { color: #fff; border-bottom-color: #8b8bff; }
  .tab-btn:hover { color: #ccc; }
  .panel-header-right {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .filter-bar {
    display: flex;
    gap: 8px;
    padding: 8px 16px;
    background: #1a1a1a;
    border-bottom: 1px solid #2a2a2a;
    flex-wrap: wrap;
    align-items: center;
  }
  .filter-bar label {
    font-size: 11px;
    color: #888;
    text-transform: uppercase;
  }
  .filter-bar select, .filter-bar input {
    background: #2a2a2a;
    border: 1px solid #3a3a3a;
    color: #e0e0e0;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
  }
  .filter-bar .reset-btn {
    background: #3a3a3a;
    border: none;
    color: #aaa;
    padding: 4px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }
  .filter-bar .reset-btn:hover { background: #4a4a4a; }
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
  th .sort-arrow { margin-left: 4px; font-size: 10px; }
  td {
    padding: 10px 12px;
    border-bottom: 1px solid #1f1f1f;
    vertical-align: top;
  }
  tr:hover td { background: #1f1f2f; }
  .notif-row-alerting { border-left: 3px solid #dc2626; }
  .notif-row-warning { border-left: 3px solid #eab308; }
  .notif-row-healthy { border-left: 3px solid #16a34a; }
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
  }
  .badge-alerting { background: #dc262633; color: #f87171; }
  .badge-warning { background: #eab30833; color: #fbbf24; }
  .badge-healthy { background: #16a34a33; color: #4ade80; }
  .state-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    background: #2a2a3e;
    color: #ccc;
  }
  .summary-text {
    max-width: 300px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .see-more {
    color: #8b8bff;
    cursor: pointer;
    font-size: 12px;
    border: none;
    background: none;
    padding: 0;
  }
  .see-more:hover { text-decoration: underline; }
  .user-link { color: #8b8bff; text-decoration: none; }
  .user-link:hover { text-decoration: underline; }
  .branch-link { color: #a78bfa; text-decoration: none; font-size: 12px; }
  .branch-link:hover { text-decoration: underline; }
  .resolve-btn {
    background: #2a2a3e;
    border: 1px solid #3a3a4e;
    color: #aaa;
    padding: 4px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }
  .resolve-btn:hover { background: #3a3a4e; color: #fff; }
  .resolved-label { color: #4ade80; font-size: 12px; }
  .query-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    background: #2a2a3e;
    color: #8b8bff;
    font-family: monospace;
  }
  .params { font-family: monospace; font-size: 12px; color: #888; }
  .coming-soon { text-align: center; padding: 40px 20px; color: #666; }
  .coming-soon .icon { font-size: 32px; margin-bottom: 8px; }
  .coming-soon p { font-size: 14px; }
  .empty-state { text-align: center; padding: 24px; color: #666; font-size: 13px; }
  .count-badge {
    background: #2a2a3e;
    color: #888;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: normal;
  }
  .count-badge-alert { background: #dc262633; color: #f87171; }
  @media (max-width: 768px) {
    .main { padding: 12px; gap: 12px; }
    .summary-grid { grid-template-columns: 1fr; }
    .header h1 { font-size: 15px; }
    .filter-bar { flex-direction: column; align-items: stretch; }
  }
  .slack-form { display: flex; flex-direction: column; gap: 12px; }
  .slack-form-row { display: flex; align-items: center; gap: 12px; }
  .slack-form-row label { font-size: 12px; color: #888; min-width: 80px; text-transform: uppercase; }
  .slack-form-row input, .slack-form-row select {
    background: #2a2a2a; border: 1px solid #3a3a3a; color: #e0e0e0;
    padding: 6px 10px; border-radius: 4px; font-size: 13px; flex: 1; max-width: 320px;
  }
  .slack-form-row input:focus, .slack-form-row select:focus { border-color: #8b8bff; outline: none; }
  .slack-actions { display: flex; gap: 8px; margin-top: 4px; }
  .slack-btn {
    background: #2a2a3e; border: 1px solid #3a3a4e; color: #ccc;
    padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 12px;
  }
  .slack-btn:hover { background: #3a3a4e; color: #fff; }
  .slack-btn-primary { background: #4338ca; border-color: #5b52e0; color: #fff; }
  .slack-btn-primary:hover { background: #5b52e0; }
  .slack-status-line { font-size: 13px; color: #aaa; }
  .slack-status-line a { color: #8b8bff; text-decoration: none; }
  .slack-status-line a:hover { text-decoration: underline; }
  .slack-warning { color: #fbbf24; font-size: 13px; padding: 12px 0; }
  .slack-last-notif { font-size: 12px; color: #666; margin-top: 8px; }
  .slack-msg { font-size: 12px; margin-top: 8px; padding: 6px 10px; border-radius: 4px; }
  .slack-msg-success { background: #16a34a22; color: #4ade80; }
  .slack-msg-error { background: #dc262622; color: #f87171; }
  .collab-card {
    background: #222;
    border: 1px solid #2a2a2a;
    border-radius: 6px;
    padding: 10px 14px;
    margin-bottom: 8px;
  }
  .collab-card:last-child { margin-bottom: 0; }
  .collab-card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
  }
  .collab-users { font-size: 13px; font-weight: 600; }
  .collab-status {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
  }
  .collab-status-pending { background: #eab30833; color: #fbbf24; }
  .collab-status-accepted { background: #16a34a33; color: #4ade80; }
  .collab-status-declined { background: #dc262633; color: #f87171; }
  .collab-status-expired { background: #4b556333; color: #9ca3af; }
  .collab-card-body {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #aaa;
  }
  .collab-files {
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .collab-meta { display: flex; align-items: center; gap: 6px; }
  .collab-join-btn {
    background: #4338ca;
    border: none;
    color: #fff;
    padding: 4px 12px;
    border-radius: 4px;
    font-size: 12px;
    text-decoration: none;
    cursor: pointer;
    margin-left: auto;
  }
  .collab-join-btn:hover { background: #5b52e0; }
  .live-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
    background: #16a34a33;
    color: #4ade80;
    animation: pulse-live 2s ease-in-out infinite;
  }
  .live-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #4ade80;
  }
  @keyframes pulse-live {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }
  .waiting-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
    background: #eab30822;
    color: #fbbf24;
  }
  .pairing-icon {
    font-size: 11px;
    margin-left: 2px;
  }
  .recommended-actions {
    margin-top: 16px;
    background: #1a1a2e;
    border: 1px solid #3a3a5e;
    border-radius: 8px;
    padding: 12px 16px;
    border-left: 3px solid #eab308;
  }
  .recommended-actions-header {
    font-size: 13px;
    font-weight: 600;
    color: #fbbf24;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .action-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 6px 0;
    font-size: 13px;
    color: #ccc;
  }
  .action-item .action-icon { font-size: 14px; flex-shrink: 0; }
  .action-item code {
    background: #2a2a3e;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 12px;
    color: #8b8bff;
  }
</style>`;
}


// ---------------------------------------------------------------------------
// Client-Side JavaScript
// ---------------------------------------------------------------------------

function buildScript(repo: string, apiBase: string, githubBase: string, repoShort: string): string {
  return `<script>
(function() {
  const REPO = ${JSON.stringify(repo)};
  const API_BASE = ${JSON.stringify(apiBase)};
  const GITHUB_BASE = ${JSON.stringify(githubBase)};
  const GITHUB_HISTORY_URL = ${JSON.stringify(`/api/github/history/${repoShort}`)};
  const GITHUB_PRS_URL = ${JSON.stringify(`/api/github/prs/${repoShort}`)};
  const FRESHNESS_COLORS = ${JSON.stringify(DEFAULT_FRESHNESS_COLORS)};
  const FRESHNESS_INTERVAL = ${DEFAULT_FRESHNESS_INTERVAL_MINUTES};

  // -----------------------------------------------------------------------
  // State
  // -----------------------------------------------------------------------
  let summary = null;
  let activeNotifications = [];
  let resolvedNotifications = [];
  let queryLogEntries = [];
  let historyEntries = [];
  let prEntries = [];
  let collabRequests = [];
  let notifTab = "active"; // "active" | "history"
  let notifSort = { col: 0, asc: false };
  let logSort = { col: 0, asc: false };
  let notifFilters = { type: "", state: "", user: "" };
  let logFilters = { user: "", queryType: "" };

  // -----------------------------------------------------------------------
  // Data Fetching
  // -----------------------------------------------------------------------
  async function fetchSummary() {
    try {
      const res = await fetch(API_BASE);
      if (res.ok) summary = await res.json();
    } catch (e) { /* SSE will update */ }
    renderSummary();
  }

  async function fetchNotifications() {
    try {
      const [activeRes, resolvedRes] = await Promise.all([
        fetch(API_BASE + "/notifications?status=active"),
        fetch(API_BASE + "/notifications?status=resolved"),
      ]);
      if (activeRes.ok) {
        const data = await activeRes.json();
        activeNotifications = data.notifications || [];
      }
      if (resolvedRes.ok) {
        const data = await resolvedRes.json();
        resolvedNotifications = data.notifications || [];
      }
    } catch (e) { /* SSE will update */ }
    renderNotifications();
  }

  async function fetchQueryLog() {
    try {
      const res = await fetch(API_BASE + "/log");
      if (res.ok) {
        const data = await res.json();
        queryLogEntries = data.entries || [];
      }
    } catch (e) { /* SSE will update */ }
    renderQueryLog();
  }

  async function fetchHistory() {
    try {
      const res = await fetch(GITHUB_HISTORY_URL);
      if (res.ok) {
        const data = await res.json();
        historyEntries = data.history || [];
      }
    } catch (e) { /* SSE will update */ }
    renderHistory();
  }

  async function fetchPRs() {
    try {
      const res = await fetch(GITHUB_PRS_URL);
      if (res.ok) {
        const data = await res.json();
        prEntries = data.prs || [];
      }
    } catch (e) { /* SSE will update */ }
    renderPRs();
  }

  async function fetchCollabRequests() {
    try {
      const res = await fetch(API_BASE + "/collab-requests");
      if (res.ok) {
        const data = await res.json();
        collabRequests = data.requests || [];
      }
    } catch (e) { /* SSE will update */ }
    renderCollabRequests();
  }

  // -----------------------------------------------------------------------
  // SSE Connection
  // -----------------------------------------------------------------------
  let sse = null;
  let sseRetryDelay = 1000;
  const SSE_MAX_DELAY = 30000;

  function connectSSE() {
    sse = new EventSource(API_BASE + "/events");
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
      case "session_change":
        summary = evt.data;
        renderSummary();
        break;
      case "notification_added":
        activeNotifications.unshift(evt.data);
        renderNotifications();
        break;
      case "notification_resolved":
        var idx = activeNotifications.findIndex(function(n) { return n.id === evt.data.id; });
        if (idx >= 0) {
          var moved = activeNotifications.splice(idx, 1)[0];
          moved.resolved = true;
          resolvedNotifications.unshift(moved);
        }
        renderNotifications();
        break;
      case "query_logged":
        queryLogEntries.unshift(evt.data);
        renderQueryLog();
        break;
      case "github_pr_change":
        fetchPRs();
        fetchHistory();
        break;
      case "github_commit_change":
        fetchHistory();
        break;
      case "slack_config_change":
        if (evt.data) {
          slackConfig = Object.assign(slackConfig || {}, { channel: evt.data.channel, verbosity: evt.data.verbosity, enabled: true });
          renderSlackPanel();
          showSlackMsg("Slack config updated by " + (evt.data.changedBy || "another user") + ".", "success");
        }
        break;
      case "collab_request_update":
        if (evt.data) {
          var crIdx = collabRequests.findIndex(function(r) { return r.requestId === evt.data.requestId; });
          if (crIdx >= 0) {
            collabRequests[crIdx] = evt.data;
          } else {
            collabRequests.unshift(evt.data);
          }
          renderCollabRequests();
        }
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
  // Resolve
  // -----------------------------------------------------------------------
  window.resolveNotification = async function(id) {
    if (!confirm("Resolve this notification?")) return;
    try {
      const res = await fetch(API_BASE + "/notifications/" + id + "/resolve", { method: "POST" });
      if (res.ok) {
        var idx = activeNotifications.findIndex(function(n) { return n.id === id; });
        if (idx >= 0) {
          var moved = activeNotifications.splice(idx, 1)[0];
          moved.resolved = true;
          resolvedNotifications.unshift(moved);
        }
        renderNotifications();
      }
    } catch (e) {}
  };

  // -----------------------------------------------------------------------
  // Collapse/Expand
  // -----------------------------------------------------------------------
  window.togglePanel = function(panelId) {
    var panel = document.getElementById(panelId);
    if (panel) panel.classList.toggle("collapsed");
  };

  // -----------------------------------------------------------------------
  // Render: Summary
  // -----------------------------------------------------------------------
  function renderSummary() {
    var el = document.getElementById("summary-section");
    if (!summary) {
      el.innerHTML = '<div class="panel"><div class="panel-header"><h2>Repository Summary</h2><span class="health-status health-healthy">🟢 Healthy</span></div><div class="panel-body"><div class="empty-state">No active sessions</div></div></div>';
      return;
    }
    var s = summary;
    var statusClass = "health-" + s.healthStatus;
    var statusEmoji = s.healthStatus === "alerting" ? "🔴" : s.healthStatus === "warning" ? "🟡" : "🟢";
    var statusLabel = s.healthStatus.charAt(0).toUpperCase() + s.healthStatus.slice(1);

    var usersHtml = s.users.map(function(u) {
      var level = computeFreshness(u.lastHeartbeat);
      var color = FRESHNESS_COLORS[level - 1] || FRESHNESS_COLORS[9];
      var mins = Math.floor((Date.now() - new Date(u.lastHeartbeat).getTime()) / 60000);
      var ago = mins < 1 ? "now" : mins + "m ago";
      var pillClass = "user-pill" + (u.hasConnected === false ? " not-connected" : "");
      var tooltip = u.hasConnected === false ? '<span class="tooltip">User is not using Konductor</span>' : "";
      // Pairing icon for users in active collab requests (Requirements 1.3, 1.4)
      var isPairing = collabRequests.some(function(r) {
        return (r.status === "link_shared" || r.status === "accepted") && (r.initiator === u.userId || r.recipient === u.userId);
      });
      var pairingHtml = isPairing ? '<span class="pairing-icon" title="In Live Share session">🤝</span>' : "";
      return '<span class="' + pillClass + '" style="background:' + color + '"><a href="https://github.com/' + esc(u.userId) + '">' + esc(u.userId) + '</a><span class="ago">' + ago + '</span>' + pairingHtml + tooltip + '</span>';
    }).join(" ");

    var branchesHtml = s.branches.map(function(b) {
      return '<li class="branch-tag"><a href="' + esc(b.githubUrl) + '">' + esc(b.name) + '</a></li>';
    }).join("");

    // Recommended Actions (Requirements 2.1, 2.2, 2.3, 2.4)
    var recommendedActionsHtml = "";
    if (s.healthStatus === "warning" || s.healthStatus === "alerting") {
      // Extract overlapping user name from summary data
      var overlappingUser = "";
      if (s.users && s.users.length > 1) {
        overlappingUser = s.users.find(function(u) { return u.userId !== (window._konductorUser || ""); })?.userId || s.users[0].userId;
      }
      var liveShareCmd = overlappingUser ? "konductor, live share with " + overlappingUser : "konductor, live share with &lt;user&gt;";
      recommendedActionsHtml = '<div class="recommended-actions">' +
        '<div class="recommended-actions-header">🛠️ Recommended Actions</div>' +
        '<div class="action-item"><span class="action-icon">🤝</span><span>Start a Live Share session — say <code>' + liveShareCmd + '</code> in your IDE</span></div>' +
        '<div class="action-item"><span class="action-icon">💬</span><span>Get coordination advice — say <code>konductor, who should I coordinate with?</code></span></div>' +
        '<div class="action-item"><span class="action-icon">📊</span><span>Check risk level — say <code>konductor, am I safe to push?</code></span></div>' +
      '</div>';
    }

    el.innerHTML = '<div class="panel"><div class="panel-header"><h2>Repository Summary</h2><span class="health-status ' + statusClass + '">' + statusEmoji + ' ' + statusLabel + '</span></div><div class="panel-body"><div class="summary-grid">' +
      '<div class="summary-item"><label>Repository</label><div class="value"><a href="' + esc(s.githubUrl) + '">' + esc(s.repo) + '</a></div></div>' +
      '<div class="summary-item"><label>Active Sessions</label><div class="value">' + s.sessionCount + ' sessions · ' + s.userCount + ' users</div></div>' +
      '<div class="summary-item" style="grid-column:1/-1"><label>Active Users</label><div style="display:flex;flex-wrap:wrap;gap:6px">' + (usersHtml || '<span class="empty-state">No active users</span>') + '</div></div>' +
      '<div class="summary-item" style="grid-column:1/-1"><label>Active Branches</label><ul class="branch-list">' + (branchesHtml || '<span class="empty-state">No active branches</span>') + '</ul></div>' +
      '</div>' + recommendedActionsHtml + '</div></div>';
  }

  function computeFreshness(lastHeartbeat) {
    var elapsed = Math.max(0, (Date.now() - new Date(lastHeartbeat).getTime()) / 60000);
    var level = Math.floor(elapsed / FRESHNESS_INTERVAL) + 1;
    return Math.min(level, 10);
  }

  function esc(str) {
    var d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  // -----------------------------------------------------------------------
  // Render: Notifications
  // -----------------------------------------------------------------------
  function renderNotifications() {
    var el = document.getElementById("notifications-section");
    var list = notifTab === "active" ? activeNotifications : resolvedNotifications;
    var activeCount = activeNotifications.length;
    var resolvedCount = resolvedNotifications.length;

    // Apply filters
    var filtered = list.filter(function(n) {
      if (notifFilters.type && n.notificationType !== notifFilters.type) return false;
      if (notifFilters.state && n.collisionState !== notifFilters.state) return false;
      if (notifFilters.user) {
        var u = notifFilters.user.toLowerCase();
        var match = n.users.some(function(nu) { return nu.userId.toLowerCase().includes(u); });
        if (!match) return false;
      }
      return true;
    });

    // Sort
    filtered = sortRows(filtered, notifSort, ["timestamp", "notificationType", "collisionState", "branch", "jiras", "summary", "users"]);

    var countBadgeClass = activeCount > 0 ? "count-badge count-badge-alert" : "count-badge";
    var headerHtml = '<div class="panel-header collapsible" onclick="togglePanel(\\'notifications-panel\\')">' +
      '<h2><span class="collapse-icon">▼</span> Notifications &amp; Alerts <span class="' + countBadgeClass + '">' + activeCount + ' active</span></h2>' +
      '<div class="panel-header-right"><div class="tab-controls" onclick="event.stopPropagation()">' +
      '<button class="tab-btn' + (notifTab === "active" ? " active" : "") + '" onclick="setNotifTab(\\'active\\')">Active (' + activeCount + ')</button>' +
      '<button class="tab-btn' + (notifTab === "history" ? " active" : "") + '" onclick="setNotifTab(\\'history\\')">History (' + resolvedCount + ')</button>' +
      '</div></div></div>';

    var filterHtml = '<div class="filter-bar">' +
      '<label>Filter:</label>' +
      '<select onchange="setNotifFilter(\\'type\\',this.value)"><option value="">All Types</option><option value="alerting"' + (notifFilters.type === "alerting" ? " selected" : "") + '>Alerting</option><option value="warning"' + (notifFilters.type === "warning" ? " selected" : "") + '>Warning</option><option value="healthy"' + (notifFilters.type === "healthy" ? " selected" : "") + '>Healthy</option></select>' +
      '<select onchange="setNotifFilter(\\'state\\',this.value)"><option value="">All States</option><option value="merge_hell"' + (notifFilters.state === "merge_hell" ? " selected" : "") + '>Merge Hell</option><option value="collision_course"' + (notifFilters.state === "collision_course" ? " selected" : "") + '>Collision Course</option><option value="crossroads"' + (notifFilters.state === "crossroads" ? " selected" : "") + '>Crossroads</option><option value="neighbors"' + (notifFilters.state === "neighbors" ? " selected" : "") + '>Neighbors</option><option value="solo"' + (notifFilters.state === "solo" ? " selected" : "") + '>Solo</option></select>' +
      '<input type="text" placeholder="Filter by user..." value="' + esc(notifFilters.user) + '" oninput="setNotifFilter(\\'user\\',this.value)">' +
      '<button class="reset-btn" onclick="resetNotifFilters()">Reset</button>' +
      '</div>';

    var cols = ["Timestamp", "Type", "State", "Branch", "JIRAs", "Summary", "Users", ""];
    var theadHtml = '<tr>' + cols.map(function(c, i) {
      var arrow = notifSort.col === i ? (notifSort.asc ? " ▲" : " ▼") : "";
      var onclick = c ? ' onclick="sortNotif(' + i + ')"' : "";
      return "<th" + onclick + ">" + c + (arrow ? '<span class="sort-arrow">' + arrow + '</span>' : "") + "</th>";
    }).join("") + '</tr>';

    var rowsHtml = "";
    if (filtered.length === 0) {
      rowsHtml = '<tr><td colspan="8" class="empty-state">' + (notifTab === "active" ? "No notifications yet" : "No resolved notifications") + '</td></tr>';
    } else {
      filtered.forEach(function(n) {
        var branches = n.users.map(function(u) { return u.branch; }).filter(function(v, i, a) { return a.indexOf(v) === i; });
        var branchLinks = branches.map(function(b) { return '<a class="branch-link" href="' + GITHUB_BASE + '/tree/' + esc(b) + '">' + esc(b) + '</a>'; }).join(", ");
        var typeLower = n.notificationType;
        var typeLabel = typeLower.charAt(0).toUpperCase() + typeLower.slice(1);
        var stateDisplay = n.collisionState.replace(/_/g, " ").replace(/\\b\\w/g, function(c) { return c.toUpperCase(); });
        var jirasDisplay = n.jiras && n.jiras.length > 0 ? n.jiras.map(esc).join(", ") : "unknown";
        var summaryText = esc(n.summary);
        var summaryHtml = n.summary.length > 120
          ? '<div class="summary-text">' + summaryText + '</div><button class="see-more" onclick="this.previousElementSibling.style.webkitLineClamp=\\'unset\\';this.previousElementSibling.style.overflow=\\'visible\\';this.remove();">see more…</button>'
          : '<div>' + summaryText + '</div>';
        var userLinks = n.users.map(function(u) { return '<a class="user-link" href="https://github.com/' + esc(u.userId) + '">' + esc(u.userId) + '</a>'; }).join(", ");
        var resolveBtn = n.resolved
          ? '<span class="resolved-label">Resolved</span>'
          : '<button class="resolve-btn" onclick="resolveNotification(\\'' + esc(n.id) + '\\')">✓ Resolve</button>';
        rowsHtml += '<tr class="notif-row-' + typeLower + '"><td style="white-space:nowrap">' + esc(fmtTs(n.timestamp)) + '</td><td><span class="badge badge-' + typeLower + '">' + esc(typeLabel) + '</span></td><td><span class="state-badge">' + esc(stateDisplay) + '</span></td><td>' + branchLinks + '</td><td>' + jirasDisplay + '</td><td>' + summaryHtml + '</td><td>' + userLinks + '</td><td>' + resolveBtn + '</td></tr>';
      });
    }

    el.innerHTML = '<div class="panel" id="notifications-panel">' + headerHtml +
      '<div class="panel-content">' + filterHtml +
      '<div class="table-wrapper"><table><thead>' + theadHtml + '</thead><tbody>' + rowsHtml + '</tbody></table></div></div></div>';
  }

  window.setNotifTab = function(tab) { notifTab = tab; renderNotifications(); };
  window.setNotifFilter = function(key, val) { notifFilters[key] = val; renderNotifications(); };
  window.resetNotifFilters = function() { notifFilters = { type: "", state: "", user: "" }; renderNotifications(); };
  window.sortNotif = function(col) {
    if (notifSort.col === col) notifSort.asc = !notifSort.asc;
    else { notifSort.col = col; notifSort.asc = true; }
    renderNotifications();
  };

  // -----------------------------------------------------------------------
  // Render: Query Log
  // -----------------------------------------------------------------------
  function renderQueryLog() {
    var el = document.getElementById("querylog-section");
    var entryCount = queryLogEntries.length;

    // Apply filters
    var filtered = queryLogEntries.filter(function(e) {
      if (logFilters.user) {
        if (!e.userId.toLowerCase().includes(logFilters.user.toLowerCase())) return false;
      }
      if (logFilters.queryType && e.queryType !== logFilters.queryType) return false;
      return true;
    });

    // Sort
    filtered = sortRows(filtered, logSort, ["timestamp", "userId", "branch", "queryType", "parameters"]);

    var headerHtml = '<div class="panel-header collapsible" onclick="togglePanel(\\'querylog-panel\\')">' +
      '<h2><span class="collapse-icon">▼</span> Query Log <span class="count-badge">' + entryCount + ' entries</span></h2></div>';

    var filterHtml = '<div class="filter-bar">' +
      '<label>Filter:</label>' +
      '<input type="text" placeholder="Filter by user..." value="' + esc(logFilters.user) + '" oninput="setLogFilter(\\'user\\',this.value)">' +
      '<select onchange="setLogFilter(\\'queryType\\',this.value)"><option value="">All Query Types</option>' +
      ["who_is_active","who_overlaps","risk_assessment","repo_hotspots","active_branches","coordination_advice"].map(function(qt) {
        return '<option value="' + qt + '"' + (logFilters.queryType === qt ? " selected" : "") + '>' + qt + '</option>';
      }).join("") +
      '</select>' +
      '<button class="reset-btn" onclick="resetLogFilters()">Reset</button>' +
      '</div>';

    var cols = ["Timestamp", "User", "Branch", "Query Type", "Parameters"];
    var theadHtml = '<tr>' + cols.map(function(c, i) {
      var arrow = logSort.col === i ? (logSort.asc ? " ▲" : " ▼") : "";
      return '<th onclick="sortLog(' + i + ')">' + c + (arrow ? '<span class="sort-arrow">' + arrow + '</span>' : "") + '</th>';
    }).join("") + '</tr>';

    var rowsHtml = "";
    if (filtered.length === 0) {
      rowsHtml = '<tr><td colspan="5" class="empty-state">No queries logged</td></tr>';
    } else {
      filtered.forEach(function(e) {
        var params = Object.entries(e.parameters || {}).map(function(kv) { return kv[0] + "=" + kv[1]; }).join(", ");
        rowsHtml += '<tr><td style="white-space:nowrap">' + esc(fmtTs(e.timestamp)) + '</td>' +
          '<td><a class="user-link" href="https://github.com/' + esc(e.userId) + '">' + esc(e.userId) + '</a></td>' +
          '<td><a class="branch-link" href="' + GITHUB_BASE + '/tree/' + esc(e.branch) + '">' + esc(e.branch) + '</a></td>' +
          '<td><span class="query-badge">' + esc(e.queryType) + '</span></td>' +
          '<td class="params">' + esc(params) + '</td></tr>';
      });
    }

    el.innerHTML = '<div class="panel" id="querylog-panel">' + headerHtml +
      '<div class="panel-content">' + filterHtml +
      '<div class="table-wrapper"><table><thead>' + theadHtml + '</thead><tbody>' + rowsHtml + '</tbody></table></div></div></div>';
  }

  window.setLogFilter = function(key, val) { logFilters[key] = val; renderQueryLog(); };
  window.resetLogFilters = function() { logFilters = { user: "", queryType: "" }; renderQueryLog(); };
  window.sortLog = function(col) {
    if (logSort.col === col) logSort.asc = !logSort.asc;
    else { logSort.col = col; logSort.asc = true; }
    renderQueryLog();
  };

  // -----------------------------------------------------------------------
  // Render: Repo History
  // -----------------------------------------------------------------------
  function renderHistory() {
    var body = document.getElementById("history-body");
    var countEl = document.getElementById("history-count");
    if (!body) return;

    if (countEl) countEl.textContent = historyEntries.length + " entries";

    if (historyEntries.length === 0) {
      body.innerHTML = '<tr><td colspan="5" class="empty-state">No GitHub activity</td></tr>';
      return;
    }

    var rowsHtml = "";
    historyEntries.forEach(function(e) {
      var actionClass = e.action.indexOf("Approved") >= 0 ? "badge-alerting"
        : e.action.indexOf("PR") >= 0 ? "badge-warning"
        : "badge-healthy";
      rowsHtml += '<tr>' +
        '<td style="white-space:nowrap">' + esc(fmtTs(e.timestamp)) + '</td>' +
        '<td><span class="badge ' + actionClass + '">' + esc(e.action) + '</span></td>' +
        '<td><a class="user-link" href="https://github.com/' + esc(e.user) + '">' + esc(e.user) + '</a></td>' +
        '<td><a class="branch-link" href="' + GITHUB_BASE + '/tree/' + esc(e.branch) + '">' + esc(e.branch) + '</a></td>' +
        '<td>' + esc(e.summary) + '</td>' +
        '</tr>';
    });
    body.innerHTML = rowsHtml;
  }

  // -----------------------------------------------------------------------
  // Render: Open PRs
  // -----------------------------------------------------------------------
  function renderPRs() {
    var body = document.getElementById("prs-body");
    var countEl = document.getElementById("prs-count");
    if (!body) return;

    if (countEl) countEl.textContent = prEntries.length + " PRs";

    if (prEntries.length === 0) {
      body.innerHTML = '<tr><td colspan="6" class="empty-state">No open PRs</td></tr>';
      return;
    }

    var rowsHtml = "";
    prEntries.forEach(function(e) {
      var statusClass = e.status === "approved" ? "badge-alerting"
        : e.status === "draft" ? "badge-healthy"
        : "badge-warning";
      var statusLabel = e.status.charAt(0).toUpperCase() + e.status.slice(1);
      var hoursDisplay = e.hoursOpen < 1 ? "<1h" : Math.round(e.hoursOpen) + "h";
      rowsHtml += '<tr>' +
        '<td style="white-space:nowrap">' + esc(hoursDisplay) + '</td>' +
        '<td><a class="branch-link" href="' + GITHUB_BASE + '/tree/' + esc(e.branch) + '">' + esc(e.branch) + '</a> → ' + esc(e.targetBranch) + '</td>' +
        '<td><a class="user-link" href="' + esc(e.prUrl) + '">#' + e.prNumber + '</a></td>' +
        '<td><a class="user-link" href="https://github.com/' + esc(e.user) + '">' + esc(e.user) + '</a></td>' +
        '<td><span class="badge ' + statusClass + '">' + esc(statusLabel) + '</span></td>' +
        '<td>' + e.filesCount + '</td>' +
        '</tr>';
    });
    body.innerHTML = rowsHtml;
  }

  // -----------------------------------------------------------------------
  // Render: Collaboration Requests (Requirement 7.1–7.5)
  // -----------------------------------------------------------------------
  function renderCollabRequests() {
    var body = document.getElementById("collab-panel-body");
    var countEl = document.getElementById("collab-count");
    if (!body) return;

    if (countEl) countEl.textContent = collabRequests.length + " requests";

    if (collabRequests.length === 0) {
      body.innerHTML = '<div class="empty-state">No active collaboration requests.</div>';
      return;
    }

    var cardsHtml = "";
    collabRequests.forEach(function(r) {
      var statusClass = (r.status === "accepted" || r.status === "link_shared") ? "collab-status-accepted"
        : r.status === "declined" ? "collab-status-declined"
        : r.status === "expired" ? "collab-status-expired"
        : "collab-status-pending";
      var stateDisplay = (r.collisionState || "").replace(/_/g, " ").replace(/\\b\\w/g, function(c) { return c.toUpperCase(); });
      var filesDisplay = (r.files || []).map(esc).join(", ");
      var age = fmtAge(r.createdAt);
      var shareLinkHtml = r.shareLink
        ? ' <a class="collab-join-btn" href="' + esc(r.shareLink) + '" target="_blank">Join Session</a>'
        : "";

      // Live session indicators (Requirements 1.1, 1.2)
      var isLive = r.status === "link_shared";
      var isWaiting = r.status === "accepted";
      var statusBadgeHtml;
      if (isLive) {
        statusBadgeHtml = '<span class="live-badge"><span class="live-dot"></span> Live</span>';
      } else if (isWaiting) {
        statusBadgeHtml = '<span class="waiting-badge">⏳ Waiting for Link</span>';
      } else {
        var statusLabel = r.status.charAt(0).toUpperCase() + r.status.slice(1);
        statusBadgeHtml = '<span class="collab-status ' + statusClass + '">' + esc(statusLabel) + '</span>';
      }

      var cardBorderStyle = isLive ? ' style="border-left: 3px solid #16a34a;"' : "";

      cardsHtml += '<div class="collab-card"' + cardBorderStyle + ' data-request-id="' + esc(r.requestId) + '">' +
        '<div class="collab-card-header">' +
          '<span class="collab-users"><a class="user-link" href="https://github.com/' + esc(r.initiator) + '">' + esc(r.initiator) + '</a> → <a class="user-link" href="https://github.com/' + esc(r.recipient) + '">' + esc(r.recipient) + '</a></span>' +
          statusBadgeHtml +
        '</div>' +
        '<div class="collab-card-body">' +
          '<span class="collab-files" title="' + esc(filesDisplay) + '">📂 ' + esc(filesDisplay) + '</span>' +
          '<span class="collab-meta"><span class="state-badge">' + esc(stateDisplay) + '</span> · ' + esc(age) + '</span>' + shareLinkHtml +
        '</div>' +
      '</div>';
    });
    body.innerHTML = cardsHtml;
  }

  function fmtAge(iso) {
    try {
      var ms = Date.now() - new Date(iso).getTime();
      var minutes = Math.floor(ms / 60000);
      if (minutes < 1) return "just now";
      if (minutes < 60) return minutes + "m ago";
      var hours = Math.floor(minutes / 60);
      if (hours < 24) return hours + "h ago";
      var days = Math.floor(hours / 24);
      return days + "d ago";
    } catch(e) { return "unknown"; }
  }

  // -----------------------------------------------------------------------
  // Utilities
  // -----------------------------------------------------------------------
  function fmtTs(iso) {
    try {
      var d = new Date(iso);
      var pad = function(n) { return String(n).padStart(2, "0"); };
      return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
    } catch(e) { return iso; }
  }

  function sortRows(rows, sortState, colKeys) {
    var key = colKeys[sortState.col];
    if (!key) return rows;
    var sorted = rows.slice();
    sorted.sort(function(a, b) {
      var va = getSortValue(a, key);
      var vb = getSortValue(b, key);
      if (va < vb) return sortState.asc ? -1 : 1;
      if (va > vb) return sortState.asc ? 1 : -1;
      return 0;
    });
    return sorted;
  }

  function getSortValue(item, key) {
    if (key === "users") {
      return (item.users || []).map(function(u) { return u.userId; }).join(",");
    }
    if (key === "branch") {
      return (item.users || []).map(function(u) { return u.branch; }).join(",") || item.branch || "";
    }
    if (key === "jiras") {
      return (item.jiras || []).join(",");
    }
    if (key === "parameters") {
      return JSON.stringify(item.parameters || {});
    }
    return item[key] || "";
  }

  // -----------------------------------------------------------------------
  // Slack Integration (Requirement 3.1–3.8)
  // -----------------------------------------------------------------------
  let slackConfig = null;

  async function fetchSlackConfig() {
    try {
      var res = await fetch(API_BASE + "/slack");
      if (res.ok) {
        slackConfig = await res.json();
      } else {
        slackConfig = null;
      }
    } catch (e) {
      slackConfig = null;
    }
    renderSlackPanel();
  }

  function renderSlackPanel() {
    var body = document.getElementById("slack-panel-body");
    var badge = document.getElementById("slack-status-badge");
    if (!body) return;

    if (!slackConfig || !slackConfig.enabled) {
      if (badge) { badge.textContent = "not configured"; }
      body.innerHTML = '<div class="slack-warning">⚠️ Slack integration not configured. Ask your admin to set up Slack credentials in the Admin Dashboard.</div>';
      return;
    }

    if (badge) { badge.textContent = "connected"; }

    var verbosityLabels = [
      "0 - Disabled",
      "1 - Merge Hell only",
      "2 - Collision Course + Merge Hell",
      "3 - Crossroads and above",
      "4 - Neighbors and above",
      "5 - Everything"
    ];

    var verbosityOptions = verbosityLabels.map(function(label, i) {
      var selected = slackConfig.verbosity === i ? " selected" : "";
      return '<option value="' + i + '"' + selected + '>' + esc(label) + '</option>';
    }).join("");

    var channelLink = "https://slack.com/app_redirect?channel=" + encodeURIComponent(slackConfig.channel);

    var lastNotifHtml = "";
    if (slackConfig.lastNotification && slackConfig.lastNotification.state) {
      var ago = fmtTs(slackConfig.lastNotification.timestamp);
      lastNotifHtml = '<div class="slack-last-notif">Last notification: ' + esc(slackConfig.lastNotification.state.replace(/_/g, " ")) + ' — ' + esc(ago) + '</div>';
    }

    body.innerHTML = '<div class="slack-form">' +
      '<div class="slack-status-line">Status: 🟢 Connected <a href="' + esc(channelLink) + '" target="_blank">🔗 Open in Slack</a></div>' +
      '<div class="slack-form-row"><label>Channel</label><input type="text" id="slack-channel-input" value="' + esc(slackConfig.channel) + '" /></div>' +
      '<div class="slack-form-row"><label>Verbosity</label><select id="slack-verbosity-select">' + verbosityOptions + '</select></div>' +
      '<div class="slack-actions">' +
        '<button class="slack-btn slack-btn-primary" onclick="saveSlackConfig()">Save Changes</button>' +
        '<button class="slack-btn" onclick="sendSlackTest()">Send Test Message</button>' +
      '</div>' +
      lastNotifHtml +
      '<div id="slack-msg"></div>' +
    '</div>';
  }

  window.saveSlackConfig = async function() {
    var channel = document.getElementById("slack-channel-input").value.trim();
    var verbosity = parseInt(document.getElementById("slack-verbosity-select").value, 10);
    var msgEl = document.getElementById("slack-msg");

    try {
      var res = await fetch(API_BASE + "/slack", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: channel, verbosity: verbosity })
      });
      if (res.ok) {
        slackConfig = await res.json();
        renderSlackPanel();
        showSlackMsg("Slack settings saved successfully.", "success");
      } else {
        var err = await res.json().catch(function() { return { error: "Unknown error" }; });
        showSlackMsg(err.error || "Failed to save settings.", "error");
      }
    } catch (e) {
      showSlackMsg("Network error saving settings.", "error");
    }
  };

  window.sendSlackTest = async function() {
    try {
      var res = await fetch(API_BASE + "/slack", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel: slackConfig.channel, verbosity: slackConfig.verbosity }) });
      if (res.ok) {
        showSlackMsg("Test message sent to #" + esc(slackConfig.channel), "success");
      } else {
        showSlackMsg("Failed to send test message.", "error");
      }
    } catch (e) {
      showSlackMsg("Network error sending test message.", "error");
    }
  };

  function showSlackMsg(text, type) {
    var el = document.getElementById("slack-msg");
    if (el) {
      el.className = "slack-msg slack-msg-" + type;
      el.textContent = text;
      setTimeout(function() { el.textContent = ""; el.className = ""; }, 5000);
    }
  }

  // -----------------------------------------------------------------------
  // Init
  // -----------------------------------------------------------------------
  fetchSummary();
  fetchNotifications();
  fetchQueryLog();
  fetchPRs();
  fetchHistory();
  fetchCollabRequests();
  fetchSlackConfig();
  connectSSE();
})();
</script>`;
}
