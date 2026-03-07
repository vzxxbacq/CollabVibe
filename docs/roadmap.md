# codex-app-server-im MVP PRD & 技术任务拆解

- 文档版本: v0.1
- 日期: 2026-03-07
- 状态: Draft（可直接进入实施）
- 目标读者: 后端/前端/平台工程师、产品、运维、安全
- 第一阶段执行清单: `docs/phase1-todo.md`
- 第二阶段执行清单: `docs/phase2-todo.md`

---

## 1. 产品目标（MVP）

构建一个面向企业团队的 IM Bot 网关，用户可在飞书中操作远程 Codex App Server 完成代码任务，具备：

1. 多项目管理与多人协作权限管理  
2. 统一 Channel 接口（MVP 仅实现飞书，预留钉钉等扩展）  
3. 安全可控（鉴权、审批、审计、最小权限）  
4. 低门槛配置（Setup Wizard）  

---

## 2. 方案约束与协议确认（基于 Codex App Server 文档）

MVP 方案以以下协议事实为前提：

- `codex app-server` 使用双向 JSON-RPC（wire 上省略 `jsonrpc: "2.0"`），默认 `stdio`，`websocket` 为实验能力。  
- 连接必须先 `initialize`，再发送 `initialized`；否则请求会被拒绝。  
- 会话核心流程：`thread/start|resume|fork` + `turn/start|steer|interrupt` + 持续事件流消费。  
- 命令执行与文件变更审批由 server 主动请求客户端决策（`accept/decline/...`）。  
- 配置与治理可通过 `config/read`、`configRequirements/read` 等接口读取/约束。  

参考：
- https://developers.openai.com/codex/app-server/
- https://developers.openai.com/codex/app-server/#protocol
- https://developers.openai.com/codex/app-server/#initialization

---

## 3. 角色与核心场景

### 3.1 角色

- 平台管理员（Platform Admin）：管理组织级配置、安全策略、密钥。  
- 项目管理员（Project Owner）：创建项目、绑定飞书群、分配成员角色。  
- 开发者（Developer）：在飞书群触发 Codex 任务、查看结果、响应追问。  
- 审批人（Approver）：审批高风险命令/文件变更。  
- 审计员（Auditor）：查看审计日志和安全事件。  

### 3.2 MVP 场景

1. 管理员通过 Setup Wizard 初始化系统并接入飞书应用。  
2. 项目管理员创建项目，绑定一个飞书群与仓库工作目录。  
3. 开发者在群内发送指令，系统映射到 Codex `thread/turn` 执行。  
4. 遇到高风险操作时，飞书交互卡片发给审批人处理。  
5. 执行结果、进度和错误回写飞书，并落审计日志。  

---

## 4. 范围定义

### 4.1 MVP In Scope

- 飞书 Bot 接入（事件接收、签名校验、消息发送、交互卡片）。  
- 多项目与成员权限（RBAC，项目级隔离）。  
- 统一 Channel 抽象与 Feishu Adapter 实现。  
- Codex 会话编排（thread/turn 生命周期管理）。  
- 审批流（命令/文件变更）与审计日志。  
- Setup Wizard（Web 管理端）完成初始化与连通性检查。  

### 4.2 MVP Out of Scope

- 钉钉正式可用接入（仅保留适配器骨架与配置位）。  
- 高级工作流编排（多 Agent 协同、自动排班）。  
- 复杂计费/配额系统（先提供基础配额与限流）。  

---

## 5. 功能需求（PRD）

## FR-1 多项目与协作权限

- 支持组织下多个项目，每个项目独立绑定：
  - IM 群会话（chatId）
  - 本地/远端工作目录（cwd）
  - 默认 sandbox / approval 策略
- RBAC 最小集合：
  - `platform_admin`, `project_owner`, `developer`, `approver`, `auditor`
- 权限点：
  - 发起任务、终止任务、审批高危操作、修改项目配置、查看审计
- 同一项目多人可共享 thread（可配置“按人独立 thread”模式）

## FR-2 Channel 统一接口

- 定义 `ChannelAdapter` 统一能力：
  - `verifyWebhook`
  - `parseInboundEvent`
  - `sendMessage`
  - `sendInteractiveCard`
  - `updateInteractiveCard`
  - `resolveUserIdentity`
