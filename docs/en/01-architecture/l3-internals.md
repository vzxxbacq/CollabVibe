---
title: "L3 Internals"
layer: architecture
source_of_truth: packages/agent-core/src/index.ts, packages/git-utils/src/index.ts, packages/logger/src/index.ts
status: active
---

# L3 Internals

This page documents the **current** L3 package layer.

## Package overview

```text
packages/
  agent-core/
  git-utils/
  logger/
  admin-ui/
```

| Package | Role |
| --- | --- |
| `agent-core` | Backend protocol abstraction and transport factories |
| `git-utils` | Unified Git operations exposed as `GitOps` |
| `logger` | Shared structured logging |
| `admin-ui` | Separate frontend package, not part of the server runtime path |

## agent-core

Public entry:

- `packages/agent-core/src/index.ts`

Key exported categories:

- backend identity
- runtime config and API interfaces
- unified agent events
- JSON-RPC client and transport types
- stdio transport
- process manager
- `createDefaultTransportFactories()`

Important current detail:

- L2 does **not** import transport internals directly
- `createDefaultTransportFactories()` constructs Codex and ACP factories internally
- `BackendIdentity` is created via `createBackendIdentity(...)`

Relevant files:

- `backend-identity.ts`
- `types.ts`
- `unified-agent-event.ts`
- `rpc-client.ts`
- `stdio-transport.ts`
- `agent-process-manager.ts`
- `transports/codex/*`
- `transports/acp/*`

## git-utils

Public entry:

- `packages/git-utils/src/index.ts`

Current public model:

- L2 gets a single `GitOps` object via `createGitOps(...)`
- type-only exports describe merge, snapshot, commit, and diff data
- diff helpers are exported as pure functions

This is different from older docs that described direct function imports as the main L2 integration style.

Key exports:

- `createGitOps`
- `GitOps`, `GitWorktreeOps`, `GitMergeOps`, `GitSnapshotOps`, `GitCommitOps`, `GitRepoOps`
- merge types such as `MergeDiffStats`, `MergeFileInfo`, `MergeFileStatus`, `MergeFileDecision`
- snapshot types such as `SnapshotDiff`
- commit type `TurnDiffResult`
- diff helpers such as `parseDiffFileNames`, `parseDiffStats`, `splitDiffByFile`

## logger

Public entry:

- `packages/logger/src/index.ts`

This package remains the shared structured logging layer used across `src/`, `services/`, and `packages/`.

Typical usage:

```ts
const log = createLogger("server");
log.info({ projectId, threadName }, "message");
```

## Current L2 integration rules

L2 should only depend on L3 public entries:

- `packages/agent-core/src/index.ts`
- `packages/git-utils/src/index.ts`
- `packages/logger/src/index.ts`

L2 should not reach into:

- `packages/agent-core/src/transports/*`
- `packages/git-utils/src/*` internals bypassing `createGitOps`
