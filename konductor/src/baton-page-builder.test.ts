import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { CollisionState } from "./types.js";
import { HealthStatus } from "./baton-types.js";
import type { BatonNotification, BatonNotificationUser } from "./baton-types.js";
import { buildRepoPage, renderNotificationRow, escapeHtml, buildHistorySection, renderHistoryRow, buildOpenPRsSection, renderPRRow, buildSlackIntegrationSection } from "./baton-page-builder.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Simple alphanumeric identifier (1–12 chars, no special HTML chars). */
const identifierArb = fc.stringMatching(/^[a-z0-9]{1,12}$/);

/** Repo in "owner/repo" format. */
const repoArb = fc
  .tuple(
    fc.stringMatching(/^[a-z0-9]{1,10}$/),
    fc.stringMatching(/^[a-z0-9]{1,10}$/),
  )
  .map(([o, r]) => `${o}/${r}`);

/** Branch name (simple, no special chars). */
const branchArb = fc.stringMatching(/^[a-z0-9]{1,15}$/);

/** Health status arbitrary. */
const healthStatusArb = fc.constantFrom(
  HealthStatus.Healthy,
  HealthStatus.Warning,
  HealthStatus.Alerting,
);

/** Collision state arbitrary. */
const collisionStateArb = fc.constantFrom(
  CollisionState.Solo,
  CollisionState.Neighbors,
  CollisionState.Crossroads,
  CollisionState.CollisionCourse,
  CollisionState.MergeHell,
);

/** JIRA ticket IDs (simple pattern). */
const jiraArb = fc.stringMatching(/^[A-Z]{2,5}-[0-9]{1,5}$/);

