# ACP 轮次翻译进现有轮次模型

ACP stop reason 映射到现有终态（end_turn 与 refusal 变为 completed，cancelled 变为 cancelled，max_tokens、max_turn_requests 和错误变为 failed）。外部 Agent 拥有自己的对话记忆，平台只存储消息与工具调用摘要的投影用于展示、审计和恢复；一个 Agent 任务仍绑定恰好一个就绪会话。
