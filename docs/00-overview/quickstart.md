---
title: "Quickstart"
layer: overview
status: active
source_of_truth: package.json, src/server.ts, src/config.ts, docs/00-overview/platform-feishu.md
---

# Quickstart

This document is for readers deploying `CollabVibe` and running it end-to-end for the first time. The goal is to complete the shortest path to:

- install dependencies
- configure environment variables
- prepare the backend and workspace
- start the service
- validate the message and card path in Feishu

![Quickstart overview placeholder](/placeholders/guide-image-placeholder.svg)

> Placeholder: add an overview diagram from local startup to receiving a Feishu message, ideally highlighting `.env`, `data/`, the workspace, and the Feishu App.

## 1. Prerequisites

| Item | Description |
| --- | --- |
| Node.js | Required to run `tsx`, VitePress, and test scripts |
| npm / pnpm compatible environment | The current repository exposes scripts via `npm run` |
| Local filesystem | Stores `data/`, config, logs, SQLite, and workspace state |
| Feishu app credentials | Required for the current primary platform |
| Backend executable command | For example `codex app-server` |

```bash
node -v
npm -v
```

## 2. Install dependencies

```bash
npm install
```

## 3. Prepare environment variables

Start from the existing environment template or your deployment environment variables. At minimum, prepare the following values:

| Variable | Required | Purpose |
| --- | --- | --- |
| `FEISHU_APP_ID` | Yes | Feishu app ID |
| `FEISHU_APP_SECRET` | Yes | Feishu app secret |
| `FEISHU_SIGNING_SECRET` | No | Event signature validation; usually optional in Stream mode |
| `FEISHU_ENCRYPT_KEY` | No | Encrypted-event support |
| `CODEX_APP_SERVER_CMD` | Recommended | Backend start command |
| `COLLABVIBE_WORKSPACE_CWD` | Recommended | Workspace root directory |
| `CODEX_SANDBOX` | No | Default sandbox policy |
| `CODEX_APPROVAL_POLICY` | No | Default approval policy |
| `APPROVAL_TIMEOUT_MS` | No | Approval timeout |
| `PORT` | No | Service listening port |
| `SYS_ADMIN_USER_IDS` | Recommended | Initial system administrator IDs |

```bash
cp .env.example .env
```

```dotenv
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
CODEX_APP_SERVER_CMD=codex app-server
COLLABVIBE_WORKSPACE_CWD=/abs/path/to/workspace
SYS_ADMIN_USER_IDS=ou_xxx
PORT=3100
```

![Environment variable configuration placeholder](/placeholders/guide-image-placeholder.svg)

> Placeholder: add a screenshot of a sample `.env` file or the environment variable screen in the deployment platform.

## 4. Prepare local directories

Runtime depends on the following directories:

| Path | Description |
| --- | --- |
| `data/codex-im.db` | Main SQLite database |
| `data/config/` | Backend configuration directory |
| `data/logs/` | Runtime logs |
| `COLLABVIBE_WORKSPACE_CWD` | Root of the code workspace |

```bash
mkdir -p data/config data/logs
mkdir -p /abs/path/to/workspace
```

## 5. Start the service

Development mode:

```bash
npm run start:dev
```

Production mode:

```bash
npm run start
```

Documentation preview:

```bash
npm run docs:dev
```

![Local startup terminal placeholder](/placeholders/guide-image-placeholder.svg)

> Placeholder: add a screenshot of successful startup output, ideally showing the port, log directory, and Feishu WebSocket startup info.

## 6. Complete the Feishu-side integration

Feishu is currently the primary platform for `CollabVibe`. On the first deployment, you need to complete bot creation, permission setup, event subscriptions, and visibility publishing on the platform side.

- See [Feishu Integration](/00-overview/platform-feishu) for the platform steps
- If you just want to understand the current state, you can also review [Slack Integration](/00-overview/platform-slack)

![Feishu integration process placeholder](/placeholders/guide-image-placeholder.svg)

> Placeholder: add a screenshot of a completed Feishu platform configuration page.

## 7. Minimal validation

Validate in the following order:

1. The service starts without startup errors
2. The bot is visible in the target group chat or direct chat
3. Sending a user message triggers an event
4. The bot returns a message or card
5. `data/logs/app.log` contains the corresponding logs

```bash
tail -f data/logs/app.log
```

```bash
npm run test:workspace
```

## 8. Common commands

```bash
npm run start:dev
npm run start
npm run docs:dev
npm run docs:build
npm run test:workspace
npm test
```

![Quickstart demo video placeholder](/placeholders/guide-video-placeholder.svg)

> Placeholder: add a 1–3 minute Quickstart recording covering “start service -> send a Feishu message -> inspect logs”.

## What to read next

- To understand the whole system: [System Overview](/00-overview/system-overview)
- To understand the three core entities: [Core Entities: Project / Thread / Turn](/01-architecture/core-entities)
- To understand logging: [Logging System](/02-operations/logging-system)
