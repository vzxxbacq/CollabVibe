---
title: "Layers and Boundaries"
layer: architecture
source_of_truth: AGENTS.md, repository layout
status: active
---

# Layers and Boundaries

## `packages/*`

Positioning: the lowest-level capability packages.

Typical contents:

- protocol clients
- channel abstractions
- types and utilities

Constraints:

- must not import `services/*`
- must not import `src/*`

## `services/*`

Positioning: shared business services.

Typical contents:

- orchestrator
- persistence
- iam
- approval
- audit

Constraints:

- may import `packages/*`
- must not import `src/*`

## `src/core`

Positioning: platform-agnostic application entry logic.

Typical contents:

- intent-dispatcher
- platform-commands

## `src/feishu`

Positioning: Feishu-specific integration layer.

Typical contents:

- message handling
- card callbacks
- WebSocket app wiring

## `src/server.ts`

Positioning: composition root.

Responsibilities:

- initialize the database, logs, adapters, and services
- connect the orchestrator with platform handlers
- wire Path A and Path B together
