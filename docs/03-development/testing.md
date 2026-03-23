---
title: "Test Matrix"
layer: development
source_of_truth: package.json
status: active
---

# Test Matrix

## Test entry points

| Command | Purpose |
| --- | --- |
| `npm test` | Full maintained test suite |
| `npm run test:logic` | Package + service logic tests |
| `npm run test:app` | Admin UI integration tests |
| `npm run test:workspace` | Workspace and docs-structure checks |
| `npm run docs:build` | Documentation build validation |

## Test layering

| Location | Description |
| --- | --- |
| `packages/admin-ui/tests/integration/*` | Admin UI integration tests (jsdom) |
| `packages/*/tests/*` | Package-level tests |
| `services/*/tests/*` | Service-level tests |
