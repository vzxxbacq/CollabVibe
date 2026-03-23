---
title: "System Architecture"
layer: architecture
source_of_truth: AGENTS.md, agent/01-architecture.md
status: active
---

# System Architecture

## Overview

Codex App Server is a multi-platform IM Bot service connecting Feishu/Slack and other IM platforms to AI Agent backends (Codex CLI / ACP protocol). Users send messages in group chats, the system routes them to the Agent for execution, and streams results back to IM cards in real time.

The system uses a **4-layer architecture** with strict **unidirectional dependencies** and **layer isolation**.

---

## 1. Layer Architecture

```
┌────────────────────────────────────────────────────────────┐
│  L0  Composition Root                                      │
│  src/server.ts · src/config.ts · src/platform/             │
├────────────────────────────────────────────────────────────┤
│  L1  Platform Modules                                      │
│  src/feishu/ · src/slack/                                  │
├────────────────────────────────────────────────────────────┤
│  L2  Services                                              │
│  contracts · orchestrator · persistence                    │
├────────────────────────────────────────────────────────────┤
│  L3  Core Packages                                         │
│  agent-core · git-utils · logger · admin-ui                │
└────────────────────────────────────────────────────────────┘
```

### Layer Responsibilities

| Layer | Responsibility | Modules |
|---|---|---|
| **L0** | Process startup, dependency injection, platform bootstrap | `server.ts`, `config.ts`, `platform/` |
| **L1** | IM platform adaptation: message handling, card rendering, WebSocket | `src/feishu/`, `src/slack/` |
| **L2** | Platform-agnostic business logic and type definitions | `services/contracts/`, `services/orchestrator/`, `services/persistence/` |
| **L3** | Low-level infrastructure: Agent protocol, utilities | `packages/agent-core/`, `packages/git-utils/`, `packages/logger/` |

### Isolation Rules

| Source | May import | Must not import |
|--------|-----------|-----------------|
| **L0** | orchestrator factory, logger | L1 internals, L3 |
| **L1** | orchestrator, contracts, logger | L3, other platform modules |
| **L2** | L3, peer L2 modules | L0, L1 |
| **L3** | same-layer (unidirectional) | L0, L1, L2 |

### L2 Modules

| Module | Responsibility |
|--------|---------------|
| **contracts** | Pure types/interfaces: IM protocol (`im/`) + admin contracts (`admin/`), zero logic |
| **orchestrator** | Business core: Agent sessions, Intent, Commands, IAM, Approval, Audit, Plugin |
| **persistence** | Storage implementation: SQLite, injected into orchestrator via DI only |

### L3 agent-core

Unified backend protocol containing `transports/codex/` (Codex stdio) and `transports/acp/` (ACP SSE). L2 accesses backends through the `AgentApiFactory` interface; direct imports of `transports/` internals are forbidden.

---

## 2. Data Paths

The system has exactly two data paths. All functionality must flow along these paths.

### Path A: Command Response (User Message → Rendered Result)

```
IM Event
  → server.ts dispatch (L0)
  → feishu-message-handler (L1)
  → orchestrator/intent/dispatcher (L2)
    ├─ agent command → orchestrator.handleIntent()
    │                 → AgentApiPool → AgentApiFactory
    │                 → HandleIntentResult
    └─ non-agent command → orchestrator/commands/platform-commands
  → FeishuOutputAdapter render (L1)
```

| Stage | Module | Responsibility |
|-------|--------|---------------|
| Event binding | `server.ts` (L0) | Binds IM callbacks |
| Platform parsing | `feishu-message-handler` (L1) | Parses messages/users/content |
| Intent dispatch | `orchestrator/intent/dispatcher` (L2) | Classify → authorize → route |
| Non-agent commands | `orchestrator/commands/` (L2) | `/thread`, `/help`, project management |
| Agent commands | `orchestrator.handleIntent()` (L2) | Thread/backend/turn/pipeline |
| Platform output | `FeishuOutputAdapter` (L1) | Renders Feishu messages and cards |