- 定义统一消息结构 `UnifiedMessage` 与统一回执结构 `UnifiedResponse`
- MVP 仅实现 `FeishuAdapter`，提供 `DingTalkAdapter` stub（不可用但可编译）

## FR-3 安全与审计

- 入站请求签名校验、时间戳窗口、防重放、幂等去重。  
- 敏感操作审批：
  - 命令执行审批
  - 文件变更审批
- 审计日志包含：谁、何时、在哪个项目、触发了什么、审批结果、执行结果。  
- 密钥与令牌不明文入库，日志脱敏（token/apiKey 路径和内容做掩码）。  

## FR-4 配置与 Setup Wizard

- 首次启动引导：
  1) 管理员账号初始化  
  2) 飞书应用参数录入（App ID/Secret/Encrypt Key/Signing Secret）  
  3) Codex App Server 连接测试（initialize + thread/start + turn/start 冒烟）  
  4) 默认安全策略选择（approval/sandbox/network）  
  5) 创建首个项目与管理员  
- 向导完成后产出可持久化配置（数据库 + 环境变量引用）

## FR-5 可观测性

- 指标：请求量、成功率、平均响应时延、审批耗时、失败原因分布。  
- 日志：结构化日志（requestId/projectId/threadId/correlationId）。  
- 健康检查：`/healthz`、`/readyz`。  

## FR-6 对话到操作映射（核心编排）

- 所有飞书消息先经过 `Intent Router`，分类为两类：
  - `Platform Intent`：项目/成员/配置/skill 管理（平台侧 API + DB 操作）
  - `Codex Intent`：需要进入 Codex 执行的对话（thread/turn/approval 流）
- 统一命令前缀建议（MVP）：
  - `/project create ...`、`/project list`
  - `/thread new`、`/thread resume`
  - `/skill install ...`、`/skill list`
  - 非命令文本默认走 `turn/start`（继续当前线程）
- `Platform Intent` 与 `Codex Intent` 必须分流，避免把“项目管理命令”错误送到模型。

---

## 6. 非功能需求（NFR）

- 可用性：MVP 环境月可用性 >= 99.5%。  
- 性能：普通文本任务首包回执 <= 3s（不含模型推理时长）。  
- 安全：默认最小权限；高风险动作必须审批。  
- 扩展性：新增一个 IM channel 不修改核心编排层。  
- 可维护性：关键路径单元测试覆盖率 >= 70%。  

---

## 7. 系统架构（MVP）

```text
Feishu Webhook
   -> Channel Gateway (verify/idempotency/rate-limit)
   -> Channel Adapter (feishu)
   -> Conversation Orchestrator
   -> Codex Connector (JSON-RPC client)
   -> Codex App Server

Admin Console (Setup Wizard / Project / Members / Audit)
   -> Backend API
   -> DB + Secret Store
```

核心模块：

- `channel-core`: 统一接口与消息模型  
- `channel-feishu`: 飞书实现  
- `orchestrator`: thread/turn 状态机、事件分发  
- `codex-client`: initialize、thread/turn、approval 回调封装  
- `iam-policy`: RBAC + 策略决策  
- `audit-log`: 审计写入与查询  
- `config-service`: 系统/项目/用户配置读取与覆盖  

### 7.1 飞书 Bot API -> 统一 Channel -> Codex 操作链路

```text
Feishu Event
  -> verifyWebhook(signature, ts, nonce)
  -> parseInboundEvent() => UnifiedMessage
  -> idempotencyGuard(event_id)
  -> intentRouter(UnifiedMessage)
      -> PlatformIntentHandler  (项目/skill/成员管理)
      -> CodexIntentHandler     (thread/turn/approval)
  -> responseComposer
  -> Feishu sendMessage/sendCard
```

### 7.2 对话编排状态机（Codex Intent）

- `IDLE`：无活动 turn，可接收新输入。  
- `RUNNING`：已调用 `turn/start`，持续消费 `item/*` 事件。  
- `AWAITING_APPROVAL`：收到 `item/*/requestApproval`，等待飞书卡片回传。  
- `INTERRUPTED`：用户触发 `/interrupt` 或超时中断。  
- `FAILED`：turn 失败，回写错误并保留可恢复上下文。  

状态迁移关键点：

- 首条消息且无 thread 绑定：先 `thread/start`，再 `turn/start`。  
- 已有 thread 绑定：直接 `turn/start`；必要时可 `/thread new` 强制新建。  
- 审批回传后继续执行，收到 `serverRequest/resolved` 后转 `RUNNING`。  

