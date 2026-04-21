# Requirements Document

## Introduction

The Konductor Baton dashboard currently serves repo pages without any authentication — anyone who can reach the server can view any repo's coordination data. This feature adds GitHub OAuth-based access control to the Baton dashboard, ensuring that only users with read access to a GitHub repository can view the corresponding Baton repo page. The authentication flow uses GitHub's OAuth web application flow to identify the user, then verifies their repository access via the GitHub API before granting access to the dashboard.

## Dependencies

- `konductor-baton` — the web dashboard that this feature secures
- `konductor-github` — GitHub API integration (provides the PAT and config patterns)

## Glossary

- **GitHub OAuth App**: A GitHub application registered by the team that enables the OAuth web flow for user authentication
- **OAuth Web Flow**: The standard GitHub OAuth authorization code flow — redirect to GitHub, user authorizes, GitHub redirects back with a code, server exchanges code for an access token
- **Baton Session**: A browser session (cookie-based) that tracks an authenticated user's identity and GitHub access token for the Baton dashboard
- **Repo Access Check**: A GitHub API call to verify whether an authenticated user has at least read access to a specific repository

## Requirements

### Requirement 1: GitHub OAuth Login Flow

**User Story:** As a developer, I want to log in to the Baton dashboard with my GitHub account, so that my identity is verified and my repo access can be checked.

#### Acceptance Criteria

1. WHEN a user navigates to a Baton repo page (`/repo/:repoName`) without a valid session, THE Baton SHALL redirect the user to `/auth/login?redirect=/repo/:repoName` to initiate the OAuth flow
2. WHEN the OAuth flow begins, THE server SHALL redirect the user to GitHub's authorization URL (`https://github.com/login/oauth/authorize`) with the configured `client_id`, a `state` parameter for CSRF protection, the `redirect_uri` pointing to `/auth/callback`, and the `repo` scope (or `read:org` for org-private repos)
3. WHEN GitHub redirects back to `/auth/callback` with an authorization `code` and valid `state`, THE server SHALL exchange the code for an access token via GitHub's token endpoint (`https://github.com/login/oauth/access_token`)
4. WHEN the token exchange succeeds, THE server SHALL fetch the user's GitHub profile (`GET /user`) to obtain their username and avatar URL
5. WHEN the user is authenticated, THE server SHALL create a Baton session cookie containing the user's GitHub username, access token (encrypted), and session expiry
6. WHEN the session is created, THE server SHALL redirect the user to the original `redirect` URL they were trying to access
7. WHEN the `state` parameter is missing or does not match the expected value, THE server SHALL reject the callback with a 403 error and a clear error message

### Requirement 2: Repository Access Verification

**User Story:** As a team lead, I want the Baton to verify that a user has access to a GitHub repo before showing them the repo page, so that sensitive coordination data is only visible to authorized team members.

#### Acceptance Criteria

1. WHEN an authenticated user requests a Baton repo page, THE server SHALL call the GitHub API (`GET /repos/:owner/:repo`) using the user's access token to verify they have at least read access
2. WHEN the GitHub API confirms access (200 response), THE server SHALL serve the repo page
3. WHEN the GitHub API returns 404 or 403, THE server SHALL return a 403 page explaining the user does not have access to this repository
4. WHEN the GitHub API call fails due to a network error or timeout, THE server SHALL return a 503 page asking the user to retry
5. WHEN the user's access token has been revoked or expired, THE server SHALL clear the session and redirect to the login flow
6. THE server SHALL cache successful access checks for a configurable duration (default: 5 minutes) to avoid excessive GitHub API calls

### Requirement 3: Session Management

**User Story:** As a developer, I want my Baton login session to persist across page loads, so that I don't have to re-authenticate on every page view.

#### Acceptance Criteria

