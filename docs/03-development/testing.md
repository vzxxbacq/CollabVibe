---
title: 测试矩阵
layer: development
source_of_truth: package.json
status: active
---

# 测试矩阵

## 测试入口

| 命令 | 作用 |
| --- | --- |
| `npm test` | 全量测试 |
| `npm run test:logic` | 逻辑层测试 |
| `npm run test:e2e` | 端到端测试 |
| `npm run test:workspace` | workspace 与文档骨架校验 |
| `npm run docs:build` | 文档站点构建校验 |

## 测试分层

| 位置 | 说明 |
| --- | --- |
| `tests/governance/*` | 仓库结构、文档结构、CI gate |
| `src/__tests__/*` | 应用层测试 |
| `packages/*/tests/*` | 包级测试 |
| `services/*/tests/*` | 服务级测试 |
| `tests/e2e/*` | 端到端测试 |
