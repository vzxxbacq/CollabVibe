# services/tests

L2 测试按职责拆成两层，二者并存：

- `unit/`：纯函数 / 纯规则 / 纯解析 / 纯投影，以及不要求通过 L1-like 入口驱动的测试
- `sim/`：通过入口处模仿 L1 调用的测试，既包含主链路，也包含真实用户 edge case

## Unit Track（`unit/`）

用于验证下沉后的纯逻辑模块，以及不要求“从入口模仿 L1 调用”的测试。

**适用场景**：
- parser / formatter
- key builder / mapper
- classifier / summary projector
- dedup / normalization / policy rules
- plugin / skill / recovery 若主要验证内部状态、持久化、规则判断，而不是模拟真实用户从入口触发，则归入 `unit/`

```bash
npx vitest run services/tests/unit
```

## SIM Track（`sim/`）

使用 `SimHarness` + `FakeAgentApiFactory` 驱动真实入口形态下的 L2 主流程。

**核心约束**：
- 存放从入口处模仿 L1 调用的测试
- 从入口处模仿 L1 调用，经 `OrchestratorApi` / fake platform / scripted backend 触发
- 既验证主链路，也验证真实用户会遇到的 edge case
- 重点验证跨 service 协作、状态机、事件路由、持久化与回归
- 不在 `sim/` 中承载纯函数边界穷举或纯内部态断言

```bash
# 运行全部 sim 测试
npx vitest run services/tests/sim

# 单个文件
npx vitest run services/tests/sim/approval.sim.test.ts
```

## 目录结构

```text
services/tests/
├── _helpers/
│   ├── fake-agent-backend.ts
│   ├── fake-chat-platform.ts
│   ├── fake-git-ops.ts
│   ├── script-presets.ts
│   ├── scripted-backend.ts
│   ├── sim-harness.ts
│   └── test-layer.ts
├── unit/
│   └── *.test.ts                 # 纯函数 / 纯规则 / 非全流程测试
├── sim/
│   └── *.sim.test.ts             # 从入口处驱动的全流程测试
└── README.md
```

## 执行原则

- 新下沉纯函数时，优先补 `unit/` 测试
- 任何重构后，必须继续跑 `sim/` 做主流程回归
- 不允许用 `unit/` 替代现有 `sim/` 的主链路保障作用
