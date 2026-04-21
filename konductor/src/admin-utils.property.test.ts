/**
 * Property-Based Tests for Admin Utilities
 *
 * Uses fast-check to verify correctness properties from the design document.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { extractJiraTicket, filterStaleRepos } from "./admin-utils.js";
import type { RepoAccess } from "./admin-utils.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Arbitrary branch prefix (feature, bugfix, hotfix, etc.) */
const prefixArb = fc.constantFrom("feature", "bugfix", "hotfix", "fix", "chore", "release", "task");

/** Arbitrary JIRA project key (2-5 uppercase letters). */
const projectKeyArb = fc.stringMatching(/^[A-Z]{2,5}$/);

/** Arbitrary JIRA issue number. */
const issueNumberArb = fc.integer({ min: 1, max: 99999 });

/** Arbitrary branch description suffix. */
const descriptionArb = fc.stringMatching(/^[a-z0-9-]{1,30}$/);

/** Arbitrary valid JIRA branch name: <prefix>/<KEY>-<number>-<description> */
const jiraBranchArb = fc.tuple(prefixArb, projectKeyArb, issueNumberArb, descriptionArb).map(
  ([prefix, key, num, desc]) => ({
    branch: `${prefix}/${key}-${num}-${desc}`,
    ticket: `${key}-${num}`,
  }),
);

/** Arbitrary branch name that does NOT match the JIRA pattern. */
const nonJiraBranchArb = fc.oneof(
  // No slash at all
  fc.stringMatching(/^[a-z][a-z0-9-]{2,20}$/).map((s) => s),
  // Slash but no uppercase key (all lowercase after slash)
  fc.tuple(prefixArb, fc.stringMatching(/^[a-z][a-z-]{2,15}$/)).map(
    ([prefix, rest]) => `${prefix}/${rest}`,
  ),
  // Slash with key but description starts with a letter (not a digit)
  fc.tuple(prefixArb, projectKeyArb, fc.stringMatching(/^[a-z][a-z0-9-]{1,15}$/)).map(
    ([prefix, key, desc]) => `${prefix}/${key}-${desc}`,
  ),
);

// ---------------------------------------------------------------------------
// Property 9: JIRA ticket extraction from branch names
// **Feature: konductor-admin, Property 9: JIRA ticket extraction from branch names**
// **Validates: Requirements 7.7**
// ---------------------------------------------------------------------------

describe("JIRA Ticket Extraction — Property Tests", () => {
  /**
   * **Feature: konductor-admin, Property 9: JIRA ticket extraction from branch names**
   * **Validates: Requirements 7.7**
   *
   * For any branch name matching the pattern <prefix>/<KEY>-<number>-<description>,
   * the JIRA extraction function SHALL return the <KEY>-<number> portion.
   * For any branch name not matching this pattern, the function SHALL return null.
   */
  it("Property 9: valid JIRA branches return the correct ticket", () => {
    fc.assert(
      fc.property(
        jiraBranchArb,
        ({ branch, ticket }) => {
          const result = extractJiraTicket(branch);
          expect(result).toBe(ticket);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("Property 9 (cont.): non-JIRA branches return null", () => {
    fc.assert(
      fc.property(
        nonJiraBranchArb,
        (branch) => {
          const result = extractJiraTicket(branch);
          expect(result).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 10: Stale repo filtering
// **Feature: konductor-admin, Property 10: Stale repo filtering**
// **Validates: Requirements 7.4**
// ---------------------------------------------------------------------------

/** Arbitrary repo access record with a timestamp relative to a reference date. */
const repoAccessArb = (referenceMs: number, thresholdMs: number) =>
  fc.tuple(
    fc.stringMatching(/^[a-z]+\/[a-z-]+$/),
    // Offset from reference: negative = in the past, positive = in the future
    fc.integer({ min: -thresholdMs * 3, max: thresholdMs }),
  ).map(([repo, offsetMs]): RepoAccess => ({
    repo,
    lastAccessTimestamp: new Date(referenceMs + offsetMs).toISOString(),
  }));

describe("Stale Repo Filtering — Property Tests", () => {
  /**
   * **Feature: konductor-admin, Property 10: Stale repo filtering**
   * **Validates: Requirements 7.4**
   *
   * For any user record with repos accessed timestamps and a stale activity
   * threshold, the filtered repo list SHALL contain only repos whose
   * last-access timestamp is within the threshold, and SHALL exclude all
   * repos whose last-access timestamp exceeds the threshold.
   */
  it("Property 10: filtered repos are all within threshold, excluded repos are all beyond", () => {
    const referenceMs = Date.now();
    const thresholdDays = 7;
    const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
    const now = new Date(referenceMs);

    fc.assert(
      fc.property(
        fc.array(repoAccessArb(referenceMs, thresholdMs), { minLength: 1, maxLength: 20 }),
        (repos) => {
          const result = filterStaleRepos(repos, thresholdDays, now);
          const cutoff = referenceMs - thresholdMs;

          // Every included repo must be within threshold
          for (const r of result) {
            const ts = new Date(r.lastAccessTimestamp).getTime();
            expect(ts).toBeGreaterThanOrEqual(cutoff);
          }

          // Every excluded repo must be beyond threshold
          const excluded = repos.filter((r) => !result.includes(r));
          for (const r of excluded) {
            const ts = new Date(r.lastAccessTimestamp).getTime();
            expect(ts).toBeLessThan(cutoff);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
