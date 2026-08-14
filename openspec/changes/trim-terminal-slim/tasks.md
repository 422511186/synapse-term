## 1. 仓库与包结构收敛

- [x] 1.1 删除 `apps/core` 与 `packages/application`、`protocol`、`infrastructure`、`agent-service`、`model-providers`、`platform-kernel`、`tooling`
- [x] 1.2 删除 `packages/ui-platform`，将 TerminalView、终端状态工具、i18n 与视图类型迁入 desktop
- [x] 1.3 更新 `pnpm-workspace.yaml`、根 `package.json` scripts/deps、`tsconfig.base.json`、`vitest.config.ts`、ESLint/Prettier 配置
- [x] 1.4 删除 Core/Agent 相关脚本（`stage-core-runtime.mjs`、smoke、verify-real-agent 等）并简化 `electron-builder.yml` 与 packaging scripts

## 2. domain 包裁剪

- [x] 2.1 重写 `packages/domain/src/index.ts`，只导出 session/terminal 相关类型
- [x] 2.2 简化 `SessionState`：删除 executionDialect、environment、lease、shared 字段及其转换
- [x] 2.3 删除 agent/provider/approval/capability/external/command/shell-ast 领域文件与测试
- [x] 2.4 更新 dependency-direction 与 module-contracts 测试以匹配新包集合

## 3. terminal-service 裁剪

- [x] 3.1 保留 pty-adapter、session-actor、session-manager、session-replay、shell-locator、terminal-model，删除 execution/resources/shell-driver/shell-probe/bash-parser 等模块
- [x] 3.2 简化 `SessionActor`：仅维护 PTY、attachment、尺寸、输出 sequence 与 Session 元数据
- [x] 3.3 实现有界内存回放缓冲：UTF-8 安全分片、严格递增 sequence、`historyGap` 与分页
- [x] 3.4 删除 SessionRecovery、OutputJournal 等磁盘持久化代码，更新 `src/index.ts` 公共出口
- [x] 3.5 重写/保留 session、replay、shell-locator、pty 契约测试并通过 `pnpm test`

## 4. test-kit 裁剪

- [x] 4.1 保留 FakePty、时钟、临时目录，删除 FakeProvider/FakeAgent 等 Agent 测试替身
- [x] 4.2 更新 `packages/test-kit/src/index.ts` 与测试

## 5. desktop Main 与 Shared

- [x] 5.1 在 `apps/desktop/src/shared/` 新增 `contracts.ts` 并重写 `desktop-ipc-channels.ts`，只保留 sessions/terminal/core 通道
- [x] 5.2 新建 `src/main/terminal-host.ts`：持有 SessionManager 与回放，注册 ipcMain 处理器
- [x] 5.3 重写 `electron-main.ts`：移除 CoreSupervisor、MCP/ACP、附件与旧数据迁移，退出时终止全部 Session
- [x] 5.4 删除 core-config/core-process/core-supervisor/named-pipe-core-connector/desktop-core-bridge/desktop-attachment-controller/user-data-migration 及其测试
- [x] 5.5 重写 `preload-api.ts` 与 `preload.ts`，只暴露 `DesktopApi`（sessions/terminal/core）
- [x] 5.6 删除 `src/acp/`、`src/mcp/` 目录与测试

## 6. Renderer 与 Mock

- [x] 6.1 重写 `app.tsx`：终端-only 布局，保留会话标签/新建/重命名/关闭/全部会话/设置，删除 Agent 面板、资源监控、方言、共享与提示词历史
- [x] 6.2 将 TerminalView 与终端输出/回放工具迁入 renderer，移除 `@synapse-term/ui-platform` imports
- [x] 6.3 保留并清理 `all-sessions-popover`、`new-session-modal` 文案，删除 `search-history-modal`
- [x] 6.4 重写 `settings/settings-workspace.tsx` 为单页占位，删除 provider/model/audit 设置文件
- [x] 6.5 重写 `mock-api.ts` 为纯终端 `DesktopApi` 并更新 `mock-api.test.ts`
- [x] 6.6 清理 renderer 样式、字体引用与无用依赖

## 7. 测试与 E2E

- [x] 7.1 删除 agent/acp/mcp/audit/provider/model/resource/dialect 相关单元测试
- [x] 7.2 更新保留的 session/replay/shell-locator/pty/TerminalView/会话操作/设置占位测试
- [x] 7.3 重写 `apps/desktop/e2e/workspace.spec.ts` 为终端-only 断言
- [x] 7.4 删除或改写 agent-composer-attachments、packaged、macos-runtime-failure、real-environment 等 e2e 中的 Core/Agent 场景

## 8. 文档与 OpenSpec 主规格

- [x] 8.1 删除过时 `openspec/specs/`（agent-*、acp-driver、mcp-access、model-providers、desktop-model-management、session-resource-monitoring、terminal-safety-audit、provider-backed-context-summarization、structured-agent-progress）
- [x] 8.2 同步六个保留能力的主规格（terminal-sessions、desktop-terminal、settings-workspace、core-modularization、desktop-runtime-assurance、macos-build-packaging）与 delta 一致
- [x] 8.3 重写 README、`docs/architecture.md`、`docs/security.md`、`docs/runbook.md`、`docs/verification-matrix.md`
- [x] 8.4 清理 ADR：删除/标注 Core、Agent、ACP、MCP、审计相关决策，保留终端相关决策并更新引用

## 9. 命名与本地清理

- [x] 9.1 移除 `TERMINAL_AGENT_*` 环境变量与 `terminal-agent` 标识，统一为 `SYNAPSE_TERM_*`/Synapse Term
- [x] 9.2 删除本机 `~/Library/Application Support/synapse-term` 与 `~/Library/Application Support/terminal-agent` 数据目录
- [x] 9.3 更新 `scripts/verify-installer-lifecycle.ps1` 等残留断言（去掉 agentTasks/Core 引用）

## 10. 验证

- [x] 10.1 更新锁文件后执行 `pnpm install --frozen-lockfile`
- [x] 10.2 通过 `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`
- [x] 10.3 通过 `pnpm test:e2e`
- [x] 10.4 通过 `pnpm build`，并冒烟启动真实 Electron
- [x] 10.5 `openspec validate --change trim-terminal-slim` 与 `openspec status --change trim-terminal-slim` 全绿

## 11. 移除终端回放

- [x] 11.1 删除 `terminal:replay` IPC 通道、`DesktopApi.terminal.replay` 与 mock replay
- [x] 11.2 移除 `OutputBuffer`/内存回放，仅保留有序输出分片与实时广播
- [x] 11.3 更新 `TerminalView` 为纯实时输出，删除 replay 工具与相关测试
- [x] 11.4 同步 OpenSpec specs 与 docs 中的回放需求
