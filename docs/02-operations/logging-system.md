---
title: "Logging System"
layer: operations
status: active
source_of_truth: packages/channel-core/src/logger.ts, packages/channel-core/src/log-file-sink.ts, docs/logging-policy.md, docs/merge-log-schema.md
---

# Logging System

`CollabVibe` uses the lightweight in-repo logger rather than depending directly on the external `pino` package. The goals are to support all of the following at the same time:

- readable console output
- JSONL file persistence
- automatic masking of sensitive fields
- global log levels plus module-level debugging
- replaceable sinks in tests to reduce side effects

## 1. Logging components

| Component | Location | Purpose |
| --- | --- | --- |
| `createLogger` | `packages/channel-core/src/logger.ts` | Creates a pino-compatible logger |
| `setLogSink` / `getLogSink` | `packages/channel-core/src/logger.ts` | Injects / gets the global sink |
| `createFileLogSink` | `packages/channel-core/src/log-file-sink.ts` | Writes logs into JSONL files |
| `multiSink` | `packages/channel-core/src/log-file-sink.ts` | Composes multiple sinks such as console + file |
| `createFilteredSink` | `packages/channel-core/src/log-file-sink.ts` | Routes specific modules or conditions into separate files |

```ts
import { createLogger } from "../packages/channel-core/src/logger";

const log = createLogger("server");
log.info({ port: 3100 }, "server starting");
```

## 2. Default log locations

| Path | Description |
| --- | --- |
| `logs/app.log` | Main runtime log |
| `logs/*.log` | Rotated historical logs |
| `logs/agent-stdio.log` | Protocol / stdio detail logs; see the logging policy |

```bash
ls -lah logs
tail -f logs/app.log
```

![Log directory placeholder](/placeholders/guide-image-placeholder.svg)

> Placeholder: add a screenshot of the `logs/` directory, ideally showing `app.log` and rotated files.

## 3. Log structure

Each log entry is written as one JSONL line. Core fields come from `LogEntry`:

| Field | Description |
| --- | --- |
| `level` | Numeric level aligned with pino |
| `time` | Unix timestamp in milliseconds |
| `name` | Logger name such as `server` or `orchestrator` |
| `msg` | Log message |
| Other fields | Business context such as `traceId`, `projectId`, or `turnId` |

```json
{"level":30,"time":1710000000000,"name":"server","msg":"Codex IM server started (Stream mode — WebSocket)","port":3100}
```

## 4. Levels and module controls

The repository defines numeric levels aligned with pino:

| Name | Value |
| --- | --- |
| `trace` | 10 |
| `debug` | 20 |
| `info` | 30 |
| `warn` | 40 |
| `error` | 50 |
| `fatal` | 60 |

The global level is controlled by `LOG_LEVEL`, and module overrides are controlled by `LOG_MODULE_LEVELS`.

```bash
LOG_LEVEL=info
LOG_MODULE_LEVELS=stdio-rpc=debug,acp-rpc=debug
```

Recommended production defaults are documented in [Logging Policy](/logging-policy).

## 5. Sensitive information redaction

The logger includes key-based and value-based redaction rules. It automatically masks sensitive keys such as:

- `token`
- `secret`
- `password`
- `authorization`
- `apiKey`
- `cookie`

It also performs value-level masking for patterns such as Bearer tokens, `sk-*`, and `ghp_*`.

```ts
log.info(
  { apiKey: "sk-secret", authorization: "Bearer abcdef", chatId: "oc_xxx" },
  "calling upstream"
);
```

Sensitive values are replaced with `***` in output.

## 6. Rotation and persistence

The file sink is provided by `createFileLogSink` and defaults to:

| Config | Default |
| --- | --- |
| Log directory | `logs` |
| Single-file size | `10MB` |
| Number of historical files | `5` |
| Base filename | `app` |

You can override these through environment variables:

```bash
LOG_DIR=logs
LOG_MAX_SIZE=10485760
LOG_MAX_FILES=5
```

When the current file exceeds the threshold, rotation follows the pattern `app.log -> app.1.log -> app.2.log`.

![Log rotation placeholder](/placeholders/guide-image-placeholder.svg)

> Placeholder: add a screenshot or flow chart showing rotated log files.

## 7. Recommended correlation fields

For troubleshooting, the repository recommends consistently using the following correlation fields:

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

This naming convention comes from [Logging Policy](/logging-policy) and [Merge Log Schema](/merge-log-schema).

## 8. Typical log sources

| Module | Common contents |
| --- | --- |
| `server` | Service startup, platform wiring, entry assembly |
| `orchestrator` | Thread creation, Turn lifecycle, recovery, exceptions |
| `feishu` / `channel-feishu` | Card rendering, message push, button callbacks |
| `stdio-rpc` / `acp-rpc` | Backend protocol reads and writes |
| `git` / `merge` / `commit` | Worktree, merge, commit, conflict handling |
| `backend-config` | Backend provider / model / policy configuration changes |

```bash
rg '"name":"orchestrator"' logs/app.log
rg '"turnId":"' logs/app.log
```

## 9. Troubleshooting suggestions

For troubleshooting, inspect logs in this order:

1. Start with `app.log` to see whether the entry event was received
2. Use `traceId / turnId / threadId` to reconstruct one execution chain
3. If you suspect backend protocol issues, inspect `stdio-rpc` or `acp-rpc` debug output
4. If the issue is around merge / snapshot / worktree, inspect `git`, `merge`, and `commit` logs

```bash
tail -f logs/app.log | rg 'turnId|traceId|error|warn'
```

![Logging troubleshooting video placeholder](/placeholders/guide-video-placeholder.svg)

> Placeholder: add a recording that traces a problem using `traceId`.
