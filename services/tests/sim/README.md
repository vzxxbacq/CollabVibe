# services/tests/sim

`sim/` 存放**通过 L1-like 入口触发**的模拟真实用户测试。

## 放入原则

- 必须从入口处模仿 L1 调用
- 不仅覆盖主链路，也覆盖真实用户会遇到的 edge case
- 重点验证“用户如何触发功能”以及跨模块联动后的结果
- 只要测试是在模拟用户通过聊天/入口使用功能，即使是异常分支、边界条件，也应保留在 `sim/`

## 典型场景

- chat turn / approval / user input
- plugin / skill 的安装、移除、通知
- 从入口触发后的 thread / recovery / lifecycle 行为

## 不应放入这里的情况

- 纯规则判断
- codec / parser / mapper / projector
- 只验证内部状态，不强调入口调用形态

这类测试应放入 `../unit/`。
