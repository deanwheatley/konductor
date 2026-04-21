# Implementation Plan

## Phase 1: Core Auth Module

- [x] 1. Implement BatonAuth module
  - [x] 1.1 Create `konductor/src/baton-auth.ts` with `BatonAuthConfig` interface, `BatonSession` interface, and `BatonAuthModule` class
    - `isEnabled()` returns true when `clientId` and `clientSecret` are both set
    - `parseCookies(cookieHeader)` minimal cookie parser
    - `serializeCookie(name, value, options)` Set-Cookie header builder with httpOnly, Secure, SameSite=Lax, Max-Age, Path
    - _Requirements: 5.1, 5.2, 5.3_
  - [x] 1.2 Implement session cookie encryption/decryption
    - `encodeSession(session)` — AES-256-GCM encrypt with PBKDF2-derived key from `sessionSecret`, returns base64(iv + authTag + ciphertext)
    - `decodeSession(cookieValue)` — decrypt and validate expiry, return null if invalid/expired/tampered
    - Generate random `sessionSecret` at startup if `BATON_SESSION_SECRET` not set, log warning
    - _Requirements: 3.1, 3.5, 3.6_
  - [x] 1.3 Implement OAuth URL builder and callback handler
    - `buildAuthUrl(redirectPath)` — generate GitHub authorize URL with client_id, state (random hex), redirect_uri, scope=repo
    - `handleCallback(code, state, expectedState)` — verify state match, exchange code for token via GitHub API, fetch user profile, return BatonSession
    - Use native `fetch` (Node 20+) for GitHub API calls
    - _Requirements: 1.2, 1.3, 1.4, 1.7_
  - [x] 1.4 Implement repo access check with cache
    - `checkRepoAccess(accessToken, owner, repo)` — check cache first, then call `GET /repos/:owner/:repo` with user's token
    - `AccessCache` class — in-memory TTL Map keyed by hash(token):owner/repo, configurable TTL from `BATON_ACCESS_CACHE_MINUTES`
    - `clearAccessCache(accessToken)` — remove all entries for a token (used on logout)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_
  - [x] 1.5 Implement error page builders
    - `build403Page(repo, username)` — dark-themed 403 page explaining missing repo access
    - `build503Page(retryUrl)` — dark-themed 503 page for GitHub API failures
    - `buildAuthErrorPage(message)` — dark-themed error page for OAuth failures with "Try again" link
    - `buildLoggedOutPage()` — dark-themed confirmation page
    - All pages use same CSS variables/theme as Baton dashboard
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 2. Write property tests for auth module
  - [x] 2.1 Property test: session cookie encryption round-trip — for any valid BatonSession, encode then decode with same secret produces equivalent session
    - **Property 2: Session cookie encryption round-trip**
    - **Validates: Requirements 3.1, 3.5**
  - [x] 2.2 Property test: decode with wrong secret returns null
    - **Property 2 (cont.): Different secret rejects session**
    - **Validates: Requirement 3.5**
  - [x] 2.3 Property test: expired sessions are rejected — for any session with expiresAt < now, decode returns null
    - **Property 5: Expired sessions are rejected**
    - **Validates: Requirement 3.3**
  - [x] 2.4 Property test: access check cache correctness — cache returns stored result within TTL, null after TTL
    - **Property 4: Access check caching correctness**
    - **Validates: Requirement 2.6**

- [x] 3. Write unit tests for auth module
  - [x] 3.1 Create `konductor/src/baton-auth.test.ts`
    - `isEnabled()` returns false when clientId or clientSecret missing
    - `buildAuthUrl()` generates correct GitHub URL with all required params
    - `handleCallback()` rejects mismatched state with error
    - `handleCallback()` exchanges code and returns session (mocked fetch)
    - `decodeSession()` returns null for tampered cookie data
    - `checkRepoAccess()` returns "allowed" for 200, "denied" for 404/403, "error" for network failure
    - `checkRepoAccess()` returns cached result on second call within TTL
    - `parseCookies()` handles empty string, single cookie, multiple cookies, special characters
    - `serializeCookie()` generates correct Set-Cookie header with all options
    - Error page builders produce HTML containing expected content strings
    - _Requirements: 1.2, 1.3, 1.7, 2.1, 2.2, 2.3, 2.6, 3.3, 3.5, 7.1, 7.2, 7.3, 7.4_

