/**
 * Baton Dashboard — Repo Summary Builder
 *
 * Builds a RepoSummary from active sessions, computing health status,
 * branches, active users with freshness, and session/user counts.
 */

import type { ISessionManager, ICollisionEvaluator, WorkSession } from "./types.js";
import {
  computeHealthStatus,
  DEFAULT_FRESHNESS_INTERVAL_MINUTES,
  DEFAULT_FRESHNESS_COLORS,
  type RepoSummary,
  type RepoBranch,
  type RepoActiveUser,
} from "./baton-types.js";

// ---------------------------------------------------------------------------
// Freshness config from environment
// ---------------------------------------------------------------------------

export interface FreshnessConfig {
  intervalMinutes: number;
  colors: readonly string[];
}

/**
 * Read freshness configuration from environment variables, falling back to
 * defaults. In a future phase this will migrate to a database/admin page.
 */
export function loadFreshnessConfig(): FreshnessConfig {
  const intervalRaw = process.env.BATON_FRESHNESS_INTERVAL_MINUTES;
  const colorsRaw = process.env.BATON_FRESHNESS_COLORS;

  const intervalMinutes =
    intervalRaw && !Number.isNaN(Number(intervalRaw))
      ? Number(intervalRaw)
      : DEFAULT_FRESHNESS_INTERVAL_MINUTES;

  let colors: readonly string[] = DEFAULT_FRESHNESS_COLORS;
  if (colorsRaw) {
    const parsed = colorsRaw.split(",").map((c) => c.trim()).filter(Boolean);
    if (parsed.length === 10) {
      colors = parsed;
    }
  }

  return { intervalMinutes, colors };
}

// ---------------------------------------------------------------------------
// Repo Summary Builder
// ---------------------------------------------------------------------------

/**
 * Build a RepoSummary for a given repository.
 *
 * @param sessionManager     Active session store
 * @param collisionEvaluator Evaluates collision state per-session
 * @param repo               Repository in "owner/repo" format
 * @param freshnessConfig    Optional freshness configuration override
 */
export async function buildRepoSummary(
  sessionManager: ISessionManager,
  collisionEvaluator: ICollisionEvaluator,
  repo: string,
  freshnessConfig?: FreshnessConfig,
): Promise<RepoSummary> {
  const _config = freshnessConfig ?? loadFreshnessConfig();
  const sessions = await sessionManager.getActiveSessions(repo);

  // Compute health status from collision states of all users
  const collisionStates = sessions.map((session) => {
    const result = collisionEvaluator.evaluate(session, sessions);
    return result.state;
  });
  const healthStatus = computeHealthStatus(collisionStates);

  // Build branch list — deduplicate and collect users per branch
  const branchMap = new Map<string, Set<string>>();
  for (const session of sessions) {
    if (!branchMap.has(session.branch)) {
      branchMap.set(session.branch, new Set());
    }
    branchMap.get(session.branch)!.add(session.userId);
  }

  const [owner, repoName] = repo.split("/");
  const githubUrl = `https://github.com/${owner}/${repoName}`;

  const branches: RepoBranch[] = Array.from(branchMap.entries()).map(
    ([name, userSet]) => ({
      name,
      githubUrl: `https://github.com/${owner}/${repoName}/tree/${name}`,
      users: Array.from(userSet),
    }),
  );

  // Build active user list — deduplicate by userId, pick most recent heartbeat
  const userMap = new Map<string, WorkSession>();
  for (const session of sessions) {
    const existing = userMap.get(session.userId);
    if (
      !existing ||
      new Date(session.lastHeartbeat).getTime() >
        new Date(existing.lastHeartbeat).getTime()
    ) {
      userMap.set(session.userId, session);
    }
  }

  // Determine which users have at least one active MCP session (not just GitHub)
  const connectedUsers = new Set<string>();
  for (const session of sessions) {
    if (!session.source || session.source === "active") {
      connectedUsers.add(session.userId);
    }
  }

  const users: RepoActiveUser[] = Array.from(userMap.values()).map((s) => ({
    userId: s.userId,
    githubUrl: `https://github.com/${s.userId}`,
    lastHeartbeat: s.lastHeartbeat,
    hasConnected: connectedUsers.has(s.userId),
  }));

  // Unique user count
  const uniqueUsers = new Set(sessions.map((s) => s.userId));

  return {
    repo,
    githubUrl,
    healthStatus,
    branches,
    users,
    sessionCount: sessions.length,
    userCount: uniqueUsers.size,
  };
}
