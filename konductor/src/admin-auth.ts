/**
 * Admin Auth Module — Konductor Admin Dashboard
 *
 * Provides admin access control via a two-tier model:
 * 1. KONDUCTOR_ADMINS env var (highest precedence)
 * 2. User record `admin` flag in ISessionHistoryStore
 *
 * Also provides cookie-based session auth for browser access.
 *
 * Requirements: 1.1–1.6, 2.1–2.5
 */

import { randomBytes, createCipheriv, createDecipheriv, pbkdf2Sync, createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdminAuthResult {
  authenticated: boolean;
  userId: string | null;
  isAdmin: boolean;
  adminSource: "env" | "database" | null;
}

export interface AdminSession {
  userId: string;
  apiKeyHash: string;   // SHA-256 of the API key used to authenticate
  createdAt: number;    // Unix timestamp ms
  expiresAt: number;    // Unix timestamp ms
}

// ---------------------------------------------------------------------------
// KONDUCTOR_ADMINS Parsing (Requirement 1.6)
// ---------------------------------------------------------------------------

/**
 * Parse the KONDUCTOR_ADMINS env var into a list of trimmed, lowercased entries.
 * Accepts a comma-separated string of userIds and/or email addresses.
 * Empty entries and whitespace-only entries are discarded.
 */
export function parseKonductorAdmins(envValue: string | undefined): string[] {
  if (!envValue) return [];
  return envValue
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}


// ---------------------------------------------------------------------------
// Admin Resolution (Requirements 1.1–1.4)
// ---------------------------------------------------------------------------

/**
 * Minimal interface for looking up user admin status from the store.
 * This avoids coupling to the full ISessionHistoryStore.
 */
export interface AdminUserLookup {
  getUserAdminFlag(userId: string): Promise<boolean | null>;
  getUserEmail?(userId: string): Promise<string | null>;
}

/**
 * Resolve whether a user is an admin using the two-tier model:
 * 1. Check KONDUCTOR_ADMINS env var (userId or email match, case-insensitive)
 * 2. Fall back to user record `admin` flag
 *
 * Returns AdminAuthResult with the source of admin status.
 */
export function resolveAdminStatus(
  userId: string,
  email: string | null,
  adminList: string[],
  userAdminFlag: boolean | null,
): AdminAuthResult {
  const userIdLower = userId.toLowerCase();
  const emailLower = email?.toLowerCase() ?? null;

  // Tier 1: KONDUCTOR_ADMINS env var
  if (adminList.length > 0) {
    const matchesUserId = adminList.includes(userIdLower);
    const matchesEmail = emailLower !== null && adminList.includes(emailLower);
    if (matchesUserId || matchesEmail) {
      return {
        authenticated: true,
        userId,
        isAdmin: true,
        adminSource: "env",
      };
    }
  }

  // Tier 2: User record admin flag
  if (userAdminFlag === true) {
    return {
      authenticated: true,
      userId,
      isAdmin: true,
      adminSource: "database",
    };
  }

  // Not admin
  return {
    authenticated: true,
    userId,
    isAdmin: false,
    adminSource: null,
  };
}

// ---------------------------------------------------------------------------
// Cookie-Based Session Auth (Requirements 2.1–2.5)
// ---------------------------------------------------------------------------

const ADMIN_PBKDF2_SALT = Buffer.from("konductor-admin-session-salt");
const ADMIN_PBKDF2_ITERATIONS = 100_000;
const ADMIN_KEY_LENGTH = 32;
const ADMIN_IV_LENGTH = 12;
const ADMIN_AUTH_TAG_LENGTH = 16;

/** Default session duration: 8 hours */
const DEFAULT_SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;

let _sessionSecret: string | null = null;

/**
 * Get or initialize the session secret.
 * Uses KONDUCTOR_SESSION_SECRET env var, or generates a random one (with warning).
 */
export function getSessionSecret(): string {
  if (_sessionSecret) return _sessionSecret;
  const envSecret = process.env.KONDUCTOR_SESSION_SECRET;
  if (envSecret && envSecret.length >= 16) {
    _sessionSecret = envSecret;
  } else {
    _sessionSecret = randomBytes(32).toString("hex");
    // Caller should log a warning that sessions won't survive restarts
  }
  return _sessionSecret;
}

/** Reset the cached secret (for testing). */
export function resetSessionSecret(): void {
  _sessionSecret = null;
}

function deriveAdminKey(secret: string): Buffer {
  return pbkdf2Sync(secret, ADMIN_PBKDF2_SALT, ADMIN_PBKDF2_ITERATIONS, ADMIN_KEY_LENGTH, "sha256");
}

/**
 * Encrypt an AdminSession into a base64 cookie value.
 * Format: base64(iv + authTag + ciphertext)
 */
export function encodeAdminSession(session: AdminSession, secret: string): string {
  const key = deriveAdminKey(secret);
  const iv = randomBytes(ADMIN_IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = JSON.stringify(session);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

/**
 * Decrypt a cookie value back into an AdminSession.
 * Returns null if invalid, expired, or tampered.
 */
export function decodeAdminSession(cookieValue: string, secret: string): AdminSession | null {
  try {
    const buf = Buffer.from(cookieValue, "base64");
    if (buf.length < ADMIN_IV_LENGTH + ADMIN_AUTH_TAG_LENGTH + 1) return null;

    const iv = buf.subarray(0, ADMIN_IV_LENGTH);
    const authTag = buf.subarray(ADMIN_IV_LENGTH, ADMIN_IV_LENGTH + ADMIN_AUTH_TAG_LENGTH);
    const ciphertext = buf.subarray(ADMIN_IV_LENGTH + ADMIN_AUTH_TAG_LENGTH);

    const key = deriveAdminKey(secret);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const session: AdminSession = JSON.parse(decrypted.toString("utf8"));

    // Validate expiry
    if (session.expiresAt < Date.now()) return null;

    return session;
  } catch {
    return null;
  }
}

/**
 * Hash an API key for storage in the session cookie.
 */
export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

/**
 * Create a new admin session after successful login.
 */
export function createAdminSession(userId: string, apiKey: string, maxAgeMs?: number): AdminSession {
  const now = Date.now();
  return {
    userId,
    apiKeyHash: hashApiKey(apiKey),
    createdAt: now,
    expiresAt: now + (maxAgeMs ?? DEFAULT_SESSION_MAX_AGE_MS),
  };
}
