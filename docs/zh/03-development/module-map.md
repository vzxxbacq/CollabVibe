---
title: 模块与目录
layer: development
status: active
---

# 模块与目录

## 应用层

| 目录 | 作用 |
| --- | --- |
| `src/server.ts` | 系统装配根 |
| `src/core/*` | 平台无关入口逻辑 |
| `src/feishu/*` | Feishu 平台事件接入 |

## 服务层

| 目录 | 作用 |
| --- | --- |
| `services/orchestrator/*` | 线程、backend、turn、event pipeline |
| `services/persistence/*` | SQLite、repository、store |
| `services/iam/*` | 角色与授权 |
| `services/approval/*` | 审批卡片与回调衔接 |
| `services/audit/*` | 审计能力 |
| `services/admin-api/*` | 管理 API |
| `services/plugin/*` | 插件目录与绑定 |

## 包层

| 目录 | 作用 |
| --- | --- |
| `packages/agent-core/*` | backend 身份、统一 agent 类型 |
| `packages/channel-core/*` | 通道抽象、intent router、统一输出类型 |
| `packages/channel-feishu/*` | Feishu adapter 与输出渲染 |
| `packages/channel-slack/*` | Slack 输出与 socket 基础能力 |
| `packages/codex-client/*` | Codex 协议接入 |
| `packages/acp-client/*` | ACP 协议接入 |
| `packages/git-utils/*` | snapshot、commit、worktree |
| `packages/admin-ui/*` | 管理 UI |
