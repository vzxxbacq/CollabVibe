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
| `npm test` | 当前维护中的全量测试 |
| `npm run test:logic` | package + service 逻辑测试 |
| `npm run test:app` | Admin UI 集成测试 |
| `npm run test:workspace` | workspace 与文档骨架校验 |
| `npm run docs:build` | 文档站点构建校验 |

## 测试分层

| 位置 | 说明 |
| --- | --- |
| `packages/admin-ui/tests/integration/*` | Admin UI 集成测试（jsdom） |
| `packages/*/tests/*` | 包级测试 |
| `services/*/tests/*` | 服务级测试 |
