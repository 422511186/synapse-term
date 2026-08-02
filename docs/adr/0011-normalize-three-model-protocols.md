# 归一化三种模型协议

Provider 档案可选择 OpenAI Responses、OpenAI 兼容 Chat Completions 或 Anthropic Messages。Core 将三者适配为统一的内部事件流：文本增量、（可用时的）推理元数据、工具调用、用量、完成与 Provider 错误，在保持广泛自定义端点兼容的同时，不允许 Provider 特定事件格式泄漏到 Agent 或 UI 逻辑。
