# ADR-0014：UI 断开后暂停 Agent

状态：已实现

## 决策

UI 断开时，正在进行的命令事务允许完成；Core 在下一个模型轮次或命令事务开始前请求 Agent 进入 `suspended`，避免用户无法观察、打断或审批时继续无人值守执行。

## 当前实现

`CoreIpcServer` 在连接断开时通知 `AgentCoordinator`，`AgentRuntime` 通过 disconnect 标记在安全边界暂停。`packages/agent-service/src/runtime/agent-runtime.test.ts` 覆盖“当前命令完成后再挂起”。

## 影响

恢复需要重新连接 UI 并显式继续；PTY 输出仍由 Core 管理，不能把 UI 消失误认为 Session 已结束。