1. THE Baton session cookie SHALL be httpOnly, Secure (when TLS is enabled), SameSite=Lax, and have a configurable expiry (default: 8 hours)
2. WHEN a session cookie is present and not expired, THE server SHALL use the stored identity without re-authenticating
3. WHEN a session cookie is expired, THE server SHALL clear the cookie and redirect to the login flow
4. WHEN a user navigates to `/auth/logout`, THE server SHALL clear the session cookie and redirect to the login page
5. THE session data (access token) SHALL be encrypted at rest in the cookie using a server-side secret key
6. THE server-side secret key SHALL be configurable via the `BATON_SESSION_SECRET` environment variable, with a random default generated at startup if not set

### Requirement 4: Baton API Authentication

**User Story:** As a developer, I want the Baton API endpoints to be protected by the same authentication, so that raw JSON data is not accessible without authorization.

#### Acceptance Criteria

1. WHEN an unauthenticated request hits any `/api/repo/:repoName/*` endpoint, THE server SHALL return 401 with a JSON error
2. WHEN an authenticated request hits an `/api/repo/:repoName/*` endpoint for a repo the user cannot access, THE server SHALL return 403 with a JSON error
3. THE SSE event stream endpoint (`/api/repo/:repoName/events`) SHALL require the same authentication and access check
4. THE notification resolve endpoint (`POST /api/repo/:repoName/notifications/:id/resolve`) SHALL require authentication

### Requirement 5: Configuration

**User Story:** As a server administrator, I want to configure the GitHub OAuth app credentials and auth behavior, so that I can deploy the Baton with proper authentication.

#### Acceptance Criteria

1. THE GitHub OAuth `client_id` SHALL be configurable via the `BATON_GITHUB_CLIENT_ID` environment variable
2. THE GitHub OAuth `client_secret` SHALL be configurable via the `BATON_GITHUB_CLIENT_SECRET` environment variable
3. WHEN `BATON_GITHUB_CLIENT_ID` is not set, THE Baton SHALL serve pages without authentication (backward compatible — existing behavior preserved)
4. THE access check cache duration SHALL be configurable via `BATON_ACCESS_CACHE_MINUTES` (default: 5)
5. THE session expiry SHALL be configurable via `BATON_SESSION_HOURS` (default: 8)
6. THE OAuth callback URL SHALL be automatically derived from the server's URL (`<serverUrl>/auth/callback`)

### Requirement 6: User Identity in Dashboard

**User Story:** As a developer, I want to see who I'm logged in as on the Baton dashboard, so that I know my identity is recognized.

#### Acceptance Criteria

1. WHEN a user is authenticated, THE Baton header SHALL display the user's GitHub avatar and username
2. WHEN a user is authenticated, THE Baton header SHALL include a "Logout" link that navigates to `/auth/logout`
3. WHEN authentication is disabled (no OAuth credentials configured), THE Baton SHALL display "Authentication disabled" in the header area

### Requirement 7: Error Pages

**User Story:** As a developer, I want clear error pages when authentication fails, so that I understand what went wrong and how to fix it.

#### Acceptance Criteria

1. WHEN a user is denied access to a repo, THE 403 page SHALL display the repo name, the user's GitHub username, and a message explaining they need repository access on GitHub
2. WHEN the OAuth flow fails (invalid state, token exchange error), THE error page SHALL display a clear message and a "Try again" link
3. WHEN the server cannot reach GitHub (503), THE error page SHALL explain the issue and offer a retry link
4. ALL error pages SHALL use the same dark theme as the Baton dashboard for visual consistency

### Requirement 8: Documentation

**User Story:** As a server administrator, I want documentation on setting up GitHub OAuth for the Baton, so that I can configure authentication correctly.

#### Acceptance Criteria

1. THE README SHALL include a section on creating a GitHub OAuth App (with the correct callback URL)
2. THE README SHALL document all auth-related environment variables (`BATON_GITHUB_CLIENT_ID`, `BATON_GITHUB_CLIENT_SECRET`, `BATON_SESSION_SECRET`, `BATON_ACCESS_CACHE_MINUTES`, `BATON_SESSION_HOURS`)
3. THE README SHALL explain that authentication is optional and the Baton falls back to open access when OAuth is not configured
4. THE `.env.local.example` SHALL include the new auth-related environment variables with comments
