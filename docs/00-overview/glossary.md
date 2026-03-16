---
title: 术语表
layer: overview
status: active
---

# 术语表

- **Path A**：用户消息到渲染结果的命令响应路径
- **Path B**：后端流式事件到 IM 输出的事件路径
- **BackendIdentity**：后端身份值对象，统一表示 backendId / model / transport
- **ThreadRecord**：chat 级线程持久状态
- **UserThreadBinding**：user 级活动线程指针
- **RuntimeConfig**：单次 turn 运行配置
- **Orchestrator**：负责线程、backend、事件、turn 生命周期的协调层
- **FeishuOutputAdapter**：Feishu 输出适配器，在两条路径中承担不同角色
