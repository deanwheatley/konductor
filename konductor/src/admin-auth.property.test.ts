/**
 * Property-Based Tests for Admin Auth Module
 *
 * Uses fast-check to verify correctness properties from the design document.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { parseKonductorAdmins, resolveAdminStatus } from "./admin-auth.js";

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Arbitrary non-empty identifier (userId or email-like). */
const identifierArb = fc.stringMatching(/^[a-zA-Z0-9._@+-]{1,50}$/);

/** Arbitrary whitespace (spaces and tabs only, 0–5 chars). */
const whitespaceArb = fc.stringMatching(/^[ \t]{0,5}$/);

// ---------------------------------------------------------------------------
// Property 2: KONDUCTOR_ADMINS parsing
// **Feature: konductor-admin, Property 2: KONDUCTOR_ADMINS parsing**
// **Validates: Requirements 1.6**
// ---------------------------------------------------------------------------

describe("KONDUCTOR_ADMINS Parsing — Property Tests", () => {
  /**
   * **Feature: konductor-admin, Property 2: KONDUCTOR_ADMINS parsing**
   * **Validates: Requirements 1.6**
   *
   * For any comma-separated string of identifiers with arbitrary whitespace,
   * parsing the KONDUCTOR_ADMINS value SHALL produce a list of trimmed,
   * non-empty entries matching the original identifiers with leading and
   * trailing whitespace removed.
   */
  it("Property 2: parsing produces trimmed, lowercased, non-empty entries", () => {
    fc.assert(
      fc.property(
        fc.array(identifierArb, { minLength: 1, maxLength: 10 }),
        fc.array(whitespaceArb, { minLength: 1, maxLength: 10 }),
        (identifiers, paddings) => {
          // Build a comma-separated string with arbitrary whitespace around each entry
          const parts = identifiers.map((id, i) => {
            const pad = paddings[i % paddings.length];
            return `${pad}${id}${pad}`;
          });
          const envValue = parts.join(",");

          const result = parseKonductorAdmins(envValue);

          // Each result entry should be trimmed and lowercased
          for (const entry of result) {
            expect(entry).toBe(entry.trim());
            expect(entry).toBe(entry.toLowerCase());
            expect(entry.length).toBeGreaterThan(0);
          }

          // The number of results should match the number of non-empty identifiers
          const expectedCount = identifiers.filter((id) => id.trim().length > 0).length;
          expect(result.length).toBe(expectedCount);

          // Each original identifier should appear (lowercased) in the result
          for (const id of identifiers) {
            if (id.trim().length > 0) {
              expect(result).toContain(id.trim().toLowerCase());
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Feature: konductor-admin, Property 2 (cont.): empty entries are discarded**
   * **Validates: Requirements 1.6**
   *
   * For any string with empty segments (consecutive commas, trailing commas),
   * parsing should discard all empty entries.
   */
  it("Property 2 (cont.): empty entries from consecutive/trailing commas are discarded", () => {
    fc.assert(
      fc.property(
        fc.array(identifierArb, { minLength: 0, maxLength: 5 }),
        fc.integer({ min: 1, max: 5 }),
        (identifiers, extraCommas) => {
          // Insert extra commas to create empty entries
          const withEmpties = [...identifiers, ...Array(extraCommas).fill("")];
          const envValue = withEmpties.join(",");

          const result = parseKonductorAdmins(envValue);

          // No empty entries in result
          for (const entry of result) {
            expect(entry.length).toBeGreaterThan(0);
          }

          // Count should match non-empty identifiers only
          expect(result.length).toBe(identifiers.filter((id) => id.trim().length > 0).length);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Feature: konductor-admin, Property 2 (cont.): undefined/empty input returns empty list**
   * **Validates: Requirements 1.6**
   */
  it("Property 2 (cont.): undefined or empty string returns empty list", () => {
    expect(parseKonductorAdmins(undefined)).toEqual([]);
    expect(parseKonductorAdmins("")).toEqual([]);
    expect(parseKonductorAdmins("   ")).toEqual([]);
    expect(parseKonductorAdmins(",,,")).toEqual([]);
  });
});


// ---------------------------------------------------------------------------
// Property 1: Admin resolution precedence
// **Feature: konductor-admin, Property 1: Admin resolution precedence**
// **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
// ---------------------------------------------------------------------------

describe("Admin Resolution Precedence — Property Tests", () => {
  /**
   * **Feature: konductor-admin, Property 1: Admin resolution precedence**
   * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
   *
   * For any userId, email, KONDUCTOR_ADMINS list, and user record admin flag,
   * the admin check SHALL return true if and only if the userId or email
   * appears in KONDUCTOR_ADMINS (case-insensitive) OR the user record has
   * admin: true. When both sources disagree, KONDUCTOR_ADMINS takes precedence.
   */
  it("Property 1: admin status is true iff userId/email in env list OR admin flag is true", () => {
    fc.assert(
      fc.property(
        identifierArb,
        fc.option(identifierArb, { nil: null }),
        fc.array(identifierArb, { minLength: 0, maxLength: 10 }),
        fc.boolean(),
        (userId, email, adminListRaw, userAdminFlag) => {
          // Normalize the admin list the same way parseKonductorAdmins would
          const adminList = adminListRaw.map((e) => e.trim().toLowerCase()).filter((e) => e.length > 0);

          const result = resolveAdminStatus(userId, email, adminList, userAdminFlag);

          const userIdLower = userId.toLowerCase();
          const emailLower = email?.toLowerCase() ?? null;
          const inEnvList =
            adminList.includes(userIdLower) ||
            (emailLower !== null && adminList.includes(emailLower));

          // The user should be admin if in env list OR has admin flag
          const expectedAdmin = inEnvList || userAdminFlag;
          expect(result.isAdmin).toBe(expectedAdmin);

          // Source precedence: env takes priority over database
          if (inEnvList) {
            expect(result.adminSource).toBe("env");
          } else if (userAdminFlag) {
            expect(result.adminSource).toBe("database");
          } else {
            expect(result.adminSource).toBeNull();
          }

          // Always authenticated (this function assumes auth already happened)
          expect(result.authenticated).toBe(true);
          expect(result.userId).toBe(userId);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Feature: konductor-admin, Property 1 (cont.): case-insensitive matching**
   * **Validates: Requirements 1.2**
   *
   * For any userId, adding it to the admin list in any case variation
   * should still result in admin: true with source "env".
   */
  it("Property 1 (cont.): case-insensitive matching for userId", () => {
    fc.assert(
      fc.property(
        identifierArb,
        fc.constantFrom("upper", "lower", "mixed"),
        (userId, caseVariant) => {
          let listEntry: string;
          if (caseVariant === "upper") listEntry = userId.toUpperCase();
          else if (caseVariant === "lower") listEntry = userId.toLowerCase();
          else listEntry = userId.split("").map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c.toLowerCase())).join("");

          // The admin list is already lowercased by parseKonductorAdmins
          const adminList = [listEntry.toLowerCase()];
          const result = resolveAdminStatus(userId, null, adminList, false);

          expect(result.isAdmin).toBe(true);
          expect(result.adminSource).toBe("env");
        },
      ),
      { numRuns: 100 },
    );
  });
});
