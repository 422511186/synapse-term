## Why

现有终端只能把远程 Shell 作为人类交互界面，无法让本机 Agent 在不安装远端组件的前提下可靠地观察、执行和审计终端操作。本变更交付一个 Windows 单用户桌面 MVP，使用户能够在已经连接好的终端 Session 中用自然语言驱动受控命令执行。

## What Changes

- 新建 Electron 桌面终端，提供标签页、启动配置、滚动区、搜索、复制粘贴、Agent 面板和授权界面。
- 新建独立的 Node.js Terminal Core，由 Core 持有 ConPTY、Session、Agent Task、模型凭据、策略和审计，桌面 UI 可关闭后重新连接。
- 把 Session 定义为与 SSH、堡垒机、容器拓扑无关的本地 PTY 上下文；Agent 仅操作用户明确选中的已就绪 Session。
- 新建内部 Terminal Tool 与自研 Agent 状态机，支持自然语言目标、结构化命令事务、持续输出、退出码、等待、中断和人工接管。
- 支持用户自定义 OpenAI Responses、OpenAI-compatible Chat Completions 和 Anthropic Messages Provider Profile。
- 增加只读自动执行、未知即确认、精确命令授权、危险操作控制、敏感数据脱敏和结构化审计。
- 支持最多约 20 个活动 Session、每个 Session 一个 Agent Task、全局最多 4 个并发 Agent Task。
- 首版结构化执行仅支持已探测成功的 POSIX Shell；完整 TUI 自动操作、跨 Core 重启恢复、外部 MCP 客户端和企业集中管理不在本变更范围内。

## Capabilities

### New Capabilities

- `desktop-terminal`: Windows 桌面终端的基础交互、标签页、Session 视图、Agent 面板和授权体验。
- `terminal-sessions`: 本地 Core、ConPTY Session、控制权租约、多会话、输出日志、UI 分离与重连。
- `agent-execution`: 自然语言 Agent Task、内部 Terminal Tool、命令事务、持续输出、Shell 完成检测和人工接管。
- `model-providers`: 自定义 Provider Profile、三种模型协议、流式事件归一化和凭据管理。
- `terminal-safety-audit`: 命令风险策略、精确授权、敏感数据保护、操作审计和留存策略。

### Modified Capabilities

无。当前主规格为空，本变更仅新增能力。

## Impact

- 新增 TypeScript monorepo，包含 Electron UI、独立 Node.js Core、共享协议和测试包。
- 主要依赖包括 Electron、React、`node-pty`、`@xterm/xterm`、`@xterm/headless`、`@xterm/addon-serialize`、`openai`、`@anthropic-ai/sdk`、`zod` 和 SQLite。
- 新增 Windows Named Pipe IPC、Windows Credential Manager 集成、本地分块输出日志和结构化审计数据库。
- 远程服务器不安装 Agent、不写入持久辅助文件，也不要求理解 SSH、堡垒机或容器连接拓扑。
- 交付目标为一名全职开发者约 8 至 12 周可完成并验证的本机 MVP。
