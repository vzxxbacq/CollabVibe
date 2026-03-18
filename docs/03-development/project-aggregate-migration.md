---
title: "Project Aggregate Migration"
layer: development
source_of_truth: services/orchestrator, services/persistence, AGENTS.md
status: active
---

# Project Aggregate Migration

## Background

The old model bound thread-related persistent data to `chatId`, which caused the following problems:

- after deleting a group chat and rebinding an existing project, thread history became invisible
- chat changes required moving thread / turn / snapshot data
- Project was clearly a business entity but was not treated as the real aggregate root

## This migration

### Ownership shift

Old:

```text
chatId -> thread / turn / snapshot / state
```

New:

```text
chatId -> projectId -> thread / turn / snapshot / state
```

### New rules

1. `Project` is the aggregate root
2. `Project.chatId` is only a 1:1 platform binding
3. `ThreadRecord / TurnRecord / TurnSnapshotRecord / ThreadTurnState / UserThreadBinding` all belong to `projectId`
4. `chatId` remains only as a compatibility and routing field, not a domain primary key

## Historical layers removed

- `ThreadBindingService`
- `ThreadBindingRepository`
- `SqliteThreadBindingRepository`

Those layers existed to patch in an extra “chat/project to thread” mapping. Under the Project aggregate model they are redundant.

## Compatibility strategy

- add `project_id` to database tables
- keep `chat_id` as a compatibility-read and platform-echo field
- inside the orchestrator, always resolve `chatId -> projectId` first

## Requirements for future development

| Scenario | Correct approach |
| --- | --- |
| Receive an IM message | Resolve `findProjectByChatId(chatId)` first |
| Query a thread | `ThreadRegistry.get(projectId, threadName)` |
| Query a turn | `TurnRepository.getByTurnId(projectId, turnId)` |
| Query a snapshot | `SnapshotRepository.listByThread(projectId, threadId)` |
| Bind a user thread | `UserThreadBinding(projectId, userId, ...)` |

## Do not regress

Do not add any new table or API that uses `chatId` as the primary key of thread history, or the group-chat rebinding bug class will return.
