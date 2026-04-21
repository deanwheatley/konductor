import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { buildRepoPageUrl, extractRepoName } from "./baton-url.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Simple alphanumeric hostname (1–20 chars). */
const hostArb = fc.stringMatching(/^[a-z0-9][a-z0-9.-]{0,18}[a-z0-9]$/);

/** Port number (1–65535). */
const portArb = fc.integer({ min: 1, max: 65535 });

/** Simple identifier for owner/repo parts. */
const identifierArb = fc.stringMatching(/^[a-z0-9]{1,12}$/);

/** Repo in "owner/repo" format. */
const repoArb = fc.tuple(identifierArb, identifierArb).map(([o, r]) => `${o}/${r}`);

// ---------------------------------------------------------------------------
// Property-Based Tests
// ---------------------------------------------------------------------------

describe("buildRepoPageUrl — Property Tests", () => {
  /**
   * **Feature: konductor-baton, Property 7: Repo page URL in registration response follows correct pattern**
   * **Validates: Requirements 6.1, 6.3**
   *
   * For any server host, port, and registered session with repo in "owner/repo"
   * format, the repo page URL should match http://<host>:<port>/repo/<repoName>.
   */
  it("Property 7: Repo page URL follows correct pattern", () => {
    fc.assert(
      fc.property(hostArb, portArb, repoArb, (host, port, repo) => {
        const url = buildRepoPageUrl(host, port, repo);
        const repoName = repo.split("/")[1];

        // Must match the expected pattern exactly
        expect(url).toBe(`http://${host}:${port}/repo/${repoName}`);

        // Verify structural components via regex
        const pattern = /^http:\/\/([^:]+):(\d+)\/repo\/([^/]+)$/;
        const match = url.match(pattern);
        expect(match).not.toBeNull();
        expect(match![1]).toBe(host);
        expect(match![2]).toBe(String(port));
        expect(match![3]).toBe(repoName);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Unit Tests
// ---------------------------------------------------------------------------

describe("extractRepoName", () => {
  it("extracts repo name from owner/repo format", () => {
    expect(extractRepoName("acme/app")).toBe("app");
    expect(extractRepoName("deanwheatley/konductor")).toBe("konductor");
  });

  it("returns as-is when no slash present", () => {
    expect(extractRepoName("konductor")).toBe("konductor");
  });
});
