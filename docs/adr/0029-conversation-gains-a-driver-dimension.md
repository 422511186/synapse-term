# ADR-0029：Conversation 增加 Driver 维度

状态：已实现

## 决策

Conversation 和 Turn 区分 `builtin` 与 `acp` 驱动者。内置驱动者需要平台的 Model Selection；ACP 驱动者由外部 Agent 管理模型，因此模型快照可以为空。

## 当前实现

`@synapse-term/domain` 的 `AgentConversation`、`AgentTurn` 和 `AgentDriver` 定义该维度；Renderer 用驱动者切换内置 Agent 与 ACP 时间线。

## 影响

两类驱动者的历史、审批和审计可以共享 UI 投影，但模型配置编辑不会影响外部 ACP Conversation。
