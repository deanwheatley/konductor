# Git Commit and PR Standards

## AI-Generated Content Tagging

All commits and pull requests that contain AI-generated code, tests, or documentation MUST be tagged with "ai-generated".

### Commit Message Format

When committing AI-generated content, include the tag in the commit message:

```bash
git commit -m "Add real-world bookmark execution tests [ai-generated]"
git commit -m "Fix bookmark execution bug [ai-generated]"
git commit -m "Update documentation for cache strategies [ai-generated]"
```

### Pull Request Requirements

When creating pull requests with AI-generated content:

1. **Title**: Include `[ai-generated]` tag
   ```
   [ai-generated] Add comprehensive bookmark testing suite
   ```

2. **Description**: Clearly indicate which parts were AI-generated

3. **Labels**: Add `ai-generated` label to the PR

### Branch Naming

When working on AI-generated features, consider using descriptive branch names:

```bash
git checkout -b feature/ai-generated-bookmark-tests
git checkout -b fix/ai-generated-cache-bug
```

## Mixed Content

If a commit contains both AI-generated and human-written code:

```bash
git commit -m "Add bookmark tests and manual fixes [ai-generated][manual-review]"
```
