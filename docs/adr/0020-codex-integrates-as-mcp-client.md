# Codex 以 MCP 客户端接入

Codex 作为外部 MCP 客户端连接平台，不会被适配为应用内 AgentDriver；不实现 CodexAgentAdapter。AgentDriver 替换点只为通过 ACP 驱动的应用内外部 Agent 存在，因此 Agent 面板保持可复用。Codex 的每次工具调用仍经过统一工具管线。
