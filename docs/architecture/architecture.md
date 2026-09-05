# 架构说明

本文档描述当前仓库中的 Synapse Term 实现，以及终端工作区和内嵌 MCP Server 之间的边界。

## 产品边界

Synapse Term 是单用户、本机运行的桌面终端应用。核心对象是由 Electron Main 持有的 Terminal Session：PTY、终端状态、输入输出序列和有限的 Sharing 输出历史。

用户可以在一个 Terminal Session 中运行 SSH、跳板机、容器、WSL 或其他连接流程；Main 不解析连接拓扑，也不建立服务器资产、远程凭据或连接恢复模型。

外部客户端（例如 Codex）只能通过用户显式 Sharing 的 Session 使用内嵌 MCP Server。未共享的 Session 对外部客户端不存在；Sharing 不是远程端点，也不会自动枚举 Session。

## 进程与边界

```text
React Renderer + xterm
        |
        | contextBridge / preload API
        v
Electron Main
   ├─ Terminal Host（PTY / Session / IPC）
   └─ Embedded MCP Server（可选，仅监听 127.0.0.1）
        ├─ Sharing 与输出历史
        ├─ 审批队列与风险策略
        └─ synapse_* 工具管线
```

| 组件         | 当前职责                                                               | 不应直接持有                         |
| ------------ | ---------------------------------------------------------------------- | ------------------------------------ |
| Renderer     | 工作区、会话标签、终端交互、设置、Sharing 对话框和审批卡片             | Node API、PTY、Session 内部状态      |
| Preload      | 暴露经过白名单限制的 `window.synapseTerm` API                          | 任意 IPC 转发、文件系统和网络        |
| Electron Main | BrowserWindow、Terminal Host、MCP Controller、IPC、Shell 发现与清理 | Renderer 业务状态、远程主机与凭据模型 |

## Workspace Package

| Package                           | 职责                                                     |
| --------------------------------- | -------------------------------------------------------- |
| `@synapse-term/domain`            | Session、PTY/终端抽象、外部调用和事务领域模型             |
| `@synapse-term/terminal-service`  | PTY 适配、SessionActor/Manager、实时输出、Shell 发现与执行 |
| `@synapse-term/test-kit`          | Fake PTY 和测试替身                                      |

包通过各自 `src/index.ts` 公共出口互相引用；`domain` 的依赖方向测试约束领域层不反向依赖上层。

## 仓库布局

本仓库是 pnpm workspace monorepo：

- `apps/desktop/`：Electron Main、preload、React Renderer 和 E2E。
- `packages/`：领域模型、PTY/Session 服务和测试替身。
- `docs/`：架构、安全与工程文档；`openspec/`：规格变更提案与归档。

## IPC 与契约

Renderer 与 Main 通过 Electron `ipcMain`/`ipcRenderer` 通信，通道与 `DesktopApi` 类型位于 `apps/desktop/src/shared/`。当前通道分为：

- Session/终端：`sessions:list`、`sessions:environment`、`sessions:create`、`sessions:rename`、`sessions:close`、`terminal:write`、`terminal:resize`、`app:status`。
- 通用设置与主题：`settings:get-general`、`settings:update-general`、`theme:get-state`。
- MCP 设置与控制：`mcp:get-settings`、`mcp:update-settings`、`mcp:regenerate-token`、`mcp:revoke-token`、`mcp:get-status`、`mcp:list-shared`、`mcp:share-session`、`mcp:unshare-session`、`mcp:decide-approval`。

事件通道包括 `terminal:output`、`session:changed`、`theme:changed`、`mcp:approval`、`mcp:approval-closed` 和 `mcp:execution`。

## Terminal Session

Session 状态描述 PTY 生命周期：`starting`、`running`、`exited`、`failed`、`interrupted`。`SessionActor` 串行处理 PTY 输出、用户输入、resize、外部写入和退出事件；Renderer 只接收受限的实时输出事件。

关闭窗口只分离 UI；应用退出时 Main 终止全部 Session。Session 不跨应用重启存活，也不提供屏幕快照或原始 PTY 字节流。

## Sharing 与内嵌 MCP Server

MCP Server 默认关闭，启用后绑定本机回环地址，并要求 `Authorization: Bearer <Token>`。用户在终端标签操作菜单中共享 Session，应用同时建立该 Session 的 Sharing 输出边界；取消共享、Session 退出或 Token 吊销都会使外部调用失效。

当前提供八个工具：

- `synapse_status`、`synapse_observe`：检查就绪状态并按游标读取 Sharing 边界内的清理输出。
- `synapse_execute`、`synapse_wait`、`synapse_interrupt`：执行带完成证据的结构化外部事务。
- `synapse_start_interactive`、`synapse_input`、`synapse_finish_interactive`：为需要 stdin 的程序提供有限输入授权和显式终结流程。

外部执行必须携带最近 `synapse_observe` 返回的 `executionContextId`；用户输入或环境变化后，旧上下文会在 PTY 写入前失效。审批模式分为 `read_only`、`managed` 和 `full`，高风险调用在 `managed` 下进入桌面审批卡片。

Sharing 输出只在当前应用运行期间保留，从 Sharing 建立后开始记录；输出经过协议帧清理和脱敏，可用 `afterCursor`、`tail` 和 `maxBytes` 分页读取。读取不会消费历史，历史也不跨应用重启持久化。

## 生命周期与本地数据

- 窗口关闭（macOS 应用常驻）：Session 继续运行，重开窗口后继续订阅实时输出。
- 应用退出：`TerminalHost.shutdown()` 终止全部 PTY，MCP Server 同时停止并清理共享句柄。
- Session、PTY 和 Sharing 输出历史只存在于应用运行期；MCP 端口、审批模式和访问 Token 由本机设置存储管理。
- 应用不建立产品账户、远程主机资产、SSH 拓扑或集中审计日志。

## 兼容标识

产品名统一为 Synapse Term；旧的 `TERMINAL_AGENT_*` 环境变量与 `terminal-agent` 数据目录不再使用。