### 7.3 三个关键用例（端到端）

#### A) 新建项目（Platform Intent，不是 Codex 原生 RPC）

说明：Codex App Server 没有 `project/create` 这类方法；“项目”是本系统抽象。

1. 飞书输入：`/project create payment-api --cwd /repos/payment --chat oc_xxx`  
2. `FeishuAdapter.parseInboundEvent` 解析命令 -> `intent=PROJECT_CREATE`  
3. `IAM` 校验 `project_owner` 或 `platform_admin`  
4. `ProjectService` 落库（`projects` + `project_channels` + 默认策略）  
5. 可选连通性冒烟：调用 Codex `initialize` + `thread/start`（ephemeral）后立即结束  
6. 回写飞书：“项目创建成功 + projectId + 默认策略”  

#### B) 新建 thread（Codex Intent，映射 thread/start）

1. 飞书输入：`/thread new --project payment-api`（或首次自然语言消息触发）  
2. `Intent Router` -> `THREAD_NEW`  
3. 读取项目配置（model/cwd/sandbox/approvalPolicy）  
4. 调用：
   - `thread/start`（带 `model`,`cwd`,`sandbox`,`approvalPolicy`）  
5. 存储映射：`(project_id, chat_id, chat_thread_key) -> codex_thread_id`  
6. 回写飞书：“线程已创建 thr_xxx，后续消息默认进入该线程”  

#### C) 安装 skill（Platform Intent + Skills RPC）

说明：Codex App Server 提供 `skills/list` 和 `skills/config/write`，但没有通用 `skills/install` RPC。  
MVP 的 “安装” 由平台实现文件分发，然后让 app-server 重新发现。

1. 飞书输入：`/skill install skill-creator --source curated`  
2. `Intent Router` -> `SKILL_INSTALL`，权限校验（仅 `project_owner`/`platform_admin`）  
3. `SkillService` 将 skill 文件写入允许目录（例如 `~/.codex/skills/skill-creator/`）  
4. 调用 `skills/list`（`forceReload=true`, `cwds=[project.cwd]`）确认可见  
5. 调用 `skills/config/write`（按 path 启用/禁用）  
6. 回写飞书：“skill 安装并启用成功；可用 `$skill-creator ...` 调用”  

---

## 7.4 统一命令到 Codex RPC 映射表（MVP）

| 飞书命令/消息 | Intent | 后端动作 | Codex RPC |
|---|---|---|---|
| `/project create ...` | `PROJECT_CREATE` | 写 `projects/project_channels` | 无（可选冒烟 `thread/start`） |
| `/thread new` | `THREAD_NEW` | 创建会话绑定 | `thread/start` |
| `/thread resume <id>` | `THREAD_RESUME` | 恢复会话绑定 | `thread/resume` |
| 普通文本（非命令） | `TURN_START` | 读取当前线程并发起任务 | `turn/start` |
| `/interrupt` | `TURN_INTERRUPT` | 中断执行 | `turn/interrupt` |
| `/skill list` | `SKILL_LIST` | 查询技能可用性 | `skills/list` |
| `/skill install ...` | `SKILL_INSTALL` | 平台分发文件 + 启用 | `skills/list` + `skills/config/write` |

---

## 7.5 审批事件映射（Codex -> 飞书交互卡片）

- `item/commandExecution/requestApproval` -> 飞书卡片（命令预览、风险标签、Accept/Decline）  
- `item/fileChange/requestApproval` -> 飞书卡片（文件 diff 摘要、影响范围）  
- 卡片回调 -> `ApprovalService` -> 回传 Codex 决策 -> 等待 `serverRequest/resolved`  
- 任何审批动作写入 `approvals` + `audit_logs`  

---

## 7.6 关键请求示意（字段以官方 schema 为准）

### a) 飞书消息进入统一接口

```json
{
  "channel": "feishu",
  "eventId": "evt_xxx",
  "chatId": "oc_xxx",
  "userId": "ou_xxx",
  "text": "/thread new --project payment-api",
  "timestamp": 1760000000
}
```

### b) 新建 thread -> `thread/start`

```json
{
  "id": "rpc-101",
  "method": "thread/start",
  "params": {
    "cwd": "/repos/payment",
    "model": "gpt-5-codex",
    "sandbox": "workspace-write",
    "approvalPolicy": "on-request"
  }
}
```

