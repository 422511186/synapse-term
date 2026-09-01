## ADDED Requirements

### Requirement: Minimal Package Boundaries
平台实现 MUST 按最小包集合组织：`domain`、`terminal-service`、`test-kit`，应用装配位于 `apps/desktop`；包间依赖 MUST 从上层指向下层（apps/desktop → terminal-service → domain），反向依赖 MUST 被依赖方向约束测试阻止。

#### Scenario: Reverse dependency is rejected
- **WHEN** `terminal-service` 引入对 `apps/desktop` 或上层包的 import
- **THEN** 依赖方向约束测试失败，该依赖不得合入

#### Scenario: Renderer imports main internals
- **WHEN** Renderer 代码尝试 import `apps/desktop/src/main` 内部实现
- **THEN** lint 或类型约束阻止该引用，Renderer 只能通过 `src/shared` 契约与 preload API 交互

### Requirement: Single-Process Composition Root
Electron Main MUST 承担单一 Composition Root 职责：通过 `apps/desktop/src/main/terminal-host.ts` 选择并组装 PTY、Session 与 IPC 实现；业务实现 MUST 位于 `terminal-service` 等包，不得继续堆入 main 装配文件。

#### Scenario: New session logic is added
- **WHEN** 需要新增 Session 相关业务逻辑
- **THEN** 实现落入 `terminal-service` 包，main 只做组装与 IPC 转发

### Requirement: Terminal Backend Contract Test
Terminal 抽象 MUST 具备契约测试：MockTerminalBackend 能替换本地 PTY 实现并通过同一套用例；上层 MUST 依赖抽象而非具体实现。

#### Scenario: Terminal backend is swapped
- **WHEN** 以 MockTerminalBackend 替换本地 PTY 实现运行契约测试
- **THEN** 契约用例通过且上层无需改动

## MODIFIED Requirements

### Requirement: Module Public API
`domain` 与 `terminal-service` MUST 通过公共入口（index）导出契约、用例组件与必要类型；包间依赖 MUST 只引用公共 API，内部实现文件 MUST NOT 被包外直接 import。

#### Scenario: Internal file is imported from another package
- **WHEN** desktop 尝试 import `terminal-service` 的某个内部实现路径
- **THEN** 类型检查或依赖约束测试失败，并提示改为公共入口

## REMOVED Requirements

### Requirement: Modular Package Boundaries
**Reason**: 旧包集合（application/protocol/infrastructure/agent-service/model-providers/platform-kernel/tooling/ui-platform）已删除。
**Migration**: 见 ADDED Requirement: Minimal Package Boundaries。

### Requirement: Composition Root Boundary
**Reason**: `apps/core` 已删除，装配迁入 Electron Main。
**Migration**: 见 ADDED Requirement: Single-Process Composition Root。

### Requirement: Core API Single Entry
**Reason**: 独立 Core、MCP 端点、ACP 桥接和统一 Core API 已删除。
**Migration**: Renderer 通过 preload + ipcMain 通道直接请求 Main，通道契约位于 `apps/desktop/src/shared`。

### Requirement: Replaceable Backend Verification
**Reason**: 旧需求包含 TestAgent 与审批语义。
**Migration**: 见 ADDED Requirement: Terminal Backend Contract Test。
