# ADR-0028：一个 ACP Conversation 对应一个长驻 Agent 进程

状态：已实现

## 决策

一个 ACP Conversation 对应一个外部 Agent 子进程；子进程只在用户显式开启 ACP 并通过保留的 ACP 控制路径开始任务时启动。当前桌面 Agent 工作区不提供驱动者选择或外部新任务入口，但关闭 Conversation、关闭 ACP 开关或退出应用时仍终止该进程。

## 当前实现

`AcpController` 按平台 Session 保存 Conversation 和子进程，阻止同一 Conversation 并行 Turn；进程退出会结束当前 Turn，并清理等待中的审批。

## 影响

外部 Agent 的进程记忆不会跨进程自动恢复。要重新开始，需要建立新的 ACP Conversation 或重新启动驱动者。
