/**
 * Unit Tests for Admin Auth Module
 *
 * Requirements: 1.1–1.6, 2.1–2.5
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseKonductorAdmins,
  resolveAdminStatus,
  encodeAdminSession,
  decodeAdminSession,
  hashApiKey,
  createAdminSession,
  getSessionSecret,
  resetSessionSecret,
  type AdminSession,
} from "./admin-auth.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_SECRET = "admin-test-secret-1234567890abcdef";

function makeAdminSession(overrides: Partial<AdminSession> = {}): AdminSession {
  return {
    userId: "testadmin",
    apiKeyHash: hashApiKey("test-api-key-123"),
    createdAt: Date.now() - 60_000,
    expiresAt: Date.now() + 8 * 60 * 60 * 1000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parseKonductorAdmins
// ---------------------------------------------------------------------------

describe("parseKonductorAdmins", () => {
  it("returns empty array for undefined", () => {
    expect(parseKonductorAdmins(undefined)).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseKonductorAdmins("")).toEqual([]);
  });

  it("parses single entry", () => {
    expect(parseKonductorAdmins("alice")).toEqual(["alice"]);
  });

  it("parses multiple comma-separated entries", () => {
    expect(parseKonductorAdmins("alice,bob,carol")).toEqual(["alice", "bob", "carol"]);
  });

  it("trims whitespace from entries (Req 1.6)", () => {
    expect(parseKonductorAdmins("  alice , bob  ,  carol  ")).toEqual(["alice", "bob", "carol"]);
  });

  it("lowercases all entries for case-insensitive matching", () => {
    expect(parseKonductorAdmins("Alice,BOB,Carol")).toEqual(["alice", "bob", "carol"]);
  });

  it("discards empty entries from consecutive commas", () => {
    expect(parseKonductorAdmins("alice,,bob,,,carol")).toEqual(["alice", "bob", "carol"]);
  });

  it("handles email addresses", () => {
    expect(parseKonductorAdmins("[email protected],[email protected]")).toEqual(["[email protected]", "[email protected]"]);
  });
});


// ---------------------------------------------------------------------------
// resolveAdminStatus
// ---------------------------------------------------------------------------

describe("resolveAdminStatus", () => {
  it("returns admin via env when userId matches (Req 1.2)", () => {
    const result = resolveAdminStatus("alice", null, ["alice"], false);
    expect(result.isAdmin).toBe(true);
    expect(result.adminSource).toBe("env");
  });

  it("returns admin via env when email matches (Req 1.2)", () => {
    const result = resolveAdminStatus("alice", "[email protected]", ["[email protected]"], false);
    expect(result.isAdmin).toBe(true);
    expect(result.adminSource).toBe("env");
  });

  it("case-insensitive matching for userId (Req 1.2)", () => {
    const result = resolveAdminStatus("Alice", null, ["alice"], false);
    expect(result.isAdmin).toBe(true);
    expect(result.adminSource).toBe("env");
  });

  it("returns admin via database when admin flag is true (Req 1.3)", () => {
    const result = resolveAdminStatus("bob", null, [], true);
    expect(result.isAdmin).toBe(true);
    expect(result.adminSource).toBe("database");
  });

  it("env takes precedence over database (Req 1.1)", () => {
    const result = resolveAdminStatus("alice", null, ["alice"], true);
    expect(result.isAdmin).toBe(true);
    expect(result.adminSource).toBe("env");
  });

  it("returns not admin when not in env list and admin flag is false (Req 1.4)", () => {
    const result = resolveAdminStatus("bob", null, ["alice"], false);
    expect(result.isAdmin).toBe(false);
    expect(result.adminSource).toBeNull();
  });

  it("returns not admin when not in env list and no user record (Req 1.4)", () => {
    const result = resolveAdminStatus("bob", null, ["alice"], null);
    expect(result.isAdmin).toBe(false);
    expect(result.adminSource).toBeNull();
  });

  it("always sets authenticated to true and preserves userId", () => {
    const result = resolveAdminStatus("testuser", null, [], false);
    expect(result.authenticated).toBe(true);
    expect(result.userId).toBe("testuser");
  });
});

// ---------------------------------------------------------------------------
// encodeAdminSession / decodeAdminSession
// ---------------------------------------------------------------------------

describe("encodeAdminSession / decodeAdminSession", () => {
  it("round-trips a valid session (Req 2.2)", () => {
    const session = makeAdminSession();
    const encoded = encodeAdminSession(session, TEST_SECRET);
    const decoded = decodeAdminSession(encoded, TEST_SECRET);

    expect(decoded).not.toBeNull();
    expect(decoded!.userId).toBe(session.userId);
    expect(decoded!.apiKeyHash).toBe(session.apiKeyHash);
    expect(decoded!.createdAt).toBe(session.createdAt);
    expect(decoded!.expiresAt).toBe(session.expiresAt);
  });

  it("returns null for expired session (Req 2.5)", () => {
    const session = makeAdminSession({ expiresAt: Date.now() - 1000 });
    const encoded = encodeAdminSession(session, TEST_SECRET);
    expect(decodeAdminSession(encoded, TEST_SECRET)).toBeNull();
  });

  it("returns null for wrong secret", () => {
    const session = makeAdminSession();
    const encoded = encodeAdminSession(session, TEST_SECRET);
    expect(decodeAdminSession(encoded, "wrong-secret-wrong-secret-12345")).toBeNull();
  });

  it("returns null for tampered data", () => {
    const session = makeAdminSession();
    const encoded = encodeAdminSession(session, TEST_SECRET);
    const tampered = encoded.slice(0, 20) + "X" + encoded.slice(21);
    expect(decodeAdminSession(tampered, TEST_SECRET)).toBeNull();
  });

  it("returns null for garbage input", () => {
    expect(decodeAdminSession("not-valid-base64!!!", TEST_SECRET)).toBeNull();
  });

  it("returns null for too-short buffer", () => {
    const short = Buffer.alloc(20).toString("base64");
    expect(decodeAdminSession(short, TEST_SECRET)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// hashApiKey
// ---------------------------------------------------------------------------

describe("hashApiKey", () => {
  it("produces consistent SHA-256 hex hash", () => {
    const hash1 = hashApiKey("my-api-key");
    const hash2 = hashApiKey("my-api-key");
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex = 64 chars
  });

  it("different keys produce different hashes", () => {
    expect(hashApiKey("key-a")).not.toBe(hashApiKey("key-b"));
  });
});

// ---------------------------------------------------------------------------
// createAdminSession
// ---------------------------------------------------------------------------

describe("createAdminSession", () => {
  it("creates session with correct fields", () => {
    const session = createAdminSession("admin1", "api-key-123");
    expect(session.userId).toBe("admin1");
    expect(session.apiKeyHash).toBe(hashApiKey("api-key-123"));
    expect(session.createdAt).toBeLessThanOrEqual(Date.now());
    expect(session.expiresAt).toBeGreaterThan(Date.now());
  });

  it("respects custom maxAgeMs", () => {
    const before = Date.now();
    const session = createAdminSession("admin1", "key", 60_000);
    expect(session.expiresAt).toBeGreaterThanOrEqual(before + 60_000);
    expect(session.expiresAt).toBeLessThanOrEqual(Date.now() + 60_000 + 100);
  });
});

// ---------------------------------------------------------------------------
// getSessionSecret / resetSessionSecret
// ---------------------------------------------------------------------------

describe("getSessionSecret", () => {
  const originalEnv = process.env.KONDUCTOR_SESSION_SECRET;

  beforeEach(() => {
    resetSessionSecret();
  });

  afterEach(() => {
    resetSessionSecret();
    if (originalEnv !== undefined) {
      process.env.KONDUCTOR_SESSION_SECRET = originalEnv;
    } else {
      delete process.env.KONDUCTOR_SESSION_SECRET;
    }
  });

  it("uses KONDUCTOR_SESSION_SECRET env var when set", () => {
    process.env.KONDUCTOR_SESSION_SECRET = "my-secret-that-is-long-enough";
    const secret = getSessionSecret();
    expect(secret).toBe("my-secret-that-is-long-enough");
  });

  it("generates random secret when env var is not set", () => {
    delete process.env.KONDUCTOR_SESSION_SECRET;
    const secret = getSessionSecret();
    expect(secret).toHaveLength(64); // 32 random bytes → 64 hex chars
  });

  it("caches the secret across calls", () => {
    delete process.env.KONDUCTOR_SESSION_SECRET;
    const secret1 = getSessionSecret();
    const secret2 = getSessionSecret();
    expect(secret1).toBe(secret2);
  });
});
