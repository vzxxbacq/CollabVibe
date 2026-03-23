---
title: "Local Development"
layer: development
status: active
---

# Local Development

## Startup steps

| Step | Command / description |
| --- | --- |
| Install dependencies | `npm install` |
| Configure environment variables | See [Quickstart](/00-overview/quickstart) |
| Start the service | `npm run start:dev` |
| Preview the docs | `npm run docs:dev` |

## Code reading entry points

| Goal | Entry file |
| --- | --- |
| System assembly | `src/server.ts` |
| Feishu message intake | `src/feishu/feishu-message-handler.ts` |
| Feishu card interactions | `src/feishu/feishu-card-handler.ts` |
| Orchestrator public entry | `services/index.ts` |
| Backend identity model | `packages/agent-core/src/backend-identity.ts` |

## Recommended docs to read first

- [Execution Paths and Data Flow](/01-architecture/architecture)
- [Layering and Module Contracts](/01-architecture/architecture)
