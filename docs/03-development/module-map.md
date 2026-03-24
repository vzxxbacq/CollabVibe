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
| `src/platform/*` | Platform-agnostic entry logic |
| `src/feishu/*` | Feishu platform event intake |

## Service layer

| Directory | Purpose |
| --- | --- |
| `services/index.ts` | L2 public API barrel |
| `services/thread/*`, `services/turn/*`, `services/event/*`, `services/backend/*` | Thread, backend, turn, event pipeline |
| `services/persistence/*` | SQLite, repositories, stores |
| `services/merge/*` | Merge review sessions, conflict resolution, ancestry checks |
| `services/snapshot/*` | Turn-level git snapshot management |
| `services/iam/*` | Roles and authorization |
| `services/approval/*` | Approval runtime state, display snapshot capture, and callback bridging |
| `services/audit/*` | Audit capabilities |
| `services/project/*` | Project aggregate and resolution |
| `services/plugin/*` | Plugin directories and bindings |

## Package layer

| Directory | Purpose |
| --- | --- |
| `packages/agent-core/*` | Backend identity and unified agent types |
| `packages/agent-core/src/transports/*` | Codex / ACP transport integration |
| `packages/git-utils/*` | Snapshot, commit, worktree |
| `packages/logger/*` | Cross-cutting logging |
| `packages/admin-ui/*` | Admin UI |