- [x] 4. Checkpoint — all auth module tests pass

## Phase 2: Server Integration

- [x] 5. Wire auth routes into HTTP server
  - [x] 5.1 Add auth routes to `requestHandler` in `konductor/src/index.ts`
    - `GET /auth/login?redirect=<path>` — set `baton_auth_state` cookie, redirect to GitHub
    - `GET /auth/callback?code=<code>&state=<state>` — verify state, exchange code, set `baton_session` cookie, redirect to stored path
    - `GET /auth/logout` — clear cookies, clear access cache, redirect to logged-out page
    - `GET /auth/logged-out` — serve logged-out page
    - Initialize `BatonAuthModule` in `createComponents()` when env vars are present
    - Pass auth module to `startSseServer()` via deps
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 3.4_
  - [x] 5.2 Add auth middleware to Baton page routes
    - Before serving `/repo/:repoName`: check auth enabled → check session cookie → check repo access → serve or redirect/error
    - Extract owner/repo from session manager or URL for access check
    - Pass decoded user info to `buildRepoPage()` for header display
    - _Requirements: 1.1, 2.1, 2.2, 2.3, 2.4, 2.5_
  - [x] 5.3 Add auth middleware to Baton API routes
    - Before serving `/api/repo/:repoName/*`: check auth enabled → check session cookie (return 401 JSON if missing) → check repo access (return 403 JSON if denied)
    - Apply to: summary, notifications, log, resolve, and SSE events endpoints
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [x] 5.4 Read auth config from environment in `createComponents()` or `main()`
    - Read `BATON_GITHUB_CLIENT_ID`, `BATON_GITHUB_CLIENT_SECRET`, `BATON_SESSION_SECRET`, `BATON_SESSION_HOURS`, `BATON_ACCESS_CACHE_MINUTES`
    - If client_id set but client_secret missing, log warning and disable auth
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 6. Update Baton page header for user identity
  - [x] 6.1 Update `buildRepoPage()` in `baton-page-builder.ts` to accept optional `user` parameter
    - When user provided: show avatar (small img), username, and "Logout" link in header
    - When user is null (auth disabled): show "Authentication disabled" text
    - When user is undefined (not passed): no change to header (backward compatible)
    - _Requirements: 6.1, 6.2, 6.3_

- [x] 7. Write integration tests for auth flow
  - [x] 7.1 Add tests to `konductor/src/index.test.ts`
    - Auth disabled: Baton routes serve without auth check (Property 1)
    - Auth enabled, no session: `/repo/:repoName` redirects to `/auth/login`
    - Auth enabled, no session: `/api/repo/:repoName` returns 401 JSON (Property 6)
    - Auth enabled, valid session, repo access: page served with user in header
    - Auth enabled, valid session, no repo access: 403 page/JSON returned
    - Auth enabled, expired session: redirects to login
    - `/auth/callback` with mismatched state returns 403 (Property 3)
    - `/auth/logout` clears session and redirects
    - Redirect path preserved through OAuth flow (Property 7)
    - _Requirements: 1.1, 1.7, 2.2, 2.3, 3.3, 4.1, 4.2, 5.3_

- [x] 8. Checkpoint — all server integration tests pass

## Phase 3: Documentation & Configuration

- [x] 9. Update environment configuration
  - [x] 9.1 Add auth env vars to `konductor/.env.local.example`
    - `BATON_GITHUB_CLIENT_ID`, `BATON_GITHUB_CLIENT_SECRET`, `BATON_SESSION_SECRET`, `BATON_SESSION_HOURS`, `BATON_ACCESS_CACHE_MINUTES`
    - Include comments explaining each variable and that auth is optional
    - _Requirements: 8.4_

- [x] 10. Update README documentation
  - [x] 10.1 Add "Baton Authentication" section to `konductor/README.md`
    - How to create a GitHub OAuth App (Settings → Developer settings → OAuth Apps → New)
    - Correct callback URL pattern: `<serverUrl>/auth/callback`
    - All auth-related env vars with defaults and descriptions
    - Explain auth is optional — omit `BATON_GITHUB_CLIENT_ID` to keep open access
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 11. Final checkpoint — all tests pass, README updated
