# ADR-0026：内置 ACP 驱动者从 opencode 开始

状态：已实现，范围有限

## 决策

当前 ACP 驱动者只接入 `opencode`，因为它提供 `opencode acp` 模式。Codex、Claude Code 等客户端若没有可用 ACP server，则通过 MCP 作为外部调用者接入。

## 当前实现

`AcpController` 使用可注入的 `opencodePath`，默认执行 `opencode`；ACP 设置页和 Agent 面板只展示当前实现支持的驱动者。

## 影响

增加新的 ACP 驱动者需要验证其协议版本、能力声明、进程生命周期和审批请求，不能只替换一个可执行文件名。
