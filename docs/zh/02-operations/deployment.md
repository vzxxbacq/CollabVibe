---
title: 部署运行
layer: operations
status: active
---

# 发布与部署策略

本页定义 `CollabVibe` 对外的正式交付方式、运行目录约定、`npm` 注册发布要求，以及 `Docker` 在真实部署中的角色边界。

## 结论

`CollabVibe` 采用双交付策略：

- 主分发形态：`npm` 可执行应用
- 官方部署选项：`Docker` / `Docker Compose`

不建议把项目定位为“仅供源码运行的仓库”，也不建议仅以容器镜像作为唯一交付形态。

## 为什么以 npm 为主

当前系统本质上是一个 IM 协作编排层，而不是封闭的单体服务。它需要与快速迭代的本地 backend 生态协同运行，例如 `codex`、`claude-code`、`opencode`。

以 `npm` 作为主分发形态有以下优势：

- 更接近现有 backend CLI 的安装与升级方式
- 用户可以直接复用宿主机已安装的 backend 命令
- backend 升级不需要重新构建应用镜像
- 本地开发、试用、私有部署的路径一致
- 更适合 `npx collabvibe`、全局安装、CI 节点和自托管机器上的快速升级

## 为什么仍然提供 Docker

`Docker` 不是主分发形态，但必须提供，原因如下：

- 降低首次部署的环境门槛
- 固定 Node.js 与应用依赖版本
- 适合演示环境、测试环境和团队标准化部署
- 为 `Docker Compose`、Kubernetes、PaaS 等环境提供统一基础镜像

需要注意，容器镜像只能标准化 `CollabVibe` 自身；如果 backend 仍依赖宿主机 CLI 或外部命令，则必须在部署文档中明确 backend 的接入方式，而不能假设镜像已经解决全部依赖。

## 官方交付矩阵

| 交付方式 | 定位 | 推荐场景 |
| --- | --- | --- |
| `npm` registry | 主交付方式 | 本地运行、私有部署、跟随 backend CLI 生态升级 |
| `Docker` image | 官方部署封装 | 团队试用、标准化部署、演示环境 |
| 源码仓库 | 开发与贡献入口 | 二次开发、调试、提交 PR |

## 运行目录约定

为支持 `npm` 交付，运行时状态不应依赖仓库相对路径作为唯一持久位置。正式发布形态应收敛到统一应用目录。

推荐目录：

```text
.collabvibe/
  config/
  data/
  logs/
  backends/
  cache/
```

推荐语义：

| 路径 | 作用 |
| --- | --- |
| `.collabvibe/config/` | 应用配置、backend 配置、发布态元数据 |
| `.collabvibe/data/` | SQLite、线程状态、审批状态、审计数据 |
| `.collabvibe/logs/` | 应用日志、backend RPC 日志、诊断日志 |
| `.collabvibe/backends/` | backend 相关生成物或辅助配置 |
| `.collabvibe/cache/` | 非关键缓存、临时下载物 |

推荐规则：

- 发布态禁止要求用户从仓库根目录启动才能找到关键数据
- 关键持久化数据应落在 `.collabvibe/` 下，而不是散落在工作目录
- 工作区代码仓库与应用状态目录应逻辑分离
- backend 命令、workspace、平台凭据通过配置显式声明，不依赖隐式目录猜测

## npm 应用形态

对外应将 `CollabVibe` 作为“可执行应用”而非“仅供 import 的库”发布。

推荐命令形态：

```bash
npx collabvibe start
```

或：

```bash
npm install -g collabvibe
collabvibe start
```

推荐能力：

- `collabvibe start`
- `collabvibe doctor`
- `collabvibe init`
- `collabvibe env check`
- `collabvibe backend list`

这些命令的目标不是扩展产品面，而是让用户在不阅读大量源码的情况下完成安装、诊断、配置校验和运行。

## npm 注册与发布策略

### 包定位

- 包名应为稳定、可公开分发的应用名
- `package.json` 应移除阻止发布的 `private: true`
- 应声明 `bin` 入口，暴露稳定 CLI
- 发布包内容应通过 `files` 白名单严格控制

### 发布前要求

发布到 `npm` registry 前，至少满足：

1. CLI 启动入口稳定
2. 默认运行目录策略稳定
3. 文档中给出最小必需环境变量
4. `npm pack` 产物不包含本地运行垃圾文件
5. 发布包不携带 `docs/.vitepress/dist`、`data/`、`tmp/`、`bak/`、测试临时产物
6. 发布流程有版本号、变更说明和回滚策略

### 包内容控制

建议仅发布运行所需内容，例如：

- `src/` 编译产物或运行入口
- `packages/*`、`services/*` 所需运行代码
- `LICENSE`
- `README`
- `.env.example`

