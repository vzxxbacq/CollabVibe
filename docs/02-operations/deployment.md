---
title: "Deployment"
layer: operations
status: active
---

# Release and Deployment Strategy

This page defines the official delivery model for `CollabVibe`, the runtime directory convention, the requirements for publishing to the `npm` registry, and the role boundaries of `Docker` in real deployments.

## Conclusion

`CollabVibe` follows a dual-delivery strategy:

- primary distribution form: executable `npm` application
- official deployment option: `Docker` / `Docker Compose`

The project should not be positioned as “source-only”, and container images should not be the only supported delivery form.

## Why `npm` comes first

The system is fundamentally an IM collaboration orchestration layer, not a closed monolithic service. It needs to work alongside a rapidly evolving local backend ecosystem such as `codex`, `claude-code`, and `opencode`.

Using `npm` as the primary distribution form provides these advantages:

- it matches the install and upgrade style of current backend CLIs
- users can directly reuse backend commands already installed on the host
- backend upgrades do not require rebuilding the app image
- local development, trial runs, and private deployment follow the same path
- it is a better fit for `npx collabvibe`, global installs, CI nodes, and self-hosted machines that need fast upgrades

## Why Docker still matters

`Docker` is not the primary distribution form, but it should still be provided because:

- it lowers the environment barrier for first-time deployment
- it pins Node.js and application dependency versions
- it works well for demos, test environments, and standardized team deployment
- it provides a consistent base image for `Docker Compose`, Kubernetes, and PaaS environments

One important caveat: the container image can only standardize `CollabVibe` itself. If a backend still depends on host CLIs or external commands, the deployment docs must explain that explicitly rather than implying the image solves all dependencies.

## Official delivery matrix

| Delivery mode | Positioning | Recommended scenarios |
| --- | --- | --- |
| `npm` registry | Primary delivery mode | Local runs, private deployments, upgrades aligned with backend CLI ecosystem |
| `Docker` image | Official deployment packaging | Team trials, standardized deployment, demo environments |
| Source repository | Development and contribution entry | Custom development, debugging, PR submission |

## Runtime directory convention

To support `npm` delivery, runtime state should not depend on repository-relative paths as the only persistence location. Released builds should converge on a unified application directory.

Recommended directory layout:

```text
.collabvibe/
  config/
  data/
  logs/
  backends/
  cache/
```

Recommended semantics:

| Path | Purpose |
| --- | --- |
| `.collabvibe/config/` | App config, backend config, release metadata |
| `.collabvibe/data/` | SQLite, thread state, approval state, audit data |
| `.collabvibe/logs/` | App logs, backend RPC logs, diagnostic logs |
| `.collabvibe/backends/` | Backend-related generated artifacts or helper config |
| `.collabvibe/cache/` | Non-critical cache and temporary downloads |

Recommended rules:

- release builds must not require users to launch from the repository root just to find critical data
- critical persistent data should live under `.collabvibe/`, not scattered across the working directory
- workspace code repositories and application state directories should be logically separated
- backend commands, workspace paths, and platform credentials should be configured explicitly instead of inferred from implicit directory guesses

## `npm` application shape

Publicly, `CollabVibe` should be released as an executable application rather than a library intended only for import.

Recommended command shape:

```bash
npx collabvibe start
```

or:

```bash
npm install -g collabvibe
collabvibe start
```

Recommended commands:

- `collabvibe start`
- `collabvibe doctor`
- `collabvibe init`
- `collabvibe env check`
- `collabvibe backend list`

These commands are not about widening the product scope. They exist so users can install, diagnose, validate configuration, and run the system without reading large amounts of source code.

## `npm` registry and release strategy

### Package positioning

- the package name should be a stable, publicly distributable app name
- `package.json` should remove `private: true`
- a `bin` entry should expose a stable CLI
- published contents should be tightly controlled through a `files` allowlist

### Requirements before publishing

Before releasing to the `npm` registry, at minimum ensure:

1. the CLI startup entry is stable
2. the default runtime directory strategy is stable
3. the docs specify the minimum required environment variables
4. `npm pack` output does not contain local junk files
5. the published package does not ship `docs/.vitepress/dist`, `data/`, `tmp/`, `bak/`, or test artifacts
6. the release flow has versioning, change notes, and a rollback plan

### Package content control

Recommended published contents include only what is required at runtime, for example:

