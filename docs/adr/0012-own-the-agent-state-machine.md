# ADR-0012：平台自有 Agent 状态机

状态：已实现

## 决策

Core 自己管理 Agent Conversation、Turn、Tool Call、审批等待、用户等待、租约、取消、挂起、完成和失败。Provider SDK 只作为协议客户端，不接管平台生命周期。

## 当前实现

状态转换位于 `@synapse-term/domain`，多轮循环位于 `@synapse-term/agent-service`，Session/审批协调位于 `@synapse-term/application` 和 `@synapse-term/platform-kernel`。

## 影响

终端安全和生命周期语义集中在平台，但新增 Provider 需要实现适配器和能力检测，而不是引入另一套 Agent 运行时。
