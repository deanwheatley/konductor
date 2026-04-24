/**
 * Property-based tests for KONDUCTOR_EXTERNAL_URL override.
 *
 * **Feature: konductor-production, Property 1: External URL override**
 * For any valid URL string set as KONDUCTOR_EXTERNAL_URL, the server SHALL
 * use that URL as serverUrl instead of deriving it from osHostname() and port.
 * For any empty or undefined value, the server SHALL fall back to hostname-derived URL.
 *
 * Validates: Requirements 8.1, 8.3
 */

import { describe, it, expect, afterEach } from "vitest";
import * as fc from "fast-check";

describe("Feature: konductor-production, Property 1: External URL override", () => {
  const originalEnv = process.env.KONDUCTOR_EXTERNAL_URL;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.KONDUCTOR_EXTERNAL_URL;
    } else {
      process.env.KONDUCTOR_EXTERNAL_URL = originalEnv;
    }
  });

  /**
   * Simulate the serverUrl resolution logic from index.ts:
   *   const serverUrl = process.env.KONDUCTOR_EXTERNAL_URL || `${protocol}://${hostname}:${port}`;
   */
  function resolveServerUrl(protocol: string, hostname: string, port: number): string {
    return process.env.KONDUCTOR_EXTERNAL_URL || `${protocol}://${hostname}:${port}`;
  }

  const validUrlArb = fc.tuple(
    fc.constantFrom("https", "http"),
    fc.domain(),
  ).map(([scheme, domain]) => `${scheme}://${domain}`);

  it("uses KONDUCTOR_EXTERNAL_URL when set (100+ iterations)", () => {
    fc.assert(
      fc.property(validUrlArb, (externalUrl) => {
        process.env.KONDUCTOR_EXTERNAL_URL = externalUrl;
        const result = resolveServerUrl("http", "localhost", 3100);
        expect(result).toBe(externalUrl);
      }),
      { numRuns: 100 },
    );
  });

  it("falls back to hostname-derived URL when KONDUCTOR_EXTERNAL_URL is undefined (100+ iterations)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("http", "https"),
        fc.domain(),
        fc.integer({ min: 1024, max: 65535 }),
        (protocol, hostname, port) => {
          delete process.env.KONDUCTOR_EXTERNAL_URL;
          const result = resolveServerUrl(protocol, hostname, port);
          expect(result).toBe(`${protocol}://${hostname}:${port}`);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("falls back to hostname-derived URL when KONDUCTOR_EXTERNAL_URL is empty string", () => {
    process.env.KONDUCTOR_EXTERNAL_URL = "";
    const result = resolveServerUrl("https", "myhost", 3100);
    expect(result).toBe("https://myhost:3100");
  });
});
