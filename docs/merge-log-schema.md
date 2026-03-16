# Merge Log Schema

## Purpose

Define a fixed field schema for merge-related logs so the full chain can be correlated from:

- Feishu action / message entry
- orchestrator merge use-case
- git merge utilities
- resolver/retry turn-complete callbacks

The schema is now also defined in code at:

- `packages/git-utils/src/merge-log-schema.ts`

This code definition is intentionally minimal:

- one shared `MergeLogContext` type
- no field-name constant set
- no extra builder DSL

## Current Entry Points

As of now, merge operations are triggered by:

- **Feishu card actions** in `src/feishu/feishu-card-handler.ts`
- **resolver turn-complete callbacks** through `EventPipeline`

There is **no separate slash-command merge path** in inbound text handling today:

- `packages/channel-core/src/intent-router.ts` currently routes inbound text to `TURN_START`
- merge command flows are therefore card-driven, not text-command-driven

## Required Standard Fields

Use these names whenever the value exists:

- `traceId`
- `chatId`
- `userId`
- `threadId`
- `turnId`
- `branchName`
- `resolverName`
- `worktreePath`
- `filePath`

## Field Semantics

### `traceId`
- Primary end-to-end correlation key
- Usually sourced from Feishu `messageId`
- Must stay stable across one merge request / resolver callback chain when available

### `chatId`
- IM conversation scope
- Required for all merge use-case logs

### `threadId`
- Agent thread identity
- For resolver/retry callbacks, use the actual resolver thread id

### `turnId`
- Agent turn identity
- For merge resolver / retry flows, use the resolver turn id bound into `EventPipeline`

### `branchName`
- The branch being merged or reviewed
- Required for merge logs

### `resolverName`
- Resolver thread name, typically `merge-${branchName}`
- Required when the log is about conflict resolution or resolver completion

### `worktreePath`
- Concrete git worktree path being operated on
- Recommended for git merge/session logs

### `filePath`
- Specific file under review/retry/decision
- Only for per-file review logs

## Recommended Per-Stage Minimum Context

### 1. Merge entry
- `traceId`
- `chatId`
- `branchName`
- `userId`
- `threadId`
- `turnId`

### 2. Merge review session
- `traceId`
- `chatId`
- `branchName`
- `worktreePath`

### 3. Resolver / retry turn
- `traceId`
- `chatId`
- `branchName`
- `resolverName`
- `threadId`
- `turnId`
- `worktreePath`

### 4. Git merge utility
- `traceId`
- `chatId`
- `branchName`
- `resolverName`
- `threadId`
- `turnId`
- `worktreePath`
- `filePath` when applicable

## Naming Rules

Do not introduce alternate names like:

- `branch` → use `branchName`
- `resolverThread` / `resolverThreadName` → use `resolverName`
- `path` → use `worktreePath` or `filePath`
- `msgId` / `requestId` → use `traceId`

## Log Level Guidance

- `info`
  - merge lifecycle state changes
  - preview/commit/result
  - session start/finish/cancel
- `warn`
  - unresolved conflicts remain
  - timeout auto-abort
  - best-effort cleanup/commit failures
- `error`
  - user-visible merge failure
  - broken callback/control-flow failures

See also: `docs/logging-policy.md`
