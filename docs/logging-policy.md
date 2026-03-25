# Production Logging Policy

## Goals

- Keep `app.log` focused on operational signals
- Route noisy protocol/stdio detail into dedicated debug files
- Preserve correlation fields for request and turn troubleshooting
- Never emit raw secrets or credentials

## Default Log Files

- `data/logs/app.log`
  - main operational log
- `data/logs/agent-stdio.log`
  - stdio / ACP / protocol debug detail

## Standard Field Names

Use these names whenever the context exists:

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

Avoid alternate field names such as:

- `backendName` → `backendId`
- `sourceName` / `provider` → `providerName`
- `model` → `modelName` when it refers to the configured model identifier
- `branch` → `branchName`
- `path` → `worktreePath` or `filePath`

For merge-specific correlation schema, see:

- `docs/merge-log-schema.md`

## Recommended Default Levels

- `server`, `handler`, `action`, `orchestrator`, `output`, `feishu`: `info`
- `backend-config`, `git`, `commit`, `merge`: `info`
- `stdio-rpc`, `acp-rpc`: `debug` and routed to dedicated file
- `codex-factory`: `info` by default, `debug` during runtime/protocol diagnosis

Suggested production env:

```bash
LOG_LEVEL=info
LOG_MODULE_LEVELS=stdio-rpc=debug,acp-rpc=debug
LOG_DEBUG_MODULES=stdio-rpc,acp-rpc
```

## Correlation Rules

- Reuse `traceId` as the main log/audit correlation key
- When available, set audit `correlationId` equal to `traceId`
- Audit `detailJson.correlationId` should match the operational log `traceId`

## Secret Safety

Logger redaction must mask values for keys matching:

- `token`
- `secret`
- `password`
- `authorization`
- `apiKey`
- `cookie`

Never intentionally log:

- raw Feishu secrets
- raw provider API keys
- raw git clone tokens
- raw bearer tokens

## Best-Effort Failure Rule

Best-effort async actions may stay non-blocking, but must emit:

- `warn` for degraded behavior
- `error` for user-visible failure or broken control flow
