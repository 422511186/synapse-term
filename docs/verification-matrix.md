# 验证矩阵

本文档对应当前仓库的实际测试布局。它不引用历史 OpenSpec change、已删除的 Core 业务测试路径或未纳入仓库的证据文件。

## 命令级入口

| 命令                             | 覆盖范围                                       | 备注                                                |
| -------------------------------- | ---------------------------------------------- | --------------------------------------------------- |
| `pnpm format:check`              | Prettier 格式                                  | 包含 apps、packages、scripts、docs 和根目录配置     |
| `pnpm lint`                      | ESLint                                         | 全仓库 TypeScript/JavaScript                        |
| `pnpm typecheck`                 | 各 workspace 的 TypeScript 检查                | 使用 `pnpm -r --if-present typecheck`               |
| `pnpm test`                      | Vitest 单元、集成、协议和安全测试              | 排除 `e2e`，最大 worker 数为 1                      |
| `pnpm verify`                    | 上述四项                                       | CI 的基础门槛                                       |
| `pnpm test:e2e`                  | Playwright Renderer Mock 和条件式 Electron E2E | 单 worker；真实环境按条件跳过                       |
| `pnpm smoke:core-package`        | 打包 Core Runtime                              | 需要先生成 `.packaging/core-runtime` 或安装包上下文 |
| `pnpm smoke:maintenance-package` | 打包维护入口                                   | 校验固定 Node 与 maintenance CLI                    |
| `pnpm test:installer`            | Windows 安装、升级、卸载生命周期               | 仅 Windows                                          |

## 领域与协议

| 能力                                     | 主要测试                                                                                                                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session 状态、租约、方言和环境 epoch     | `packages/domain/src/session/session-state.test.ts`、`packages/domain/src/session/shared-session.test.ts`                                                                    |
| Agent Conversation、Turn、Task 和 Driver | `packages/domain/src/agent/agent-conversation.test.ts`、`packages/domain/src/agent/agent-task.test.ts`、`packages/domain/src/module-contracts.test.ts`                       |
| 精确审批授权和命令事务                   | `packages/domain/src/approval/approval-grant.test.ts`、`packages/domain/src/session/command-transaction.test.ts`、`packages/domain/src/session/command-hash.ts` 相关测试     |
| Provider/Model 分离和配置不变量          | `packages/domain/src/provider-model-separation.test.ts`、`packages/domain/src/provider/provider-profile.test.ts`、`packages/domain/src/provider/model-configuration.test.ts` |
| Tool Schema、Core API 和领域 Schema      | `packages/protocol/src/schemas/tool-schemas.test.ts`、`packages/protocol/src/core-api/core-api.test.ts`、`packages/protocol/src/schemas/domain-schemas.test.ts`              |
| IPC 帧、协议版本和认证握手               | `packages/protocol/src/core-api/framing.test.ts`、`packages/protocol/src/core-api/version.test.ts`、`packages/protocol/src/core-api/handshake.test.ts`                       |
| 包依赖方向和公共出口                     | `packages/domain/src/dependency-direction.test.ts`、`packages/domain/src/index.test.ts`、`packages/protocol/src/index.test.ts`                                               |

## Terminal Service

