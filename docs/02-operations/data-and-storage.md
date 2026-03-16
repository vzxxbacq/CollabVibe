---
title: 数据与存储
layer: operations
status: active
---

# 数据与存储

![数据与存储占位图](/placeholders/guide-image-placeholder.svg)

> Placeholder：在这里插入 `SQLite / config / logs / workspace` 之间关系图。

本章描述 `data/` 目录的结构、每个文件或子目录的作用、以及迁移方法。

## 目录概览

当前仓库中的 `data/` 结构如下：

| 路径 | 类型 | 作用 |
| --- | --- | --- |
| `data/codex-im.db` | SQLite 主库 | 主数据文件 |
| `data/codex-im.db-wal` | SQLite WAL 文件 | 写前日志，WAL 模式下保存未 checkpoint 的数据 |
| `data/codex-im.db-shm` | SQLite SHM 文件 | WAL 共享内存索引文件 |
| `data/config/` | 配置目录 | backend 配置与默认模板 |
| `data/logs/` | 日志目录 | 应用运行日志 |

## SQLite 文件组

`createDatabase()` 默认启用：

- `PRAGMA journal_mode = WAL`
- `PRAGMA foreign_keys = ON`
- `PRAGMA busy_timeout = 5000`

因此数据库通常不是单文件，而是一组文件：

| 文件 | 是否必须一起迁移 | 说明 |
| --- | --- | --- |
| `data/codex-im.db` | 是 | 主数据库 |
| `data/codex-im.db-wal` | 建议是 | 未 checkpoint 的事务日志 |
| `data/codex-im.db-shm` | 建议是 | WAL 索引状态 |

### 迁移原则

- **在线迁移时不要只复制 `.db`**
- 停服务后迁移时，建议同时复制 `.db`、`.db-wal`、`.db-shm`
- 如果确认已做 SQLite checkpoint，也可以只迁移 `.db`，但这不是默认建议路径

## SQLite 主要表

迁移脚本当前会创建或维护以下表：

| 表 | 作用 |
| --- | --- |
| `projects` | 项目信息 |
| `project_channels` | 项目与 channel 绑定 |
| `threads` | 旧线程表，历史兼容 |
| `turns` | turn 记录 |
| `audit_logs` | 审计日志 |
| `approvals` | 审批记录 |
| `secrets` | 密钥存储 |
| `user_thread_bindings` | 用户当前 thread 绑定 |
| `project_threads` | project 级 thread 注册表（chat 仅保留 1:1 绑定字段） |
| `turn_snapshots` | turn 快照 |
| `skill_allowlist` | skill allowlist |
| `schema_versions` | migration 版本记录 |

### 当前有效持久源说明

| 数据类型 | 当前关键持久源 |
| --- | --- |
| 线程 backend 身份 | `project_threads` / `ThreadRecord.backend` |
| 用户当前 thread 指针 | `user_thread_bindings` |
| 审批状态 | `approvals` |
| 审计记录 | `audit_logs` |
| 快照记录 | `turn_snapshots` |
| 用户角色 | `users` 表，由 `SqliteUserRepository` 管理 |

> 历史 migration 中保留过一些旧字段与旧表形态，启动时会自动迁移到当前版本。

## `data/config/` 目录

当前系统约定的配置文件类型：

| 文件 | 作用 |
| --- | --- |
| `data/config/codex.toml` | Codex backend 配置 |
| `data/config/opencode.json` | OpenCode backend 配置 |
| `data/config/default.gitignore` | 默认忽略模板 |

> 目录中如果出现额外的 `*_bak`、`copy` 等文件，通常属于人工备份或临时文件，不应作为系统标准配置的一部分写入文档或依赖于部署流程。

### 配置目录使用规则

| 规则 | 说明 |
| --- | --- |
| backend 配置由 `BackendConfigService` 管理 | 启动时同步到 backend registry |
| 文件格式依 backend 不同而不同 | 当前同时存在 TOML 与 JSON |
| 可保留备份文件 | 但应避免误被当作生效配置 |

## `data/logs/` 目录

当前默认日志文件：

| 文件 | 作用 |
| --- | --- |
| `data/logs/app.log` | 主运行日志 |

### 日志初始化逻辑

- `src/server.ts` 在非测试环境下初始化文件日志
- 日志目录默认由 `createFileLogSink({ dir: "data/logs" })` 创建

## 迁移场景

### 场景 1：迁移到另一台机器

推荐步骤：

| 步骤 | 操作 |
| --- | --- |
| 1 | 停止服务 |
| 2 | 复制 `data/codex-im.db`、`data/codex-im.db-wal`、`data/codex-im.db-shm` |
| 3 | 复制整个 `data/config/` |
| 4 | 如需保留历史日志，复制 `data/logs/` |
| 5 | 复制 `.env` 或重新配置环境变量 |
| 6 | 确认新机器上的 `CODEX_WORKSPACE_CWD` 有效 |
| 7 | 启动服务，自动执行 migration |

### 场景 2：只迁移数据库，不迁移日志

可行，但需要同步：

- `data/codex-im.db*`
- `data/config/`
- `.env`

日志不是状态恢复必需项，但数据库与配置是。

### 场景 3：升级代码版本

推荐步骤：

| 步骤 | 操作 |
| --- | --- |
| 1 | 备份整个 `data/` |
| 2 | 更新代码 |
| 3 | 启动服务 |
| 4 | 让 `runMigrations()` 自动补齐 schema |
| 5 | 验证 thread、approval、audit、snapshot 是否正常 |

## 备份建议

| 类别 | 建议 |
| --- | --- |
| 数据库 | 定期备份 `data/codex-im.db*` |
| backend 配置 | 将 `data/config/` 纳入版本化或备份 |
| 日志 | 按需轮转与归档 |
| workspace | 根据项目需要单独备份，不建议与 `data/` 混为一类 |

## 迁移后验证

| 检查项 | 说明 |
| --- | --- |
| 服务可启动 | migration 正常执行 |
| 线程可恢复 | `project_threads`、`user_thread_bindings` 正常 |
| backend 可用 | `data/config/` 被正确读取 |
| 审批和审计可查询 | 主库数据完整 |
| 日志可写 | `data/logs/` 权限正常 |
