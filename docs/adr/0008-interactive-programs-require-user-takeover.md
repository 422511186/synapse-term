# ADR-0008：交互式程序需要用户接管

状态：已实现

## 决策

Agent 只执行有界 Command Transaction。检测到密码、OTP、分页器、编辑器、TUI 或其他需要按键交互的程序时，任务进入等待用户或交互状态，由用户取得 Session Lease。

## 当前实现

`InteractionDetector`、`SessionActor` 和 `AgentCoordinator` 共同处理 `interaction_required`、`waiting_user` 和 user takeover；平台没有通用 `send_keys` Agent 工具。

## 影响

交互流程需要用户完成后再继续；这是刻意保留的产品边界，不是命令执行失败。
