---
title: GitHub Pages 部署
layer: operations
status: active
---

# GitHub Pages 部署

## 本地验证

| 目标 | 命令 |
| --- | --- |
| 预览站点 | `npm run docs:dev` |
| 构建站点 | `npm run docs:build` |
| 校验文档骨架 | `npm run test:workspace` |

## GitHub 配置

| 步骤 | 操作 |
| --- | --- |
| 1 | 进入 `Settings -> Pages` |
| 2 | `Build and deployment` 选择 `GitHub Actions` |
| 3 | 新建 `/.github/workflows/docs-pages.yml` |

## 推荐工作流

```yaml
name: docs-pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run docs:build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: docs/.vitepress/dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

## base 配置

| 场景 | 配置 |
| --- | --- |
| 仓库子路径发布 | `base: "/<repo>/"` |
| 自定义域名 | 通常不需要仓库子路径 base |
