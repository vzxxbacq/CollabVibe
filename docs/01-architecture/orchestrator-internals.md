---
title: "Orchestrator Internals"
layer: architecture
source_of_truth: services/factory.ts, services/event/*, services/thread/*, services/turn/*
status: active
---

# Orchestrator Internals

This page describes the **current** L2 implementation, centered on `services/factory.ts`.

## Composition root inside L2

`createOrchestratorLayer(...)` assembles the orchestrator in this order:

1. database and persistence
2. project resolver over admin state
3. backend registry and config services
4. runtime config provider and API factory registry
5. API pool
6. thread, turn, and snapshot domain layers
7. merge, approval, IAM, audit, and project services
8. raw API facade
9. API guard proxy
10. deferred startup wiring for `EventPipeline`

## Main components

| Component | File | Responsibility |
| --- | --- | --- |
| `createOrchestratorLayer` | `services/factory.ts` | Assembles the whole L2 layer |
| `withApiGuards` | `services/api-guard.ts` | Adds auth and audit around public API calls |
| `DefaultAgentApiPool` | `services/session/agent-api-pool.ts` | Caches backend APIs by `projectId:threadName` |
| `DefaultRuntimeConfigProvider` | `services/backend/runtime-config-provider.ts` | Builds project-level runtime defaults |
| `ThreadRuntimeService` | `services/thread/thread-runtime-service.ts` | Builds thread runtime config, worktrees, and APIs |
| `TurnLifecycleService` | `services/turn/turn-lifecycle-service.ts` | Owns turn start, interrupt, finish, and merge-safe commit rules |
| `EventPipeline` | `services/event/pipeline.ts` | Path B facade |
| `ThreadEventRuntime` | `services/event/thread-event-runtime.ts` | Per-thread event convergence and turn state handling |
| `AgentEventRouter` | `services/event/router.ts` | Maps unified events to IM output |
| `SessionRecoveryService` | `services/session/session-recovery-service.ts` | Restores persisted thread sessions at startup |

## Domain layer split

The factory no longer builds everything as one monolith. It delegates to sub-factories:

- `createThreadLayer(...)`
- `createTurnLayer(...)`
- `createSnapshotLayer(...)`

Those sub-factories return already-wired domain services such as:

- `ThreadService`
- `ThreadRuntimeService`
- `ThreadUseCaseService`
- `TurnQueryService`
- `TurnCommandService`
- `SnapshotService`

## Public API assembly

The raw `OrchestratorApi` object is constructed directly in `services/factory.ts`. Each public method delegates into a narrower domain service.

Examples:

- `createThread` → `ThreadUseCaseService.createThread(...)`
- `createTurn` → `TurnLifecycleService.handleUserTextForUser(...)`
- `getTurnDetail` → `TurnQueryService.getTurnDetail(...)`
- `handleMerge` → `MergeUseCase.handleMerge(...)`
- `resolveRole` → `IamService.resolveRole(...)`

After that, `withApiGuards(rawApi, roleResolver, auditService)` returns the guarded public API exposed to L1.

## Path B runtime

Path B is activated only after `runStartup(gateway)` is called.

```text
runStartup(gateway)
  -> OutputIntentBuffer
  -> AgentEventRouter
  -> EventPipeline
  -> TurnLifecycleService.setEventPipeline(...)
  -> session recovery
  -> health checks
```

The main runtime chain is:

```text
AgentApi.onNotification
  -> EventPipeline
  -> ThreadRuntimeRegistry
  -> ThreadEventRuntime
  -> AgentEventRouter
  -> OutputGateway.dispatch
```

## Turn lifecycle ownership

`TurnLifecycleService` is the authoritative owner of turn start and finish semantics.

Important behaviors:

- it resolves the current user thread from `projectId + userId`
- it starts the backend turn
- it establishes turn persistence after `turn/start` succeeds
- it binds the turn into `EventPipeline`
- it enforces merge-safe finish behavior

For merge resolver threads, `finishTurn()` explicitly skips normal snapshot/commit flow when a `MERGE_HEAD` is present.

## Session recovery

`SessionRecoveryService` runs during startup against persisted thread records.

It:

- expires stale pending approvals
- restores cached backend sessions for active projects
- restores merge review sessions
- releases state when a project is deactivated

Recovery is keyed by `projectId`, not `chatId`.

## Current shape vs. older docs

The current orchestrator is not organized as a single `services/orchestrator/` subtree with a separate contracts package. Instead:

- the public API contract lives in `services/orchestrator-api.ts`
- the public barrel is `services/index.ts`
- domain logic is split across `services/project`, `services/thread`, `services/turn`, `services/merge`, `services/event`, and related folders
- persistence stays under `services/persistence`

That is the code shape this document now reflects.
