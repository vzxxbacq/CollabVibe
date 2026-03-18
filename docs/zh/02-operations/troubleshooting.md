---
title: 故障排查
layer: operations
status: active
---

# 故障排查

| 问题 | 检查项 |
| --- | --- |
| 服务启动失败 | `.env`、端口占用、`data/` 写权限、backend 命令可执行 |
| Feishu 无响应 | appId / appSecret、Bot 可见性、事件订阅、WS 连接 |
| Agent 不执行 | backend 配置、默认 model、event pipeline 注入 |
| 线程状态异常 | `project_threads`、`user_thread_bindings`、数据库记录 |
| 卡片审批无响应 | `card.action.trigger` 订阅、审批回调链路 |
| 数据迁移后状态缺失 | 是否同时迁移 `.db`、`.db-wal`、`.db-shm` 与 `data/config/` |
| 文档站点 404 | VitePress `base` 配置、GitHub Pages 路径 |
