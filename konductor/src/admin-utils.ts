/**
 * Admin Utilities — Konductor Admin Dashboard
 *
 * Shared utility functions for the admin dashboard.
 */

// ---------------------------------------------------------------------------
// JIRA Ticket Extraction (Requirement 7.7)
// ---------------------------------------------------------------------------

/**
 * Pattern: <prefix>/<KEY>-<number>-<description>
 * where <KEY> is an uppercase project key (2+ chars) and <number> is a positive integer.
 * The prefix can be anything (feature, bugfix, hotfix, etc.)
 */
const JIRA_BRANCH_PATTERN = /^[^/]+\/([A-Z][A-Z0-9]+-\d+)/;

/**
 * Extract a JIRA ticket identifier from a branch name.
 *
 * Matches branches like:
 *   feature/PROJ-123-add-login
 *   bugfix/DATA-42-fix-null-pointer
 *   hotfix/CORE-7-urgent-patch
 *
 * Returns the ticket portion (e.g. "PROJ-123") or null if no match.
 */
export function extractJiraTicket(branchName: string): string | null {
  const match = branchName.match(JIRA_BRANCH_PATTERN);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Stale Repo Filtering (Requirement 7.4)
// ---------------------------------------------------------------------------

export interface RepoAccess {
  repo: string;
  lastAccessTimestamp: string; // ISO 8601
}

/**
 * Filter out repos whose last-access timestamp exceeds the stale threshold.
 *
 * @param repos           List of repo access records
 * @param thresholdDays   Number of days after which a repo is considered stale
 * @param now             Reference time (defaults to current time)
 * @returns               Only repos within the freshness threshold
 */
export function filterStaleRepos(
  repos: RepoAccess[],
  thresholdDays: number,
  now?: Date,
): RepoAccess[] {
  const reference = now ?? new Date();
  const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
  const cutoff = reference.getTime() - thresholdMs;

  return repos.filter((r) => {
    const ts = new Date(r.lastAccessTimestamp).getTime();
    return ts >= cutoff;
  });
}
