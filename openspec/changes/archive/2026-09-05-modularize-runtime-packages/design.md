## Context

当前 workspace 已有 `@synapse-term/domain`、`@synapse-term/terminal-service` 和 `@synapse-term/test-kit`。`terminal-service` 持有 PTY、SessionActor、Shell Driver、完成 Probe 和外部事务执行器；Electron Main 目前在 `apps/desktop/src/main` 中额外承载 Session 运行装配，以及完整的 MCP Sharing、风险策略、输出历史、输入授权、审批和 Node MCP 端点 implementation。

本次变更只调整 implementation 的归属，不改变 Session、Sharing、外部事务、审批模式、executionContextId、PTY 输出历史或交互事务语义。Electron Main 继续持有 PTY 与 Session，Renderer 继续只能通过受限 preload API 访问能力。已完成的 `mcp-external-input-tool` change 是行为事实源，本 change 不重新打开它。

## Goals / Non-Goals

**Goals:**

- 建立 `@synapse-term/session-runtime`，集中 Session 生命周期、运行端数据类型、环境和输出事件映射。
- 建立 `@synapse-term/mcp-runtime`，集中当前 `main/mcp` 的 MCP implementation，并通过窄公共出口提供装配入口。
- 让 `apps/desktop` 只保留 Electron-specific adapter、IPC 参数校验、BrowserWindow、preload、Renderer 和运行端装配。
- 保持包间依赖从上层指向下层，禁止 package 反向 import `apps/desktop` 或其他 package 的内部路径。
- 将测试随对应 implementation 迁移，并让 package interface 成为主要测试 surface。
- 为未来本地 TUI 和 Web renderer 保留运行端复用位置，但不提前实现这些运行端。

**Non-Goals:**

- 不改变八个 `synapse_*` 工具、MCP 协议、错误码、审批行为或输出脱敏规则。
- 不引入远程 Session、主机资产、凭据库、跨应用持久化或多用户模型。
- 不让 Web renderer 直接访问 Node API、PTY 或 Session 内部状态。
- 不把 `SessionActor` 改造成跨进程或远程抽象；在出现第二个真实 adapter 前保留现有 concrete seam。
- 不处理通用设置模型与持久化的独立下沉；该方向留待后续 change。

## Decisions

### 1. 使用两个独立的 runtime package

新增 `@synapse-term/session-runtime` 和 `@synapse-term/mcp-runtime`，不合并为一个泛化的 `@synapse-term/runtime`。

依赖方向为：

```text
@synapse-term/domain
        ↑
@synapse-term/terminal-service
        ↑                 ↑
@synapse-term/session-runtime   @synapse-term/mcp-runtime
        ↑                 ↑
              apps/desktop
```

`mcp-runtime` 初始直接使用 `terminal-service` 的 `SessionActor` 和执行器；它不依赖 `session-runtime`，由 Desktop Composition Root 将两者连接起来，避免形成反向或环形依赖。未来 TUI 可以选择两个 package，Web renderer 可以只使用运行端契约和自己的 transport。

备选方案是把所有代码继续放入 `terminal-service`，或把 Session 与 MCP 合并进单一 package。前者会让已有 PTY implementation 继续吸收跨领域的 MCP 规则，后者会扩大 interface、降低 module depth；两者都不利于 locality。

### 2. `SessionRuntime` 吸收 TerminalHost 的运行行为

`SessionRuntime` 位于 `session-runtime` package，负责 Session 创建、重命名、关闭、shutdown、环境发现、默认工作目录、环境合并、摘要映射和有序输出事件。`SessionSummary`、`SessionEnvironment`、`SessionLaunchInput`、`TerminalOutputEvent` 和 `AppStatus` 同属该 package 的运行端契约。

原 `TerminalHost.handle()`、IPC channel 分发、原始参数校验和 Electron 广播不进入 package；这些内容由 Desktop adapter 调用 `SessionRuntime`。`SessionRuntime` 暴露获得活动 `SessionActor` 的必要能力，以便 Composition Root 装配 MCP，但不引入 MCP 专用命名或远程 Session port。

备选方案是保留 `TerminalHost` 类并让它逐个转发到 `SessionRuntime`。这会留下一个 interface 几乎等于 implementation 的 shallow module，因此不保留该 wrapper。

### 3. `mcp-runtime` 吸收完整 MCP implementation

`mcp-runtime` 迁移当前 `apps/desktop/src/main/mcp` 下的全部实现和测试，包括：

- `McpController`、`ExternalToolPipeline` 和工具注册；
- `PolicyEngine`、`ApprovalQueue`、`SharingOutputHistory`、`SecretRedactor` 和 `InputEncoder`；
- `EmbeddedMcpServer`、MCP settings 清理/存储和相关 Node implementation。

