---
title: 本地开发
layer: development
status: active
---

# 本地开发

## 启动步骤

| 步骤 | 命令 / 说明 |
| --- | --- |
| 安装依赖 | `npm install` |
| 配置环境变量 | 参考 [QUICKSTART](/zh/00-overview/quickstart) |
| 启动服务 | `npm run start:dev` |
| 预览文档 | `npm run docs:dev` |

## 读代码入口

| 目标 | 入口文件 |
| --- | --- |
| 系统装配 | `src/server.ts` |
| Feishu 消息接入 | `src/feishu/feishu-message-handler.ts` |
| Feishu 卡片交互 | `src/feishu/feishu-card-handler.ts` |
| orchestrator 公共入口 | `services/index.ts` |
| backend 身份模型 | `packages/agent-core/src/backend-identity.ts` |

## 推荐先读文档

- [调用链与数据流](/zh/01-architecture/architecture)
- [分层隔离与模块契约](/zh/01-architecture/architecture)
