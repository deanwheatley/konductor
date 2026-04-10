---
inclusion: always
---

# Documentation Standards

## README Maintenance

When implementing features or making changes to the codebase, always keep user-facing documentation up to date.

### When to Update the README

**Always update the README when:**
- A new feature, tool, or command is added
- Configuration options are added or changed
- Setup or installation steps change
- New dependencies are introduced
- Architecture or component structure changes
- New environment variables or config files are required

**README updates are not needed when:**
- Internal refactoring with no user-facing impact
- Test-only changes
- Code comments or inline documentation changes

### README Structure

Each project or significant component should have a README that covers:
1. **What it does** — one-paragraph overview
2. **Quick start** — minimal steps to get running
3. **Configuration** — all config options with defaults and examples
4. **Usage** — how to use the feature, with examples
5. **Architecture** — brief description of components (for developers)
6. **Troubleshooting** — common issues and solutions

### Documentation as Part of Implementation

- Treat README updates as part of the implementation task, not a separate follow-up
- When a task adds a new tool, endpoint, or config option, the README section for that item should be written in the same task
- When a task changes behavior, update the relevant README section in the same task
- Do not defer documentation to a "documentation task" at the end — it should be incremental

### Changelog

When completing a phase or milestone, add a dated entry to a CHANGELOG.md summarizing what was added, changed, or fixed. Keep entries concise.

### Project README

The root `README.md` serves as the project summary and roadmap. Keep it updated:
- When a milestone status changes (not started → in progress → complete), update the roadmap table
- When a phase is completed, update the "Current Status" section
- When new configuration options, tools, or components are added, update the relevant README sections
- When architecture changes, update the architecture diagram
- Treat the README as the single source of truth for project status
