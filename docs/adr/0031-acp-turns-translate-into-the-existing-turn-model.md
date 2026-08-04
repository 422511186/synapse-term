# ADR-0031：ACP Turn 映射到平台现有 Turn 语义

状态：已实现

## 决策

ACP 的开始、文本、工具调用、停止和错误事件映射到平台统一的 Agent 时间线与 Turn 终态：正常结束为 completed，用户取消为 cancelled，进程错误、协议错误或限制为 failed。外部 Agent 自己管理完整上下文，平台保存 Conversation Projection 用于展示、审计和恢复界面。

## 当前实现

`AcpController` 将 ACP session/turn/tool call 投影为带 `sessionId`、Conversation、Turn 和 status 的时间线；领域层的 Driver 字段允许外部 Turn 不携带平台模型选择。

## 影响

内置 Agent 与 ACP 时间线仍可共享状态组件和投影契约；当前桌面 Agent 工作区仅展示内置 Agent，ACP 投影保留给历史、审计和后续入口恢复。ACP 的完整提示词、模型记忆和 Provider 细节不属于平台数据库。外部进程崩溃后不能假设平台拥有足够上下文自动续跑。
