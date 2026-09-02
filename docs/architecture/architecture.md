# 架构说明

本文档描述当前仓库中的 Synapse Term 实现。

## 产品边界

Synapse Term 是单用户、本机运行的桌面终端应用。核心对象是由 Electron Main 持有的 Terminal Session：PTY、终端状态、输入输出序列和有限历史。它不是 SSH Session、服务器资产或远程凭据对象。

用户可以在一个 Terminal Session 中运行 SSH、跳板机、容器、WSL 或其他连接流程；Main 不解析连接拓扑。

## 进程与边界

```text
React Renderer + xterm
        |
        | contextBridge / preload API
        v
Electron Main
  Terminal Host（PTY / Session / IPC）
```

| 组件        | 当前职责                                                | 不应直接持有                     |
| ----------- | ------------------------------------------------------- | -------------------------------- |
| Renderer    | 工作区、会话标签、终端交互、设置占位页                   | Node API、PTY、Session 内部状态  |
| Preload     | 暴露经过白名单限制的 `window.synapseTerm` API          | 任意 IPC 转发、文件系统和网络    |
| Electron Main | BrowserWindow、Terminal Host、IPC、Shell 发现、退出清理 | 业务实现、持久化                 |

## Workspace Package

| Package                | 职责                                              |
| ---------------------- | ------------------------------------------------- |
| `@synapse-term/domain` | Session 状态、PTY/终端抽象与领域状态转换          |
| `@synapse-term/terminal-service` | PTY 适配、SessionActor/Manager、实时输出、Shell 发现 |
| `@synapse-term/test-kit` | Fake PTY 等测试替身                             |

包通过各自 `src/index.ts` 公共出口互相引用；`domain` 的依赖方向测试约束领域层不反向依赖上层。

## 仓库布局

本仓库是 pnpm workspace monorepo：

- `apps/desktop/`：Electron 主进程、preload、React Renderer 与 `e2e/`；字体等静态资源位于 `apps/desktop/src/renderer/assets/`。
- `packages/`：`@synapse-term/domain`（Session/终端领域模型）、`@synapse-term/terminal-service`（PTY、Session、实时输出、Shell 发现）、`@synapse-term/test-kit`（测试替身）。
- `docs/`：架构、安全与工程文档；`openspec/`：规格变更提案与归档。
- 单元测试与源码同目录，命名为 `*.test.ts` 或 `*.test.tsx`。

## IPC 与契约

Renderer 与 Main 通过 Electron `ipcMain`/`ipcRenderer` 通信，通道与 `DesktopApi` 类型位于 `apps/desktop/src/shared/`。当前通道只覆盖：

- `sessions:list / environment / create / rename / close`
- `terminal:write / resize`
- `app:status`

事件通道只有 `terminal:output` 与 `session:changed`。

## Terminal Session

Session 状态只包含 PTY 生命周期：`starting | running | exited | failed | interrupted`。

`SessionActor` 串行处理 PTY 输出、用户输入、resize 与退出事件。PTY 输出被拆成 UTF-8 安全、有界的分片，分配严格递增 sequence 后实时广播给 Renderer，不保留历史。

关闭窗口只分离 UI；应用退出时 Main 终止全部 Session。Session 不跨应用重启存活。

## 生命周期

- 窗口关闭（macOS 应用常驻）：Session 继续运行，重开窗口继续订阅实时输出。
- 应用退出：`TerminalHost.shutdown()` 终止全部 PTY。
- 无独立 Core、无后台进程、无磁盘持久化。

## 兼容标识

产品名统一为 Synapse Term；旧的 `TERMINAL_AGENT_*` 环境变量与 `terminal-agent` 数据目录不再使用。
