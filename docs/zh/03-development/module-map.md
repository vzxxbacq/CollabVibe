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
| `src/platform/*` | 平台无关入口逻辑 |
| `src/feishu/*` | Feishu 平台事件接入 |

## 服务层

| 目录 | 作用 |
| --- | --- |
| `services/index.ts` | L2 公共 API barrel |
| `services/thread/*`, `services/turn/*`, `services/event/*`, `services/backend/*` | 线程、backend、turn、event pipeline |
| `services/persistence/*` | SQLite、repository、store |
| `services/iam/*` | 角色与授权 |
| `services/approval/*` | 审批卡片与回调衔接 |
| `services/audit/*` | 审计能力 |
| `services/project/*` | Project 聚合根与解引用 |
| `services/plugin/*` | 插件目录与绑定 |

## 包层

| 目录 | 作用 |
| --- | --- |
| `packages/agent-core/*` | backend 身份、统一 agent 类型 |
| `packages/agent-core/src/transports/*` | Codex / ACP 协议接入 |
| `packages/git-utils/*` | snapshot、commit、worktree |
| `packages/logger/*` | 跨切面日志 |
| `packages/admin-ui/*` | 管理 UI |