### Path B: Agent Streaming Events (Agent Executing → Real-time Push)

```
Backend (Codex stdio / ACP SSE)
  → onNotification
  → agent-core/transports/ eventBridge (L3)
  → UnifiedAgentEvent
  → orchestrator/event/EventPipeline (L2)
  → AgentEventRouter → transformEvent
  → AgentStreamOutput interface
  → FeishuOutputAdapter / SlackOutputAdapter (L1)
```

| Stage | Module | Responsibility |
|-------|--------|---------------|
| Backend integration | `agent-core/transports/` (L3) | Connects to Codex/ACP protocols |
| Event unification | `UnifiedAgentEvent` (L3) | Unified event model |
| Event orchestration | `orchestrator/event/` (L2) | Pipeline, routing, callbacks |
| Platform push | Output Adapter (L1) | Converts to platform messages |

### Design Constraints

| Constraint | Description |
|-----------|-------------|
| Path A must go through `intent/dispatcher` | Unified command entry point |
| Path B must go through `EventPipeline` | Unified streaming event entry point |
| L1 must not call backends directly | Backend differences handled inside L3 |
| New platforms must not add a third path | Reuse Path A / B |

---

## 3. Core Invariants

### 3.1 BackendIdentity

| Rule | Description |
|------|------------|
| **I1** | `transport` derived from `backendId` automatically; never passed independently |
| **I2** | Must be passed as a whole `BackendIdentity`; never split into fields |
| **I3** | `ThreadRecord.backend` is the single persistent source |
| **I4** | Frozen with `Object.freeze()` after creation; immutable |
| **I5** | `UserThreadBinding` is a pure pointer; no backend metadata |

### 3.2 Project / Chat Relationship

| Rule | Description |
|------|------------|
| **P1** | Project is the aggregate root |
| **P2** | `chatId` is a platform binding, not a persistence key |
| **P3** | IM entry dereferences `chatId → projectId` first |
| **P4** | Thread history does not migrate on chat rebinding |
| **P5** | `UserThreadBinding` is a pure pointer |

### 3.3 Thread State Model

| Type | Scope | Persistent Source |
|------|-------|------------------|
| `ProjectRecord` | project aggregate root | `AdminStateStore` |
| `ThreadRecord` | project-level, immutable | `ThreadRegistry` |
| `UserThreadBinding` | user-level, pure pointer | `UserThreadBindingService` |
| `RuntimeConfig` | per-turn, transient | `RuntimeConfigProvider` |
| `UserRecord` | global, mutable | `UserRepository` (SQLite) |

### 3.4 User State

| Rule | Description |
|------|------------|
| **U1** | Admin merged from `env` (non-deletable) and `im` (mutable) |
| **U2** | `users` table is the single source of truth for roles |
| **U3** | Admin has all permissions |

---

## 4. Platform Extension Rules

### New Platform Minimum Contract

A new IM platform must provide:
- A message → input adapter for Path A
- An interactive callback → command adapter
- An `IMOutputAdapter` implementation for Path B and structured Path A outputs

Must not:
- Persist thread/backend state at the platform layer
- Bypass `dispatchIntent()` or `EventPipeline`
- Leak platform payload shapes into shared services

### Adding a New Backend

- Add a new transport under `agent-core/transports/`
- Update `BackendId` enum + `BACKEND_TRANSPORT` mapping
- Zero changes required in L2

---

## 5. Governance

### Fallback Governance

Critical paths must fail explicitly. Fallbacks allowed only on non-critical paths (logs/cache/UI degradation), must record the original error, and must not alter core semantics.

### Test File Protection

Test files (`*.test.*`) are read-only by default. Explicit authorization + rationale required before modification.

### Architecture Changes

Propose rationale → obtain human approval → verify isolation constraints still hold.
