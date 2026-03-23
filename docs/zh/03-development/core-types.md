---
title: 核心类型
layer: development
status: active
---

# 核心类型

| 类型 | 位置 | 作用 |
| --- | --- | --- |
| `BackendIdentity` | `packages/agent-core` | 统一 backend 身份，派生 transport |
| `ThreadRecord` | orchestrator / persistence | chat 级线程状态 |
| `UserThreadBinding` | orchestrator | user 级当前 thread 指针 |
| `RuntimeConfig` | agent-core / orchestrator | turn 运行配置 |
| `HandleIntentResult` | orchestrator | Path A 结果模型 |
| `UnifiedAgentEvent` | agent-core | Path B 统一事件 |

## 关键约束

| 类型 | 约束 |
| --- | --- |
| `BackendIdentity` | 不拆分传递，`transport` 自动派生 |
| `ThreadRecord` | backend 身份唯一持久源 |
| `UserThreadBinding` | 不保存 backend 元数据 |
| `RuntimeConfig` | 从 thread record 组装 |
