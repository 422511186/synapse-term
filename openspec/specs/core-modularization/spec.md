# core-modularization Specification

## Purpose
规定 Synapse Term 的最小 package 边界、单进程 Composition Root、公共 API 与可替换终端后端契约。

## Requirements

### Requirement: Minimal Package Boundaries
平台实现 MUST 按可复用 package 集合组织：`domain`、`terminal-service`、`session-runtime`、`mcp-runtime`、`test-kit`，应用装配位于 `apps/desktop`。包间依赖 MUST 从上层指向下层：`apps/desktop` 可以依赖各 runtime package，`session-runtime` 与 `mcp-runtime` 可以依赖 `terminal-service` 和 `domain`，`terminal-service` 只能依赖 `domain`，`test-kit` 只能依赖 `domain`；任何 package MUST NOT import `apps/desktop` 或其他 package 的内部实现路径，反向依赖 MUST 被依赖方向约束测试阻止。

#### Scenario: Reverse dependency is rejected
- **WHEN** `terminal-service`、`session-runtime` 或 `mcp-runtime` 引入对 `apps/desktop` 或更上层 package 的 import
- **THEN** 依赖方向约束测试失败，该依赖不得合入

#### Scenario: Renderer imports main internals
- **WHEN** Renderer 代码尝试 import `apps/desktop/src/main` 内部实现
- **THEN** lint 或类型约束阻止该引用，Renderer 只能通过 `src/shared` 契约与 preload API 交互

#### Scenario: A future runtime host reuses behavior
- **WHEN** 未来 TUI 或本地 Web 运行端需要使用 Session 或 MCP runtime 能力
- **THEN** 运行端 MUST 通过 package 公共出口装配对应 module，不得复制 `apps/desktop/src/main` 的 implementation

### Requirement: Single-Process Composition Root
Electron Main MUST 承担单一 Composition Root 职责：通过 `electron-main.ts` 选择并组装 `@synapse-term/session-runtime`、`@synapse-term/mcp-runtime`、PTY 和 IPC adapter；业务 implementation MUST 位于对应 package，不得继续堆入 Main 装配文件。Electron Main 仍 MUST 持有 PTY 与 Session，Renderer 不得成为其所有者。

#### Scenario: New session logic is added
- **WHEN** 需要新增 Session 相关业务逻辑
- **THEN** 实现落入 `session-runtime` 或 `terminal-service` package，Main 只做组装、IPC 参数校验与事件转发

#### Scenario: New MCP behavior is added
- **WHEN** 需要新增 Sharing、外部事务、风险策略、输入授权或 MCP 工具行为
- **THEN** 实现落入 `mcp-runtime` package，Main 只选择 adapter、注册 IPC 和广播运行端事件

### Requirement: Module Public API
`domain`、`terminal-service`、`session-runtime` 与 `mcp-runtime` MUST 通过各自公共入口（`index`）导出契约、composition root、用例和必要类型；包间依赖 MUST 只引用公共 API，内部实现文件 MUST NOT 被包外直接 import。Desktop-specific `DesktopApi` 和 IPC channel 契约可以保留在 `apps/desktop/src/shared`，但不得被 package 反向引用。

#### Scenario: Internal file is imported from another package
- **WHEN** desktop 或另一个 package 尝试 import `terminal-service`、`session-runtime` 或 `mcp-runtime` 的某个内部实现路径
- **THEN** 类型检查或依赖约束测试失败，并提示改为公共入口

#### Scenario: Runtime behavior is exposed through a small interface
- **WHEN** 运行端需要创建 Session 或启动 MCP runtime
- **THEN** 调用方只需要学习对应 package 的 composition root 和运行端契约，不需要知道内部策略、输出历史、脱敏或输入编码 module

### Requirement: Terminal Backend Contract Test
Terminal 抽象 MUST 具备契约测试：MockTerminalBackend 能替换本地 PTY 实现并通过同一套用例；上层 MUST 依赖抽象而非具体实现。

#### Scenario: Terminal backend is swapped
- **WHEN** 以 MockTerminalBackend 替换本地 PTY 实现运行契约测试
- **THEN** 契约用例通过且上层无需改动
