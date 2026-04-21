/**
 * Bundle Manager Page — HTML Generator
 *
 * Generates the `/admin/bundles` page HTML following the mockup at
 * `konductor/konductor/mockups/bundle-manager.html`. Displays channel
 * assignment summary cards, a sortable/filterable bundle table, and
 * real-time SSE updates.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.1, 6.2, 6.3, 6.5, 6.6
 */

import { buildAdminStyles } from "./admin-page-builder.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface BundlePageOptions {
  localStoreMode: boolean;
}

/**
 * Build the full Bundle Manager page HTML.
 */
export function buildBundleManagerPage(opts: BundlePageOptions): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🎼 Konductor — Bundle Manager</title>
${buildAdminStyles()}
${buildBundlePageStyles()}
</head>
<body>
${buildBundleHeader(opts.localStoreMode)}
<div class="connection-bar" id="connection-bar">● Connected — live updates active</div>
<div class="main">
  ${buildChannelSummary()}
  ${buildBundleTableSection(opts.localStoreMode)}
</div>
${buildBundleScript()}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function buildBundleHeader(localStoreMode: boolean): string {
  const badge = localStoreMode
    ? `<span class="header-badge local-store-header-badge">Local Store</span>`
    : "";
  return `<div class="header">
  <span class="logo">🎼</span>
  <h1>Bundle Manager</h1>
  ${badge}
  <span class="header-spacer"></span>
  <a class="back-link" href="/admin">← Back to Admin Dashboard</a>
</div>`;
}

// ---------------------------------------------------------------------------
// Channel Summary Cards
// ---------------------------------------------------------------------------

