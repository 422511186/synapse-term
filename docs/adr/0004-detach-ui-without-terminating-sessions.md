# ADR-0004：UI 脱离不等于终止 Session

状态：已实现

## 决策

关闭窗口只分离 UI 订阅，不终止活动 Session；显式退出应用时终止全部 Session。

## 当前实现

`TerminalHost.shutdown()` 在应用退出时终止全部 PTY。Session 仅存在于应用运行期内存。

## 影响

UI 重连只需继续订阅实时输出；无后台进程、无回放、无跨重启持久化承诺。
