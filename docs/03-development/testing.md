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
| `npm test` | Full test suite |
| `npm run test:logic` | Logic-layer tests |
| `npm run test:e2e` | End-to-end tests |
| `npm run test:workspace` | Workspace and docs-structure checks |
| `npm run docs:build` | Documentation build validation |

## Test layering

| Location | Description |
| --- | --- |
| `tests/governance/*` | Repository structure, documentation structure, CI gate |
| `src/__tests__/*` | Application-layer tests |
| `packages/*/tests/*` | Package-level tests |
| `services/*/tests/*` | Service-level tests |
| `tests/e2e/*` | End-to-end tests |
