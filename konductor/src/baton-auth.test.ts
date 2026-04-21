/**
 * Unit Tests for Baton Auth Module
 *
 * Requirements: 1.2, 1.3, 1.7, 2.1, 2.2, 2.3, 2.6, 3.3, 3.5, 7.1, 7.2, 7.3, 7.4
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseCookies,
  serializeCookie,
  encodeSession,
  decodeSession,
  AccessCache,
  BatonAuthModule,
  build403Page,
  build503Page,
  buildAuthErrorPage,
  buildLoggedOutPage,
  type BatonAuthConfig,
  type BatonSession,
} from "./baton-auth.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_SECRET = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4";

function makeSession(overrides: Partial<BatonSession> = {}): BatonSession {
  return {
    githubUsername: "testuser",
    githubAvatarUrl: "https://avatars.githubusercontent.com/u/12345",
    accessToken: "gho_abc123def456",
    createdAt: Date.now() - 60_000,
    expiresAt: Date.now() + 8 * 60 * 60 * 1000,
    ...overrides,
  };
}

function makeConfig(overrides: Partial<BatonAuthConfig> = {}): BatonAuthConfig {
  return {
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    serverUrl: "https://localhost:3100",
    sessionSecret: TEST_SECRET,
    sessionMaxAgeHours: 8,
    accessCacheMinutes: 5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parseCookies
// ---------------------------------------------------------------------------

describe("parseCookies", () => {
  it("returns empty object for undefined", () => {
    expect(parseCookies(undefined)).toEqual({});
  });

  it("returns empty object for empty string", () => {
    expect(parseCookies("")).toEqual({});
  });

  it("parses a single cookie", () => {
    expect(parseCookies("name=value")).toEqual({ name: "value" });
  });

  it("parses multiple cookies", () => {
    const result = parseCookies("a=1; b=2; c=3");
    expect(result).toEqual({ a: "1", b: "2", c: "3" });
  });

  it("handles URI-encoded values", () => {
    const result = parseCookies("data=%7B%22key%22%3A%22val%22%7D");
    expect(result).toEqual({ data: '{"key":"val"}' });
  });

  it("handles cookies with = in value", () => {
    const result = parseCookies("token=abc=def=ghi");
    expect(result).toEqual({ token: "abc=def=ghi" });
  });
});


// ---------------------------------------------------------------------------
// serializeCookie
// ---------------------------------------------------------------------------

describe("serializeCookie", () => {
  it("generates a basic cookie string", () => {
    const result = serializeCookie("name", "value");
    expect(result).toBe("name=value");
  });

  it("generates a cookie with all options", () => {
    const result = serializeCookie("session", "abc123", {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      maxAge: 28800,
      path: "/",
    });
    expect(result).toContain("session=abc123");
    expect(result).toContain("HttpOnly");
    expect(result).toContain("Secure");
    expect(result).toContain("SameSite=Lax");
    expect(result).toContain("Max-Age=28800");
    expect(result).toContain("Path=/");
  });

  it("URI-encodes the value", () => {
    const result = serializeCookie("data", "hello world");
    expect(result).toBe("data=hello%20world");
  });
});

// ---------------------------------------------------------------------------
// encodeSession / decodeSession
// ---------------------------------------------------------------------------

describe("encodeSession / decodeSession", () => {
  it("round-trips a valid session", () => {
    const session = makeSession();
    const encoded = encodeSession(session, TEST_SECRET);
    const decoded = decodeSession(encoded, TEST_SECRET);

    expect(decoded).not.toBeNull();
    expect(decoded!.githubUsername).toBe(session.githubUsername);
    expect(decoded!.accessToken).toBe(session.accessToken);
    expect(decoded!.expiresAt).toBe(session.expiresAt);
  });

  it("returns null for tampered cookie data", () => {
    const session = makeSession();
    const encoded = encodeSession(session, TEST_SECRET);
    // Flip a character in the middle of the base64 string
    const tampered = encoded.slice(0, 20) + "X" + encoded.slice(21);
    expect(decodeSession(tampered, TEST_SECRET)).toBeNull();
  });

  it("returns null for expired session (Req 3.3)", () => {
    const session = makeSession({ expiresAt: Date.now() - 1000 });
    const encoded = encodeSession(session, TEST_SECRET);
    expect(decodeSession(encoded, TEST_SECRET)).toBeNull();
  });

  it("returns null for wrong secret (Req 3.5)", () => {
    const session = makeSession();
    const encoded = encodeSession(session, TEST_SECRET);
    expect(decodeSession(encoded, "wrong-secret-wrong-secret-wrong1")).toBeNull();
  });

  it("returns null for garbage input", () => {
    expect(decodeSession("not-valid-base64!!!", TEST_SECRET)).toBeNull();
  });

  it("returns null for too-short buffer", () => {
    // Less than IV + authTag + 1 byte
    const short = Buffer.alloc(20).toString("base64");
    expect(decodeSession(short, TEST_SECRET)).toBeNull();
  });
});


// ---------------------------------------------------------------------------
// AccessCache
// ---------------------------------------------------------------------------

describe("AccessCache", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("returns null for uncached entry", () => {
    const cache = new AccessCache(5);
    expect(cache.get("tok", "owner", "repo")).toBeNull();
  });

  it("returns cached result on second call within TTL (Req 2.6)", () => {
    const cache = new AccessCache(5);
    cache.set("tok", "owner", "repo", "allowed");
    expect(cache.get("tok", "owner", "repo")).toBe("allowed");
  });

  it("returns null after TTL expires", () => {
    const cache = new AccessCache(5);
    cache.set("tok", "owner", "repo", "denied");
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    expect(cache.get("tok", "owner", "repo")).toBeNull();
  });

  it("clear removes all entries for a token", () => {
    const cache = new AccessCache(60);
    cache.set("tok", "owner", "repo1", "allowed");
    cache.set("tok", "owner", "repo2", "denied");
    cache.clear("tok");
    expect(cache.get("tok", "owner", "repo1")).toBeNull();
    expect(cache.get("tok", "owner", "repo2")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// BatonAuthModule.isEnabled
// ---------------------------------------------------------------------------

describe("BatonAuthModule.isEnabled", () => {
  it("returns true when both clientId and clientSecret are set", () => {
    const mod = new BatonAuthModule(makeConfig());
    expect(mod.isEnabled()).toBe(true);
  });

  it("returns false when clientId is empty", () => {
    const mod = new BatonAuthModule(makeConfig({ clientId: "" }));
    expect(mod.isEnabled()).toBe(false);
  });

  it("returns false when clientSecret is empty", () => {
    const mod = new BatonAuthModule(makeConfig({ clientSecret: "" }));
    expect(mod.isEnabled()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BatonAuthModule.buildAuthUrl
// ---------------------------------------------------------------------------

describe("BatonAuthModule.buildAuthUrl", () => {
  it("generates correct GitHub URL with all required params (Req 1.2)", () => {
    const mod = new BatonAuthModule(makeConfig());
    const { url, state } = mod.buildAuthUrl("/repo/my-repo");

    expect(url).toContain("https://github.com/login/oauth/authorize");
    expect(url).toContain("client_id=test-client-id");
    expect(url).toContain("redirect_uri=");
    expect(url).toContain("%2Fauth%2Fcallback");
    expect(url).toContain("scope=repo");
    expect(url).toContain(`state=${state}`);
    expect(state).toHaveLength(32); // 16 random bytes → 32 hex chars
  });
});


// ---------------------------------------------------------------------------
// BatonAuthModule.handleCallback
// ---------------------------------------------------------------------------

describe("BatonAuthModule.handleCallback", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("rejects mismatched state with error (Req 1.7)", async () => {
    const mod = new BatonAuthModule(makeConfig());
    await expect(mod.handleCallback("code123", "state-a", "state-b"))
      .rejects.toThrow("OAuth state mismatch");
  });

  it("rejects empty state", async () => {
    const mod = new BatonAuthModule(makeConfig());
    await expect(mod.handleCallback("code123", "", "expected-state"))
      .rejects.toThrow("OAuth state mismatch");
  });

  it("exchanges code and returns session with mocked fetch (Req 1.3)", async () => {
    const mod = new BatonAuthModule(makeConfig());

    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "gho_test_token_123" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ login: "octocat", avatar_url: "https://avatars.githubusercontent.com/u/1" }),
      }),
    );

    const session = await mod.handleCallback("valid-code", "state-x", "state-x");

    expect(session.githubUsername).toBe("octocat");
    expect(session.githubAvatarUrl).toBe("https://avatars.githubusercontent.com/u/1");
    expect(session.accessToken).toBe("gho_test_token_123");
    expect(session.expiresAt).toBeGreaterThan(Date.now());
  });

  it("throws when token exchange fails", async () => {
    const mod = new BatonAuthModule(makeConfig());

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
    }));

    await expect(mod.handleCallback("code", "s", "s"))
      .rejects.toThrow("GitHub token exchange failed: 500");
  });

  it("throws when token response has error field", async () => {
    const mod = new BatonAuthModule(makeConfig());

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: "bad_verification_code" }),
    }));

    await expect(mod.handleCallback("code", "s", "s"))
      .rejects.toThrow("bad_verification_code");
  });
});

// ---------------------------------------------------------------------------
// BatonAuthModule.checkRepoAccess
// ---------------------------------------------------------------------------

describe("BatonAuthModule.checkRepoAccess", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns 'allowed' for 200 response (Req 2.1, 2.2)", async () => {
    const mod = new BatonAuthModule(makeConfig());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, status: 200 }));

    const result = await mod.checkRepoAccess("token", "owner", "repo");
    expect(result).toBe("allowed");
  });

  it("returns 'denied' for 404 response (Req 2.3)", async () => {
    const mod = new BatonAuthModule(makeConfig());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: false, status: 404 }));

    const result = await mod.checkRepoAccess("token", "owner", "repo");
    expect(result).toBe("denied");
  });

  it("returns 'denied' for 403 response (Req 2.3)", async () => {
    const mod = new BatonAuthModule(makeConfig());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: false, status: 403 }));

    const result = await mod.checkRepoAccess("token", "owner", "repo");
    expect(result).toBe("denied");
  });

  it("returns 'error' for network failure", async () => {
    const mod = new BatonAuthModule(makeConfig());
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("ECONNREFUSED")));

    const result = await mod.checkRepoAccess("token", "owner", "repo");
    expect(result).toBe("error");
  });

  it("returns cached result on second call within TTL (Req 2.6)", async () => {
    const mod = new BatonAuthModule(makeConfig());
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await mod.checkRepoAccess("token", "owner", "repo");
    await mod.checkRepoAccess("token", "owner", "repo");

    // fetch should only be called once — second call served from cache
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});


// ---------------------------------------------------------------------------
// Error Page Builders
// Requirements: 7.1, 7.2, 7.3, 7.4
// ---------------------------------------------------------------------------

describe("Error Page Builders", () => {
  it("build403Page contains repo name, username, and access message (Req 7.1)", () => {
    const html = build403Page("owner/my-repo", "testuser");
    expect(html).toContain("owner/my-repo");
    expect(html).toContain("testuser");
    expect(html).toContain("Access Denied");
    expect(html).toContain("Sign out");
    // Dark theme check (Req 7.4)
    expect(html).toContain("background: #0f0f0f");
  });

  it("build503Page contains retry link and explanation (Req 7.3)", () => {
    const html = build503Page("/repo/my-repo");
    expect(html).toContain("/repo/my-repo");
    expect(html).toContain("Retry");
    expect(html).toContain("GitHub Unavailable");
    expect(html).toContain("background: #0f0f0f");
  });

  it("buildAuthErrorPage contains message and try again link (Req 7.2)", () => {
    const html = buildAuthErrorPage("Invalid state parameter");
    expect(html).toContain("Invalid state parameter");
    expect(html).toContain("Try again");
    expect(html).toContain("/auth/login");
    expect(html).toContain("Authentication Failed");
    expect(html).toContain("background: #0f0f0f");
  });

  it("buildLoggedOutPage contains logged out message", () => {
    const html = buildLoggedOutPage();
    expect(html).toContain("logged out");
    expect(html).toContain("Back to Baton");
    expect(html).toContain("background: #0f0f0f");
  });

  it("error pages escape HTML in user input (Req 7.4)", () => {
    const html = build403Page("<script>alert(1)</script>", "<b>hacker</b>");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<b>hacker</b>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;b&gt;");
  });
});
