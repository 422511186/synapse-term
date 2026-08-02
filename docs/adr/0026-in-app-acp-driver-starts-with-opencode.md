# 应用内 ACP 驱动者从 opencode 开始

opencode 是第一个应用内外部驱动者，因为它的 CLI 自带 ACP server 模式（`opencode acp`）；当前安装版本中 Codex 与 Claude Code 均无 ACP 模式，因此它们先通过 MCP 端点作为外部客户端接入，而不是作为应用内驱动者。Agent 支持跟随各产品实际暴露的协议面，而不是假设 ACP 一定可用。
