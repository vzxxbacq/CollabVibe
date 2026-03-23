---
title: "Change Playbooks"
layer: development
status: active
---

# Change Playbooks

| Change target | Look here first |
| --- | --- |
| Platform message integration | `src/feishu/*`, `src/feishu/channel/*` |
| Thread / backend / turn | `services/thread/*`, `services/backend/*`, `services/turn/*`, `packages/agent-core/*` |
| Streaming events | `services/event/*`, `packages/agent-core/src/transports/*` |
| Approval flow | `services/approval/*`, `src/feishu/feishu-card-handler.ts` |
| Access control | `services/iam/*`, `src/platform/dispatcher.ts` |
| Local persistence | `services/persistence/*`, `services/audit/*` |
| Platform output rendering | `src/feishu/channel/*`, `src/slack/channel/*` |

## Pre-change checklist

| Check | Description |
| --- | --- |
| Does the change still follow Path A / Path B? | Do not add bypasses |
| Does it preserve layering dependencies? | Do not add reverse cross-layer dependencies |
| Does it introduce a second source of truth for state? | Thread / backend / user must still keep a single persistent source |
