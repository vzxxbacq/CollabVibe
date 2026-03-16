---
title: 分层隔离与模块契约
layer: architecture
source_of_truth: AGENTS.md, repository layout, public index exports
status: active
---

# 分层隔离与模块契约

本文定义分层目的、依赖方向、模块职责和对外暴露方式。

## 分层结构

| 层级 | 目录 | 责任 |
| --- | --- | --- |
| Wiring | `src/server.ts` | 初始化依赖并装配系统 |
| Platform | `src/feishu/*` | 平台事件解析、平台交互处理 |
| Platform-Agnostic App | `src/core/*` | intent 分发、共享入口逻辑 |
| Services | `services/*` | 线程、backend、权限、持久化、审批、审计 |
| Packages | `packages/*` | 通道抽象、协议客户端、基础类型、输出适配 |

## 依赖方向

| 目录 | 允许依赖 | 禁止依赖 |
| --- | --- | --- |
| `src/core` | `packages/*`, `services/*` | `src/feishu`, `src/slack` |
| `src/feishu` | `src/core`, `packages/*`, `services/*` | `src/slack` |
| `services/*` | `packages/*` | `src/*` |
| `packages/*` | 同层内部 | `services/*`, `src/*` |

## 核心模块职责

| 模块 | 责任 | 不负责 |
| --- | --- | --- |
| `services/orchestrator` | thread、backend、turn、event pipeline、approval 恢复 | 平台 payload 解析、平台 UI 细节 |
| `services/persistence` | SQLite、repository、store | 业务编排 |
| `services/iam` | 角色解析、命令授权 | 平台认证 |
| `services/approval` | 审批卡片数据、审批回调衔接 | 平台消息接入 |
| `packages/channel-core` | 通道抽象、intent router、统一 message/output 类型 | 具体平台 UI |
| `packages/channel-feishu` | Feishu adapter、输出适配、卡片构建 | 线程管理、backend 选择 |
| `packages/channel-slack` | Slack 输出与 socket 基础能力 | 共享业务编排 |
| `packages/codex-client` / `packages/acp-client` | backend 协议接入 | 平台逻辑 |
| `packages/agent-core` | `BackendIdentity`、基础 agent 类型、统一事件类型 | 业务流程编排 |

## 对外暴露方式

| 规则 | 说明 |
| --- | --- |
| 模块对外优先通过 `index.ts` 暴露 | 收敛 import 入口 |
| 上层依赖稳定契约，不依赖内部 helper | 降低重构扩散面 |
| 平台层依赖共享服务，不反向污染共享层 | 保持平台差异可替换 |

## 状态与身份约束

### BackendIdentity

| 规则 | 说明 |
| --- | --- |
| `transport` 派生 | 由 `backendId` 自动派生 |
| 原子传递 | 不拆成 `backendName/model/transport` 分散传递 |
| 唯一持久源 | `ThreadRecord.backend` |
| 不可变 | 创建后冻结 |

### 线程状态

| 对象 | 作用域 | 说明 |
| --- | --- | --- |
| `ThreadRecord` | chat 级 | 线程持久状态与 backend 身份 |
| `UserThreadBinding` | user 级 | 当前 thread 指针，不携带 backend 元数据 |
| `RuntimeConfig` | per-turn | 每次 turn 运行配置 |
| `UserRecord` | 全局 | 用户角色状态 |

## 扩展规则

| 目标 | 正确做法 | 错误做法 |
| --- | --- | --- |
| 新增平台 | 新建平台 handler 与 output adapter，复用 services 与 packages | 在平台层重写线程/审批/后端管理 |
| 新增 backend | 扩展 backend registry / factory / unified event 映射 | 让平台层感知 transport 差异 |
| 新增业务能力 | 挂到现有 Path A / Path B | 旁路调用 backend 或平台 SDK |
