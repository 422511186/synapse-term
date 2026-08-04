# ADR-0029：Conversation 增加 Driver 维度

状态：已实现

## 决策

Conversation 和 Turn 区分 `builtin` 与 `acp` 驱动者。内置驱动者需要平台的 Model Selection；ACP 驱动者由外部 Agent 管理模型，因此模型快照可以为空。该维度仍属于 Core、协议和历史模型；当前桌面 Agent 工作区只开放内置驱动者，暂不提供 ACP 切换或新任务入口。

## 当前实现

`@synapse-term/domain` 的 `AgentConversation`、`AgentTurn` 和 `AgentDriver` 定义该维度；Renderer 按当前工作区策略展示内置 Agent 时间线，同时保留 ACP 历史、事件和 preload/Core 路径。

## 影响

两类驱动者的历史、审批和审计可以共享 UI 投影，但模型配置编辑不会影响外部 ACP Conversation。隐藏桌面入口不会删除 ACP 数据或后端能力，后续恢复入口时仍可沿用同一身份模型。
