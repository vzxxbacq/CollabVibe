---
title: "BackendIdentity"
layer: architecture
source_of_truth: packages/agent-core/src/backend-identity.ts, AGENTS.md
status: active
---

# BackendIdentity

`BackendIdentity` is the unified value object for a thread's backend identity.

## Rules

- `transport` is derived automatically from `backendId`
- backend information is passed as a single atomic object and must not be split apart
- `ThreadRecord.backend` is the only persistent source of truth
- the object is immutable after creation

## Current `backendId` values

- `codex`
- `opencode`
- `claude-code`

## Correct usage

```ts
const backend = createBackendIdentity("codex", "gpt-5-codex");
```

## Forbidden patterns

- Manually passing `transport`
- Storing backend metadata inside `UserThreadBinding`
- Passing `backendName / model / transport` separately across the execution path
