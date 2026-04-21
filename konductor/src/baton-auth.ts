/**
 * Baton Dashboard — GitHub OAuth Authentication Module
 *
 * Provides GitHub OAuth-based access control for the Baton dashboard.
 * When configured with a GitHub OAuth App's credentials, the server requires
 * users to authenticate via GitHub before viewing any repo page. When OAuth
 * is not configured, the Baton falls back to open-access behavior.
 *
 * Requirements: 1.x, 2.x, 3.x, 5.x, 7.x
 */

import { randomBytes, createCipheriv, createDecipheriv, pbkdf2Sync, createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface BatonAuthConfig {
  clientId: string;
  clientSecret: string;
  serverUrl: string;              // e.g. "https://hostname:3100"
  sessionSecret: string;          // for cookie encryption
  sessionMaxAgeHours: number;     // default: 8
  accessCacheMinutes: number;     // default: 5
}

export interface BatonSession {
  githubUsername: string;
  githubAvatarUrl: string;
  accessToken: string;
  createdAt: number;              // epoch ms
  expiresAt: number;              // epoch ms
}

export interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  maxAge?: number;                // seconds
  path?: string;
}

// ---------------------------------------------------------------------------
// Cookie Utilities
// ---------------------------------------------------------------------------

/**
 * Minimal cookie parser. Splits the Cookie header into key-value pairs.
 * Handles missing/empty headers, whitespace, and URI-encoded values.
 */
export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const pair of cookieHeader.split(";")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) continue;
    const key = pair.slice(0, eqIdx).trim();
    const val = pair.slice(eqIdx + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(val);
      } catch {
        result[key] = val;
      }
    }
  }
  return result;
}

/**
 * Build a Set-Cookie header string.
 * Requirements: 3.1 — httpOnly, Secure, SameSite=Lax
 */
export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  let cookie = `${name}=${encodeURIComponent(value)}`;
  if (options.httpOnly) cookie += "; HttpOnly";
  if (options.secure) cookie += "; Secure";
  if (options.sameSite) cookie += `; SameSite=${options.sameSite}`;
  if (options.maxAge !== undefined) cookie += `; Max-Age=${options.maxAge}`;
  if (options.path) cookie += `; Path=${options.path}`;
  return cookie;
}


// ---------------------------------------------------------------------------
// Session Cookie Encryption (AES-256-GCM)
// Requirements: 3.1, 3.5, 3.6
// ---------------------------------------------------------------------------

const PBKDF2_SALT = Buffer.from("konductor-baton-session-salt");
const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12;  // 96 bits for GCM
const AUTH_TAG_LENGTH = 16;

function deriveKey(secret: string): Buffer {
  return pbkdf2Sync(secret, PBKDF2_SALT, PBKDF2_ITERATIONS, KEY_LENGTH, "sha256");
}

/**
 * Encrypt a BatonSession into a base64 cookie value.
 * Format: base64(iv + authTag + ciphertext)
 */
export function encodeSession(session: BatonSession, secret: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = JSON.stringify(session);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

/**
 * Decrypt a cookie value back into a BatonSession.
 * Returns null if invalid, expired, or tampered.
 * Requirements: 3.3 — expired sessions rejected
 */
export function decodeSession(cookieValue: string, secret: string): BatonSession | null {
  try {
    const buf = Buffer.from(cookieValue, "base64");
    if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) return null;

    const iv = buf.subarray(0, IV_LENGTH);
    const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const key = deriveKey(secret);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const session: BatonSession = JSON.parse(decrypted.toString("utf8"));

    // Validate expiry
    if (session.expiresAt < Date.now()) return null;

    return session;
  } catch {
    return null;
  }
}


// ---------------------------------------------------------------------------
// Access Check Cache
// Requirements: 2.6
// ---------------------------------------------------------------------------

export class AccessCache {
  private cache = new Map<string, { result: "allowed" | "denied"; expiresAt: number }>();
  private ttlMs: number;

  constructor(ttlMinutes: number) {
    this.ttlMs = ttlMinutes * 60 * 1000;
  }

  private makeKey(token: string, owner: string, repo: string): string {
    const tokenHash = createHash("sha256").update(token).digest("hex").slice(0, 16);
    return `${tokenHash}:${owner}/${repo}`;
  }