function buildChannelSummary(): string {
  return `<div class="channel-summary" id="channel-summary">
  <div class="channel-card" id="card-dev">
    <h3>Dev</h3>
    <div class="version none">—</div>
    <div class="meta">Loading…</div>
  </div>
  <div class="channel-card" id="card-uat">
    <h3>UAT</h3>
    <div class="version none">—</div>
    <div class="meta">Loading…</div>
  </div>
  <div class="channel-card" id="card-prod">
    <h3>Prod</h3>
    <div class="version none">—</div>
    <div class="meta">Loading…</div>
  </div>
  <div class="channel-card latest" id="card-latest">
    <h3>Latest</h3>
    <div class="version none">—</div>
    <div class="meta">Loading…</div>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// Bundle Table Section
// ---------------------------------------------------------------------------

function buildBundleTableSection(localStoreMode: boolean): string {
  const badge = localStoreMode
    ? `<div class="local-store-badge">📂 Local Store Mode — bundles loaded from installers/ directory</div>`
    : "";

  return `<div class="section">
  <div class="section-header">
    <h2>Available Bundles</h2>
    <span class="count" id="bundle-count">0 bundles</span>
    <div class="spacer"></div>
    <input type="text" id="bundle-filter" placeholder="Filter by version…" class="filter-input" oninput="filterBundles()">
  </div>
  <div class="section-body">
    ${badge}
    <div class="table-wrapper">
      <table id="bundle-table">
        <thead>
          <tr>
            <th onclick="sortBundles('version')">Version <span class="sort-arrow" id="sort-version"></span></th>
            <th>Channels</th>
            <th onclick="sortBundles('fileSize')">Size <span class="sort-arrow" id="sort-fileSize"></span></th>
            <th onclick="sortBundles('createdAt')">Created <span class="sort-arrow" id="sort-createdAt"></span></th>
            <th>Uploaded</th>
            <th onclick="sortBundles('author')">Author <span class="sort-arrow" id="sort-author"></span></th>
            <th>Notes</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="bundle-body">
          <tr><td colspan="8" class="empty-state">Loading bundles…</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</div>`;
}


// ---------------------------------------------------------------------------
// Bundle Page Styles (supplements buildAdminStyles)
// ---------------------------------------------------------------------------

function buildBundlePageStyles(): string {
  return `<style>
/* Back link */
.back-link { color: #8b8bff; text-decoration: none; font-size: 13px; }
.back-link:hover { text-decoration: underline; }

/* Channel Summary */
.channel-summary {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}
.channel-summary .channel-card {
  background: #1a1a1a;
  border: 1px solid #2a2a2a;
  border-radius: 8px;
  padding: 16px;
}
.channel-summary .channel-card h3 {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #888;
  margin-bottom: 8px;
}
.channel-summary .channel-card .version {
  font-size: 18px;
  font-weight: 600;
  color: #fff;
  font-family: 'SF Mono', Monaco, monospace;
}
.channel-summary .channel-card .version.none { color: #666; font-size: 14px; font-family: inherit; }
.channel-summary .channel-card .meta { font-size: 11px; color: #555; margin-top: 4px; }
.channel-summary .channel-card.latest { border-color: #4fc3f7; }
.channel-summary .channel-card.latest h3 { color: #4fc3f7; }

/* Section */
.section {
  background: #1a1a1a;
  border: 1px solid #2a2a2a;
  border-radius: 8px;
  overflow: hidden;
}
.section-header {
  padding: 12px 16px;
  background: #222;
  border-bottom: 1px solid #2a2a2a;
  display: flex;
  align-items: center;
  gap: 12px;
}
.section-header h2 {
  font-size: 14px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #aaa;
}
.section-header .count {
  background: #2a2a3e;
  color: #888;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
}
.section-header .spacer { flex: 1; }
.section-body { padding: 16px; }
.filter-input {
  padding: 6px 10px;
  background: #2a2a2a;
  border: 1px solid #3a3a3a;
  border-radius: 4px;
  color: #e0e0e0;
  font-size: 12px;
  width: 180px;
}

/* Local store badge */
.local-store-badge {
  display: inline-block;
  background: #f59e0b33;
  color: #fbbf24;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  margin-bottom: 12px;
}
.local-store-header-badge {
  background: #f59e0b33;
  color: #fbbf24;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  margin-left: 8px;
}

/* Bundle table */
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th {
  text-align: left;
  padding: 10px 12px;
  background: #1e1e1e;
  color: #aaa;
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid #2a2a2a;
}
th:hover { color: #fff; }
td {
  padding: 10px 12px;
  border-bottom: 1px solid #1f1f1f;
  vertical-align: middle;
}
tr:hover td { background: #1f1f2f; }

/* Bundle table cells */
.version-cell {
  font-family: 'SF Mono', Monaco, monospace;
  font-weight: 600;
  color: #4ade80;
}
.version-cell .prerelease { color: #f59e0b; }
.channel-pills { display: flex; gap: 4px; flex-wrap: wrap; }
.pill {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
}
.pill-dev { background: #3b82f633; color: #60a5fa; }
.pill-uat { background: #f59e0b33; color: #fbbf24; }
.pill-prod { background: #16a34a33; color: #4ade80; }
.pill-latest { background: #4fc3f733; color: #4fc3f7; }
.size-cell { color: #888; font-size: 12px; }
.date-cell { color: #888; font-size: 12px; }
.author-cell { color: #ccc; }
.notes-cell { color: #888; font-size: 12px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.actions-cell { display: flex; gap: 6px; }

/* Bundle table danger button (matches mockup) */
.actions-cell .btn-danger {
  background: #dc262633;
  color: #f87171;
  border: 1px solid #dc262666;
}
.actions-cell .btn-danger:hover { background: #dc262655; }

/* Delete confirmation dialog */
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.dialog-box {
  background: #1a1a2e;
  border: 1px solid #2a2a3e;
  border-radius: 8px;
  padding: 24px;
  max-width: 440px;
  width: 90%;
}
.dialog-box h3 { font-size: 16px; color: #fff; margin-bottom: 12px; }
.dialog-box p { font-size: 13px; color: #ccc; margin-bottom: 16px; line-height: 1.5; }
.dialog-box .warning { color: #f59e0b; font-weight: 600; }
.dialog-actions { display: flex; gap: 12px; justify-content: flex-end; }
.dialog-actions .btn-cancel {
  padding: 8px 16px;
  border: 1px solid #3a3a3a;
  border-radius: 4px;
  background: transparent;
  color: #aaa;
  font-size: 13px;
  cursor: pointer;
}
.dialog-actions .btn-cancel:hover { background: #2a2a2a; }

/* Connection bar */
.connection-bar {
  padding: 6px 16px;
  font-size: 11px;
  font-weight: 600;
  color: #4ade80;
  background: #0a2e0a;
  border-bottom: 1px solid #1a3a1a;
}
.connection-bar.disconnected {
  color: #f87171;
  background: #2e0a0a;
  border-bottom-color: #3a1a1a;
}

@media (max-width: 768px) {
  .channel-summary { grid-template-columns: 1fr 1fr; }
}
</style>`;
}


// ---------------------------------------------------------------------------
// Client-Side JavaScript
// ---------------------------------------------------------------------------

function buildBundleScript(): string {
  return `<script>
(function() {
  // State
  let bundles = [];
  let channels = {};
  let sortCol = "version";
  let sortAsc = false; // newest first by default
  let filterText = "";

  // SSE Connection
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
      case "bundle_change":
      case "admin_channel_change":
      case "channel_assign":
        fetchBundles();
        fetchChannels();
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

  // Fetch data
  async function fetchBundles() {
    try {
      const res = await fetch("/api/admin/bundles");
      if (res.ok) {
        const data = await res.json();
        bundles = data.bundles || [];
        renderBundles();
      }
    } catch (e) {}
  }

  async function fetchChannels() {
    try {
      const res = await fetch("/api/admin/channels");
      if (res.ok) {
        const data = await res.json();
        channels = data.channels || {};
        renderChannelSummary();
      }
    } catch (e) {}
  }

  // Render: Channel Summary
  function renderChannelSummary() {
    var channelNames = ["dev", "uat", "prod"];
    channelNames.forEach(function(ch) {
      var card = document.getElementById("card-" + ch);
      if (!card) return;
      var meta = channels[ch];
      var versionEl = card.querySelector(".version");
      var metaEl = card.querySelector(".meta");
      if (meta && meta.version) {
        versionEl.textContent = meta.version;
        versionEl.className = "version";
        metaEl.textContent = meta.uploadTimestamp ? "Assigned " + fmtRelative(meta.uploadTimestamp) : "";
      } else {
        versionEl.textContent = "Not assigned";
        versionEl.className = "version none";
        metaEl.textContent = "";
      }
    });

    // Latest card
    var latestCard = document.getElementById("card-latest");
    if (latestCard) {
      var latestVersion = getLatestVersion();
      var versionEl = latestCard.querySelector(".version");
      var metaEl = latestCard.querySelector(".meta");
      if (latestVersion) {
        versionEl.textContent = latestVersion.version;
        versionEl.className = "version";
        metaEl.textContent = "Most recently created";
      } else {
        versionEl.textContent = "No bundles";
        versionEl.className = "version none";
        metaEl.textContent = "";
      }
    }
  }

  function getLatestVersion() {
    if (!bundles.length) return null;
    var sorted = bundles.slice().sort(function(a, b) {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return sorted[0];
  }

  // Render: Bundle Table
  function renderBundles() {
    var body = document.getElementById("bundle-body");
    var countEl = document.getElementById("bundle-count");

    // Filter
    var filtered = bundles;
    if (filterText) {
      var ft = filterText.toLowerCase();
      filtered = bundles.filter(function(b) {
        return b.version.toLowerCase().indexOf(ft) !== -1;
      });
    }

    // Sort
    filtered = filtered.slice().sort(function(a, b) {
      var va, vb;
      if (sortCol === "version") {
        // Use semver comparison via index position (bundles come pre-sorted from API)
        va = bundles.indexOf(a);
        vb = bundles.indexOf(b);
      } else if (sortCol === "fileSize") {
        va = a.size || 0;
        vb = b.size || 0;
      } else if (sortCol === "createdAt") {
        va = a.createdAt || "";
        vb = b.createdAt || "";
      } else if (sortCol === "author") {
        va = (a.author || "").toLowerCase();
        vb = (b.author || "").toLowerCase();
      } else {
        va = a[sortCol] || "";
        vb = b[sortCol] || "";
      }
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });

    if (countEl) countEl.textContent = bundles.length + " bundle" + (bundles.length !== 1 ? "s" : "");

    // Update sort arrows
    ["version", "fileSize", "createdAt", "author"].forEach(function(col) {
      var arrow = document.getElementById("sort-" + col);
      if (arrow) arrow.textContent = sortCol === col ? (sortAsc ? "▲" : "▼") : "";
    });

    if (filtered.length === 0) {
      body.innerHTML = '<tr><td colspan="8" class="empty-state">No bundles found</td></tr>';
      return;
    }

    var latestBundle = getLatestVersion();
    var html = "";
    filtered.forEach(function(b) {
      var versionHtml = formatVersion(b.version);
      var pillsHtml = formatChannelPills(b, latestBundle);
      var sizeHtml = formatSize(b.size);
      var createdHtml = b.createdAt ? fmtTs(b.createdAt) : "—";
      var uploadedHtml = "n/a (local)";
      var authorHtml = b.author && b.author !== "unknown" ? esc(b.author) : "—";
      var notesHtml = b.summary ? esc(b.summary) : "—";

      html += '<tr>' +
        '<td class="version-cell">' + versionHtml + '</td>' +
        '<td><div class="channel-pills">' + pillsHtml + '</div></td>' +
        '<td class="size-cell">' + sizeHtml + '</td>' +
        '<td class="date-cell">' + esc(createdHtml) + '</td>' +
        '<td class="date-cell">' + uploadedHtml + '</td>' +
        '<td class="author-cell">' + authorHtml + '</td>' +
        '<td class="notes-cell" title="' + esc(b.summary || "") + '">' + notesHtml + '</td>' +
        '<td><div class="actions-cell"><button class="btn btn-danger btn-sm" onclick="confirmDelete(\\'' + esc(b.version) + '\\')">Delete</button></div></td>' +
        '</tr>';
    });
    body.innerHTML = html;
  }

  function formatVersion(version) {
    var parts = version.split("-");
    if (parts.length > 1) {
      return esc(parts[0]) + '<span class="prerelease">-' + esc(parts.slice(1).join("-")) + '</span>';
    }
    return esc(version);
  }

  function formatChannelPills(bundle, latestBundle) {
    var pills = [];
    var channelNames = ["dev", "uat", "prod"];
    channelNames.forEach(function(ch) {
      if (channels[ch] && channels[ch].version === bundle.version) {
        pills.push('<span class="pill pill-' + ch + '">' + ch.charAt(0).toUpperCase() + ch.slice(1) + '</span>');
      }
    });
    if (latestBundle && latestBundle.version === bundle.version) {
      pills.push('<span class="pill pill-latest">Latest</span>');
    }
    if (pills.length === 0) {
      return '<span style="color:#555; font-size:11px">—</span>';
    }
    return pills.join("");
  }

  function formatSize(bytes) {
    if (!bytes) return "—";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  // Delete confirmation with user impact warning (Requirement 6.2, 6.3)
  var cachedUsers = null;

  async function fetchUsers() {
    if (cachedUsers !== null) return cachedUsers;
    try {
      var res = await fetch("/api/admin/users");
      if (res.ok) {
        var data = await res.json();
        cachedUsers = data.users || [];
        return cachedUsers;
      }
    } catch (e) {}
    return [];
  }

  function countUsersOnChannel(users, channelName) {
    var count = 0;
    for (var i = 0; i < users.length; i++) {
      var u = users[i];
      var effective = (u.installerChannel || "prod").toLowerCase();
      if (effective === channelName.toLowerCase()) count++;
    }
    return count;
  }

  window.confirmDelete = async function(version) {
    var bundle = bundles.find(function(b) { return b.version === version; });
    if (!bundle) return;

    // Check which channels reference this version
    var affectedChannels = [];
    ["dev", "uat", "prod"].forEach(function(ch) {
      if (channels[ch] && channels[ch].version === version) {
        affectedChannels.push(ch);
      }
    });

    var warningHtml = "";
    if (affectedChannels.length > 0) {
      // Fetch users to show impact count
      var users = await fetchUsers();
      var channelDetails = [];
      var totalAffected = 0;
      affectedChannels.forEach(function(ch) {
        var userCount = countUsersOnChannel(users, ch);
        totalAffected += userCount;
        channelDetails.push(ch.toUpperCase() + " (" + userCount + " user" + (userCount !== 1 ? "s" : "") + ")");
      });

      warningHtml = '<p class="warning">⚠️ This bundle is assigned to: ' + esc(channelDetails.join(", ")) + '</p>' +
        '<p>' + totalAffected + ' user' + (totalAffected !== 1 ? 's' : '') + ' will enter a stale state until a new version is assigned to ' +
        (affectedChannels.length === 1 ? 'this channel' : 'these channels') + '.</p>';
    } else {
      warningHtml = '<p>This bundle is not assigned to any channel. Safe to delete.</p>';
    }

    var overlay = document.createElement("div");
    overlay.className = "dialog-overlay";
    overlay.id = "delete-dialog";
    overlay.innerHTML = '<div class="dialog-box">' +
      '<h3>Delete v' + esc(version) + '?</h3>' +
      warningHtml +
      '<div class="dialog-actions">' +
      '<button class="btn-cancel" onclick="closeDialog()">Cancel</button>' +
      '<button class="btn btn-danger" onclick="executeDelete(\\'' + esc(version) + '\\')">Delete</button>' +
      '</div></div>';
    document.body.appendChild(overlay);
  };

  window.closeDialog = function() {
    var dialog = document.getElementById("delete-dialog");
    if (dialog) dialog.remove();
  };

  window.executeDelete = async function(version) {
    closeDialog();
    try {
      var res = await fetch("/api/admin/bundles/" + encodeURIComponent(version), { method: "DELETE" });
      if (res.ok) {
        cachedUsers = null; // invalidate user cache after delete
        fetchBundles();
        fetchChannels();
      } else {
        var err = await res.json();
        alert("Delete failed: " + (err.error || "Unknown error"));
      }
    } catch (e) {
      alert("Delete failed: network error");
    }
  };

  // Sorting
  window.sortBundles = function(col) {
    if (sortCol === col) {
      sortAsc = !sortAsc;
    } else {
      sortCol = col;
      sortAsc = col === "version" ? false : true;
    }
    renderBundles();
  };

  // Filtering
  window.filterBundles = function() {
    filterText = (document.getElementById("bundle-filter").value || "").trim();
    renderBundles();
  };

  // Utilities
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

  function fmtRelative(iso) {
    try {
      var now = Date.now();
      var then = new Date(iso).getTime();
      var diff = now - then;
      var mins = Math.floor(diff / 60000);
      if (mins < 1) return "just now";
      if (mins < 60) return mins + " min ago";
      var hours = Math.floor(mins / 60);
      if (hours < 24) return hours + " hour" + (hours > 1 ? "s" : "") + " ago";
      var days = Math.floor(hours / 24);
      if (days < 7) return days + " day" + (days > 1 ? "s" : "") + " ago";
      var weeks = Math.floor(days / 7);
      return weeks + " week" + (weeks > 1 ? "s" : "") + " ago";
    } catch (e) { return ""; }
  }

  // Init
  fetchBundles();
  fetchChannels();
  connectSSE();
})();
</script>`;
}
