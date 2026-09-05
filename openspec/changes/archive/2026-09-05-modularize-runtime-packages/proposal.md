## Why

`apps/desktop` 当前同时承载 Electron 装配、Session 运行行为和完整 MCP 外部调用 implementation，导致可复用能力与 Electron seam 纠缠。现在 MCP 交互事务和 Sharing 语义已经稳定，适合把 Session runtime 与 MCP runtime 下沉到独立 package，为未来 TUI 和本地 Web renderer 保留复用位置，同时不改变当前单用户、本地 PTY 和安全语义。

## What Changes

- 新增 `@synapse-term/session-runtime`，承载 Session 生命周期、运行端数据类型、Shell 启动配置和 PTY 输出事件映射。
- 新增 `@synapse-term/mcp-runtime`，承载 Sharing、外部事务、风险分类、审批协调、输入授权、输出历史、工具注册、MCP Controller 和 Node MCP 端点 implementation。
- 将 Electron IPC 参数校验、preload、BrowserWindow、审批卡片广播和运行端装配保留在 `apps/desktop`。
- 将 package 公共出口收窄为 composition root 与运行端契约；内部策略、输出历史和输入编码 module 不作为 app 外部公共知识。
- 迁移对应单元/集成测试到 package，并保持八个 `synapse_*` 工具、Session 生命周期、Sharing、审批、执行上下文和交互事务行为不变。
- **BREAKING**：更新 `core-modularization` 对 package 集合、Composition Root 和公共出口的要求；不保留旧的 app 内部 re-export shim。

## Capabilities

### New Capabilities

- 无。本变更只重组既有能力，不新增外部可见产品能力。

### Modified Capabilities

- `core-modularization`：允许 Session runtime 与 MCP runtime 作为独立 package，并明确 Electron Main 负责装配而非承载全部业务 implementation。
- `desktop-runtime-assurance`：将 Main 的 Session 持有实现从 app 内 `terminal-host.ts` 调整为 `@synapse-term/session-runtime`，保留受限 IPC、preload 和 Renderer 隔离要求。

## Impact

- 影响 `apps/desktop/src/main`、`apps/desktop/src/shared`、`packages/`、workspace package manifests、构建依赖和测试位置。
- `domain`、`terminal-service` 和既有 MCP/Session 对外行为保持兼容；Electron Main 仍持有 PTY 与 Session，Renderer 仍只能通过受限 preload API 访问能力。
- `mcp-external-input-tool` 已完成的 OpenSpec change 不重新打开；本变更只迁移其已实现的 implementation，不改变其协议要求。
- 需要同步更新架构说明、ADR、测试矩阵和 `core-modularization` delta spec；主规格在本 change 归档或显式 sync 时更新，并通过 OpenSpec、类型检查、lint、测试和构建验证。
