# Authentication & Security Guidelines

## Multi-User System
- **User accounts**: `data/users.yaml` with bcrypt hashing, roles: `web`, `cli`, `admin`
- **Sessions**: 8-hour JWT tokens in httpOnly cookies
- **Per-user Snowflake credentials** - no shared accounts

## Security Implementation
- **Password requirements**: 8+ chars, mixed case, number, symbol
- **Rate limiting**: 5 login attempts/min, 10 queries/min per user
- **CSRF protection**: All state-changing operations require tokens
- **Input sanitization**: XSS prevention, path traversal protection

## Key Files
- `web/auth.py` - Authentication middleware
- `web/security.py` - CSRF, rate limiting, validation
- `scripts/manage_users.py` - User management CLI
- `data/users.yaml` - User accounts (bcrypt hashed)

## Admin Panel
- **Admin role required** for `/admin.html` access
- **Token validation** on all operations
- **Atomic file operations** prevent corruption
