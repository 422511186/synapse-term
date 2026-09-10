# 架构说明

本文是 Synapse Term 当前实现的稳定架构参考。用户操作见 [docs 导航](../README.md)，长期取舍见 [ADR 索引](../adr/README.md)。本文不替代 MCP Reference、发布手册或领域词汇表。

## 产品边界

Synapse Term 是单用户、本机运行的 Electron 桌面应用。核心对象是由 Electron Main 持有的 Session：本地 PTY、终端状态、输入输出序列和有限的 Sharing 输出历史。

用户可以在同一个 Session 中运行 SSH、跳板机、容器、WSL 或其他连接流程；Main 不解析连接拓扑，也不建立远程主机资产、凭据或连接恢复模型。外部客户端只能通过用户显式 Sharing 的 Session 使用内嵌 MCP Server。

## 进程与能力边界

```text
React Renderer + xterm
        |
        | contextBridge / 受限 preload API
        v
Electron Main（Composition Root）
   ├─ @synapse-term/session-runtime
   ├─ Desktop IPC Adapter
   └─ @synapse-term/mcp-runtime（可选，仅监听 127.0.0.1）
```

| 组件 | 当前职责 | 不应直接持有 |
| --- | --- | --- |
| Renderer | 工作区、Session 标签、终端交互、设置、Sharing 对话框和审批卡片 | Node API、PTY、Session 内部状态 |
| Preload | 暴露白名单限制的 `window.synapseTerm` API | 任意 IPC 转发、文件系统和网络 |
| Electron Main | 创建 runtime、BrowserWindow、IPC adapter、事件广播和退出清理 | Renderer 业务状态、远程主机与凭据模型 |

Renderer 崩溃或窗口关闭不会直接终止活动 Session；显式退出应用时 Main 终止全部 Session。Session 不跨应用重启存活。

## Workspace packages

| Package | 职责 |
| --- | --- |
| `@synapse-term/domain` | Session、PTY/终端抽象、外部调用和事务领域模型 |
| `@synapse-term/terminal-service` | PTY 适配、SessionActor/Manager、实时输出、Shell 发现与执行 |
| `@synapse-term/session-runtime` | Session 生命周期、环境发现、启动默认值、摘要和输出事件映射 |
| `@synapse-term/mcp-runtime` | Sharing、外部事务、风险/审批、输入授权、工具和内嵌 MCP Server |
| `@synapse-term/test-kit` | Fake PTY 和测试替身 |

依赖方向从上层指向下层：

```text
domain
   ^
terminal-service
   ^                 ^
session-runtime     mcp-runtime
   ^                 ^
        apps/desktop
```

跨包依赖必须经过各 package 的 `src/index.ts` 公共出口。runtime package 不得 import `apps/desktop` 或另一个 package 的内部实现路径；领域模型不得反向依赖终端服务、Electron 或 UI。

## Desktop IPC

Renderer 与 Main 通过 Electron IPC 通信，通道与共享类型位于 `apps/desktop/src/shared/`。当前请求通道分为：

- Session/终端：`sessions:list`、`sessions:environment`、`sessions:create`、`sessions:rename`、`sessions:close`、`terminal:write`、`terminal:resize`、`app:status`；
- 通用设置与主题：`settings:get-general`、`settings:update-general`、`theme:get-state`；
- 应用更新：`updates:get-state`、`updates:set-automatic-checks`、`updates:check`、`updates:download`、`updates:cancel`、`updates:install-impact`、`updates:install`；
- MCP：`mcp:get-settings`、`mcp:update-settings`、`mcp:regenerate-token`、`mcp:revoke-token`、`mcp:get-status`、`mcp:list-shared`、`mcp:share-session`、`mcp:unshare-session`、`mcp:decide-approval`。

事件通道包括 `terminal:output`、`session:changed`、`theme:changed`、`updates:changed`、`mcp:approval`、`mcp:approval-closed` 和 `mcp:execution`。

具体 channel 名称属于 Desktop 实现契约，新增或修改时应同步 `apps/desktop/src/shared/desktop-ipc-channels.ts`、preload 白名单和对应测试；不要把完整 IPC 清单复制到用户文档。

## Session 运行模型

Session 状态描述本地 PTY 生命周期：`starting`、`running`、`exited`、`failed`、`interrupted`。`SessionActor` 串行处理 PTY 输出、用户输入、resize、外部写入和退出事件；Renderer 只接收受限的实时输出事件。

Shell environment 通过运行时 Probe 验证。进入 SSH、容器、WSL 或嵌套 Shell 后，应用仍管理同一个本地 PTY；当前环境、能力代际和执行上下文由运行时事实更新，不建立远程连接对象。

## Sharing 与内嵌 MCP Server

MCP runtime 默认不启动端点。启用后只监听本机回环地址，要求 Bearer Token；用户在桌面端明确 Sharing Session 后才建立外部能力。取消 Sharing、Session 退出、Token 吊销或应用退出会清理共享句柄、审批和外部事务。

MCP 工具协议、输入授权、输出游标和稳定错误码见 [MCP 工具参考](../reference/mcp-tools.md)。安全边界见 [安全说明](../security/security.md)，不可回退的语义见 [ADR-0014 至 ADR-0019](../adr/README.md)。

## 应用更新

应用更新控制器只属于 Desktop Main，不进入 Session、MCP runtime 或领域模型。它管理固定 GitHub Release 来源、候选校验、一次性安装确认和平台安装适配器；安装前的 Session 清理顺序和信任取舍见 [ADR-0021](../adr/0021-explicit-github-application-updates.md)。

用户行为见[更新指南](../guides/updates.md)，发布和验收见[维护者文档](../maintainers/application-updates.md)。

## 数据边界

Session、PTY 和 Sharing 输出历史只存在于应用运行期；本机设置、MCP Token、更新偏好、公钥和有限更新缓存由各自控制器管理。应用不提供产品账户、远程主机资产、SSH 拓扑、远程凭据库或集中审计日志。

完整数据清单见[本地数据边界](../reference/data-boundary.md)。

## 兼容标识

当前产品名统一为 Synapse Term；旧的 `TERMINAL_AGENT_*` 环境变量与 `terminal-agent` 数据目录不再使用。兼容迁移的具体处理不在本架构总览中，按用户问题查阅对应 Release 或故障排查指南。
