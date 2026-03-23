---
title: 日志系统
layer: operations
status: active
source_of_truth: packages/channel-core/src/logger.ts, packages/channel-core/src/log-file-sink.ts, docs/logging-policy.md, docs/merge-log-schema.md
---

# 日志系统

`CollabVibe` 的日志系统基于仓库内置的轻量 logger 实现，而不是直接依赖外部 pino 包。目标是同时满足：

- 控制台可读输出
- JSONL 文件持久化
- 敏感字段自动脱敏
- 支持全局级别与模块级别调试
- 在测试中可替换 sink，降低副作用

## 1. 日志组件

| 组件 | 位置 | 作用 |
| --- | --- | --- |
| `createLogger` | `packages/channel-core/src/logger.ts` | 创建 pino-compatible logger |
| `setLogSink` / `getLogSink` | `packages/channel-core/src/logger.ts` | 注入 / 获取全局 sink |
| `createFileLogSink` | `packages/channel-core/src/log-file-sink.ts` | 将日志写入 JSONL 文件 |
| `multiSink` | `packages/channel-core/src/log-file-sink.ts` | 组合 console + file 等多个 sink |
| `createFilteredSink` | `packages/channel-core/src/log-file-sink.ts` | 将指定模块或条件路由到独立文件 |

```ts
import { createLogger } from "../packages/channel-core/src/logger";

const log = createLogger("server");
log.info({ port: 3100 }, "server starting");
```

## 2. 默认日志位置

| 路径 | 说明 |
| --- | --- |
| `data/logs/app.log` | 主运行日志 |
| `data/logs/*.log` | 轮转后的历史日志 |
| `data/logs/agent-stdio.log` | 协议/stdio 细节日志，见 logging policy |

```bash
ls -lah data/logs
tail -f data/logs/app.log
```

![日志目录占位图](/placeholders/guide-image-placeholder.svg)

> Placeholder：在这里插入 `data/logs/` 目录结构截图，建议展示 `app.log` 和轮转文件。

## 3. 日志结构

单条日志会以 JSONL 形式写入，每行一条记录。核心字段来自 `LogEntry`：

| 字段 | 说明 |
| --- | --- |
| `level` | 数字级别，兼容 pino |
| `time` | Unix 毫秒时间戳 |
| `name` | logger 名称，如 `server`、`orchestrator` |
| `msg` | 日志消息 |
| 其他字段 | 业务上下文，如 `traceId`、`projectId`、`turnId` |

```json
{"level":30,"time":1710000000000,"name":"server","msg":"Codex IM server started (Stream mode — WebSocket)","port":3100}
```

## 4. 级别与模块控制

仓库中定义了与 pino 对齐的数值级别：

| 名称 | 数值 |
| --- | --- |
| `trace` | 10 |
| `debug` | 20 |
| `info` | 30 |
| `warn` | 40 |
| `error` | 50 |
| `fatal` | 60 |

全局级别由 `LOG_LEVEL` 控制，模块级覆盖由 `LOG_MODULE_LEVELS` 控制。

```bash
LOG_LEVEL=info
LOG_MODULE_LEVELS=stdio-rpc=debug,acp-rpc=debug
```

建议生产环境默认值见 [日志策略](/zh/logging-policy)。

## 5. 敏感信息脱敏

logger 内置了 key-based 和 value-based 脱敏规则，会自动屏蔽以下敏感键：

- `token`
- `secret`
- `password`
- `authorization`
- `apiKey`
- `cookie`

同时也会对类似 Bearer token、`sk-*`、`ghp_*` 的字符串进行值级脱敏。

```ts
log.info(
  { apiKey: "sk-secret", authorization: "Bearer abcdef", chatId: "oc_xxx" },
  "calling upstream"
);
```

输出中的敏感字段会被替换成 `***`。

## 6. 轮转与落盘

文件 sink 由 `createFileLogSink` 提供，默认行为如下：

| 配置 | 默认值 |
| --- | --- |
| 日志目录 | `data/logs` |
| 单文件大小 | `10MB` |
| 历史文件数 | `5` |
| 基础文件名 | `app` |

可通过环境变量覆盖：

```bash
LOG_DIR=data/logs
LOG_MAX_SIZE=10485760
LOG_MAX_FILES=5
```

当当前日志文件超过阈值时，会按 `app.log -> app.1.log -> app.2.log` 方式轮转。

![日志轮转占位图](/placeholders/guide-image-placeholder.svg)

> Placeholder：在这里插入日志轮转后的文件列表截图或流程图。

## 7. 推荐关联字段

为了方便排障，当前仓库推荐统一使用以下关联字段：

- `traceId`
- `chatId`
- `userId`
- `threadId`
- `threadName`
- `turnId`
- `backendId`
- `providerName`
- `modelName`
- `policyField`
- `branchName`
- `resolverName`
- `worktreePath`
- `filePath`

这套命名约定来自 [日志策略](/zh/logging-policy) 和 [Merge 日志 Schema](/zh/merge-log-schema)。

## 8. 典型日志来源

| 模块 | 常见内容 |
| --- | --- |
| `server` | 服务启动、平台接线、入口装配 |
| `orchestrator` | thread 创建、turn 生命周期、恢复与异常 |
| `feishu` / `channel-feishu` | 卡片渲染、消息推送、按钮回调 |
| `stdio-rpc` / `acp-rpc` | backend 协议读写 |
| `git` / `merge` / `commit` | worktree、merge、commit、冲突处理 |
| `backend-config` | backend provider / model / policy 配置变更 |

```bash
rg '"name":"orchestrator"' data/logs/app.log
rg '"turnId":"' data/logs/app.log
```

## 9. 排障建议

排障时建议按照下面顺序看日志：

1. `app.log` 看入口是否收到事件
2. 用 `traceId / turnId / threadId` 串起一次完整执行
3. 如果怀疑 backend 协议问题，再看 `stdio-rpc` 或 `acp-rpc` 的 debug 输出
4. 如果是 merge / snapshot / worktree 问题，再看 `git`、`merge`、`commit` 相关日志

```bash
tail -f data/logs/app.log | rg 'turnId|traceId|error|warn'
```

![日志排障视频占位图](/placeholders/guide-video-placeholder.svg)

> Placeholder：在这里插入一次基于 `traceId` 追查问题的录屏。
