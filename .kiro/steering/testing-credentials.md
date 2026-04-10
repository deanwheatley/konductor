# Testing Credentials

## Playwright UI Test Account
- Always use the `playwright_test` account for automated UI testing
- Credentials are in `.env` as `TEST_USERNAME` / `TEST_PASSWORD`
- Default: `playwright_test` / `PlaywrightTest1!`
- This account has roles: `web`, `admin`
- Test bookmark data lives in `data/bookmarks/playwright_test.yaml`

## Important
- Never use the `admin` account for automated tests
- The `playwright_test` user has dummy Snowflake credentials (`test`), so MCP queries will fail — tests should account for this
- Bookmark IDs must be valid UUIDs (8-4-4-4-12 hex format) or the server will reject them
