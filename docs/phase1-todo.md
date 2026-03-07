# 第一阶段 TODO（TDD 最小拆分）

- 基线来源：`docs/roadmap.md` Sprint 1（2026-03-09 ~ 2026-03-20）
- 目标范围：架构骨架、Channel Core、Feishu 基础收发、Codex Client 冒烟链路、最小数据模型与 RBAC
- 拆分原则：每个任务先写测试（Red）再实现（Green）再重构（Refactor）
- 审核要求：每个模块必须有独立逻辑测试入口，测试报告单独提交审核

---

## 0) 全局约束（执行前）

1. 每个模块必须有单独测试命令（示例）：
   - `pnpm test:channel-core`
   - `pnpm test:channel-feishu`
   - `pnpm test:codex-client`
   - `pnpm test:orchestrator`
   - `pnpm test:iam`
   - `pnpm test:persistence`
2. 每个任务交付必须包含：
   - 测试用例清单（输入/期望输出）
   - 本地测试截图或日志摘要
   - 审核结论（通过/驳回 + 问题单）
3. 任何功能未通过对应模块逻辑测试，不得合并。

---

## 1) M0 工程骨架与测试基建（P0）

### S1-M0-T01 初始化 monorepo 与模块边界
- Red：新增 `workspace` 结构校验测试（模块路径存在性）
- Green：创建目录骨架  
  - `packages/channel-core`
  - `packages/channel-feishu`
  - `packages/codex-client`
  - `services/orchestrator`
  - `services/iam`
  - `services/persistence`
- Refactor：统一 tsconfig/eslint/vitest 配置
- 独立测试：`pnpm test:workspace`
- 审核提交：目录结构图 + workspace 测试通过记录

### S1-M0-T02 建立测试门禁
- Red：编写 CI 失败测试（任一模块测试失败应阻断）
- Green：配置 GitHub Actions 门禁（`npm ci` + `npm run report:phase1`）
- Refactor：提取复用脚本 `scripts/test-module.sh` 与审核报告汇总脚本 `scripts/generate-review-report.mjs`
- 独立测试：`pnpm test:ci-gate`
- 审核提交：CI 日志（含失败拦截示例）+ 自动生成 `docs/review/phase1/module-test-report.md`

---

## 2) M1 `channel-core`（P0）

### S1-M1-T01 定义统一消息模型 `UnifiedMessage`
- Red：模型校验测试（command/text/card_action 三种输入）
- Green：实现类型定义 + schema 校验器（zod/同类）
- Refactor：抽离公共字段 normalizer
- 独立测试：`pnpm test:channel-core -- unified-message`
- 审核提交：模型 schema + 样例入参/出参

### S1-M1-T02 定义 `ChannelAdapter` 契约
- Red：契约测试（必须实现 `verifyWebhook/parseInboundEvent/sendMessage/sendCard/updateCard/resolveUserIdentity`）
- Green：实现接口与抽象基类
- Refactor：错误码标准化（`CHANNEL_INVALID_SIGNATURE` 等）
- 独立测试：`pnpm test:channel-core -- adapter-contract`
- 审核提交：契约测试报告 + 错误码表

### S1-M1-T03 实现 Intent Router 最小规则
- Red：路由测试（`/project`、`/thread`、`/skill`、普通文本）
- Green：实现正则/语法解析器（MVP 命令前缀）
- Refactor：命令解析与参数解析分层
- 独立测试：`pnpm test:channel-core -- intent-router`
- 审核提交：命令路由覆盖率与冲突用例

---

## 3) M2 `channel-feishu`（P0）

### S1-M2-T01 webhook 验签与防重放
- Red：签名错误、超时戳、重复 eventId 测试
- Green：实现 `verifyWebhook` + 幂等检查
- Refactor：提取 `antiReplayGuard`
- 独立测试：`pnpm test:channel-feishu -- verify`
- 审核提交：验签测试矩阵（通过/拒绝场景）

### S1-M2-T02 飞书事件转 `UnifiedMessage`
- Red：文本消息、@提及、卡片回调解析测试
- Green：实现 `parseInboundEvent`
- Refactor：事件版本兼容层（v1/v2 字段兼容）
- 独立测试：`pnpm test:channel-feishu -- parse`
- 审核提交：事件样本与统一模型映射表

### S1-M2-T03 飞书消息发送最小封装
- Red：sendMessage/sendCard/updateCard 的请求构造测试（mock http）
- Green：实现 API client（重试 1 次 + 超时）
- Refactor：统一错误映射到 `ChannelError`
- 独立测试：`pnpm test:channel-feishu -- send`
- 审核提交：mock 调用日志 + 错误处理测试

---

## 4) M3 `codex-client`（P0）

### S1-M3-T01 JSON-RPC 传输层
- Red：requestId 生成、超时、响应匹配测试
- Green：实现基础 RPC client（stdio transport）
- Refactor：transport 与 protocol 解耦
- 独立测试：`pnpm test:codex-client -- rpc-transport`
- 审核提交：RPC 往返测试结果

### S1-M3-T02 初始化握手流程
- Red：未 initialize 前调用业务方法应失败测试
- Green：实现 `initialize -> initialized` 流程封装
- Refactor：握手状态机（未连接/已初始化）
- 独立测试：`pnpm test:codex-client -- initialize`
- 审核提交：握手顺序测试与异常测试

