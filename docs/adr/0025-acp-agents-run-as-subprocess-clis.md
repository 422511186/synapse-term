# ADR-0025：ACP Agent 以 CLI 子进程运行

状态：已实现

## 决策

应用内外部 Agent 以独立 CLI 子进程运行，通过 stdio 使用 ACP；平台作为 ACP Client，不把外部 Agent SDK 嵌入 Core。

## 当前实现

`AcpController` 默认启动 `opencode acp --pure --cwd <cwd>`，通过 `@zed-industries/agent-client-protocol` 建立会话，并将平台工具请求翻译到 Core API。

## 影响

外部 Agent 有独立进程边界，崩溃和退出可被识别；但用户必须自行安装并维护 `opencode`，它不包含在 Synapse Term 安装包中。
