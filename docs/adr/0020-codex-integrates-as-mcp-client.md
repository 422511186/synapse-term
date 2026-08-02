# ADR-0020：Codex 通过 MCP 客户端接入

状态：当前边界

## 决策

Codex 等外部客户端通过 MCP 连接 Synapse Term，不在平台内实现专用 Codex Agent Adapter。应用内外部 Agent 的替换点保留给 ACP 驱动者。

## 当前实现

桌面端的 `EmbeddedMcpServer` 和 `mcp-tools.ts` 提供回环 Streamable HTTP MCP 端点；外部调用以 `caller.kind = mcp` 进入 Core 的 `ExternalToolPipeline`。

## 影响

Codex 不会获得平台内置模型快照或内置 Conversation；每次调用仍受 shared Session、外部审批、租约、脱敏和审计限制。
