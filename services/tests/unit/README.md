# services/tests/unit

`unit/` 存放**不要求通过 L1-like 入口完整触发**的测试。

## 放入原则

- 纯函数 / 纯规则 / 纯解析 / 纯投影
- 直接面向 service API、repository、policy、codec、mapper 的验证
- 断言重点是内部状态、持久化结果、规则分支、数据变换
- 即使使用了测试 harness，只要**不是在模拟真实用户从入口发起功能**，也属于 `unit/`

## 不应放入这里的情况

- 测试通过 chat/L1-like 入口模拟真实用户操作
- 测试目标是验证某个功能从入口进入后的完整用户路径
- 测试是用户 edge case，但仍然属于真实入口驱动场景

这类测试应放入 `../sim/`。
