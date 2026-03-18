---
title: "Threads and State"
layer: architecture
source_of_truth: AGENTS.md, services/orchestrator, services/persistence
status: active
---

# Threads and State

## State objects

| Type | Scope | Description |
| --- | --- | --- |
| `ProjectRecord` | project-level | Project aggregate root, holding chat binding and project config |
| `ThreadRecord` | project-level | Thread persistent state and backend identity |
| `UserThreadBinding` | user-level / owned by project | Pointer to the current active thread |
| `RuntimeConfig` | per-turn | Temporary runtime configuration |
| `UserRecord` | global | User roles and system-level identity |

## Core flow

```text
chatId
  → ProjectResolver.findProjectByChatId(chatId)
  → projectId
  → ThreadRegistry.get(projectId, threadName)
  → threadRecord.backend
  → RuntimeConfig.backend
```

## Design implications

- Project is the aggregate root; thread / turn / snapshot / thread-turn-state / user-thread-binding all belong to `projectId`
- `chatId` is only the IM routing entry and the 1:1 binding field on Project; it is no longer the primary key for thread history
- Thread identity comes from the thread registry, not from user binding
- User binding is only responsible for “which thread this user points to in the current project”
- Per-turn config assembly must resolve the project first, then read back from the thread record
