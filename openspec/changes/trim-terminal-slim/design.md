## Context

当前实现围绕“独立 Node.js Core + 桌面端”的跨进程架构展开，内置 Agent、ACP、MCP、审计、Provider/Model、资源监控和持久化构成约 7 万行代码。本变更的目标是把产品收敛为单进程 Electron 桌面终端，并同步裁剪包结构、协议、数据与文档。动机见 proposal.md。

## Goals / Non-Goals

**Goals:**
- 建立单一 Electron Main 进程持有 PTY、Session 与实时输出的运行架构。
- 将 workspace 收敛为 `domain`、`terminal-service`、`test-kit` 三个包，其余实现并入 `apps/desktop`。
- 删除 Agent/ACP/MCP/审计/资源监控/方言/共享 Session/附件/提示词历史及其设置页。
- 会话全部内存化，应用退出即终止，不保留任何磁盘数据，不提供终端回放。
- 保留浏览器 Mock 模式与终端核心测试，使 `pnpm verify` 和 `pnpm test:e2e` 可独立验证。

**Non-Goals:**
- 不实现内置 Agent、ACP、MCP、审计或设置主题的替代方案（后续重新规划）。
- 不提供旧数据迁移或旧 Core 兼容层。
- 不新增终端外观/行为设置（设置页保持占位）。

## Decisions

### 1. 单进程 Electron Main Terminal Host
在 `apps/desktop/src/main/terminal-host.ts` 中创建 `TerminalHost`：持有 `SessionManager`、Shell 发现结果，并注册全部 ipcMain 处理器。`electron-main.ts` 只负责窗口、应用生命周期与调用 Terminal Host。

替代方案：保留独立 Core 子进程（被否决——跨进程协议、令牌、生命周期是主要复杂度来源）；新建 `terminal-host` workspace 包（被否决——装配与 Electron 主进程强耦合，无独立复用收益）。

### 2. 最小包集合与依赖方向
- `domain`：Session 状态与 PTY/终端抽象；无任何 Node/Electron 依赖。
- `terminal-service`：`PtySpawner` 适配、`SessionActor`/`SessionManager`、实时输出、ShellLocator；依赖 `domain`，不依赖 Electron。
- `test-kit`：Fake Pty、时钟与临时目录等测试工具。
- `apps/desktop`：Main/Preload/Renderer 与 `src/shared` 契约。

删除 `application`、`protocol`、`infrastructure`、`agent-service`、`model-providers`、`platform-kernel`、`tooling` 与 `apps/core`。`ui-platform` 组件并入 desktop renderer。

### 3. Session 状态模型简化
`SessionState` 只保留 PTY 生命周期、UI attachment、最后尺寸与 Session 元数据（id/title/terminalType）。删除 executionDialect、environment、lease、shared 与 shell probing。`SessionSummary` 由 actor snapshot 派生，Renderer 通过 `src/shared/contracts.ts` 消费。

### 4. 有界实时输出
`SessionActor` 按固定预算（32 KiB）把 PTY 输出拆成 UTF-8 安全分片，分配严格递增 sequence 后实时广播给 Renderer；不保留任何输出历史，不提供 `terminal.replay` 接口。

替代方案：磁盘 raw-log + SQLite（被否决——无持久化需求）；内存回放缓冲（被否决——重开应用即空列表，回放没有使用场景）。

### 5. Renderer↔Main 契约
`apps/desktop/src/shared/` 保存 IPC 通道名与 `DesktopApi` 类型；preload 只暴露 `window.terminalAgent`；Main 对每个通道做参数校验（保留 zod，作为 desktop 内部依赖）。不再有 `protocol` 包与跨进程 schema。

### 6. UI 与 Mock
Renderer 重写为终端-only 布局：Header（品牌、标签、全部会话、新建、设置）、TerminalView、会话弹窗、设置占位页。`mock-api.ts` 实现同一 `DesktopApi`（内存假会话/假输出），供 `pnpm dev` 与 Playwright 使用。`ui-platform` 的 TerminalView、终端状态工具与 i18n 文案迁入 renderer。

### 7. 构建、打包与脚本
- 根脚本只保留 `dev`、`build`、`start`、`format`、`lint`、`typecheck`、`test`、`verify`、`test:e2e` 与 packaging 脚本。
- 删除 `package:core`、`smoke:*`、`verify:real-agent`、`stage-core-runtime.mjs`、`smoke-packaged-*`、`run-real-agent-session.mjs`。
- `electron-builder.yml` 与 `package:mac/win` 直接打包 desktop；产物名改为 `Synapse-Term-*`。
- `pnpm-workspace.yaml` 保留 `apps/*` 与 `packages/*`；依赖方向由 `domain` 内测试与 ESLint 规则约束。

### 8. 本地数据与命名清理
实施时删除本机 `~/Library/Application Support/synapse-term` 与旧 `~/Library/Application Support/terminal-agent` 目录（未发布，无迁移义务）。代码中移除 `TERMINAL_AGENT_*` 环境变量、旧数据迁移与 `terminal-agent` 标识。

## Risks / Trade-offs

- [大范围删除导致编译/测试断裂] → 按“先收包与 main、再改 renderer、最后清理测试与文档”分阶段执行，每阶段运行 typecheck/test。
- [无输出历史，Renderer 重载后看不到此前输出] → 与产品决策一致（会话不跨重启存活），新 Renderer 只订阅实时输出。
- [Electron Main 直接持有 PTY，崩溃即丢失会话] → 与产品决策一致（应用退出即终止），在 UI 显示中断状态。
- [移除 `ui-platform` 后 renderer 文件变多] → 按 `terminal/`、`sessions/`、`settings/`、`feedback/` 目录组织，避免单文件膨胀。
- [Mock 与真实 Main 行为漂移] → 共享同一 `DesktopApi` 类型，E2E 同时覆盖 Mock 浏览器与 Electron 场景。

## Migration Plan

1. 在 `feat/trim-terminal-slim` 分支实施；本变更不提供旧版本兼容。
2. 先删包与 apps/core，再重写 desktop main/preload/shared，随后重写 renderer 与 mock。
3. 删除本地用户数据目录，安装精简依赖，跑 `pnpm verify` 与 `pnpm test:e2e`。
4. 同步清理 `openspec/specs`、docs 与 README，最后提交并进入 review。

## Open Questions

无；输出分片预算可在实现中按常量调整，不影响规格与任务分解。
