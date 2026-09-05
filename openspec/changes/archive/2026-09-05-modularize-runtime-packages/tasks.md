## 1. Package foundations and dependency boundaries

- [x] 1.1 完成 `@synapse-term/session-runtime` 和 `@synapse-term/mcp-runtime` 的 package manifest、TypeScript 配置、workspace 注册和公共入口，确保包外只依赖各自 public export。
- [x] 1.2 为两个 runtime package 增加依赖方向与公共出口约束测试，覆盖禁止 import `apps/desktop`、禁止跨 package 内部路径以及 `domain`/`terminal-service` 的既有方向。

## 2. Session runtime extraction

- [x] 2.1 将 `apps/desktop/src/main/terminal-host.ts` 中的 Session 生命周期、环境发现、默认值合并、摘要映射和有序输出事件行为迁移到 `packages/session-runtime`，定义并导出稳定的 Session runtime 类型。
- [x] 2.2 在 `session-runtime` 保留获取活动 `SessionActor`、写入、resize、环境读取和 shutdown 所需的窄 composition-root API，不引入 Electron、IPC 或 MCP 依赖。
- [x] 2.3 在 `apps/desktop` 增加 Desktop IPC adapter，把 channel 分发、参数校验、错误映射和 Electron 事件广播连接到 `SessionRuntime`，保持现有 Renderer/preload 契约不变。
- [x] 2.4 迁移并适配 `terminal-host` 行为测试到 `session-runtime`，补充 public export 测试和 Session 生命周期、环境及输出顺序回归覆盖；删除旧 app implementation 与 re-export shim。

## 3. MCP runtime extraction

- [x] 3.1 将 `apps/desktop/src/main/mcp` 的全部 implementation 迁移到 `packages/mcp-runtime`，包括 Controller、Pipeline、八个工具注册、审批、Sharing history、redaction、input encoding、settings 和 embedded Node MCP server。
- [x] 3.2 修正迁移后 MCP module 的相对引用和 package 依赖，确保实现不依赖 Electron 或 `apps/desktop`，并保留既有 `SessionActor`/terminal-service concrete seam。
- [x] 3.3 收窄 `mcp-runtime` 公共出口为 `McpController`、`EmbeddedMcpServer`、审批队列、settings 及装配所需稳定类型；策略、历史、脱敏和输入编码保持 package 内部。
- [x] 3.4 迁移并适配 MCP 单元/集成测试到 `mcp-runtime`，覆盖八个 `synapse_*` 工具、Sharing、审批模式、execution context、输出脱敏、交互事务、输入授权和 embedded HTTP endpoint。

## 4. Desktop composition and contract migration

- [x] 4.1 更新 Electron Main 的 Composition Root，从两个 runtime package 装配 Session、MCP、PTY、IPC adapter 和 Renderer 广播；Main 继续持有 PTY/Session，Renderer 继续只使用受限 preload API。
- [x] 4.2 更新 Desktop shared contracts、IPC handlers、settings/approval event wiring 和所有 runtime imports，消除对旧 `apps/desktop/src/main/mcp` 与 `terminal-host` 路径的引用。
- [x] 4.3 删除迁移后的 app implementation/test 文件及旧内部出口，检查 Renderer、preload、shared 与 packages 的依赖方向和构建入口；不改变外部协议或运行时行为。
- [x] 4.4 更新 workspace lockfile、构建配置和 package scripts，使两个新 package 能独立 typecheck/test，并被 Desktop/Vite/Electron 构建正确解析。

## 5. Documentation and verification

- [x] 5.1 新增 ADR-0020，记录 runtime package 拆分、Composition Root 责任、依赖方向、公共出口和未来 TUI/本地 Web 复用边界。
- [x] 5.2 更新架构说明、测试指南、README package 导航和受影响的实现说明，明确 app 只负责 Electron runtime assembly；如出现新的稳定术语，同步 `CONTEXT.md`。
- [x] 5.3 运行 OpenSpec strict validation、格式检查、依赖方向测试、所有相关 typecheck/Vitest、Desktop build、`pnpm verify` 和 `git diff --check`，修复发现的问题并记录验证结果。