### S1-M3-T03 thread/turn 最小 API
- Red：`thread/start`、`turn/start` 请求构造与响应解析测试
- Green：实现方法封装 + 类型定义
- Refactor：统一 `CodexApiError`
- 独立测试：`pnpm test:codex-client -- thread-turn`
- 审核提交：调用样例与字段映射说明

### S1-M3-T04 事件流消费（最小）
- Red：item 事件顺序消费与断流重连测试（mock stream）
- Green：实现订阅器 `onItemEvent`
- Refactor：事件去重（eventId）
- 独立测试：`pnpm test:codex-client -- stream`
- 审核提交：事件顺序与重连测试报告

---

## 5) M4 `orchestrator`（P0）

### S1-M4-T01 thread 绑定仓储接口
- Red：`chat -> threadId` 映射增删改查测试
- Green：实现 `ThreadBindingService`
- Refactor：project/chat/thread key 索引抽象
- 独立测试：`pnpm test:orchestrator -- thread-binding`
- 审核提交：映射一致性测试

### S1-M4-T02 首条消息自动建线程
- Red：无绑定时触发 `thread/start` + `turn/start` 顺序测试
- Green：实现 `handleUserText` 最小路径
- Refactor：提取 `ensureThread`
- 独立测试：`pnpm test:orchestrator -- first-message`
- 审核提交：调用时序断言日志

### S1-M4-T03 已有线程继续对话
- Red：已有绑定时只触发 `turn/start` 测试
- Green：实现复用 thread 逻辑
- Refactor：重复逻辑合并
- 独立测试：`pnpm test:orchestrator -- continue-message`
- 审核提交：线程复用率与错误回退场景

### S1-M4-T04 `/thread new` 命令
- Red：命令触发新 thread 并覆盖绑定测试
- Green：实现命令处理路径
- Refactor：命令处理器注册机制
- 独立测试：`pnpm test:orchestrator -- thread-new`
- 审核提交：命令前后绑定变更记录

---

## 6) M5 `persistence`（P0）

### S1-M5-T01 最小表结构迁移
- Red：migration 测试（建表成功、关键索引存在）
- Green：创建 `projects/project_channels/threads/turns/audit_logs`
- Refactor：命名统一与约束补全
- 独立测试：`pnpm test:persistence -- migration`
- 审核提交：DDL 与 migration 执行日志

### S1-M5-T02 项目仓储
- Red：项目 CRUD + 唯一约束测试
- Green：实现 `ProjectRepository`
- Refactor：查询条件对象化
- 独立测试：`pnpm test:persistence -- project-repo`
- 审核提交：仓储行为测试报告

### S1-M5-T03 线程/turn 仓储
- Red：线程绑定查询、turn 状态流转测试
- Green：实现 `ThreadRepository`、`TurnRepository`
- Refactor：事务边界封装
- 独立测试：`pnpm test:persistence -- thread-turn-repo`
- 审核提交：状态流转测试报告

---

## 7) M6 `iam`（P0）

### S1-M6-T01 角色模型与权限矩阵
- Red：角色到权限点映射测试
- Green：实现 `RolePermissionMap`
- Refactor：权限点常量化
- 独立测试：`pnpm test:iam -- permission-map`
- 审核提交：权限矩阵（角色 x 操作）

### S1-M6-T02 鉴权中间件
- Red：未登录/无角色/越权三类拒绝测试
- Green：实现 `authorize(action, resource)`
- Refactor：错误码与审计字段统一
- 独立测试：`pnpm test:iam -- middleware`
- 审核提交：403 场景覆盖报告

### S1-M6-T03 命令级权限控制
- Red：`/project create`、`/thread new`、`/skill install` 权限测试
- Green：在 Intent Router 后挂载 IAM 校验
- Refactor：命令到权限点映射配置化
- 独立测试：`pnpm test:iam -- command-guard`
- 审核提交：命令鉴权审计样例

---

## 8) 阶段集成与审核包（P0 结束门）

### S1-INT-T01 端到端最小链路测试
- Red：飞书文本消息触发失败用例（缺少 thread 绑定）
- Green：打通 `feishu -> router -> orchestrator -> codex-client -> feishu`
- Refactor：traceId 全链路透传
- 独立测试：`pnpm test:e2e:phase1`
- 审核提交：E2E 测试录像/日志摘要 + trace 链路图

### S1-INT-T02 审核材料归档
- 输出目录：`docs/review/phase1/`
  - `module-test-report.md`（各模块测试结果）
  - `risk-list.md`（未解决风险与规避）
  - `change-log.md`（任务到提交映射）
- 验收条件：审核人签字后方可进入第二阶段

---

## 9) 第一阶段完成定义（DoD）

1. 六个核心模块均有独立逻辑测试命令且通过。  
2. 每个模块测试报告已提交到 `docs/review/phase1/`。  
3. E2E 最小链路通过（首条消息自动建 thread + turn 返回）。  
4. `/thread new`、普通文本对话、`/project create` 的权限校验生效。  
5. 所有 P0 任务完成且审核结论为通过。  
