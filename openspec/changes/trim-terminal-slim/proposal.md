## Why

当前仓库为单一桌面应用维护了一套跨进程 Core、内置 Agent、ACP、MCP 与审计体系，代码量约 7 万行，已知 Critical/High 缺陷大多集中在这套体系上；继续修不如先裁剪。本项目尚未发布，重写代价过高，因此本次将产品收敛为纯终端桌面应用：保留终端与设置页面，删除 Agent、ACP、MCP、审计及相关运行时，后续再按新架构重新规划实现。

## What Changes

- **BREAKING** 删除独立 Node.js Core：移除 `apps/core`、Named Pipe、握手/令牌认证、CoreSupervisor、Core 生命周期与后台运行语义；终端运行时由 Electron Main 直接持有。
- **BREAKING** 删除内置 Agent 全套：`agent-service`、`model-providers`、Agent 协调器/运行时、时间线/Composer/附件/审批/权限模式、Provider/Model 设置。
- **BREAKING** 删除 ACP 与 MCP：桌面端 ACP 控制器、`@zed-industries/agent-client-protocol` 依赖、MCP HTTP 端点、`external.*` Core API、共享 Session、本地文件工具。
- **BREAKING** 删除审计：审计服务、审计查询/保留/清理、审计设置页与相关 schema。
- **BREAKING** 删除资源监控、执行方言、提示词历史、共享 Session 按钮；终端页保留多会话、Tab、新建/重命名/关闭、xterm 终端内查找与设置入口。
- **BREAKING** 设置页简化为单页占位「暂无设置项」，删除主题导航。
- **BREAKING** 持久化全部内存化：删除 SQLite、迁移、备份、raw-log 文件与密钥存储；会话仅存在于应用运行期，应用退出即终止，不提供终端回放。
- **BREAKING** 包结构收敛：保留 `domain`、`terminal-service`、`test-kit`；`ui-platform` 并入 desktop；删除 `application`、`protocol`、`infrastructure`、`agent-service`、`model-providers`、`platform-kernel`、`tooling`。
- 打包与脚本：删除 Core/Agent 打包与验收脚本，electron-builder 只打包 desktop；删除 `TERMINAL_AGENT_*` 兼容标识、旧数据目录迁移与 `Terminal-Agent` 安装命名。
- 文档与规格：归档过时的 OpenSpec specs，重写 README、架构、安全、运行手册与 ADR，清理界面文案中的 Agent 残留。
- 测试：删除已删功能的测试，保留并调整 PTY、会话、Shell 发现、TerminalView、会话操作、设置占位与浏览器 E2E；Mock 开发模式保留并裁剪。

## Capabilities

### New Capabilities

无新增能力；本次为能力删除与存量能力修改。

### Modified Capabilities

- `terminal-sessions`: 会话生命周期收敛为单进程内存态，删除执行方言、共享会话、租约、环境探测、持久化恢复与资源采集需求。
- `desktop-terminal`: 终端工作区改为纯终端布局，删除 Agent 面板、资源监控、提示词历史与共享会话入口，保留终端内查找。
- `settings-workspace`: 设置工作区改为单页占位，删除主题导航与配置内容。
- `core-modularization`: 删除独立 Core 进程与协议包边界，改为单进程 Electron Main 装配 + 三个 workspace 包的最小结构。
- `desktop-runtime-assurance`: 删除 Core 连接握手/超时/生命周期保障，保留 Renderer 受限 API 与 Mock 开发模式。
- `macos-build-packaging`: 删除 Core Runtime staging 与打包依赖，只保留 Electron 应用打包。

## Impact

- 代码：`apps/core` 删除；`packages/` 由 11 个收敛为 3 个；desktop 主进程、preload、renderer、mock API、共享 IPC 契约全部重写；根配置（pnpm workspace、tsconfig、vitest、playwright、electron-builder、ESLint/Prettier）同步精简。
- 依赖：移除 `openai`、`@anthropic-ai/sdk`、`@napi-rs/keyring`、`@modelcontextprotocol/sdk`、`@zed-industries/agent-client-protocol`、`@xterm/headless`、`web-tree-sitter`、`react-markdown` 等 Core/Agent/MCP 相关依赖。
- 数据：本地 `~/Library/Application Support/synapse-term` 与旧 `terminal-agent` 数据目录不再读取；未发布，不提供迁移。
- 验证：`pnpm verify` 与 `pnpm test:e2e` 只覆盖终端、会话、UI 布局与 Mock 模式。
