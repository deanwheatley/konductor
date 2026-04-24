/**
 * QueryLogStore — In-memory ring buffer for Baton query log entries.
 *
 * Captures user-initiated query tool invocations (who_is_active, who_overlaps, etc.)
 * scoped to a repo. Entries are ephemeral — no persistence needed.
 * Each repo has a maximum of 1000 entries; oldest entries are evicted first.
 */

import type { QueryLogEntry } from "./baton-types.js";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface IQueryLogStore {
  add(entry: QueryLogEntry): void;
  getEntries(repo: string): QueryLogEntry[];
  getKnownRepos(): string[];
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/** Maximum number of query log entries stored per repo. */
const MAX_ENTRIES_PER_REPO = 1000;

export class QueryLogStore implements IQueryLogStore {
  private readonly entries = new Map<string, QueryLogEntry[]>();

  add(entry: QueryLogEntry): void {
    let repoEntries = this.entries.get(entry.repo);
    if (!repoEntries) {
      repoEntries = [];
      this.entries.set(entry.repo, repoEntries);
    }
    repoEntries.push({ ...entry });
    // Evict oldest when exceeding capacity
    if (repoEntries.length > MAX_ENTRIES_PER_REPO) {
      repoEntries.shift();
    }
  }

  getEntries(repo: string): QueryLogEntry[] {
    const repoEntries = this.entries.get(repo);
    if (!repoEntries) return [];
    return repoEntries.map((e) => ({ ...e, parameters: { ...e.parameters } }));
  }

  getKnownRepos(): string[] {
    return [...this.entries.keys()];
  }
}
