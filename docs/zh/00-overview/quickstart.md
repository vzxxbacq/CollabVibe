---
title: QUICKSTART
layer: overview
status: active
source_of_truth: package.json, src/server.ts, src/config.ts, docs/00-overview/platform-feishu.md
---

# QUICKSTART

这份文档面向第一次部署和第一次跑通 `CollabVibe` 的读者，目标是在最短路径内完成：

- 安装依赖
- 配置环境变量
- 准备 API backend 命令与 workspace
- 启动服务
- 在 Feishu 中验证消息与卡片链路

## 1. 运行前提

| 项目 | 说明 |
| --- | --- |
| Node.js | 用于运行 `tsx`、VitePress、测试脚本 |
| npm / pnpm 兼容环境 | 当前仓库脚本以 `npm run` 形式提供 |
| 本地文件系统 | 保存 `data/`、配置、日志、SQLite、workspace |
| Feishu 应用凭据 | 当前主平台必需 |
| backend 可执行命令 | 例如 `codex app-server` |

```bash
node -v
npm -v
```

## 2. 安装依赖

```bash
npm install
```

## 3. 准备环境变量

推荐从现有环境模板或本地部署变量开始整理，至少准备以下变量：

| 变量 | 必填 | 作用 |
| --- | --- | --- |
| `FEISHU_APP_ID` | 是 | Feishu 应用 ID |
| `FEISHU_APP_SECRET` | 是 | Feishu 应用密钥 |
| `FEISHU_SIGNING_SECRET` | 否 | 事件签名校验；Stream 模式通常可不填 |
| `FEISHU_ENCRYPT_KEY` | 否 | 加密事件支持 |
| `CODEX_APP_SERVER_CMD` | 建议 | backend 启动命令 |
| `COLLABVIBE_WORKSPACE_CWD` | 建议 | 工作区根目录 |
| `CODEX_SANDBOX` | 否 | 默认 sandbox 策略 |
| `CODEX_APPROVAL_POLICY` | 否 | 默认审批策略 |
| `APPROVAL_TIMEOUT_MS` | 否 | 审批超时 |
| `COLLABVIBE_STREAM_PERSIST_WINDOW_MS` | 否 | Path B 流式持久化窗口 |
| `COLLABVIBE_STREAM_PERSIST_MAX_WAIT_MS` | 否 | Path B 流式持久化最长等待时间 |
| `COLLABVIBE_STREAM_PERSIST_MAX_CHARS` | 否 | 提前触发持久化 flush 的字符阈值 |
| `COLLABVIBE_STREAM_UI_WINDOW_MS` | 否 | Path B 流式 UI flush 窗口 |
| `COLLABVIBE_STREAM_UI_MAX_WAIT_MS` | 否 | Path B 流式 UI 最长等待时间 |
| `COLLABVIBE_STREAM_UI_MAX_CHARS` | 否 | 提前触发 UI flush 的字符阈值 |
| `PORT` | 否 | 服务监听端口 |
| `SYS_ADMIN_USER_IDS` | 建议 | 初始系统管理员 ID 列表 |

```bash
cp .env.example .env
```

```dotenv
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
CODEX_APP_SERVER_CMD=codex app-server
COLLABVIBE_WORKSPACE_CWD=/abs/path/to/workspace
SYS_ADMIN_USER_IDS=ou_xxx
PORT=3100
```

这些 stream 调参变量都是可选项。大多数部署场景保持默认值即可，只有在高频流式 turn 下需要平衡“推送频率 / 感知延迟”时再调整。



## 4. 准备本地目录

运行时会依赖以下目录：

| 路径 | 说明 |
| --- | --- |
| `collabvibe.db` | SQLite 主库 |
| `config/` | backend 配置目录 |
| `logs/` | 运行日志 |
| `COLLABVIBE_WORKSPACE_CWD` | 代码工作区根目录 |

```bash
mkdir -p config logs
mkdir -p /abs/path/to/workspace
```

## 5. 启动服务

开发模式：

```bash
npm run start:dev
```

生产模式：

```bash
npm run start
```

文档预览：

```bash
npm run docs:dev
```



## 6. 完成 Feishu 平台接入

`CollabVibe` 当前主平台是 Feishu。第一次部署时，需要先在平台侧完成 Bot 创建、权限开通、事件订阅与可见范围发布。

- 平台步骤详见 [Feishu 平台接入](/zh/00-overview/platform-feishu)
- 如果只是了解现状，可同时参考 [Slack 平台接入](/zh/00-overview/platform-slack)



## 7. 最小验证

建议按下面顺序验证：

1. 服务已启动，无启动时报错
2. Bot 已加入目标群聊或单聊可见
3. 用户发送消息后可触发事件
4. 机器人可返回消息或卡片
5. `logs/app.log` 中可以看到对应日志

```bash
tail -f logs/app.log
```

```bash
npm run test:workspace
```

## 8. 常用命令

```bash
npm run start:dev
npm run start
npm run docs:dev
npm run docs:build
npm run test:workspace
npm test
```

## 9. 可选的 stream 调参

如果 backend 会产生非常密集的流式 delta，可以通过环境变量调节 Path B 节流参数：

```dotenv
COLLABVIBE_STREAM_PERSIST_WINDOW_MS=700
COLLABVIBE_STREAM_UI_WINDOW_MS=500
COLLABVIBE_STREAM_UI_MAX_WAIT_MS=1500
```

建议先验证默认行为，再决定是否调参。终态事件仍会强制执行最终 flush。

## 下一步

- 想理解系统全貌：看 [系统总览](/zh/00-overview/system-overview)
- 想理解三大核心对象：看 [核心类：Project / Thread / Turn](/zh/01-architecture/core-entities)