/** Summary text (printable ASCII, no angle brackets to avoid HTML ambiguity). */
const summaryArb = fc.stringMatching(/^[a-zA-Z0-9 .,!?'-]{1,200}$/);

/** Notification user. */
const notifUserArb: fc.Arbitrary<BatonNotificationUser> = fc.record({
  userId: identifierArb,
  branch: branchArb,
});

/** ISO timestamp arbitrary. */
const isoTimestampArb = fc
  .integer({ min: new Date("2020-01-01").getTime(), max: new Date("2030-01-01").getTime() })
  .map((ms) => new Date(ms).toISOString());

/** A complete BatonNotification. */
const notificationArb: fc.Arbitrary<BatonNotification> = fc
  .record({
    id: fc.uuid(),
    repo: repoArb,
    timestamp: isoTimestampArb,
    notificationType: healthStatusArb,
    collisionState: collisionStateArb,
    jiras: fc.array(jiraArb, { minLength: 0, maxLength: 3 }),
    summary: summaryArb,
    users: fc.array(notifUserArb, { minLength: 1, maxLength: 4 }),
    resolved: fc.boolean(),
  })
  .map((n) => {
    if (n.resolved) {
      return { ...n, resolvedAt: new Date().toISOString() };
    }
    return n;
  });

// ---------------------------------------------------------------------------
// Property-Based Tests
// ---------------------------------------------------------------------------

describe("buildRepoPage — Property Tests", () => {
  /**
   * **Feature: konductor-baton, Property 1: Repo page contains all five sections**
   * **Validates: Requirements 1.1**
   *
   * For any valid repository name in owner/repo format, the generated repo
   * page HTML should contain identifiable sections for Repository Summary,
   * Notifications & Alerts, Query Log, Open PRs, and Repo History.
   */
  it("Property 1: Repo page contains all five sections", () => {
    fc.assert(
      fc.property(repoArb, (repo) => {
        const html = buildRepoPage(repo, "http://localhost:3100");

        // Section 1: Repository Summary
        expect(html).toContain("Repository Summary");
        expect(html).toContain("summary-section");

        // Section 2: Notifications & Alerts
        expect(html).toContain("Notifications");
        expect(html).toContain("Alerts");
        expect(html).toContain("notifications-section");

        // Section 3: Query Log
        expect(html).toContain("Query Log");
        expect(html).toContain("querylog-section");

        // Section 4: Open PRs
        expect(html).toContain("Open PRs");
        expect(html).toContain("prs-panel");

        // Section 5: Repo History
        expect(html).toContain("Repo History");
        expect(html).toContain("history-panel");
      }),
      { numRuns: 100 },
    );
  });
});


describe("renderNotificationRow — Property Tests", () => {
  /**
   * **Feature: konductor-baton, Property 4: Notification rendering contains all required fields and correct links**
   * **Validates: Requirements 3.2, 3.3**
   *
   * For any BatonNotification, the rendered notification row should contain
   * the timestamp, notification type, collision state, branch names (each linked
   * to GitHub), JIRAs (or "unknown"), summary text, and each user name as a
   * link to https://github.com/<userId>.
   */
  it("Property 4: Notification rendering contains all required fields and correct links", () => {
    fc.assert(
      fc.property(notificationArb, (notification) => {
        const githubBase = `https://github.com/${notification.repo}`;
        const html = renderNotificationRow(notification, githubBase);

        // Notification type badge is present
        const typeLabel = notification.notificationType.charAt(0).toUpperCase() + notification.notificationType.slice(1);
        expect(html).toContain(typeLabel);
        expect(html).toContain(`badge-${notification.notificationType}`);

        // Collision state is present (formatted)
        const stateWords = notification.collisionState.replace(/_/g, " ");
        // At least the raw words appear (title-cased in the output)
        for (const word of stateWords.split(" ")) {
          const titleCased = word.charAt(0).toUpperCase() + word.slice(1);
          expect(html).toContain(titleCased);
        }

        // Each user linked to GitHub profile
        for (const user of notification.users) {
          expect(html).toContain(`https://github.com/${user.userId}`);
          expect(html).toContain(user.userId);
        }

        // Branch links point to GitHub tree
        const uniqueBranches = [...new Set(notification.users.map((u) => u.branch))];
        for (const branch of uniqueBranches) {
          expect(html).toContain(`${githubBase}/tree/${branch}`);
          expect(html).toContain(branch);
        }

        // JIRAs present (or "unknown" if empty)
        if (notification.jiras.length > 0) {
          for (const jira of notification.jiras) {
            expect(html).toContain(escapeHtml(jira));
          }
        } else {
          expect(html).toContain("unknown");
        }

        // Summary text present (escaped for HTML)
        expect(html).toContain(escapeHtml(notification.summary));

        // Row has type-specific left border class
        expect(html).toContain(`notif-row-${notification.notificationType}`);

        // Resolve button or resolved label
        if (notification.resolved) {
          expect(html).toContain("Resolved");
        } else {
          expect(html).toContain("Resolve");
        }
      }),
      { numRuns: 100 },
    );
  });
});


// ---------------------------------------------------------------------------
// Property-Based Tests — Live Share Dashboard (Requirement 1.1, 1.2)
// ---------------------------------------------------------------------------

/** Collab request status arbitrary. */
const collabStatusArb = fc.constantFrom(
  "pending" as const,
  "accepted" as const,
  "declined" as const,
  "expired" as const,
  "link_shared" as const,
);

/** A collab request object matching the renderCollabRequestRow parameter shape. */
const collabRequestArb = fc.record({
  requestId: fc.uuid(),
  initiator: identifierArb,
  recipient: identifierArb,
  files: fc.array(fc.stringMatching(/^[a-z0-9/._-]{1,30}$/), { minLength: 1, maxLength: 5 }),
  collisionState: fc.constantFrom("solo", "neighbors", "crossroads", "collision_course", "merge_hell"),
  status: collabStatusArb,
  createdAt: isoTimestampArb,
  shareLink: fc.option(fc.constant("https://prod.liveshare.vsengsaas.visualstudio.com/join?ABC"), { nil: undefined }),
});

describe("renderCollabRequestRow — Property Tests (Live Share Dashboard)", () => {
  /**
   * **Feature: konductor-live-share-dashboard, Property 1: Status-specific indicator rendering**
   * **Validates: Requirements 1.1, 1.2**
   *
   * For any valid CollabRequest object, the HTML string returned by
   * renderCollabRequestRow() SHALL contain a status-specific indicator:
   * "Live" when status is link_shared, "Waiting" when status is accepted,
   * and the standard status badge for all other statuses.
   */
  it("Property 1: Status-specific indicator rendering", () => {
    fc.assert(
      fc.property(collabRequestArb, (request) => {
        const html = renderCollabRequestRow(request);

        if (request.status === "link_shared") {
          // Must show Live badge with pulsing dot
          expect(html).toContain("live-badge");
          expect(html).toContain("live-dot");
          expect(html).toContain("Live");
          // Must have green left border
          expect(html).toContain("border-left: 3px solid #16a34a");
        } else if (request.status === "accepted") {
          // Must show Waiting for Link badge
          expect(html).toContain("waiting-badge");
          expect(html).toContain("Waiting for Link");
          // Must NOT have green left border
          expect(html).not.toContain("border-left: 3px solid #16a34a");
        } else {
          // Standard status badge with capitalized label
          const expectedLabel = request.status.charAt(0).toUpperCase() + request.status.slice(1);
          expect(html).toContain(expectedLabel);
          expect(html).toContain("collab-status");
          // Must NOT have live or waiting badges
          expect(html).not.toContain("live-badge");
          expect(html).not.toContain("waiting-badge");
          // Must NOT have green left border
          expect(html).not.toContain("border-left: 3px solid #16a34a");
        }
      }),
      { numRuns: 100 },
    );
  });
});


// ---------------------------------------------------------------------------
// Repo History Section — Unit Tests (Requirement 7.2)
// ---------------------------------------------------------------------------

describe("buildHistorySection", () => {
  it("renders a panel with the correct id and column headers", () => {
    const html = buildHistorySection();
    expect(html).toContain('id="history-panel"');
    expect(html).toContain("Repo History");
    expect(html).toContain("<th>Timestamp</th>");
    expect(html).toContain("<th>Action</th>");
    expect(html).toContain("<th>User</th>");
    expect(html).toContain("<th>Branch</th>");
    expect(html).toContain("<th>Summary</th>");
    expect(html).toContain('id="history-body"');
    expect(html).toContain('id="history-count"');
  });

  it("does not contain the Coming Soon placeholder", () => {
    const html = buildHistorySection();
    expect(html).not.toContain("Coming Soon");
    expect(html).not.toContain("coming soon");
  });
});

describe("renderHistoryRow", () => {
  const githubBase = "https://github.com/org/repo";

  it("renders a PR Opened row with correct links and badge", () => {
    const entry = {
      timestamp: "2025-04-15T10:30:00.000Z",
      action: "PR Opened",
      user: "alice",
      branch: "feature-x",
      summary: "PR #42 → main  ·  3 files",
    };
    const html = renderHistoryRow(entry, githubBase);
    expect(html).toContain("badge-warning");
    expect(html).toContain("PR Opened");
    expect(html).toContain('href="https://github.com/alice"');
    expect(html).toContain('href="https://github.com/org/repo/tree/feature-x"');
    expect(html).toContain("PR #42");
  });

  it("renders a PR Approved row with alerting badge", () => {
    const entry = {
      timestamp: "2025-04-15T10:30:00.000Z",
      action: "PR Approved",
      user: "bob",
      branch: "hotfix",
      summary: "PR #99 → main  ·  1 file",
    };
    const html = renderHistoryRow(entry, githubBase);
    expect(html).toContain("badge-alerting");
    expect(html).toContain("PR Approved");
    expect(html).toContain('href="https://github.com/bob"');
  });

  it("renders a Commit row with healthy badge", () => {
    const entry = {
      timestamp: "2025-04-16T08:00:00.000Z",
      action: "Commit",
      user: "carol",
      branch: "main",
      summary: "5 files modified (2025-04-15 – 2025-04-16)",
    };
    const html = renderHistoryRow(entry, githubBase);
    expect(html).toContain("badge-healthy");
    expect(html).toContain("Commit");
    expect(html).toContain('href="https://github.com/carol"');
    expect(html).toContain('href="https://github.com/org/repo/tree/main"');
    expect(html).toContain("5 files modified");
  });

  it("escapes HTML in user and summary fields", () => {
    const entry = {
      timestamp: "2025-04-15T10:30:00.000Z",
      action: "Commit",
      user: "<script>alert(1)</script>",
      branch: "main",
      summary: 'file with "quotes" & <tags>',
    };
    const html = renderHistoryRow(entry, githubBase);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&lt;tags&gt;");
  });
});


// ---------------------------------------------------------------------------
// Open PRs Section — Unit Tests (Requirement 7.1)
// ---------------------------------------------------------------------------

describe("buildOpenPRsSection", () => {
  it("renders a panel with the correct id and column headers", () => {
    const html = buildOpenPRsSection();
    expect(html).toContain('id="prs-panel"');
    expect(html).toContain("Open PRs");
    expect(html).toContain("<th>Hours Open</th>");
    expect(html).toContain("<th>Branch</th>");
    expect(html).toContain("<th>PR #</th>");
    expect(html).toContain("<th>User</th>");
    expect(html).toContain("<th>Status</th>");
    expect(html).toContain("<th>Files</th>");
    expect(html).toContain('id="prs-body"');
    expect(html).toContain('id="prs-count"');
  });

  it("does not contain the Coming Soon placeholder", () => {
    const html = buildOpenPRsSection();
    expect(html).not.toContain("Coming Soon");
    expect(html).not.toContain("coming soon");
  });
});

describe("renderPRRow", () => {
  const githubBase = "https://github.com/org/repo";

  it("renders an open PR row with correct links and badge", () => {
    const entry = {
      prNumber: 42,
      prUrl: "https://github.com/org/repo/pull/42",
      user: "alice",
      branch: "feature-x",
      targetBranch: "main",
      status: "open",
      filesCount: 3,
      hoursOpen: 5,
    };
    const html = renderPRRow(entry, githubBase);
    expect(html).toContain("badge-warning");
    expect(html).toContain("Open");
    expect(html).toContain('href="https://github.com/org/repo/pull/42"');
    expect(html).toContain("#42");
    expect(html).toContain('href="https://github.com/alice"');
    expect(html).toContain('href="https://github.com/org/repo/tree/feature-x"');
    expect(html).toContain("→ main");
    expect(html).toContain("3");
    expect(html).toContain("5h");
  });

  it("renders a draft PR row with healthy badge", () => {
    const entry = {
      prNumber: 7,
      prUrl: "https://github.com/org/repo/pull/7",
      user: "bob",
      branch: "wip",
      targetBranch: "develop",
      status: "draft",
      filesCount: 1,
      hoursOpen: 0.5,
    };
    const html = renderPRRow(entry, githubBase);
    expect(html).toContain("badge-healthy");
    expect(html).toContain("Draft");
    expect(html).toContain("&lt;1h");
  });

  it("renders an approved PR row with alerting badge", () => {
    const entry = {
      prNumber: 99,
      prUrl: "https://github.com/org/repo/pull/99",
      user: "carol",
      branch: "hotfix",
      targetBranch: "main",
      status: "approved",
      filesCount: 10,
      hoursOpen: 48,
    };
    const html = renderPRRow(entry, githubBase);
    expect(html).toContain("badge-alerting");
    expect(html).toContain("Approved");
    expect(html).toContain("48h");
  });

  it("escapes HTML in user and branch fields", () => {
    const entry = {
      prNumber: 1,
      prUrl: "https://github.com/org/repo/pull/1",
      user: "<script>alert(1)</script>",
      branch: "feat/<xss>",
      targetBranch: "main",
      status: "open",
      filesCount: 1,
      hoursOpen: 1,
    };
    const html = renderPRRow(entry, githubBase);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;xss&gt;");
  });
});


// ---------------------------------------------------------------------------
// Slack Integration Panel — Unit Tests (Requirement 3.1, 3.2, 3.3, 3.6)
// ---------------------------------------------------------------------------

describe("buildSlackIntegrationSection", () => {
  it("renders a collapsible panel with the correct id and title", () => {
    const html = buildSlackIntegrationSection();
    expect(html).toContain('id="slack-panel"');
    expect(html).toContain("Slack Integration");
    expect(html).toContain("collapsible");
    expect(html).toContain("togglePanel('slack-panel')");
  });

  it("contains the panel body placeholder for client-side rendering", () => {
    const html = buildSlackIntegrationSection();
    expect(html).toContain('id="slack-panel-body"');
    expect(html).toContain('id="slack-status-badge"');
  });
});

describe("buildRepoPage — Slack Integration", () => {
  it("includes the Slack Integration panel in the full page", () => {
    const html = buildRepoPage("org/my-repo", "http://localhost:3100");
    expect(html).toContain('id="slack-panel"');
    expect(html).toContain("Slack Integration");
  });

  it("includes client-side JS for Slack config fetching", () => {
    const html = buildRepoPage("org/my-repo", "http://localhost:3100");
    expect(html).toContain("fetchSlackConfig");
    expect(html).toContain("renderSlackPanel");
  });

  it("includes 'not configured' message logic in client JS", () => {
    const html = buildRepoPage("org/my-repo", "http://localhost:3100");
    expect(html).toContain("Slack integration not configured");
    expect(html).toContain("Admin Dashboard");
  });

  it("includes verbosity dropdown labels in client JS", () => {
    const html = buildRepoPage("org/my-repo", "http://localhost:3100");
    expect(html).toContain("0 - Disabled");
    expect(html).toContain("1 - Merge Hell only");
    expect(html).toContain("2 - Collision Course + Merge Hell");
    expect(html).toContain("3 - Crossroads and above");
    expect(html).toContain("4 - Neighbors and above");
    expect(html).toContain("5 - Everything");
  });

  it("includes SSE handler for slack_config_change event", () => {
    const html = buildRepoPage("org/my-repo", "http://localhost:3100");
    expect(html).toContain("slack_config_change");
  });

  it("includes Save and Send Test Message button logic", () => {
    const html = buildRepoPage("org/my-repo", "http://localhost:3100");
    expect(html).toContain("saveSlackConfig");
    expect(html).toContain("sendSlackTest");
    expect(html).toContain("Save Changes");
    expect(html).toContain("Send Test Message");
  });

  it("includes Slack channel link generation logic", () => {
    const html = buildRepoPage("org/my-repo", "http://localhost:3100");
    expect(html).toContain("slack.com/app_redirect");
    expect(html).toContain("Open in Slack");
  });
});


// ---------------------------------------------------------------------------
// Collaboration Requests Panel — Unit Tests (Requirement 7.1–7.5)
// ---------------------------------------------------------------------------

import { buildCollabRequestsSection, renderCollabRequestRow } from "./baton-page-builder.js";

describe("buildCollabRequestsSection", () => {
  it("renders a collapsible panel with the correct id and title (Req 7.1)", () => {
    const html = buildCollabRequestsSection();
    expect(html).toContain('id="collab-panel"');
    expect(html).toContain("Collaboration Requests");
    expect(html).toContain("collapsible");
    expect(html).toContain("togglePanel('collab-panel')");
    expect(html).toContain('id="collab-count"');
    expect(html).toContain('id="collab-panel-body"');
  });

  it("shows empty state message when no requests (Req 7.5)", () => {
    const html = buildCollabRequestsSection();
    expect(html).toContain("No active collaboration requests.");
  });
});

describe("renderCollabRequestRow", () => {
  it("renders a pending request with all required fields (Req 7.2)", () => {
    const html = renderCollabRequestRow({
      requestId: "abc-123",
      initiator: "alice",
      recipient: "bob",
      files: ["src/index.ts", "src/utils.ts"],
      collisionState: "collision_course",
      status: "pending",
      createdAt: new Date().toISOString(),
    });
    expect(html).toContain("alice");
    expect(html).toContain("bob");
    expect(html).toContain("src/index.ts");
    expect(html).toContain("src/utils.ts");
    expect(html).toContain("Collision Course");
    expect(html).toContain("Pending");
    expect(html).toContain("collab-status-pending");
    expect(html).toContain('data-request-id="abc-123"');
    expect(html).toContain('href="https://github.com/alice"');
    expect(html).toContain('href="https://github.com/bob"');
  });

  it("renders an accepted request with Waiting for Link badge", () => {
    const html = renderCollabRequestRow({
      requestId: "def-456",
      initiator: "carol",
      recipient: "dave",
      files: ["README.md"],
      collisionState: "merge_hell",
      status: "accepted",
      createdAt: new Date(Date.now() - 3600_000).toISOString(),
    });
    expect(html).toContain("Waiting for Link");
    expect(html).toContain("waiting-badge");
    expect(html).toContain("Merge Hell");
    expect(html).toContain("1h ago");
  });

  it("renders a declined request with correct status badge", () => {
    const html = renderCollabRequestRow({
      requestId: "ghi-789",
      initiator: "eve",
      recipient: "frank",
      files: ["app.ts"],
      collisionState: "crossroads",
      status: "declined",
      createdAt: new Date().toISOString(),
    });
    expect(html).toContain("Declined");
    expect(html).toContain("collab-status-declined");
  });

  it("renders an expired request with correct status badge", () => {
    const html = renderCollabRequestRow({
      requestId: "jkl-012",
      initiator: "grace",
      recipient: "heidi",
      files: ["config.ts"],
      collisionState: "solo",
      status: "expired",
      createdAt: new Date(Date.now() - 86400_000).toISOString(),
    });
    expect(html).toContain("Expired");
    expect(html).toContain("collab-status-expired");
    expect(html).toContain("1d ago");
  });

  it("renders a link_shared request with Live badge and Join Session button (Req 7.3)", () => {
    const html = renderCollabRequestRow({
      requestId: "mno-345",
      initiator: "ivan",
      recipient: "judy",
      files: ["src/main.ts"],
      collisionState: "collision_course",
      status: "link_shared",
      createdAt: new Date().toISOString(),
      shareLink: "https://prod.liveshare.vsengsaas.visualstudio.com/join?ABC123",
    });
    expect(html).toContain("Live");
    expect(html).toContain("live-badge");
    expect(html).toContain("live-dot");
    expect(html).toContain("border-left: 3px solid #16a34a");
    expect(html).toContain("Join Session");
    expect(html).toContain('href="https://prod.liveshare.vsengsaas.visualstudio.com/join?ABC123"');
    expect(html).toContain("collab-join-btn");
  });

  it("does not render Join Session button when no share link", () => {
    const html = renderCollabRequestRow({
      requestId: "pqr-678",
      initiator: "karl",
      recipient: "liam",
      files: ["test.ts"],
      collisionState: "neighbors",
      status: "pending",
      createdAt: new Date().toISOString(),
    });
    expect(html).not.toContain("Join Session");
    expect(html).not.toContain("collab-join-btn");
  });

  it("escapes HTML in user names and file paths", () => {
    const html = renderCollabRequestRow({
      requestId: "stu-901",
      initiator: "<script>alert(1)</script>",
      recipient: "bob&co",
      files: ['file<xss>.ts'],
      collisionState: "solo",
      status: "pending",
      createdAt: new Date().toISOString(),
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("bob&amp;co");
    expect(html).toContain("file&lt;xss&gt;.ts");
  });
});

describe("buildRepoPage — Collaboration Requests", () => {
  it("includes the Collaboration Requests panel in the full page (Req 7.1)", () => {
    const html = buildRepoPage("org/my-repo", "http://localhost:3100");
    expect(html).toContain('id="collab-panel"');
    expect(html).toContain("Collaboration Requests");
  });

  it("includes client-side JS for collab request fetching (Req 7.1)", () => {
    const html = buildRepoPage("org/my-repo", "http://localhost:3100");
    expect(html).toContain("fetchCollabRequests");
    expect(html).toContain("renderCollabRequests");
  });

  it("includes SSE handler for collab_request_update events (Req 7.4)", () => {
    const html = buildRepoPage("org/my-repo", "http://localhost:3100");
    expect(html).toContain("collab_request_update");
  });

  it("includes empty state message in client JS (Req 7.5)", () => {
    const html = buildRepoPage("org/my-repo", "http://localhost:3100");
    expect(html).toContain("No active collaboration requests.");
  });

  it("includes Join Session button logic in client JS (Req 7.3)", () => {
    const html = buildRepoPage("org/my-repo", "http://localhost:3100");
    expect(html).toContain("collab-join-btn");
    expect(html).toContain("Join Session");
  });
});


// ---------------------------------------------------------------------------
// Live Share Dashboard — Enhanced Rendering Unit Tests (Req 1.1, 1.2, 2.1, 2.4)
// ---------------------------------------------------------------------------

describe("renderCollabRequestRow — Live Session Badges (Req 1.1, 1.2)", () => {
  it("renders link_shared status with Live badge and green border", () => {
    const html = renderCollabRequestRow({
      requestId: "live-1",
      initiator: "alice",
      recipient: "bob",
      files: ["src/index.ts"],
      collisionState: "collision_course",
      status: "link_shared",
      createdAt: new Date().toISOString(),
    });
    expect(html).toContain("live-badge");
    expect(html).toContain("live-dot");
    expect(html).toContain("Live");
    expect(html).toContain("border-left: 3px solid #16a34a");
    expect(html).not.toContain("waiting-badge");
    expect(html).not.toContain("collab-status-accepted");
  });

  it("renders accepted status with Waiting for Link badge", () => {
    const html = renderCollabRequestRow({
      requestId: "wait-1",
      initiator: "carol",
      recipient: "dave",
      files: ["README.md"],
      collisionState: "merge_hell",
      status: "accepted",
      createdAt: new Date().toISOString(),
    });
    expect(html).toContain("waiting-badge");
    expect(html).toContain("Waiting for Link");
    expect(html).not.toContain("live-badge");
    expect(html).not.toContain("border-left: 3px solid #16a34a");
  });

  it("renders pending status with standard badge (no live/waiting)", () => {
    const html = renderCollabRequestRow({
      requestId: "pend-1",
      initiator: "eve",
      recipient: "frank",
      files: ["app.ts"],
      collisionState: "crossroads",
      status: "pending",
      createdAt: new Date().toISOString(),
    });
    expect(html).toContain("Pending");
    expect(html).toContain("collab-status-pending");
    expect(html).not.toContain("live-badge");
    expect(html).not.toContain("waiting-badge");
  });

  it("renders declined status with standard badge (no live/waiting)", () => {
    const html = renderCollabRequestRow({
      requestId: "dec-1",
      initiator: "grace",
      recipient: "heidi",
      files: ["config.ts"],
      collisionState: "solo",
      status: "declined",
      createdAt: new Date().toISOString(),
    });
    expect(html).toContain("Declined");
    expect(html).toContain("collab-status-declined");
    expect(html).not.toContain("live-badge");
    expect(html).not.toContain("waiting-badge");
  });

  it("renders expired status with standard badge (no live/waiting)", () => {
    const html = renderCollabRequestRow({
      requestId: "exp-1",
      initiator: "ivan",
      recipient: "judy",
      files: ["test.ts"],
      collisionState: "neighbors",
      status: "expired",
      createdAt: new Date().toISOString(),
    });
    expect(html).toContain("Expired");
    expect(html).toContain("collab-status-expired");
    expect(html).not.toContain("live-badge");
    expect(html).not.toContain("waiting-badge");
  });
});

describe("buildRepoPage — Recommended Actions (Req 2.1, 2.4)", () => {
  it("includes recommended actions rendering logic in client JS", () => {
    const html = buildRepoPage("org/my-repo", "http://localhost:3100");
    expect(html).toContain("recommended-actions");
    expect(html).toContain("recommended-actions-header");
    expect(html).toContain("Recommended Actions");
  });

  it("includes condition to show only for warning/alerting health", () => {
    const html = buildRepoPage("org/my-repo", "http://localhost:3100");
    expect(html).toContain('s.healthStatus === "warning" || s.healthStatus === "alerting"');
  });

  it("includes all three recommended action commands", () => {
    const html = buildRepoPage("org/my-repo", "http://localhost:3100");
    expect(html).toContain("konductor, live share with");
    expect(html).toContain("konductor, who should I coordinate with?");
    expect(html).toContain("konductor, am I safe to push?");
  });

  it("includes CSS for recommended actions styling", () => {
    const html = buildRepoPage("org/my-repo", "http://localhost:3100");
    expect(html).toContain(".recommended-actions {");
    expect(html).toContain(".recommended-actions-header {");
    expect(html).toContain(".action-item {");
  });

  it("includes CSS for live badge and waiting badge", () => {
    const html = buildRepoPage("org/my-repo", "http://localhost:3100");
    expect(html).toContain(".live-badge {");
    expect(html).toContain(".waiting-badge {");
    expect(html).toContain("pulse-live");
    expect(html).toContain(".live-dot {");
  });

  it("includes CSS for pairing icon", () => {
    const html = buildRepoPage("org/my-repo", "http://localhost:3100");
    expect(html).toContain(".pairing-icon {");
  });

  it("includes client-side live badge rendering logic", () => {
    const html = buildRepoPage("org/my-repo", "http://localhost:3100");
    expect(html).toContain("live-badge");
    expect(html).toContain("waiting-badge");
    expect(html).toContain("Waiting for Link");
  });
});