### c) 用户继续对话 -> `turn/start`

```json
{
  "id": "rpc-102",
  "method": "turn/start",
  "params": {
    "threadId": "thr_xxx",
    "input": {
      "type": "text",
      "text": "请修复订单服务的超时重试逻辑并补测试"
    }
  }
}
```

### d) 安装 skill（平台动作 + skills RPC）

```text
1) Platform: 下载/拷贝 skill -> ~/.codex/skills/<name>/
2) RPC: skills/list(forceReload=true, cwds=[project.cwd])
3) RPC: skills/config/write(path=<skill_path>, enabled=true)
```

> 注：`/project create` 是平台 API（DB + 权限 + 绑定），不是 Codex 原生 RPC。

---

## 8. 数据模型（建议最小集合）

- `organizations(id, name, created_at)`  
- `users(id, external_uid, display_name, status)`  
- `projects(id, org_id, name, default_cwd, sandbox_mode, approval_policy, status)`  
- `project_members(project_id, user_id, role)`  
- `project_channels(id, project_id, channel_type, chat_id, config_json)`  
- `threads(id, project_id, channel_thread_key, codex_thread_id, mode, status)`  
- `turns(id, thread_id, codex_turn_id, initiator_user_id, status, started_at, ended_at)`  
- `approvals(id, turn_id, approval_type, status, approver_user_id, decided_at, payload_json)`  
- `audit_logs(id, org_id, project_id, actor_id, action, result, trace_id, created_at, detail_json)`  
- `secrets(id, org_id, scope, encrypted_blob, rotated_at)`  

---

## 9. 技术任务拆解（按后端/前端/平台）

说明：优先级 `P0 > P1 > P2`，MVP 必做为 `P0`。

### 9.1 后端任务（Backend）

| ID | 优先级 | 模块 | 任务 | 交付物 | 验收标准 |
|---|---|---|---|---|---|
| BE-01 | P0 | channel-core | 设计 `ChannelAdapter` 接口与统一消息模型 | `packages/channel-core` | 可被 Feishu 实现并通过契约测试 |
| BE-02 | P0 | channel-feishu | 飞书 webhook 接入、验签、事件解析、消息发送 | `packages/channel-feishu` | 能收消息并回写文本/卡片 |
| BE-03 | P0 | codex-client | JSON-RPC client（initialize、thread/turn、事件流） | `packages/codex-client` | 完成冒烟：start thread + start turn + 收到 item 事件 |
| BE-04 | P0 | orchestrator | 消息到 thread/turn 的映射与状态机 | `services/orchestrator` | 群消息可驱动完整执行链路 |
| BE-05 | P0 | approvals | 审批请求映射飞书卡片，处理 accept/decline 回传 | `services/approval` | 高风险操作可暂停并等待审批 |
| BE-06 | P0 | iam-policy | RBAC 与权限中间件 | `services/iam` | 未授权用户操作返回 403 |
| BE-07 | P0 | persistence | 项目/成员/线程/审计数据表与 DAO | DB migration + repository | 所有核心记录可查询与回溯 |
| BE-08 | P1 | config | 分层配置（系统/项目）与动态读取 | `services/config` | 修改配置后新任务生效 |
| BE-09 | P1 | resilience | 幂等、重试、超时、死信队列（可选） | middleware + worker | 重复 webhook 不重复执行 |
| BE-10 | P1 | observability | 结构化日志、metrics、traceId | logging/metrics 模块 | 可按 traceId 串联请求链路 |
| BE-11 | P2 | dingtalk-stub | 钉钉 adapter 桩实现 | `packages/channel-dingtalk` | 编译通过，接口契约通过 |

后端测试任务（P0）：

- 单元测试：Channel 解析、权限决策、状态机转移、审批决策映射。  
- 集成测试：飞书 webhook -> Codex turn -> 回消息端到端。  
- 回归用例：断线重连、重复投递、审批超时、Codex 错误码处理。  

### 9.2 前端任务（Frontend）