- compiled output or runtime entry for `src/`
- runtime code required from `packages/*` and `services/*`
- `LICENSE`
- `README`
- `.env.example`

The following should generally not be published directly in the package:

- local databases
- documentation build artifacts
- review output
- temporary directories
- development scratch files

### Registry release recommendations

- use the official `npm` registry as the default public distribution channel
- use semantic versioning
- publish prereleases under `next` or an equivalent dist-tag
- publish stable releases under `latest`
- keep a changelog or release note for every release

## Docker delivery strategy

Docker should be an officially supported deployment packaging option, not the only runtime path.

Recommended artifacts:

- `Dockerfile`
- `docker-compose.yml`
- `.dockerignore`
- documentation for container environment variables
- documentation for volume mounts

Recommended mount design:

| Container path | Host source | Description |
| --- | --- | --- |
| `/app/.collabvibe` | named volume or bind mount | configuration, database, logs |
| `/workspace` | bind mount | user code workspace |

Recommended boundaries:

- the Docker image is responsible for providing a stable `CollabVibe` runtime
- if a backend depends on host CLIs, the docs should clearly explain the pass-through strategy
- if a backend later supports standalone containers, it should still be integrated through explicit orchestration instead of being baked into the app image

## Stream throttling tuning

Path B streaming throttling is owned by the L2 `EventPipeline` / `StreamOutputCoordinator`, not by Feishu or Slack adapters.

Use these environment variables only when you need to tune bursty streaming behavior in production:

| Variable | Default | Meaning |
| --- | --- | --- |
| `COLLABVIBE_STREAM_PERSIST_WINDOW_MS` | `500` | Minimum interval between normal persisted turn-state flushes |
| `COLLABVIBE_STREAM_PERSIST_MAX_WAIT_MS` | `2000` | Maximum time dirty streaming state may wait before persistence |
| `COLLABVIBE_STREAM_PERSIST_MAX_CHARS` | `2048` | Character threshold that triggers an early persistence flush |
| `COLLABVIBE_STREAM_UI_WINDOW_MS` | `400` | Minimum interval between normal UI streaming flushes |
| `COLLABVIBE_STREAM_UI_MAX_WAIT_MS` | `1200` | Maximum time buffered streaming UI output may wait before flush |
| `COLLABVIBE_STREAM_UI_MAX_CHARS` | `1024` | Character threshold that triggers an early UI flush |

Operational guidance:

- prefer defaults first; they are chosen to keep critical events immediate while reducing high-frequency delta fan-out
- tune `*_WINDOW_MS` carefully; larger values reduce write/send frequency but increase perceived latency
- tune `*_MAX_WAIT_MS` as a guardrail, not as the primary control
- tune `*_MAX_CHARS` when the backend emits very large deltas or very dense tool output bursts
- terminal events (`turn_complete`, `turn_aborted`) still force a flush regardless of these settings
- invalid or non-positive values are ignored and the default remains in effect

Example:

```bash
export COLLABVIBE_STREAM_PERSIST_WINDOW_MS=700
export COLLABVIBE_STREAM_UI_WINDOW_MS=500
export COLLABVIBE_STREAM_UI_MAX_WAIT_MS=1500
```

## Documentation consistency requirements

After release, all user-facing docs should consistently communicate:

- recommend `npm` / `npx` first for quick start
- recommend `Docker` for team deployment and demo environments
- describe source-based execution as the developer path, not the only recommended path

The following information must remain consistent across docs:

- minimum required environment variables
- `.collabvibe/` directory semantics
- backend integration method
- log and data locations
- upgrade method

## Release gates

Before each formal release, it is recommended to run these checks:

1. use `npm pack` to verify package contents
2. run a minimal install-and-start validation on a fresh machine
3. validate `.collabvibe/` directory initialization logic
4. validate the Feishu main path: startup, receive message, and return result
5. validate that the Docker image can start and pass a minimal health check
6. verify that commands and variable names are consistent across README, QUICKSTART, and deployment docs

## Current governance direction for this repository

Given the current code state, recommended next steps are:

1. formalize the official stance of `npm first, Docker supported`
2. gradually migrate the default release-state directory from repository-relative paths to `.collabvibe/`
3. add the CLI entry and `bin` command
4. then implement the `npm` publishing flow and official Docker image

## Related documents

- [Quickstart](/00-overview/quickstart)
- [Data and Storage](/02-operations/data-and-storage)
- [Logging System](/02-operations/logging-system)
