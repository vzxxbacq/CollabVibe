---
title: 常见改动入口
layer: development
status: active
---

# 常见改动入口

| 改动目标 | 先看哪里 |
| --- | --- |
| 平台消息接入 | `src/feishu/*`, `packages/channel-feishu/*` |
| 线程 / backend / turn | `services/orchestrator/*`, `packages/agent-core/*` |
| 流式事件 | `services/orchestrator/src/event/*`, `packages/codex-client/*`, `packages/acp-client/*` |
| 审批流程 | `services/approval/*`, `services/orchestrator/src/use-cases/approval`, `src/feishu/feishu-card-handler.ts` |
| 权限控制 | `services/iam/*`, `src/core/intent-dispatcher.ts` |
| 本地持久化 | `services/persistence/*`, `services/audit/*` |
| 平台输出渲染 | `packages/channel-feishu/*`, `packages/channel-slack/*` |

## 改动前检查

| 检查项 | 说明 |
| --- | --- |
| 是否仍沿 Path A / Path B | 不新增旁路 |
| 是否破坏分层依赖 | 不跨层反向依赖 |
| 是否引入第二个状态事实源 | thread / backend / user 仍保持唯一持久源 |