  get(token: string, owner: string, repo: string): "allowed" | "denied" | null {
    const key = this.makeKey(token, owner, repo);
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.cache.delete(key);
      return null;
    }
    return entry.result;
  }

  set(token: string, owner: string, repo: string, result: "allowed" | "denied"): void {
    const key = this.makeKey(token, owner, repo);
    this.cache.set(key, { result, expiresAt: Date.now() + this.ttlMs });
  }

  /** Remove all cache entries for a given token (used on logout). */
  clear(token: string): void {
    const prefix = createHash("sha256").update(token).digest("hex").slice(0, 16) + ":";
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }
}


// ---------------------------------------------------------------------------
// BatonAuthModule
// Requirements: 1.x, 2.x, 3.x, 5.x
// ---------------------------------------------------------------------------

export class BatonAuthModule {
  private readonly config: BatonAuthConfig;
  private readonly accessCache: AccessCache;

  constructor(config: BatonAuthConfig) {
    this.config = config;
    this.accessCache = new AccessCache(config.accessCacheMinutes);
  }

  /** Check if auth is enabled (both clientId and clientSecret are set). Req 5.1, 5.2, 5.3 */
  isEnabled(): boolean {
    return Boolean(this.config.clientId) && Boolean(this.config.clientSecret);
  }

  /** Build the GitHub OAuth authorization URL with state param. Req 1.2 */
  buildAuthUrl(redirectPath: string): { url: string; state: string } {
    const state = randomBytes(16).toString("hex");
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: `${this.config.serverUrl}/auth/callback`,
      scope: "repo",
      state,
    });
    return {
      url: `https://github.com/login/oauth/authorize?${params.toString()}`,
      state,
    };
  }

  /** Exchange authorization code for access token + user profile. Req 1.3, 1.4, 1.7 */
  async handleCallback(code: string, state: string, expectedState: string): Promise<BatonSession> {
    // CSRF check
    if (!state || state !== expectedState) {
      throw new Error("OAuth state mismatch — possible CSRF attack");
    }

    // Exchange code for token
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
      }),
    });

    if (!tokenRes.ok) {
      throw new Error(`GitHub token exchange failed: ${tokenRes.status}`);
    }

    const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (tokenData.error || !tokenData.access_token) {
      throw new Error(`GitHub token exchange error: ${tokenData.error ?? "no access_token"}`);
    }

    const accessToken = tokenData.access_token;

    // Fetch user profile
    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": "Konductor-Baton",
      },
    });

    if (!userRes.ok) {
      throw new Error(`GitHub user profile fetch failed: ${userRes.status}`);
    }

    const userData = (await userRes.json()) as { login?: string; avatar_url?: string };
    if (!userData.login) {
      throw new Error("GitHub user profile missing login");
    }

    const now = Date.now();
    return {
      githubUsername: userData.login,
      githubAvatarUrl: userData.avatar_url ?? "",
      accessToken,
      createdAt: now,
      expiresAt: now + this.config.sessionMaxAgeHours * 60 * 60 * 1000,
    };
  }

  /** Encrypt a BatonSession into a cookie value. */
  encodeSession(session: BatonSession): string {
    return encodeSession(session, this.config.sessionSecret);
  }

  /** Decrypt a cookie value back into a BatonSession, or null if invalid/expired. */
  decodeSession(cookieValue: string): BatonSession | null {
    return decodeSession(cookieValue, this.config.sessionSecret);
  }

  /** Check if a user has access to a repo. Uses cache, falls back to GitHub API. Req 2.1–2.6 */
  async checkRepoAccess(accessToken: string, owner: string, repo: string): Promise<"allowed" | "denied" | "error"> {
    // Check cache first
    const cached = this.accessCache.get(accessToken, owner, repo);
    if (cached !== null) return cached;

    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "User-Agent": "Konductor-Baton",
        },
      });

      if (res.ok) {
        this.accessCache.set(accessToken, owner, repo, "allowed");
        return "allowed";
      }

      if (res.status === 404 || res.status === 403) {
        this.accessCache.set(accessToken, owner, repo, "denied");
        return "denied";
      }

      // Token revoked/expired — don't cache
      if (res.status === 401) {
        return "denied";
      }

      return "error";
    } catch {
      // Network error — don't cache
      return "error";
    }
  }

  /** Clear cached access for a user (e.g., on logout). */
  clearAccessCache(accessToken: string): void {
    this.accessCache.clear(accessToken);
  }

  /** Get the session secret for external use (e.g., state cookie encryption). */
  getSessionSecret(): string {
    return this.config.sessionSecret;
  }

  /** Get the session max age in seconds (for cookie Max-Age). */
  getSessionMaxAgeSec(): number {
    return this.config.sessionMaxAgeHours * 60 * 60;
  }

  /** Get the server URL. */
  getServerUrl(): string {
    return this.config.serverUrl;
  }

  /** Update the server URL (called when the actual URL is known after server starts). */
  setServerUrl(url: string): void {
    this.config.serverUrl = url;
  }
}


