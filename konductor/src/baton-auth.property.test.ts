/**
 * Property-Based Tests for Baton Auth Module
 *
 * Uses fast-check to verify correctness properties from the design document.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import fc from "fast-check";
import { encodeSession, decodeSession, AccessCache, type BatonSession } from "./baton-auth.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Arbitrary non-empty printable string (1–50 chars). */
const nonEmptyStringArb = fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0);

/** Arbitrary URL-like string for avatar. */
const avatarUrlArb = fc.webUrl();

/** Arbitrary hex string for tokens/secrets. */
const hexStringArb = (min: number, max: number) =>
  fc.stringMatching(new RegExp(`^[0-9a-f]{${min},${max}}$`));

/** Arbitrary session secret (16–64 hex chars). */
const secretArb = hexStringArb(16, 64);

/** Arbitrary valid (non-expired) BatonSession. */
const validSessionArb: fc.Arbitrary<BatonSession> = fc
  .record({
    githubUsername: nonEmptyStringArb,
    githubAvatarUrl: avatarUrlArb,
    accessToken: hexStringArb(20, 40),
    createdAt: fc.integer({ min: 0, max: Date.now() }),
    expiresAt: fc.integer({ min: Date.now() + 60_000, max: Date.now() + 365 * 24 * 60 * 60 * 1000 }),
  });

/** Arbitrary expired BatonSession (expiresAt in the past). */
const expiredSessionArb: fc.Arbitrary<BatonSession> = fc
  .record({
    githubUsername: nonEmptyStringArb,
    githubAvatarUrl: avatarUrlArb,
    accessToken: hexStringArb(20, 40),
    createdAt: fc.integer({ min: 0, max: Date.now() - 120_000 }),
    expiresAt: fc.integer({ min: 0, max: Date.now() - 1 }),
  });

/** Arbitrary owner/repo strings. */
const ownerArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9-]{0,19}$/);
const repoArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9._-]{0,29}$/);

/** Arbitrary access result. */
const accessResultArb = fc.constantFrom("allowed" as const, "denied" as const);

// ---------------------------------------------------------------------------
// Property 2: Session cookie encryption round-trip
// Validates: Requirements 3.1, 3.5
// ---------------------------------------------------------------------------

describe("Session Cookie Encryption — Property Tests", () => {
  /**
   * **Feature: konductor-baton-auth, Property 2: Session cookie encryption round-trip**
   * **Validates: Requirements 3.1, 3.5**
   *
   * For any valid BatonSession and any secret, encoding then decoding
   * with the same secret produces an equivalent session.
   */
  it("Property 2: encode then decode with same secret produces equivalent session", () => {
    fc.assert(
      fc.property(validSessionArb, secretArb, (session, secret) => {
        const encoded = encodeSession(session, secret);
        const decoded = decodeSession(encoded, secret);

        expect(decoded).not.toBeNull();
        expect(decoded!.githubUsername).toBe(session.githubUsername);
        expect(decoded!.githubAvatarUrl).toBe(session.githubAvatarUrl);
        expect(decoded!.accessToken).toBe(session.accessToken);
        expect(decoded!.createdAt).toBe(session.createdAt);
        expect(decoded!.expiresAt).toBe(session.expiresAt);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Feature: konductor-baton-auth, Property 2 (cont.): Different secret rejects session**
   * **Validates: Requirement 3.5**
   *
   * For any valid BatonSession and two distinct secrets, encoding with one
   * secret and decoding with a different secret returns null.
   */
  it("Property 2 (cont.): decode with wrong secret returns null", () => {
    fc.assert(
      fc.property(
        validSessionArb,
        secretArb,
        secretArb,
        (session, secret1, secret2) => {
          fc.pre(secret1 !== secret2);

          const encoded = encodeSession(session, secret1);
          const decoded = decodeSession(encoded, secret2);

          expect(decoded).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5: Expired sessions are rejected
// Validates: Requirement 3.3
// ---------------------------------------------------------------------------

describe("Expired Session Rejection — Property Tests", () => {
  /**
   * **Feature: konductor-baton-auth, Property 5: Expired sessions are rejected**
   * **Validates: Requirement 3.3**
   *
   * For any session with expiresAt < now, decoding returns null.
   */
  it("Property 5: expired sessions are rejected on decode", () => {
    fc.assert(
      fc.property(expiredSessionArb, secretArb, (session, secret) => {
        const encoded = encodeSession(session, secret);
        const decoded = decodeSession(encoded, secret);

        expect(decoded).toBeNull();
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: Access check caching correctness
// Validates: Requirement 2.6
// ---------------------------------------------------------------------------

describe("Access Check Cache — Property Tests", () => {
  /**
   * **Feature: konductor-baton-auth, Property 4: Access check caching correctness**
   * **Validates: Requirement 2.6**
   *
   * For any token, owner, repo, and access result, the cache returns the
   * stored result within the TTL window and returns null (miss) before set.
   */
  it("Property 4: cache returns stored result within TTL, null before set", () => {
    fc.assert(
      fc.property(
        hexStringArb(10, 40),
        ownerArb,
        repoArb,
        accessResultArb,
        (token, owner, repo, result) => {
          // Use a large TTL (60 min) so entries are always fresh during the test
          const cache = new AccessCache(60);

          // Before set: cache miss
          expect(cache.get(token, owner, repo)).toBeNull();

          // After set: cache hit with correct result
          cache.set(token, owner, repo, result);
          expect(cache.get(token, owner, repo)).toBe(result);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Feature: konductor-baton-auth, Property 4 (cont.): TTL expiry**
   * **Validates: Requirement 2.6**
   *
   * Entries expire after the configured TTL. We use fake timers to
   * advance past the TTL boundary and verify expiry.
   */
  it("Property 4 (cont.): cache entries expire after TTL", () => {
    vi.useFakeTimers();
    try {
      fc.assert(
        fc.property(
          hexStringArb(10, 40),
          ownerArb,
          repoArb,
          accessResultArb,
          (token, owner, repo, result) => {
            const ttlMinutes = 5;
            const cache = new AccessCache(ttlMinutes);
            cache.set(token, owner, repo, result);

            // Still within TTL — should be a hit
            expect(cache.get(token, owner, repo)).toBe(result);

            // Advance past TTL
            vi.advanceTimersByTime(ttlMinutes * 60 * 1000 + 1);

            // Now expired — should be null
            expect(cache.get(token, owner, repo)).toBeNull();
          },
        ),
        { numRuns: 100 },
      );
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * **Feature: konductor-baton-auth, Property 4 (cont.): clear removes entries**
   * **Validates: Requirement 2.6**
   *
   * Clearing a token's cache removes all entries for that token.
   */
  it("Property 4 (cont.): clear removes all entries for a token", () => {
    fc.assert(
      fc.property(
        hexStringArb(10, 40),
        ownerArb,
        repoArb,
        accessResultArb,
        (token, owner, repo, result) => {
          const cache = new AccessCache(60);
          cache.set(token, owner, repo, result);
          expect(cache.get(token, owner, repo)).toBe(result);

          cache.clear(token);
          expect(cache.get(token, owner, repo)).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });
});
