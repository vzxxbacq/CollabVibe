---
title: "Glossary"
layer: overview
status: active
---

# Glossary

- **Path A**: the command-response path from a user message to a rendered result
- **Path B**: the event path from backend streaming events to IM output
- **BackendIdentity**: the backend identity value object that consistently represents `backendId` / `model` / `transport`
- **ThreadRecord**: persistent thread state at the project scope
- **UserThreadBinding**: the user-scoped pointer to the active thread
- **RuntimeConfig**: per-turn runtime configuration
- **Orchestrator**: the coordination layer responsible for threads, backends, events, and Turn lifecycle
- **FeishuOutputAdapter**: the Feishu output adapter, which plays different roles on the two main paths
