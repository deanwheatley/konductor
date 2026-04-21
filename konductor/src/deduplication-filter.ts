/**
 * DeduplicationFilter — prevents redundant and self-collision passive sessions.
 *
 * Three deduplication rules:
 * 1. Self-collision suppression: skip passive session if user has active session in same repo
 * 2. PR supersedes commits: skip commit session if user has PR session covering same files
 * 3. Active supersedes passive: skip own PR/commit sessions when active session exists
 *
 * Requirements: 1.7, 2.4, 3.6
 */

import type { WorkSession } from "./types.js";

export class DeduplicationFilter {
  /**
   * Filter a list of candidate sessions, removing those that are redundant
   * according to the three deduplication rules.
   *
   * @param candidates  All sessions (active + passive) to evaluate
   * @returns           Filtered list with redundant passive sessions removed
   */
  filter(candidates: WorkSession[]): WorkSession[] {
    // Separate active sessions from passive sessions
    const activeSessions = candidates.filter(
      (s) => !s.source || s.source === "active",
    );
    const passiveSessions = candidates.filter(
      (s) => s.source === "github_pr" || s.source === "github_commit",
    );

    // Index active sessions by userId+repo for fast lookup
    const activeByUserRepo = new Map<string, WorkSession[]>();
    for (const s of activeSessions) {
      const key = `${s.userId}#${s.repo}`;
      const list = activeByUserRepo.get(key) ?? [];
      list.push(s);
      activeByUserRepo.set(key, list);
    }

    // Index PR sessions by userId+repo for PR-supersedes-commits lookup
    const prSessionsByUserRepo = new Map<string, WorkSession[]>();
    for (const s of passiveSessions) {
      if (s.source === "github_pr") {
        const key = `${s.userId}#${s.repo}`;
        const list = prSessionsByUserRepo.get(key) ?? [];
        list.push(s);
        prSessionsByUserRepo.set(key, list);
      }
    }

    const kept: WorkSession[] = [...activeSessions];

    for (const session of passiveSessions) {
      if (this.shouldSuppress(session, activeByUserRepo, prSessionsByUserRepo)) {
        continue;
      }
      kept.push(session);
    }

    return kept;
  }

  /**
   * Determine if a passive session should be suppressed.
   */
  private shouldSuppress(
    session: WorkSession,
    activeByUserRepo: Map<string, WorkSession[]>,
    prSessionsByUserRepo: Map<string, WorkSession[]>,
  ): boolean {
    const userRepoKey = `${session.userId}#${session.repo}`;

    // Rule 1 & 3: Self-collision suppression / Active supersedes passive
    // If the user has an active session in the same repo, suppress this passive session.
    // This covers both:
    //   - Req 1.7: don't create duplicate passive session when PR author has active session
    //   - Req 3.6: suppress own PR/commit collisions when user has active session
    const activeForUser = activeByUserRepo.get(userRepoKey);
    if (activeForUser && activeForUser.length > 0) {
      return true;
    }

    // Rule 2: PR supersedes commits
    // If this is a commit session and the same user has a PR session covering the same files,
    // suppress the commit session (the PR is a more specific signal).
    if (session.source === "github_commit") {
      const prSessions = prSessionsByUserRepo.get(userRepoKey);
      if (prSessions && prSessions.length > 0) {
        const commitFiles = new Set(session.files);
        for (const pr of prSessions) {
          const prFiles = new Set(pr.files);
          // Check if all commit files are covered by this PR
          let allCovered = true;
          for (const f of commitFiles) {
            if (!prFiles.has(f)) {
              allCovered = false;
              break;
            }
          }
          if (allCovered) {
            return true;
          }
        }
      }
    }

    return false;
  }
}
