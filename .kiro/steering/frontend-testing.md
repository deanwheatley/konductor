---
inclusion: fileMatch
fileMatchPattern: "web/static/*.js"
---

# Frontend Testing Requirements

## When modifying frontend JavaScript files

1. **Always consider E2E impact**: Changes to `bookmarks-panel.js`, `app.js`, `conversation-manager.js`, or `message-renderer.js` affect user-visible behavior. After making changes, verify with Playwright UI tests.

2. **Run Playwright UI tests**: After modifying any JS file in `web/static/`, run the relevant Playwright tests:
   ```bash
   npx playwright test tests/ui/ --reporter=list
   ```

3. **Key regression areas to verify**:
   - Bookmark execution: cached response content must remain visible after background refresh
   - Conversation persistence: conversations must not disappear after agent changes or bookmark runs
   - Home screen: must not flash or reappear during bookmark execution
   - System messages: info messages use blue styling, warnings use red — never mix them up

4. **Content wipe pattern**: A common regression is calling `loadConversationById()` after dynamically adding content (system messages, appended fresh data). This reloads from storage and wipes anything not persisted. Always check whether a reload is necessary.

5. **Test files to run for bookmark changes**:
   - `tests/ui/bookmark-cached-response-display.spec.js` — cached response visibility
   - `tests/ui/bookmark-conversation-persistence.spec.js` — conversation survival
   - `tests/ui/bookmarks.spec.js` — panel interactions and cache strategies
   - `tests/ui/bookmark-home-screen-regression.spec.js` — home screen behavior

6. **Backend Python tests are not sufficient** for frontend regressions. Python tests validate API responses and data flow, but cannot catch DOM rendering issues, conversation wipes, or styling problems.
