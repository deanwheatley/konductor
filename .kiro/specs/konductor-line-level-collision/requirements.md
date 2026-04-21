# Requirements Document

## Introduction

The Konductor currently detects collisions at the file level — if two users edit the same file, it's a Collision Course regardless of whether they're working on the same function or completely different sections. This spec adds line-level collision detection, allowing the server to distinguish between "same file, different sections" (lower risk) and "same file, same lines" (highest risk). The file watcher reports line ranges for each modified file, and the collision evaluator uses this information to provide more precise severity assessments and actionable guidance.

## Dependencies

- `konductor-mcp-server` — provides the collision evaluator, session manager, and API endpoints
- `konductor-bugs-and-missing-features` — provides the watcher branch detection (Requirement 7) which this feature extends

## Glossary

- **Line Range**: A contiguous range of lines in a file represented as `{ startLine: number, endLine: number }` (1-indexed, inclusive)
- **File Change**: A modification to a file, optionally annotated with one or more line ranges indicating which sections were changed
- **Line Overlap**: When two users' line ranges for the same file have a non-empty intersection
- **Section Collision**: Two users editing the same file but in non-overlapping line ranges (lower risk than line overlap)
- **Line Collision**: Two users editing the same file with overlapping line ranges (highest risk)
- **Collision Evaluator**: The server component that computes collision state from session overlap
- **File Watcher**: The background process (`konductor-watcher.mjs`) that monitors file changes and reports them to the server

## Requirements

### Requirement 1: Watcher Reports Line Ranges

**User Story:** As a developer, I want the file watcher to report which lines I've changed in each file, so that the server can determine whether my changes overlap with another user's at the line level.

#### Acceptance Criteria

1. WHEN the file watcher detects a file change, THE watcher SHALL determine the modified line ranges using `git diff` output (unified diff hunks)
2. WHEN reporting file changes to the server, THE watcher SHALL include an optional `lineRanges` field for each file: `{ file: string, lineRanges?: Array<{ startLine: number, endLine: number }> }`
3. WHEN `git diff` is not available or fails for a file (new untracked file, binary file), THE watcher SHALL omit `lineRanges` for that file (file-level fallback)
4. WHEN a file has multiple non-contiguous changed sections, THE watcher SHALL report multiple line ranges for that file
5. THE line range format SHALL use 1-indexed, inclusive line numbers (matching `git diff` output)

### Requirement 2: Server Accepts Line Range Data

**User Story:** As a server operator, I want the server to accept and store line range information alongside file paths, so that the collision evaluator can use it for more precise detection.

#### Acceptance Criteria

1. WHEN a `register_session` call includes `lineRanges` for a file, THE server SHALL store the line ranges alongside the file path in the session record
2. WHEN a `register_session` call does NOT include `lineRanges` for a file, THE server SHALL treat the entire file as the modified range (full-file fallback)
3. THE `/api/register` endpoint SHALL accept an extended files format: `files` may be an array of strings (backward compatible) OR an array of objects `{ path: string, lineRanges?: Array<{ startLine: number, endLine: number }> }`
4. WHEN the files array contains a mix of strings and objects, THE server SHALL handle both formats in the same request
5. THE existing MCP `register_session` tool SHALL accept the same extended format in its `files` parameter

### Requirement 3: Line-Level Collision Evaluation

**User Story:** As a developer, I want the collision evaluator to distinguish between "same file, different sections" and "same file, same lines," so that I get more precise risk assessments.

#### Acceptance Criteria

1. WHEN two users edit the same file AND their line ranges overlap (non-empty intersection), THE evaluator SHALL classify this as a "line collision" and maintain the Collision Course (or Merge Hell) state
2. WHEN two users edit the same file BUT their line ranges do NOT overlap, THE evaluator SHALL classify this as a "Proximity" state — a new state between Crossroads and Collision Course (severity 2.5)
3. WHEN one or both users have no line range data for a shared file, THE evaluator SHALL fall back to Collision Course (assume worst case, current behavior)
4. THE new "Proximity" state SHALL NOT pause the agent (same behavior as Crossroads)
5. THE new "Proximity" state SHALL NOT trigger Slack notifications at default verbosity (level 2)
6. WHEN reporting collision details in Proximity state, THE server SHALL include the specific non-overlapping line ranges for context

### Requirement 4: Enhanced Collision Messages

**User Story:** As a developer, I want collision notifications to tell me whether the overlap is at the line level or just the file level, so that I can prioritize my coordination efforts.

#### Acceptance Criteria

1. WHEN a collision has `lineOverlap: true`, THE notification message SHALL include: "same lines" context (e.g., "bob is editing src/index.ts lines 10-25, overlapping with your lines 15-30")
2. WHEN a collision has `lineOverlap: false` (same file, different sections), THE notification message SHALL include: "different sections" context (e.g., "bob is editing src/index.ts lines 100-120 — you're in lines 10-25, no overlap")
3. WHEN line data is unavailable (`lineOverlap: null`), THE notification message SHALL use the existing file-level message (no change from current behavior)
4. THE Slack notification SHALL include line range information when available
5. THE Baton dashboard notification SHALL include line range information when available

### Requirement 5: Merge Severity Assessment

**User Story:** As a developer, I want Konductor to estimate how bad a potential merge conflict would be based on the extent of line overlap, so that I can decide whether to coordinate immediately or continue working.

#### Acceptance Criteria

1. WHEN a line collision is detected, THE server SHALL compute an overlap severity score based on: number of overlapping lines, percentage of each user's changes that overlap, and whether the overlap is on the same branch or different branches
2. THE overlap severity SHALL be reported as one of: `minimal` (1-5 overlapping lines), `moderate` (6-20 overlapping lines), `severe` (21+ overlapping lines or >50% of either user's changes)
3. WHEN the overlap severity is `severe`, THE notification SHALL include a recommendation: "High merge conflict risk. Coordinate immediately."
4. WHEN the overlap severity is `minimal`, THE notification SHALL include context: "Minor overlap — likely a quick merge resolution."
5. THE severity assessment SHALL be included in the `risk_assessment` MCP tool response

### Requirement 6: Pretty-Printer for Line Range Data

**User Story:** As a developer, I want line range data to be serialized and deserialized correctly, so that session persistence and API responses maintain data integrity.

#### Acceptance Criteria

1. WHEN a session with line ranges is serialized to JSON, THE server SHALL produce a valid JSON representation of all line ranges
2. WHEN a session with line ranges is deserialized from JSON, THE server SHALL produce line range objects equivalent to the originals (round-trip consistency)
3. THE server SHALL provide a human-readable format for line ranges in notification messages (e.g., "lines 10-25")
4. WHEN a line range has `startLine === endLine`, THE formatter SHALL display it as a single line (e.g., "line 10" not "lines 10-10")

### Requirement 7: Backward Compatibility

**User Story:** As a server operator, I want line-level detection to be fully backward compatible, so that existing clients without line range support continue working without changes.

#### Acceptance Criteria

1. WHEN a client sends `files` as an array of strings (no line ranges), THE server SHALL accept the request and use file-level collision detection (current behavior)
2. WHEN a client sends `files` as an array of objects with `lineRanges`, THE server SHALL use line-level detection for those files
3. THE collision state model (Solo through Merge Hell) SHALL remain unchanged — line data adds context, not new states
4. EXISTING clients SHALL NOT need any updates to continue functioning correctly
5. THE `check_status` and all query tools SHALL include line range context in responses only when line data is available
