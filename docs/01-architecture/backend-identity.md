---
title: BackendIdentity
layer: architecture
source_of_truth: packages/agent-core/src/backend-identity.ts, AGENTS.md
status: active
---

# BackendIdentity

`BackendIdentity` 是线程后端身份的统一值对象。

## 规则

- `transport` 从 `backendId` 自动派生
- 后端信息整体传递，不拆分传播
- `ThreadRecord.backend` 是唯一持久源
- 创建后不可变

## 当前 backendId

- `codex`
- `opencode`
- `claude-code`

## 正确使用方式

```ts
const backend = createBackendIdentity("codex", "gpt-5-codex");
```

## 禁止方式

- 手工传 `transport`
- 在 `UserThreadBinding` 中存 backend 元数据
- 在调用链中分散传 `backendName / model / transport`
