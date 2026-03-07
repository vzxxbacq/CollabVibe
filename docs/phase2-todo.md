# 第二阶段 TODO（TDD 最小拆分）

- 基线来源：`docs/roadmap.md` Sprint 2（2026-03-23 ~ 2026-04-03）
- 目标范围：Orchestrator 完整链路、审批卡片回传、审计日志、Setup Wizard v1、项目管理页
- 拆分原则：每个任务严格 Red -> Green -> Refactor，且每个模块可独立运行逻辑测试
- 审核要求：模块测试报告 + Live 连通性报告必须提交审核

---

## 0) 全局约束（执行前）

1. 测试分层固定为：
   - `logic`：纯本地 mock/内存依赖
   - `integration`：模块间联调（不依赖真实外部平台）
   - `live`：真实 Codex App Server / 飞书沙箱环境
2. 每个模块必须同时定义独立测试命令（建议）：
   - `npm run test:orchestrator:phase2`
   - `npm run test:approval`
   - `npm run test:audit`
   - `npm run test:admin-api`
   - `npm run test:admin-ui`
   - `npm run test:live:codex`
3. Phase2 Gate 必须包含 `live`：
   - 未提供 `CODEX_APP_SERVER_CMD` 时，`test:live:codex` 必须显式失败（不允许静默跳过）
4. 每个任务交付必须包含：
   - 用例清单（成功/失败/越权/超时）
   - 测试日志摘要
   - 审核结论（通过/驳回）与遗留风险

---

## 0.1) 依赖与并行计划（必须遵守）

### 模块前置依赖

| 模块 | 前置依赖 | 说明 |
|---|---|---|
| M0 测试治理升级 | 无 | 先落地 CI 与 live 探针基线 |
| M1 codex-client phase2 | M0 | 审批事件与 live 冒烟依赖测试治理能力 |
| M2 orchestrator 状态机 | M1-T01/T02 | 审批事件与回传 API 就绪后实现挂起恢复 |
| M3 审批服务 | M2-T01/T02 | 卡片回调与恢复执行依赖状态机就绪 |
| M4 审计日志 | M2 并行 / M3 并行 | 作为状态机与审批副作用消费者，需提前可用 |
| M5 Admin Backend | M0、M1-T04 | Wizard 连通性复用 live 探针能力 |
| M6 Admin Frontend | M5 | 前端依赖后端向导/项目 API |
| S2-INT 阶段集成 | M2+M3+M4+M5+M6 | 集成关口 |

### 可并行模块组（建议排期）

1. 并行组 A：`M1` 与 `M4-T01`（先把审计写入接口立起来）  
2. 并行组 B：`M2` 与 `M4-T02/T03`（状态机开发时同步接审计查询/脱敏）  
3. 并行组 C：`M3` 与 `M5-T01/T02/T03`（审批链路与后台管理并行）  
4. 收敛组：`M5-T04` + `M6` + `S2-INT`  

> 约束：`S2-M3-T03` 必须在 `S2-M2-T01/T02` 完成后开始。

---

## 0.2) Live Gate 稳定性策略（防偶发阻塞）

1. 重试策略：固定最多 3 次（首次 + 2 次重试），仅对网络抖动/超时类错误重试。  
2. 超时窗口：单次握手/调用超时 20s；单个 live 用例总超时 90s。  
3. 退避策略：重试间隔 2s -> 5s（指数退避，带 20% 抖动）。  
4. 失败分级：
   - `ENV_MISSING`：环境未配置，直接 fail（不重试）
   - `AUTH_INVALID`：鉴权失败，直接 fail（不重试）
   - `TRANSIENT_NETWORK`：可重试，超限后 fail
5. Gate 判定：重试后仍失败即阻断；报告必须记录每次尝试的错误码与耗时。

---

## 1) M0 测试治理升级（P0）

### S2-M0-T01 Phase2 CI 门禁拆分（logic + live）
- Red：新增门禁测试，要求 CI 同时声明 `logic` 和 `live` job
- Green：新增 `phase2-ci.yml`，将 `test:phase2:logic` 与 `test:live:codex` 分开执行
- Refactor：复用报告脚本，支持 phase 参数（phase1/phase2）
- 独立测试：`npm run test:ci-gate -- --phase2`
- 审核提交：CI job 截图（含 live 失败阻断示例）

### S2-M0-T02 Live 环境探针
- Red：无 `CODEX_APP_SERVER_CMD` 时应返回明确错误码测试
- Green：实现 `scripts/live-check-codex.mjs`（启动、握手、冒烟、清理）
- Refactor：提取公共 `live-env` 校验库
- 独立测试：`npm run test:live:codex:precheck`
- 审核提交：环境变量清单与失败日志样例

---

