---
title: "Core Types"
layer: development
status: active
---

# Core Types

| Type | Location | Purpose |
| --- | --- | --- |
| `BackendIdentity` | `packages/agent-core` | Unified backend identity; derives transport |
| `ThreadRecord` | orchestrator / persistence | Project-scoped thread state |
| `UserThreadBinding` | orchestrator | User-scoped pointer to the current thread |
| `RuntimeConfig` | agent-core / orchestrator | Turn runtime configuration |
| `HandleIntentResult` | orchestrator | Path A result model |
| `UnifiedAgentEvent` | agent-core | Path B unified event model |

## Key constraints

| Type | Constraint |
| --- | --- |
| `BackendIdentity` | Must not be split apart; `transport` is derived automatically |
| `ThreadRecord` | Single persistent source of backend identity |
| `UserThreadBinding` | Must not store backend metadata |
| `RuntimeConfig` | Assembled from the thread record |
