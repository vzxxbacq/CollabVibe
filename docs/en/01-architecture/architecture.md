---
title: "System Architecture"
layer: architecture
source_of_truth: AGENTS.md, src/server.ts, src/common/dispatcher.ts, services/factory.ts
status: active
---

# System Architecture

## Overview

CollabVibe connects IM platforms to agent backends and returns both synchronous command results and streaming turn output.

The system follows the AGENTS invariants:

- exactly two data paths
- strict L0/L1/L2/L3 layering
- `projectId` as the aggregate key
- `BackendIdentity` as the thread backend source of truth

## 1. Layering in the current codebase

```text
L0  src/server.ts, src/config.ts
L1  src/common/, src/feishu/, src/slack/
L2  services/index.ts, services/orchestrator-api.ts, services/* domain modules, services/persistence/
L3  packages/agent-core/, packages/git-utils/, packages/logger/, packages/admin-ui/
```

### Responsibilities

| Layer | Current files | Responsibility |
| --- | --- | --- |
| `L0` | `src/server.ts`, `src/config.ts` | process bootstrap and wiring |
| `L1` | `src/common/`, `src/feishu/`, `src/slack/` | platform handlers, shared dispatch, platform rendering |
| `L2` | `services/*` | business orchestration, persistence, IAM, merge, plugin, event runtime |
| `L3` | `packages/*` | backend transport abstraction, git operations, logging |

### Import constraints

| Layer | May import | Must not import |
| --- | --- | --- |
| `L0/L1` | `services/index.ts`, public logger exports | `services/*` internals, `packages/agent-core` transport internals, `packages/git-utils` internals |
| `L2` | `packages/*` public entries, peer `services/*` modules | `src/*` |
| `L3` | same-package internals | `services/*`, `src/*` |

## 2. Path A: command response

Current Path A is implemented through shared L1 dispatch plus L2 API calls:

```text
IM Event
  -> src/server.ts wiring
  -> src/feishu/* or src/slack/*
  -> src/common/dispatcher.ts
     -> agent turn path: OrchestratorApi.createTurn(...)
     -> command path: platform handlers + src/common/platform-commands.ts
  -> services/index.ts facade
  -> platform renderers in L1
```

### Notes

- L1 does not call backend transports directly.
- `src/common/dispatcher.ts` is the shared command split point for agent turns.
- Project and admin workflows still call the same L2 `OrchestratorApi`; they are not a third data path.

## 3. Path B: streaming agent events

Current Path B is:

```text
Backend (Codex stdio / ACP)
  -> AgentApi.onNotification
  -> services/event/EventPipeline
  -> ThreadRuntimeRegistry
  -> ThreadEventRuntime
  -> AgentEventRouter
  -> transformUnifiedAgentEvent / toPlatformOutput
  -> OutputGateway
  -> Feishu / Slack adapters
```

### Key files

| Stage | File |
| --- | --- |
| backend abstraction | `packages/agent-core/src/types.ts` |
| event bridge | `packages/agent-core/src/transports/*` |
| pipeline facade | `services/event/pipeline.ts` |
| per-thread runtime | `services/event/thread-event-runtime.ts` |
| event router | `services/event/router.ts` |
| platform output contract | `services/event/output-contracts.ts` |

## 4. Current L2 assembly

`services/factory.ts` assembles the runtime in this order:

1. persistence and project resolver
2. backend registry, config service, session resolver
3. runtime config provider and transport factory registry
4. API pool
5. thread, turn, and snapshot sub-layers
6. merge, approval, IAM, audit, plugin, and project services
7. raw `OrchestratorApi`
8. `withApiGuards(...)`
9. deferred `runStartup(gateway)` wiring for Path B

## 5. State invariants that still matter

### Project and chat

- `chatId` is only the platform binding
- `projectId` is the real aggregate key
- IM entry points must resolve `chatId -> projectId` before thread or turn access

### Thread and backend

- `ThreadRecord.backend` is the persisted backend identity
- `UserThreadBinding` is only a pointer to the active thread
- thread runtime config is built from project config plus thread backend identity

### Turn lifecycle

- `TurnLifecycleService` owns authoritative turn start and finish behavior
- `EventPipeline` may buffer or defensively ensure state, but it is not the source of truth for turn creation
- merge resolver threads skip normal commit flow when `MERGE_HEAD` is active
