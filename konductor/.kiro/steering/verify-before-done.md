---
inclusion: always
---

# Verify Before Done

## Rule

Before telling the user that work is complete, you MUST:

1. **Build**: Run `npx tsc` (or the project's build command) and confirm zero errors.
2. **Kill stale processes**: Run `lsof -ti:<port> | xargs kill -9` to free the port before starting.
3. **Start the server**: Launch `node dist/index.js` (or the project's start command) and wait 3 seconds.
4. **Verify clean startup**: Check the process output for errors (EADDRINUSE, unhandled exceptions, missing modules). If any error appears, fix it and retry.
5. **Smoke test**: Hit at least one endpoint (e.g. `/health`) to confirm the server responds.

Only after all 5 steps succeed should you report completion to the user.

## Why

The user should never encounter a broken server after being told work is done. Port conflicts (EADDRINUSE), compile errors, and runtime crashes must be caught by the agent, not discovered by the user.
