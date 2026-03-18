---
title: "Module Map"
layer: development
status: active
---

# Module Map

## Application layer

| Directory | Purpose |
| --- | --- |
| `src/server.ts` | System composition root |
| `src/core/*` | Platform-agnostic entry logic |
| `src/feishu/*` | Feishu platform event intake |

## Service layer

| Directory | Purpose |
| --- | --- |
| `services/orchestrator/*` | Thread, backend, turn, event pipeline |
| `services/persistence/*` | SQLite, repositories, stores |
| `services/iam/*` | Roles and authorization |
| `services/approval/*` | Approval cards and callback bridging |
| `services/audit/*` | Audit capabilities |
| `services/admin-api/*` | Admin API |
| `services/plugin/*` | Plugin directories and bindings |

## Package layer

| Directory | Purpose |
| --- | --- |
| `packages/agent-core/*` | Backend identity and unified agent types |
| `packages/channel-core/*` | Channel abstraction, intent router, unified output types |
| `packages/channel-feishu/*` | Feishu adapter and output rendering |
| `packages/channel-slack/*` | Slack output and socket foundation |
| `packages/codex-client/*` | Codex protocol integration |
| `packages/acp-client/*` | ACP protocol integration |
| `packages/git-utils/*` | Snapshot, commit, worktree |
| `packages/admin-ui/*` | Admin UI |