| 能力                                     | 主要测试                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PTY、SessionActor、SessionManager 和重放 | `packages/terminal-service/src/shell/pty-adapter.test.ts`、`packages/terminal-service/src/session/session-actor.test.ts`、`packages/terminal-service/src/session/session-manager.test.ts`、`packages/terminal-service/src/session/session-replay.test.ts`                                                                                                                                                                         |
| POSIX/PowerShell ShellDriver 和 Probe    | `packages/terminal-service/src/shell/shell-driver.test.ts`、`packages/terminal-service/src/shell/shell-probe.test.ts`、`packages/terminal-service/src/shell/environment-identification.test.ts`                                                                                                                                                                                                                                   |
| 明文命令事务、退出码、流式输出和中断     | `packages/terminal-service/src/execution/command-executor.test.ts`、`packages/terminal-service/src/execution/command-executor.integration.test.ts`、`packages/terminal-service/src/execution/command-executor.powershell.integration.test.ts`、`packages/terminal-service/src/plaintext-protocol.e2e.test.ts`                                                                                                                     |
| 交互检测和有界输出                       | `packages/terminal-service/src/execution/interaction-detector.test.ts`、`packages/terminal-service/src/execution/output-journal.test.ts`、`packages/terminal-service/src/execution/command-output-collector.test.ts`                                                                                                                                                                                                              |
| 资源快照、解析和跨方言指标               | `packages/terminal-service/src/resources/session-resource-domain.test.ts`、`packages/terminal-service/src/resources/session-resource-parser.test.ts`、`packages/terminal-service/src/resources/session-resource-service.test.ts`、`packages/terminal-service/src/resources/session-resource-service.posix.integration.test.ts`、`packages/terminal-service/src/resources/session-resource-service.powershell.integration.test.ts` |
| SSH/跳转场景的终端语义                   | `packages/terminal-service/src/ssh-hop-scenarios.test.ts`、`packages/terminal-service/src/unified-dispatch.integration.test.ts`                                                                                                                                                                                                                                                                                                   |

## Agent、策略与文件

| 能力                                      | 主要测试                                                                                                                                                                                                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent Runtime 多轮、Tool Call、取消和挂起 | `packages/agent-service/src/runtime/agent-runtime.test.ts`、`packages/agent-service/src/runtime/agent-runtime.integration.test.ts`                                                                                                                                               |
| 上下文预算、脱敏和对话压缩                | `packages/agent-service/src/context/context-builder.test.ts`、`packages/agent-service/src/context/context-budget.test.ts`、`packages/agent-service/src/context/conversation-compactor.test.ts`                                                                                   |
| Tool Call 组装                            | `packages/agent-service/src/tools/tool-call-assembler.test.ts`                                                                                                                                                                                                                   |
| Agent Coordinator、时间线、审批恢复       | `packages/application/src/agent/agent-coordinator.test.ts`、`packages/application/src/router/core-request-router.agent.test.ts`                                                                                                                                                  |
| Tool Gateway、外部调用和任务调度          | `packages/platform-kernel/src/gateway/tool-gateway.test.ts`、`packages/platform-kernel/src/gateway/external-tool-pipeline.test.ts`、`packages/platform-kernel/src/gateway/core-tool-gateway-flow.test.ts`、`packages/platform-kernel/src/scheduler/agent-task-scheduler.test.ts` |
| 权限模式、命令风险和 fail closed          | `packages/platform-kernel/src/policy/authorization-policy.test.ts`、`packages/platform-kernel/src/policy/local-file-policy.test.ts`、`packages/platform-kernel/src/policy/policy-engine.test.ts`、`packages/platform-kernel/src/gateway/static-execution-gate.test.ts`           |
| 本机 home 路径和文件操作                  | `packages/tooling/src/files/local-file-service.test.ts`、`packages/infrastructure/src/paths/home-resolver.test.ts`                                                                                                                                                               |
| 秘密检测、凭据存储和数据权限              | `packages/infrastructure/src/security/secret-protection.test.ts`、`packages/infrastructure/src/security/secret-store.test.ts`、`packages/infrastructure/src/security/data-security.test.ts`                                                                                      |

## Provider、持久化与生命周期

