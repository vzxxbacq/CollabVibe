---
title: "Troubleshooting"
layer: operations
status: active
---

# Troubleshooting

| Problem | What to check |
| --- | --- |
| Service fails to start | `.env`, port conflicts, `data/` write permissions, backend command executability |
| Feishu is unresponsive | `appId` / `appSecret`, bot visibility, event subscriptions, WebSocket connection |
| Agent does not execute | backend configuration, default model, event pipeline injection |
| Thread state looks wrong | `project_threads`, `user_thread_bindings`, database records |
| Card approvals do not respond | `card.action.trigger` subscription, approval callback path |
| State missing after data migration | Whether `.db`, `.db-wal`, `.db-shm`, and `data/config/` were migrated together |
| Documentation site returns 404 | VitePress locale/base configuration, GitHub Pages path |
