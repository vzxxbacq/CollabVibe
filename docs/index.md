---
title: 首页
---

# CollabVibe 文档

面向 IM 场景的 Human-in-the-Loop Agent 协作系统。

## 文档入口

| 场景 | 文档 |
| --- | --- |
| 了解项目范围与能力 | [项目简介](/00-overview/project-intro) |
| 第一次部署并跑通系统 | [QUICKSTART](/00-overview/quickstart) |
| 理解整体结构 | [系统总览](/00-overview/system-overview) |
| 完成平台接入准备 | [Feishu 平台接入](/00-overview/platform-feishu), [Slack 平台接入](/00-overview/platform-slack) |
| 理解调用链 | [调用链与数据流](/01-architecture/data-paths) |
| 理解核心对象 | [核心类：Project / Thread / Turn](/01-architecture/core-entities) |
| 理解分层边界 | [分层隔离与模块契约](/01-architecture/invariants) |
| 查看运维与日志 | [数据与存储](/02-operations/data-and-storage), [日志系统](/02-operations/logging-system) |
| 数据迁移与备份 | [数据与存储](/02-operations/data-and-storage) |
| 本地开发 | [本地开发](/03-development/local-development) |

## 文档组织

- **00 QUICKSTART**：第一次部署、平台接入、项目定位
- **01 架构**：调用链、核心对象、分层边界、模块契约
- **02 运维**：数据目录、日志系统、排障、文档发布
- **开发**：本地运行、测试、模块地图、核心类型、改动入口