| ID | 优先级 | 页面/模块 | 任务 | 交付物 | 验收标准 |
|---|---|---|---|---|---|
| FE-01 | P0 | Setup Wizard | 5 步初始化向导 | `admin/setup/*` | 首次安装可在 10 分钟内完成接入 |
| FE-02 | P0 | 项目管理 | 项目 CRUD、默认策略配置、channel 绑定 | `admin/projects/*` | 可创建并激活一个飞书项目 |
| FE-03 | P0 | 成员权限 | 成员邀请、角色分配、权限可视化 | `admin/members/*` | 不同角色视图和动作受控 |
| FE-04 | P0 | 审计日志 | 审计列表、筛选（项目/操作/时间） | `admin/audit/*` | 可定位任意一次任务与审批轨迹 |
| FE-05 | P1 | 运行监控 | 成功率/时延/审批耗时看板 | `admin/metrics/*` | 可查看最近 24h 核心指标 |
| FE-06 | P1 | 安全设置 | 密钥轮换提示、策略模板、危险操作开关 | `admin/security/*` | 修改策略后有确认与审计记录 |
| FE-07 | P2 | 渠道扩展 | Channel 列表页（飞书可用、钉钉未启用） | `admin/channels/*` | 清晰展示可用性状态 |

前端测试任务（P0）：

- Setup Wizard 端到端流程测试。  
- 关键表单校验测试（飞书配置、策略配置）。  
- 权限可见性测试（菜单与操作按钮级别）。  

### 9.3 平台任务（Platform / DevOps / Security）

| ID | 优先级 | 模块 | 任务 | 交付物 | 验收标准 |
|---|---|---|---|---|---|
| PL-01 | P0 | 工程化 | Monorepo 基础脚手架、lint/test/ci | CI pipeline | PR 自动校验通过 |
| PL-02 | P0 | 环境 | dev/staging/prod 配置模板与密钥注入 | deployment manifests | 一键部署到 staging |
| PL-03 | P0 | 安全 | Secret 加密存储、日志脱敏、最小权限 runtime | security baseline | 无明文密钥落库落日志 |
| PL-04 | P0 | 可靠性 | webhook 限流与熔断、任务重试策略 | gateway middleware | 峰值下服务稳定无雪崩 |
| PL-05 | P1 | 观测 | Prometheus/Grafana（或同类）仪表盘与告警 | dashboards + alerts | 核心告警规则生效 |
| PL-06 | P1 | 备份恢复 | 数据备份与恢复演练 | runbook | 演练成功并记录 RTO/RPO |
| PL-07 | P2 | 合规 | 审计保留策略与导出能力 | retention/export job | 可按时间区间导出审计 |

---

## 10. 里程碑与排期（建议）

> 以 2 周迭代计算，可按团队规模微调。

### Sprint 1（2026-03-09 ~ 2026-03-20）

- 架构骨架、Channel Core、Feishu 基础收发、Codex Client 冒烟链路。  
- 完成最小数据模型与 RBAC 中间件。  

### Sprint 2（2026-03-23 ~ 2026-04-03）

- Orchestrator 完整链路、审批卡片回传、审计日志。  
- Setup Wizard v1 与项目管理页。  

### Sprint 3（2026-04-06 ~ 2026-04-17）

- 安全加固（限流/幂等/脱敏）、可观测性、回归测试。  
- 发布 MVP（飞书可用），钉钉 stub 与扩展文档完成。  

---

## 11. MVP 验收标准（Release Gate）

1. 飞书群中可成功触发 Codex 任务并返回结果。  
2. 多项目隔离有效，跨项目无法越权访问 thread/日志。  
3. 高风险操作可审批，审批结果可追溯。  
4. Setup Wizard 可完成从 0 到可用的初始化。  
5. 审计日志完整，支持按项目和时间检索。  
6. 关键路径测试通过（单元 + 集成 + E2E 冒烟）。  

---

## 12. 风险与应对

- 协议演进风险：Codex App Server 新字段/事件变更。  
  - 应对：封装 `codex-client` 适配层，增加契约测试。  
- IM 平台限制风险：飞书回调重试、频控和卡片交互限制。  
  - 应对：幂等键、异步队列、回执降级策略。  
- 安全风险：误执行高风险命令。  
  - 应对：默认审批 + 高危命令黑名单 + 最小权限 sandbox。  
- 运维风险：长连接或事件流中断。  
  - 应对：自动重连、心跳检测、任务状态补偿。  

---

## 13. 后续（MVP 之后）

- 钉钉正式接入（复用 `channel-core`，补齐 adapter + 签名/卡片实现）。  
- 支持企业微信接入。  
- 引入配额计费、成本看板与更细粒度治理策略。  