// ---------------------------------------------------------------------------
// Error Page Builders
// Requirements: 7.1, 7.2, 7.3, 7.4
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function buildErrorPageShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🎵 Konductor Baton — ${escapeHtml(title)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0f0f0f;
    color: #e0e0e0;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
  .header {
    background: #1a1a2e;
    padding: 16px 24px;
    display: flex;
    align-items: center;
    gap: 12px;
    border-bottom: 1px solid #2a2a3e;
  }
  .header .logo { font-size: 24px; }
  .header h1 { font-size: 18px; font-weight: 600; color: #fff; }
  .error-container {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 24px;
  }
  .error-card {
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    border-radius: 8px;
    padding: 40px;
    max-width: 500px;
    text-align: center;
  }
  .error-icon { font-size: 48px; margin-bottom: 16px; }
  .error-title { font-size: 20px; font-weight: 600; color: #fff; margin-bottom: 12px; }
  .error-message { font-size: 14px; color: #aaa; line-height: 1.6; margin-bottom: 24px; }
  .error-link {
    display: inline-block;
    background: #2a2a3e;
    color: #8b8bff;
    text-decoration: none;
    padding: 8px 20px;
    border-radius: 6px;
    font-size: 14px;
  }
  .error-link:hover { background: #3a3a4e; }
  .error-detail { font-size: 12px; color: #666; margin-top: 16px; }
</style>
</head>
<body>
<div class="header">
  <span class="logo">🎵</span>
  <h1>Konductor Baton</h1>
</div>
<div class="error-container">
  <div class="error-card">
    ${body}
  </div>
</div>
</body>
</html>`;
}

/** 403 page — user lacks repo access. Req 7.1 */
export function build403Page(repo: string, username: string): string {
  return buildErrorPageShell("Access Denied", `
    <div class="error-icon">🔒</div>
    <div class="error-title">Access Denied</div>
    <div class="error-message">
      <strong>${escapeHtml(username)}</strong>, you don't have access to
      <strong>${escapeHtml(repo)}</strong> on GitHub.<br>
      Ask a repository admin to grant you read access, then try again.
    </div>
    <a class="error-link" href="/auth/logout">Sign out</a>
    <div class="error-detail">Logged in as ${escapeHtml(username)}</div>
  `);
}

/** 503 page — GitHub API unreachable. Req 7.3 */
export function build503Page(retryUrl: string): string {
  return buildErrorPageShell("Service Unavailable", `
    <div class="error-icon">⚠️</div>
    <div class="error-title">GitHub Unavailable</div>
    <div class="error-message">
      We couldn't reach the GitHub API to verify your access.<br>
      This is usually temporary — please try again in a moment.
    </div>
    <a class="error-link" href="${escapeHtml(retryUrl)}">Retry</a>
  `);
}

/** Auth error page — OAuth flow failure. Req 7.2 */
export function buildAuthErrorPage(message: string): string {
  return buildErrorPageShell("Authentication Error", `
    <div class="error-icon">❌</div>
    <div class="error-title">Authentication Failed</div>
    <div class="error-message">${escapeHtml(message)}</div>
    <a class="error-link" href="/auth/login">Try again</a>
  `);
}

/** Logged-out confirmation page. */
export function buildLoggedOutPage(): string {
  return buildErrorPageShell("Logged Out", `
    <div class="error-icon">👋</div>
    <div class="error-title">You've been logged out</div>
    <div class="error-message">Your Baton session has been cleared.</div>
    <a class="error-link" href="/">Back to Baton</a>
  `);
}