| 能力                                      | 主要测试                                                                                                                                                                                                                                       |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 三种模型协议适配和事件归一化              | `packages/model-providers/src/adapter/provider-adapters.test.ts`、`packages/model-providers/src/adapter/model-adapter.test.ts`                                                                                                                 |
| Provider 检测、模型发现和配置服务         | `packages/model-providers/src/adapter/provider-validator.test.ts`、`packages/model-providers/src/discovery/provider-model-discovery.test.ts`、`packages/model-providers/src/discovery/model-catalog-service.test.ts`                           |
| Provider HTTP 集成                        | `packages/model-providers/src/discovery/provider-model-discovery-http.integration.test.ts`、`packages/model-providers/src/discovery/provider-openai-http.integration.test.ts`                                                                  |
| SQLite Repository、迁移、备份和 retention | `packages/infrastructure/src/store/repositories.test.ts`、`packages/infrastructure/src/store/sqlite-store.test.ts`、`packages/infrastructure/src/migration-v7.test.ts`、`packages/infrastructure/src/store/retention.test.ts`                  |
| Core IPC、Named Pipe 和生命周期           | `packages/infrastructure/src/ipc/core-ipc-server.test.ts`、`packages/infrastructure/src/ipc/named-pipe.test.ts`、`packages/infrastructure/src/lifecycle/core-lifecycle.test.ts`、`packages/infrastructure/src/lifecycle/upgrade-state.test.ts` |
| Core Composition Root 和维护 CLI          | `apps/core/src/core-application.test.ts`、`apps/core/src/main-options.test.ts`、`apps/core/src/maintenance-cli.test.ts`                                                                                                                        |

## Desktop 与 E2E

| 能力                                            | 主要测试                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preload、IPC 白名单、Core Supervisor 和安全窗口 | `apps/desktop/src/main/electron-security.test.ts`、`apps/desktop/src/main/desktop-core-bridge.test.ts`、`apps/desktop/src/main/core-supervisor.test.ts`、`apps/desktop/src/main/named-pipe-core-connector.test.ts`                                                                             |
| Session 创建、Shell 发现和用户数据迁移          | `apps/desktop/src/renderer/session-launch.test.ts`、`apps/desktop/src/renderer/session-selection.test.ts`、`apps/desktop/src/main/user-data-migration.test.ts`                                                                                                                                 |
| MCP 设置、端点、token 和工具翻译                | `apps/desktop/src/mcp/mcp-settings.test.ts`、`apps/desktop/src/mcp/mcp-controller.test.ts`、`apps/desktop/src/mcp/embedded-mcp-server.test.ts`                                                                                                                                                 |
| ACP 设置、进程、权限和 Projection               | `apps/desktop/src/acp/acp-settings.test.ts`、`apps/desktop/src/acp/acp-controller.test.ts`                                                                                                                                                                                                     |
| UI 时间线、Markdown、终端和中文文案             | `packages/ui-platform/src/agent/agent-history.test.ts`、`packages/ui-platform/src/agent/agent-timeline-state.test.ts`、`packages/ui-platform/src/markdown/markdown-content.test.tsx`、`packages/ui-platform/src/terminal/terminal-view.test.ts`、`packages/ui-platform/src/i18n/zh-cn.test.ts` |
| Mock Renderer 工作区、Session tabs 和 UI 交互   | `apps/desktop/e2e/runtime-workspace.spec.ts`、`apps/desktop/e2e/workspace.spec.ts`、`apps/desktop/e2e/session-tabs.spec.ts`                                                                                                                                                                    |
| 真实 Electron / Core / PTY                      | `apps/desktop/e2e/electron.spec.ts`、`apps/desktop/e2e/macos-session-lifecycle.spec.ts`、`apps/desktop/e2e/macos-runtime-failure.spec.ts`                                                                                                                                                      |
| 打包应用、固定 Runtime、模型和 Local File Tool  | `apps/desktop/e2e/packaged.spec.ts`                                                                                                                                                                                                                                                            |
| 真实 Provider 与 SSH 只读验收                   | `apps/desktop/e2e/real-environment.spec.ts`，仅在显式设置 `TERMINAL_AGENT_REAL_E2E=1` 等变量时运行                                                                                                                                                                                             |

## 覆盖边界

- 默认 CI 不依赖真实 Provider、SSH、`opencode` 或用户凭据。
- Electron、打包和安装器测试依赖对应平台；不适用的平台会跳过，而不是伪造成功。
- `pnpm test:e2e` 的 WebServer 是 Mock Renderer；需要验证真实 Core/PTY 时运行 Electron 或 packaged 测试。
- 通过测试不等于远端环境安全。执行真实验收时仍需使用隔离用户数据目录、最小权限凭据和固定只读命令。