## 2) M1 `codex-client` Phase2 能力（P0）

### S2-M1-T01 审批请求事件建模
- Red：`item/commandExecution/requestApproval`、`item/fileChange/requestApproval` 解析失败用例
- Green：新增审批事件类型与解析器
- Refactor：统一事件反序列化入口
- 独立测试：`npm run test:codex-client -- approval-events`
- 审核提交：事件 schema 与示例 payload

### S2-M1-T02 审批决策回传 API
- Red：accept/decline/reject-invalid 三类测试
- Green：实现 `approval.respond(...)` RPC 封装
- Refactor：审批请求 ID 与 turn/thread 关联索引
- 独立测试：`npm run test:codex-client -- approval-response`
- 审核提交：RPC 请求样例 + 错误码映射

### S2-M1-T03 中断与恢复增强
- Red：`turn/interrupt` 后状态不一致测试
- Green：补齐 interrupt 后的状态回调处理
- Refactor：中断结果与上层状态机解耦
- 独立测试：`npm run test:codex-client -- interrupt-recovery`
- 审核提交：中断时序图与回归报告

### S2-M1-T04 Live 冒烟（真实 app-server）
- Red：未 initialize 直接 `turn/start` 必须失败
- Green：真实执行 `initialize -> thread/start -> turn/start -> interrupt`
- Refactor：输出结构化 live 报告 json
- 独立测试：`npm run test:live:codex`
- 审核提交：`docs/review/phase2/live-codex-report.md`
- 前置依赖：`S2-M0-T02`

---

## 3) M2 `orchestrator` 完整状态机（P0）

### S2-M2-T01 状态机落地（IDLE/RUNNING/AWAITING_APPROVAL/INTERRUPTED/FAILED）
- Red：状态迁移非法路径测试（例如 AWAITING_APPROVAL -> IDLE 直接跳转）
- Green：实现显式状态机与迁移表
- Refactor：状态迁移副作用（发消息/记审计）分离
- 独立测试：`npm run test:orchestrator:phase2 -- state-machine`
- 审核提交：迁移矩阵与覆盖率

### S2-M2-T02 审批挂起与恢复
- Red：审批超时、重复回调、无效审批 ID 测试
- Green：实现 `AWAITING_APPROVAL` 挂起与恢复执行
- Refactor：审批超时策略配置化
- 独立测试：`npm run test:orchestrator:phase2 -- approval-wait`
- 审核提交：审批超时回退策略说明

### S2-M2-T03 命令分流强化（Platform vs Codex）
- Red：`/project create` 被误路由到 `turn/start` 的防回归测试
- Green：实现强制分流中间件
- Refactor：命令 DSL 到 intent 映射配置化
- 独立测试：`npm run test:orchestrator:phase2 -- intent-split`
- 审核提交：分流命中率与误判案例

---

## 4) M3 审批服务与飞书卡片（P0）

### S2-M3-T01 审批卡片生成器
- Red：命令审批卡片、文件变更审批卡片渲染测试
- Green：实现 `ApprovalCardBuilder`
- Refactor：卡片模板抽象（多渠道可扩展）
- 独立测试：`npm run test:approval -- card-builder`
- 审核提交：卡片 JSON 示例（accept/decline）

### S2-M3-T02 飞书卡片回调处理器
- Red：重复点击、多审批人竞争、签名无效测试
- Green：实现 `ApprovalCallbackHandler`
- Refactor：幂等锁与审批状态更新事务化
- 独立测试：`npm run test:approval -- callback-handler`
- 审核提交：幂等测试日志 + 审批轨迹

### S2-M3-T03 编排层联调
- Red：审批回传后 turn 不恢复的失败用例
- Green：打通 `approval-service -> orchestrator -> codex-client`
- Refactor：审批事件统一总线
- 独立测试：`npm run test:approval -- orchestrator-integration`
- 审核提交：联调时序图 + 回归结果
- 前置依赖：`S2-M2-T01` + `S2-M2-T02`

---

## 5) M4 审计日志闭环（P0）

### S2-M4-T01 审计事件模型与写入
- Red：关键字段缺失（actor/project/action/result）测试
- Green：实现 `AuditService.append(...)`
- Refactor：审计枚举常量化
- 独立测试：`npm run test:audit -- append`
- 审核提交：审计字段字典

### S2-M4-T02 审计查询 API
- Red：按项目/操作/时间过滤测试
- Green：实现 `GET /admin/audit-logs`
- Refactor：查询条件构建器
- 独立测试：`npm run test:audit -- query-api`
- 审核提交：API 合同 + 示例响应

### S2-M4-T03 敏感字段脱敏
- Red：token、secret、path diff 敏感片段脱敏测试
- Green：实现脱敏中间件
- Refactor：脱敏规则可配置化
- 独立测试：`npm run test:audit -- masking`
- 审核提交：脱敏前后对比样例

