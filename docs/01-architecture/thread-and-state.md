---
title: 线程与状态
layer: architecture
source_of_truth: AGENTS.md, services/orchestrator, services/persistence
status: active
---

# 线程与状态

## 状态对象

| 类型 | 作用域 | 说明 |
| --- | --- | --- |
| `ProjectRecord` | project 级 | 项目聚合根，持有 chat 绑定与项目配置 |
| `ThreadRecord` | project 级 | 线程持久状态与 backend 身份 |
| `UserThreadBinding` | user 级 / project 归属 | 当前活动线程指针 |
| `RuntimeConfig` | per-turn | 运行期临时配置 |
| `UserRecord` | 全局 | 用户角色与系统级身份 |

## 核心流向

```text
chatId
  → ProjectResolver.findProjectByChatId(chatId)
  → projectId
  → ThreadRegistry.get(projectId, threadName)
  → threadRecord.backend
  → RuntimeConfig.backend
```

## 设计含义

- Project 是聚合根，thread / turn / snapshot / thread-turn-state / user-thread-binding 都归属 `projectId`
- `chatId` 只是 IM 路由入口和 Project 的 1:1 绑定，不再是线程历史数据主键
- 线程身份来自线程注册表，而不是用户绑定
- 用户绑定只负责“在当前 project 下指向哪个线程”
- 每次 turn 的配置组装要先解析 project，再从 thread record 回读


## Turn 生命周期补充

```text
prepareTurnPipeline(route)
  → turn/start 成功返回 turnId
  → TurnLifecycleService.ensureTurnStarted(...)
  → create turn record + initial snapshot + activeTurnId
  → activateTurnPipeline(route)
  → EventPipeline 持续同步流式事件
  → turn_complete / turn_aborted
  → finishTurn() + finalizeTurnState()
```

### 关键约束

- turn 的权威起点是 `TurnLifecycleService`，不是“第一条流式事件”。
- `ThreadTurnState.activeTurnId` 必须在 `ensureTurnStarted()` 阶段建立，供 `finishTurn()`、interrupt、rollback 等后续能力复用。
- 初始 snapshot 语义是“turn 开始前基线”；如果延迟到首条事件后再创建，会破坏 revert / diff 语义。
- `EventPipeline` 允许做幂等防御和事件缓冲，但不得改写 turn lifecycle 的权威归属。