这些 module 的具体实现保持不变，迁移后由 package 内部相对路径互相引用。Electron Main 只负责创建审批事件到 Renderer 的广播、注册 MCP IPC、选择目录和装配 `McpController`/`EmbeddedMcpServer`。

`EmbeddedMcpServer` 是 Node adapter，但不依赖 Electron；把它放在 `mcp-runtime` 使本地 TUI 可以复用。未来浏览器 renderer 不直接导入 Node entry；是否拆出 browser-safe 子路径由真实 Web transport 出现后再决定。

备选方案是只迁移纯逻辑而把 MCP Controller 和 HTTP 端点留在 app。这会继续让 app 持有 Sharing registry 和事务生命周期，无法达到“app 只装配”的目标。

### 4. 公共出口只暴露 composition root 和运行端契约

`session-runtime/src/index.ts` 主要暴露 `SessionRuntime` 和 Session 运行端类型。`mcp-runtime/src/index.ts` 主要暴露 `McpController`、`EmbeddedMcpServer`、`ApprovalQueue`、settings 类型和装配所需类型。策略、历史、脱敏和输入编码 module 保留为 package 内部实现；其测试通过 package 内部 interface 验证。

`apps/desktop/src/shared/contracts.ts` 继续承载 Desktop IPC 与 Renderer-specific 类型，但 Session 运行端类型从 `session-runtime` 引用，避免重复定义。IPC channel 名称和 `DesktopApi` 不下沉到 package，因为它们是 Electron preload seam，而不是运行端领域契约。

### 5. 测试采用迁移而非叠加

Session 行为测试迁移到 `session-runtime`，MCP Main 测试迁移到 `mcp-runtime`；新增两个 package 的公共出口和依赖方向测试。测试断言 observable outcome，不依赖旧 app 文件路径。Renderer、真实 Electron MCP 和 PTY 集成测试保留在原有位置，只更新 import 或装配路径。

### 6. 文档与规格同步

新增 ADR-0020 记录 package 拆分的架构取舍，更新 `docs/architecture/architecture.md`、`docs/engineering/testing.md` 和 README 的 package 说明，并在本 change 中维护 `core-modularization` 与 `desktop-runtime-assurance` delta spec；主规格在本 change 归档或显式 sync 时更新。现有 MCP 行为规格不改写；已完成的 `mcp-external-input-tool` change 保持不变。

## Risks / Trade-offs

- [Risk] `mcp-runtime` 含 Node HTTP、文件系统和 MCP SDK，不能直接作为浏览器 bundle → [Mitigation] 将 Node implementation 与核心 module 分目录，公共出口保持窄；Web renderer 只在真实 transport 确定后选择 browser-safe 子路径。
- [Risk] 大量文件移动可能造成 import 或打包回归 → [Mitigation] 先保持源码行为和相对 import 结构，再通过 package typecheck、Desktop build、MCP 工具测试和真实端点测试验证。
- [Risk] 公共出口收窄后隐藏测试或未来运行端找不到内部类型 → [Mitigation] 只暴露 composition root 和稳定运行端契约；需要公开的新能力必须单独评估其 interface depth。
- [Risk] `SessionRuntime` 暴露 `SessionActor` 获取能力会保留 concrete seam → [Mitigation] 这是当前唯一真实 PTY adapter；不假造远程 port，未来出现第二个 adapter 时再重新设计。
- [Risk] 旧 OpenSpec 主规格与新 package 集合不一致 → [Mitigation] 在本 change 中修改对应 delta，并在实现完成后同步主规格、运行 `openspec validate`。

## Migration Plan

1. 保留中断前已创建的 package 骨架，补齐 OpenSpec artifacts 并通过 change 校验。
2. 创建 `session-runtime` 与 `mcp-runtime` 的 package manifests、tsconfig 和公共出口。
3. 将 Session 运行行为和测试迁移到 `session-runtime`，在 Desktop 中新增 IPC adapter。
4. 将 `main/mcp` implementation 与测试迁移到 `mcp-runtime`，更新 Electron Main 的装配和依赖。
5. 更新 shared contracts、Desktop public exit、文档、ADR 和主规格。
6. 运行格式检查、lint、所有 package typecheck、Vitest、Desktop build、`git diff --check` 和 OpenSpec strict validation。

迁移期间不改变持久化格式或外部协议，因此回滚只需还原本 change 的文件移动和 import；不需要数据迁移或 Session 恢复步骤。

## Open Questions

暂无阻塞问题。未来 Web renderer 的 transport、是否需要 browser-safe MCP 子路径，以及 TUI 是否启动本地 MCP 端点留待实际运行端出现后决定。