---

## 6) M5 Admin Backend（Setup Wizard + 项目管理）（P0）

### S2-M5-T01 Setup Wizard Step API
- Red：步骤顺序越界、重复提交测试
- Green：实现向导状态 API（step1~step5）
- Refactor：step 状态存储抽象
- 独立测试：`npm run test:admin-api -- wizard-steps`
- 审核提交：step 状态机文档

### S2-M5-T02 飞书配置校验与保存
- Red：参数缺失/签名校验失败测试
- Green：实现飞书配置校验接口与持久化
- Refactor：配置加密写入统一到 secret service
- 独立测试：`npm run test:admin-api -- feishu-config`
- 审核提交：配置校验报告

### S2-M5-T03 项目 CRUD + 绑定 chat
- Red：重复项目名、重复 chat 绑定、越权更新测试
- Green：实现项目创建/更新/查询/禁用 API
- Refactor：项目策略对象化（sandbox/approval/network）
- 独立测试：`npm run test:admin-api -- project-crud`
- 审核提交：OpenAPI 片段 + 权限矩阵

### S2-M5-T04 Wizard 连通性冒烟
- Red：Codex 不可达时 step3 必须失败并给出错误详情
- Green：实现 step3 的实时连通检查（真实 initialize + thread/start）
- Refactor：连通性结果缓存（短 TTL）
- 独立测试：`npm run test:admin-api -- wizard-connectivity`
- 审核提交：连通性失败示例与排障建议
- 前置依赖：`S2-M1-T04`（复用 live 探针）

---

## 7) M6 Admin Frontend（Setup Wizard v1 + 项目管理页）（P0）

### S2-M6-T01 Setup Wizard 页面骨架
- Red：step 导航、表单必填校验测试
- Green：实现 5 步 UI 流程与进度状态
- Refactor：表单组件复用（Input/SecretInput/StepFooter）
- 独立测试：`npm run test:admin-ui -- wizard-shell`
- 审核提交：录屏 + 表单校验截图

### S2-M6-T02 Step3 连通性可视化
- Red：连接中/成功/失败状态渲染测试
- Green：实现连接检测按钮与结果面板
- Refactor：状态渲染组件化
- 独立测试：`npm run test:admin-ui -- connectivity-panel`
- 审核提交：失败态交互说明

### S2-M6-T03 项目管理页（列表 + 新建/编辑弹窗）
- Red：重复名、无权限按钮隐藏测试
- Green：实现列表、筛选、创建与编辑
- Refactor：权限驱动 UI 展示（基于 role）
- 独立测试：`npm run test:admin-ui -- project-page`
- 审核提交：角色可见性矩阵

### S2-M6-T04 审计页最小可用
- Red：筛选条件无效、空态渲染测试
- Green：实现审计列表页与基础筛选
- Refactor：筛选查询参数同步 URL
- 独立测试：`npm run test:admin-ui -- audit-page`
- 审核提交：查询耗时与分页验证

---

## 8) 阶段集成与审核包（P0 结束门）

### S2-INT-T01 审批主链路 E2E（integration）
- Red：命令触发审批但无回调时应超时失败
- Green：打通 `feishu webhook -> orchestrator -> requestApproval -> card callback -> codex continue`
- Refactor：traceId 覆盖审批链路
- 独立测试：`npm run test:e2e:phase2`
- 审核提交：端到端时序图 + 日志摘要

### S2-INT-T02 Live Gate（真实 Codex）
- Red：live 环境缺失时 gate fail
- Green：将 `test:live:codex` 纳入 `report:phase2`
- Refactor：live 输出统一写入 `docs/review/phase2/live-codex-report.md`
- 独立测试：`npm run report:phase2`
- 审核提交：live 报告 + 失败告警截图

### S2-INT-T03 审核材料归档
- 输出目录：`docs/review/phase2/`
  - `module-test-report.md`
  - `module-test-report.json`
  - `live-codex-report.md`
  - `risk-list.md`
  - `change-log.md`
- 验收条件：审核人签字 + live gate 通过后方可进入 Phase3

---

## 9) 第二阶段完成定义（DoD）

1. 审批请求、审批回调、审批恢复链路全通过（logic + integration）。  
2. 审计日志写入、查询、脱敏能力可用并有测试覆盖。  
3. Setup Wizard v1 可完成飞书配置与 Codex 连通性检查。  
4. 项目管理页可完成项目 CRUD 与 chat 绑定。  
5. `report:phase2` 包含 live gate，且未配置真实环境时必须失败。  
6. `docs/review/phase2/` 审核材料完整并签字通过。  
