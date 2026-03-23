---
title: Project 聚合迁移说明
layer: development
source_of_truth: services/orchestrator, services/persistence, AGENTS.md
status: active
---

# Project 聚合迁移说明

## 背景

旧模型把线程相关持久化数据绑定在 `chatId` 上，导致：

- 删除群聊后重新绑定已有项目时，thread 历史不可见
- chat 变更需要搬迁 thread / turn / snapshot
- Project 明明是业务实体，却没有成为真正聚合根

## 本次迁移

### 数据归属切换

旧：

```text
chatId -> thread / turn / snapshot / state
```

新：

```text
chatId -> projectId -> thread / turn / snapshot / state
```

### 新规则

1. `Project` 是聚合根
2. `Project.chatId` 只是 1:1 平台绑定
3. `ThreadRecord / TurnRecord / TurnSnapshotRecord / ThreadTurnState / UserThreadBinding` 全部归属 `projectId`
4. `chatId` 保留为兼容与路由字段，不再是领域主键

## 已清理历史层

- `ThreadBindingService`
- `ThreadBindingRepository`
- `SqliteThreadBindingRepository`

这些层本质上是在补“chat/project 到 thread 的额外映射”，在 Project 聚合模型下已经冗余。

## 兼容策略

- 数据库表补充 `project_id`
- 保留 `chat_id` 作为兼容读取与平台回显字段
- orchestrator 内部统一先做 `chatId -> projectId`

## 后续开发要求

| 场景 | 正确做法 |
| --- | --- |
| 收到 IM 消息 | 先 `findProjectByChatId(chatId)` |
| 查线程 | `ThreadRegistry.get(projectId, threadName)` |
| 查 turn | `TurnRepository.getByTurnId(projectId, turnId)` |
| 查 snapshot | `SnapshotRepository.listByThread(projectId, threadId)` |
| 绑定用户线程 | `UserThreadBinding(projectId, userId, ...)` |

## 禁止回退

不要再新增任何以 `chatId` 为 thread 历史主键的新表或新接口，否则会重新引入群聊重绑类 bug。
