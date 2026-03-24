---
title: 常见改动入口
layer: development
status: active
---

# 常见改动入口

| 改动目标 | 先看哪里 |
| --- | --- |
| 平台消息接入 | `src/feishu/*`, `src/feishu/channel/*` |
| 线程 / backend / turn | `services/thread/*`, `services/backend/*`, `services/turn/*`, `packages/agent-core/*` |
| 流式事件 | `services/event/*`, `packages/agent-core/src/transports/*` |
| 审批流程 | `services/approval/*`, `src/feishu/feishu-card-handler.ts` |
| 权限控制 | `services/iam/*`, `src/platform/dispatcher.ts` |
| 本地持久化 | `services/persistence/*`, `services/audit/*` |
| 平台输出渲染 | `src/feishu/channel/*`, `src/slack/channel/*` |

## 改动前检查

| 检查项 | 说明 |
| --- | --- |
| 是否仍沿 Path A / Path B | 不新增旁路 |
| 是否破坏分层依赖 | 不跨层反向依赖 |
| 是否引入第二个状态事实源 | thread / backend / user 仍保持唯一持久源 |

## 审批流程补充

- 审批展示数据在事件注册阶段由 L2 生成并保存 snapshot。
- 批准/拒绝后的 Feishu 卡片应通过 `handleApprovalCallback(..., includeDisplay: true)` 返回的展示数据渲染，而不是继续把按钮 callback metadata 当作真实来源。
- 不要为了卡片渲染新增独立审批查询接口；复用既有审批回调契约即可。
