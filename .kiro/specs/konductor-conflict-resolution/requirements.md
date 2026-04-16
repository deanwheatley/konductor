# Requirements: Conflict Resolution Detection

## Introduction

Konductor detects when users are working on the same files, but it doesn't currently detect when conflicts are resolved (e.g. after a merge). This feature adds client-side merge detection so the system can automatically clear resolved conflicts and notify users.

## Requirements

### Requirement 1: Client-side merge detection

**User Story:** As a developer, I want Konductor to automatically detect when I merge changes, so that resolved conflicts are cleared without manual intervention.

#### Acceptance Criteria

1. THE client watcher SHALL monitor `.git/refs/heads/` for ref changes indicating a merge or pull
2. WHEN a merge is detected (new commit on the current branch after a pull/merge), THE watcher SHALL call `register_session` with the updated file list
3. THE watcher SHALL detect the presence of `.git/MERGE_HEAD` as an indicator of an in-progress merge
4. WHEN `.git/MERGE_HEAD` is removed (merge completed), THE watcher SHALL re-evaluate collision state

### Requirement 2: Server-side conflict clearing

**User Story:** As a server operator, I want the collision state to automatically update when users merge, so that stale warnings are cleared.

#### Acceptance Criteria

1. WHEN a user re-registers a session after merging, THE server SHALL re-evaluate collision state against all active sessions
2. IF the merge resolved the file overlap (same branch now), THE collision state SHALL drop from merge_hell to collision_course or lower
3. THE server SHALL log a STATUS entry when a conflict is resolved: `[STATUS] [User: X] Conflict resolved in repo#branch`

### Requirement 3: User notification

**User Story:** As a developer, I want to be notified when a conflict I was warned about has been resolved.

#### Acceptance Criteria

1. WHEN the collision state drops from collision_course or merge_hell to a lower state, THE watcher SHALL print: `🟢 [Konductor] Conflict resolved — <previous state> → <new state>`
2. THE notification SHALL include which users were previously in conflict
3. THE steering rule SHALL instruct the agent to notify the user when collision state improves

### Requirement 4: Git event detection in watcher

#### Acceptance Criteria

1. THE watcher SHALL watch `.git/refs/heads/<current-branch>` for changes
2. WHEN the ref changes (new commit), THE watcher SHALL re-register the session to trigger a fresh collision evaluation
3. THE watcher SHALL detect `git pull`, `git merge`, and `git rebase` completions by monitoring ref changes
4. THE watcher SHALL NOT trigger on `git stash` or `git checkout` (branch switch is handled separately)

## Design Notes

### Detection approach

The watcher already uses `fs.watch` for file changes. We add watchers on:
- `.git/refs/heads/<branch>` — ref changes (commits, merges, pulls)
- `.git/MERGE_HEAD` — merge in progress / completed

When a ref change is detected:
1. Re-read the current branch (in case of checkout)
2. Call `register_session` with current files
3. The server re-evaluates collision state
4. If state improved, the watcher's polling detects the change and notifies

### Conflict resolution flow

```
1. Alice and Bob both editing src/index.ts on different branches → MERGE HELL
2. Bob merges Alice's branch into his
3. Bob's watcher detects ref change on his branch
4. Bob's watcher re-registers → server evaluates → now same branch content → COLLISION COURSE (or lower)
5. Bob's watcher sees state drop → prints "Conflict resolved"
6. Alice's next poll also sees the state drop → she gets notified too
```

### State improvement detection

The watcher already tracks `lastStateSig`. When the state changes to a lower severity, that's a resolution. The `notify` function can compare old vs new severity and print a resolution message.
