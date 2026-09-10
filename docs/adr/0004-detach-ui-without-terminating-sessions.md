# ADR-0004：UI 脱离不等于终止 Session

状态：已实现

## 决策

关闭窗口只分离 UI 订阅，不终止活动 Session；显式退出应用时终止全部 Session。

## 当前实现

当前生命周期和本地数据边界见[创建第一个 Session](../getting-started/first-session.md)与[本地数据边界](../reference/data-boundary.md)。

## 影响

UI 重连只需继续订阅实时输出；无后台进程、无回放、无跨重启持久化承诺。
