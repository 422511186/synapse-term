# ADR-0011：归一化三种模型协议

状态：已实现

## 决策

Provider Profile 支持 OpenAI Responses、OpenAI-compatible Chat Completions 和 Anthropic Messages。Provider 差异在适配层收敛为统一的文本、工具调用、用量、完成和错误事件。

## 当前实现

`@synapse-term/model-providers` 的 `provider-adapters.ts` 和 `model-adapter.ts` 负责协议映射；Agent Service 和 UI 不直接依赖 Provider 特定事件格式。

## 影响

自定义兼容端点可以复用统一 Agent Loop，但具体 Provider 能否支持 streaming、Tool Call 和 reasoning 仍需通过模型检测确认。