不建议把以下内容直接打入发布包：

- 本地数据库
- 文档构建产物
- 评审输出
- 临时目录
- 开发期 scratch 文件

### 注册表发布建议

- 使用官方 `npm` registry 作为默认公开分发渠道
- 使用语义化版本
- 预发布版本使用 `next` 或等价 dist-tag
- 稳定版本使用 `latest`
- 为每次发布保留对应 changelog 或 release note

## Docker 交付策略

Docker 应作为官方支持的部署封装，而不是唯一运行路径。

推荐提供：

- `Dockerfile`
- `docker-compose.yml`
- `.dockerignore`
- 容器环境变量说明
- 卷挂载说明

推荐挂载设计：

| 容器路径 | 宿主机来源 | 说明 |
| --- | --- | --- |
| `/app/.collabvibe` | named volume 或 bind mount | 配置、数据库、日志 |
| `/workspace` | bind mount | 用户代码工作区 |

推荐边界：

- Docker 镜像负责提供稳定的 `CollabVibe` 运行时
- backend 若依赖宿主机 CLI，应在文档中明确透传方案
- backend 若未来支持独立容器，也应通过显式编排接入，不应写死在应用镜像里

## 流式节流调参

Path B 的流式节流统一由 L2 `EventPipeline` / `StreamOutputCoordinator` 负责，Feishu / Slack 渠道层不再承担业务级时间窗口聚合。

仅当你需要在生产环境中调优高频流式输出时，再使用以下环境变量：

| 变量名 | 默认值 | 含义 |
| --- | --- | --- |
| `COLLABVIBE_STREAM_PERSIST_WINDOW_MS` | `500` | 普通流式状态持久化的最小间隔 |
| `COLLABVIBE_STREAM_PERSIST_MAX_WAIT_MS` | `2000` | dirty 流式状态允许等待落盘的最长时间 |
| `COLLABVIBE_STREAM_PERSIST_MAX_CHARS` | `2048` | 达到该字符阈值时提前触发持久化 flush |
| `COLLABVIBE_STREAM_UI_WINDOW_MS` | `400` | 普通 UI 流式输出 flush 的最小间隔 |
| `COLLABVIBE_STREAM_UI_MAX_WAIT_MS` | `1200` | 缓冲中的 UI 流式输出允许等待的最长时间 |
| `COLLABVIBE_STREAM_UI_MAX_CHARS` | `1024` | 达到该字符阈值时提前触发 UI flush |

运维建议：

- 优先使用默认值；默认参数的目标是在保留关键事件即时可见的前提下降低高频 delta 扇出
- `*_WINDOW_MS` 越大，写入/推送频率越低，但用户感知延迟也越高
- `*_MAX_WAIT_MS` 更适合作为兜底上限，而不是主调节手段
- 如果 backend 会输出超大 delta 或非常密集的工具输出，可优先调整 `*_MAX_CHARS`
- `turn_complete`、`turn_aborted` 等终态事件仍会强制 flush，不受这些窗口限制
- 非法值或小于等于 0 的值会被忽略，系统继续使用默认值

示例：

```bash
export COLLABVIBE_STREAM_PERSIST_WINDOW_MS=700
export COLLABVIBE_STREAM_UI_WINDOW_MS=500
export COLLABVIBE_STREAM_UI_MAX_WAIT_MS=1500
```

## 文档口径要求

发布后，所有用户文档应统一以下口径：

- 快速上手优先推荐 `npm` / `npx`
- 团队部署与演示环境推荐 `Docker`
- 源码运行是开发者路径，不应作为唯一推荐路径

以下信息必须保持一致：

- 最小必需环境变量
- `.collabvibe/` 目录语义
- backend 接入方式
- 日志与数据位置
- 升级方式

## 发布门禁

每次正式发布前，建议执行以下检查：

1. `npm pack` 检查包内容是否符合预期
2. 新机器上执行一次最小安装与启动验证
3. 校验 `.collabvibe/` 目录初始化逻辑
4. 校验 Feishu 主路径可启动、可收消息、可返回结果
5. 校验 Docker 镜像可启动并完成最小健康检查
6. 核对 README、QUICKSTART、部署文档中的命令与变量名称一致

## 当前仓库的治理方向

按当前代码状态，后续治理建议如下：

1. 先确立 `npm first, Docker supported` 的正式口径
2. 将发布态的默认数据目录逐步从仓库相对路径迁移到 `.collabvibe/`
3. 补齐 CLI 入口与 `bin` 命令
4. 再落地 `npm` 注册发布流程和 Docker 官方镜像

## 相关文档

- [QUICKSTART](/zh/00-overview/quickstart)
- [数据与存储](/zh/02-operations/data-and-storage)
- [日志系统](/zh/02-operations/logging-system)
