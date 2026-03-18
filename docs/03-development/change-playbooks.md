---
title: "Change Playbooks"
layer: development
status: active
---

# Change Playbooks

| Change target | Look here first |
| --- | --- |
| Platform message integration | `src/feishu/*`, `packages/channel-feishu/*` |
| Thread / backend / turn | `services/orchestrator/*`, `packages/agent-core/*` |
| Streaming events | `services/orchestrator/src/event/*`, `packages/codex-client/*`, `packages/acp-client/*` |
| Approval flow | `services/approval/*`, `services/orchestrator/src/use-cases/approval`, `src/feishu/feishu-card-handler.ts` |
| Access control | `services/iam/*`, `src/core/intent-dispatcher.ts` |
| Local persistence | `services/persistence/*`, `services/audit/*` |
| Platform output rendering | `packages/channel-feishu/*`, `packages/channel-slack/*` |

## Pre-change checklist

| Check | Description |
| --- | --- |
| Does the change still follow Path A / Path B? | Do not add bypasses |
| Does it preserve layering dependencies? | Do not add reverse cross-layer dependencies |
| Does it introduce a second source of truth for state? | Thread / backend / user must still keep a single persistent source |
