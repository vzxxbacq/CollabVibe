# CollabVibe

An orchestration layer for collaborative AI coding workflows across chat platforms and agent backends.

CollabVibe provides threaded agent conversations, approval workflows, snapshots, merge review, and streaming output through a layered `src / services / packages` architecture.

![README hero placeholder](docs/public/placeholders/guide-image-placeholder.svg)

Placeholder: replace with a product overview screenshot, architecture poster, or chat-card workflow image.

## Why this project

- Run coding or automation agents directly from chat
- Keep platform integration separate from orchestration and backend logic
- Support multiple agent backends behind one runtime
- Add safety controls such as approvals, snapshots, rollback, and merge review

## Features

- Multi-backend agent orchestration
- Feishu-first chat integration
- Thread-based conversations
- Approval and interruption workflow
- Snapshot and rollback support
- Merge preview and merge review flows
- Streaming event pipeline
- Plugin / skill extensibility

## Architecture

The system has two main paths:

1. **Command response path**
   - IM event → platform handler → intent dispatcher → orchestrator → output adapter
2. **Streaming event path**
   - backend notification → event pipeline → router → output adapter

Core repository layout:

- `src/` — platform entrypoints and handlers
- `services/` — orchestration and business services
- `packages/` — reusable low-level packages
- `docs/` — architecture and operations docs

System-level architecture constraints live in:

- `AGENTS.md`

![Architecture placeholder](docs/public/placeholders/guide-image-placeholder.svg)

Placeholder: replace with the latest Path A / Path B architecture diagram.

## Quick start

### 1. Install

```bash
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Minimum commonly used settings:

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `CODEX_APP_SERVER_CMD`
- `CODEX_WORKSPACE_CWD`
- `SYS_ADMIN_USER_IDS`

### 3. Run

```bash
npm run start:dev
```

### 4. Open docs locally

```bash
npm run docs:dev
```

![Quickstart video placeholder](docs/public/placeholders/guide-video-placeholder.svg)

Placeholder: replace with a short walkthrough video cover that shows local boot, Feishu trigger, and streaming output.

## Documentation

- Docs home: `docs/index.md`
- Quickstart: `docs/00-overview/quickstart.md`
- Project intro: `docs/00-overview/project-intro.md`
- System overview: `docs/00-overview/system-overview.md`
- Feishu onboarding: `docs/00-overview/platform-feishu.md`
- Slack onboarding: `docs/00-overview/platform-slack.md`
- Core entities: `docs/01-architecture/core-entities.md`
- Architecture invariants: `docs/01-architecture/invariants.md`
- Layer boundaries: `docs/01-architecture/layers-and-boundaries.md`
- Logging system: `docs/02-operations/logging-system.md`
- Local development: `docs/03-development/local-development.md`
- Testing guide: `docs/03-development/testing.md`
- Logging policy: `docs/logging-policy.md`

## Development

Run the app:

```bash
npm run start
```

Run tests:

```bash
npm test
```

Useful targeted suites:

```bash
npm run test:app
npm run test:orchestrator
npm run test:channel-feishu
```

## Current status

- Primary chat platform: **Feishu**
- Repository architecture is already prepared for additional platforms and backends
- The project is under active iteration

## Notes

- Runtime logs and local data are kept out of Git
- Deep architecture rules are intentionally stricter than a typical Node project
- If you are changing cross-layer data flow, read `AGENTS.md` first
