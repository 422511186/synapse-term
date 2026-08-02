# OpenSpec 验证矩阵

本矩阵对应活动 change `upgrade-terminal-agent-runtime-v2`。单元、性质、集成和安全测试由 `pnpm test` 执行；浏览器、Electron、打包程序和真实 SSH 验收由 Playwright 串行执行。真实外部凭据测试默认跳过，只有显式提供用户已有配置时运行，且不会读取或输出 API Key。

## Agent Execution

| Requirement | 自动化或验收证据 |
| --- | --- |
| Session Conversation History | `packages/domain/src/agent-conversation.test.ts`；`apps/core/src/repositories.test.ts`；`apps/core/src/agent-coordinator.test.ts`；`apps/desktop/src/agent-history.test.ts` |
| Text-Only Agent Turn | `apps/core/src/agent-coordinator.test.ts`；`scripts/verify-real-agent.mts` 普通中文与 Markdown 对话 |
| Agent System Prompt Contract | `apps/core/src/context-builder.test.ts`；`apps/core/src/agent-runtime.test.ts` |
| Recoverable Tool Feedback | `apps/core/src/agent-runtime.test.ts`；`apps/core/src/agent-runtime.integration.test.ts`；`apps/core/src/tool-gateway.test.ts` |
| Bounded Autonomous Loop | `apps/core/src/agent-runtime.test.ts`；`apps/core/src/agent-runtime.integration.test.ts` |
| Post-Tool Completion Review | `apps/core/src/agent-runtime.test.ts`；`apps/core/src/agent-runtime.integration.test.ts`；`apps/core/src/agent-coordinator.test.ts`；`apps/desktop/e2e/packaged.spec.ts`；真实模型与 `example-host` 自包含最终答复断言 |
| Just-in-Time Terminal Lease | `apps/core/src/agent-coordinator.test.ts`；`apps/core/src/tool-gateway.test.ts`；`apps/core/src/session-actor.test.ts` |
| Configurable Context Budget | `apps/core/src/context-budget.test.ts`；`apps/core/src/context-builder.test.ts`；`apps/core/src/token-estimator.ts` |
| Persisted Conversation Compaction | `apps/core/src/conversation-compactor.test.ts`；`apps/core/src/repositories.test.ts`；`apps/core/src/agent-coordinator.test.ts` |
| Per-Turn Model Controls | `packages/domain/src/model-configuration.test.ts`；`apps/core/src/provider-adapters.test.ts`；`apps/core/src/agent-coordinator.test.ts`；`apps/desktop/e2e/workspace.spec.ts` |
| Conversation Reset and Cancellation | `packages/domain/src/agent-conversation.test.ts`；`apps/core/src/agent-coordinator.test.ts`；`apps/desktop/e2e/workspace.spec.ts` |
| Session-Bound Agent Task | `apps/core/src/agent-coordinator.test.ts`；`packages/protocol/src/tool-schemas.test.ts` |
| Agent Concurrency Limits | `apps/core/src/agent-task-scheduler.test.ts`；`apps/core/src/performance-baseline.test.ts` |
| Explicit Context Disclosure | `apps/core/src/context-builder.test.ts`；`apps/core/src/secret-protection.test.ts`；`apps/core/src/agent-coordinator.test.ts` |
| Restricted Terminal Tools | `packages/protocol/src/tool-schemas.test.ts`；`apps/core/src/agent-runtime.test.ts`；`apps/core/src/tool-gateway.test.ts` |
| Goal-Oriented Tool Loop | `apps/core/src/agent-runtime.integration.test.ts`；`apps/core/src/agent-coordinator.test.ts`；`scripts/verify-real-agent.mts` |
| POSIX Shell Probe | `apps/core/src/shell-probe.test.ts`；`apps/core/src/command-executor.integration.test.ts`；真实 `example-host` POSIX E2E |

## Model Providers

| Requirement | 自动化或验收证据 |
| --- | --- |
| Provider and Model Separation | `packages/domain/src/provider-model-separation.test.ts`；`packages/protocol/src/provider-model-separation.test.ts`；`apps/core/src/repositories.test.ts` |
| Model Catalog Eligibility | `apps/core/src/model-catalog-service.test.ts`；`apps/core/src/core-request-router.provider.test.ts` |
| Model Configuration Reference Integrity | `apps/core/src/model-catalog-service.test.ts`；`apps/core/src/repositories.test.ts` |
| Provider Model Discovery | `apps/core/src/provider-model-discovery.test.ts`；`apps/core/src/provider-model-discovery-http.integration.test.ts` |
| Quick Model ID Selection | `apps/core/src/model-catalog-service.test.ts`；`apps/desktop/e2e/workspace.spec.ts` |
| Structured Tool Conversation Mapping | `apps/core/src/provider-adapters.test.ts`；`apps/core/src/model-adapter.test.ts`；`apps/core/src/tool-call-assembler.test.ts` |
| Protocol-Safe Tool Names | `packages/protocol/src/tool-schemas.test.ts`；`apps/core/src/provider-adapters.test.ts` |
| Model Validation Details | `apps/core/src/provider-validator.test.ts`；`apps/core/src/core-request-router.provider.test.ts`；真实模型 attempt/checkedAt/capability 证据 |
| Context and Reasoning Configuration | `packages/domain/src/model-configuration.test.ts`；`apps/core/src/context-budget.test.ts`；`apps/core/src/provider-adapters.test.ts`；模型页 Playwright |
| OpenAI Responses Support | `apps/core/src/provider-adapters.test.ts` |
| OpenAI-Compatible Chat Completions Support | `apps/core/src/provider-adapters.test.ts`；`apps/core/src/provider-openai-http.integration.test.ts`；真实 `mimo-v2.5-pro` 验收 |
| Anthropic Messages Support | `apps/core/src/provider-adapters.test.ts` |
| Provider Capability Validation | `apps/core/src/provider-validator.test.ts`；`apps/core/src/provider-openai-http.integration.test.ts`；`scripts/verify-real-agent.mts` |
| Normalized Model Events | `apps/core/src/model-adapter.test.ts`；`apps/core/src/tool-call-assembler.test.ts`；`apps/core/src/provider-adapters.test.ts` |

## Terminal Sessions

| Requirement | 自动化或验收证据 |
| --- | --- |
| Session Execution Dialect | `packages/domain/src/session-state.test.ts`；`apps/core/src/session-manager.test.ts`；`apps/desktop/e2e/workspace.spec.ts` |
| ShellDriver Capability Probe | `apps/core/src/shell-driver.test.ts`；`apps/core/src/agent-coordinator.test.ts`；`apps/core/src/shell-probe.test.ts` |
| PowerShell Command Transaction | `apps/core/src/shell-driver.test.ts`；`apps/core/src/command-executor.powershell.integration.test.ts` 对象输出/状态/流式/退出码/Ctrl+C；`apps/core/src/session-resource-service.powershell.integration.test.ts` |
| Dynamic Local Runtime Paths | `apps/core/src/home-resolver.test.ts`；`apps/desktop/src/shell-locator.test.ts`；`apps/desktop/src/session-launch.test.ts` |
| Default Home Launch | `apps/core/src/home-resolver.test.ts`；`apps/desktop/src/session-launch.test.ts`；`apps/desktop/e2e/packaged.spec.ts` |
| Orthogonal Session State | `packages/domain/src/session-state.test.ts`；`apps/core/src/session-actor.test.ts` |
| Exclusive Session Lease | `apps/core/src/session-actor.test.ts`；`apps/core/src/agent-coordinator.test.ts`；`apps/core/src/tool-gateway.test.ts` |

## Local File Tools

| Requirement | 自动化或验收证据 |
| --- | --- |
| Dynamic Current User Home Root | `apps/core/src/home-resolver.test.ts`；`apps/core/src/local-file-service.test.ts` |
| Canonical Relative Path Boundary | `apps/core/src/local-file-service.test.ts`；`apps/core/src/local-file-policy.test.ts`；`apps/core/src/authorization-policy.test.ts` |
| Local File Listing | `apps/core/src/local-file-service.test.ts`；`apps/core/src/tool-gateway.test.ts` |
| Local File Search | `apps/core/src/local-file-service.test.ts`；`apps/core/src/tool-gateway.test.ts` |
| Local Text File Read | `apps/core/src/local-file-service.test.ts`；`apps/core/src/secret-protection.test.ts` |
| Local File Write | `apps/core/src/local-file-service.test.ts`；`apps/core/src/tool-gateway.test.ts` |
| Local File Edit | `apps/core/src/local-file-service.test.ts`；`apps/core/src/agent-coordinator.test.ts` |
| Local and Remote File Separation | `apps/core/src/local-file-service.test.ts`；`apps/core/src/context-builder.test.ts`；`apps/core/src/agent-coordinator.test.ts` |
| No Destructive Local File Tools | `packages/protocol/src/tool-schemas.test.ts`；`apps/core/src/tool-gateway.test.ts` |

## Terminal Safety and Audit

| Requirement | 自动化或验收证据 |
| --- | --- |
| Local File Risk Classification | `apps/core/src/local-file-policy.test.ts`；`apps/core/src/authorization-policy.test.ts` |
| Local File Approval Integrity | `packages/domain/src/approval-grant.test.ts`；`apps/core/src/approval-manager.test.ts`；`apps/core/src/tool-gateway.test.ts` |
| Local File Audit Events | `apps/core/src/tool-gateway.test.ts`；`apps/core/src/audit-service.test.ts`；`apps/desktop/e2e/workspace.spec.ts` |
| Conversation Permission Modes | `packages/domain/src/agent-conversation.test.ts`；`apps/core/src/authorization-policy.test.ts`；`apps/core/src/agent-coordinator.test.ts`；installed `apps/desktop/e2e/packaged.spec.ts` |
| Cross-Dialect Terminal Command Risk | `apps/core/src/policy-engine.test.ts`；`apps/core/src/tool-gateway.test.ts`；真实 PowerShell ConPTY packaged 权限矩阵；`docs/evidence/powershell-permission-matrix.log` |
| Non-Bypassable Boundaries | `apps/core/src/authorization-policy.test.ts`；`apps/core/src/local-file-service.test.ts`；`apps/core/src/tool-gateway.test.ts`；packaged home escape |
| Permission Mode Audit | `apps/core/src/agent-coordinator.test.ts`；`apps/core/src/tool-gateway.test.ts`；`apps/desktop/e2e/workspace.spec.ts`；packaged POSIX/PowerShell 权限矩阵与 SQLite 审计断言 |
| Secret Redaction Before Disclosure | `apps/core/src/secret-protection.test.ts`；`apps/core/src/context-builder.test.ts`；`apps/core/src/local-file-service.test.ts` |
| Structured Audit Events | `apps/core/src/audit-service.test.ts`；`apps/core/src/agent-coordinator.test.ts`；`apps/core/src/core-request-router.test.ts` |
| Fail-Closed Authorization | `apps/core/src/policy-engine.test.ts`；`apps/core/src/authorization-policy.test.ts`；`apps/core/src/tool-gateway.test.ts` |

## Session Observability

| Requirement | 自动化或验收证据 |
| --- | --- |
| Explicit Read-Only Resource Snapshot | `apps/core/src/session-resource-service.test.ts`；`apps/core/src/session-resource-service.powershell.integration.test.ts`；真实 `example-host` E2E |
| Bounded Cross-Dialect Metrics | `apps/core/src/session-resource-parser.test.ts`；`apps/core/src/session-resource-domain.test.ts`；`apps/core/src/session-resource-service.test.ts` |
| Resource Snapshot Audit | `apps/core/src/session-resource-service.test.ts`；真实 SSH 审计断言无 approval、无写操作 |

## Desktop Terminal

| Requirement | 自动化或验收证据 |
| --- | --- |
| Simplified Chinese Product UI | `apps/desktop/src/zh-cn.test.ts`；`apps/desktop/e2e/workspace.spec.ts`；中文视觉证据 |
| Shell Availability and Dialect Controls | `apps/desktop/src/shell-locator.test.ts`；`apps/desktop/src/session-launch.test.ts`；工作区 Playwright |
| Dedicated Model Management Page | `apps/desktop/src/model-management-page.tsx`；`apps/desktop/e2e/workspace.spec.ts` |
| Model Discovery Workflow | `apps/desktop/e2e/workspace.spec.ts`；`apps/core/src/provider-model-discovery-http.integration.test.ts` |
| Model Test Feedback | `apps/desktop/src/zh-cn.test.ts`；`apps/desktop/e2e/workspace.spec.ts`；真实模型检测 |
| Local File Tool Activity | `apps/desktop/e2e/workspace.spec.ts`；`apps/core/src/agent-coordinator.test.ts` |
| Adaptive Workspace Theme | `apps/desktop/e2e/workspace.spec.ts`；`docs/evidence/desktop-1440x900.png`；`docs/evidence/mobile-390x844.png` |
| Markdown Agent Timeline | `apps/desktop/src/agent-history.test.ts`；`apps/desktop/e2e/workspace.spec.ts`；真实 Markdown 对话 |
| Composer Runtime Controls | `apps/desktop/e2e/workspace.spec.ts`；`apps/core/src/agent-coordinator.test.ts` |
| Simplified Session Dialog | `apps/desktop/src/session-launch.test.ts`；`apps/desktop/e2e/workspace.spec.ts`；`apps/desktop/e2e/packaged.spec.ts` |
| Session Resource View | `apps/desktop/e2e/workspace.spec.ts`；`apps/desktop/e2e/electron.spec.ts`；真实 SSH 截图 |
| Top Session Tabs and Collapsible Right Panel | `apps/desktop/e2e/workspace.spec.ts`；桌面、最小与移动视觉证据 |
| Launch Profiles | `apps/desktop/src/session-launch.test.ts`；真实 PowerShell ConPTY E2E |
| Session-Scoped Agent Panel | `apps/desktop/e2e/workspace.spec.ts`；`apps/core/src/agent-coordinator.test.ts` |
| Visible Failure States | `apps/desktop/src/zh-cn.test.ts`；`apps/desktop/e2e/workspace.spec.ts`；`apps/desktop/src/core-supervisor.test.ts` |

## 基线 Session 与发布能力

| 范围 | 自动化或验收证据 |
| --- | --- |
| Core-Owned PTY、顺序输出、replay、resize | `apps/core/src/pty-adapter.test.ts`；`apps/core/src/output-journal.test.ts`；`apps/core/src/session-replay.test.ts`；Electron reload E2E |
| UI detach、Core restart、资源上限 | `apps/core/src/core-lifecycle.test.ts`；`apps/core/src/session-recovery.test.ts`；`apps/core/src/performance-baseline.test.ts` |
| Renderer、IPC、凭据与数据隔离 | `apps/desktop/src/electron-security.test.ts`；`apps/core/src/core-ipc-server.test.ts`；`apps/core/src/data-security.test.ts`；`apps/core/src/secret-store.test.ts` |
| schema v4 -> v8 迁移、备份和回滚 | `apps/core/src/repositories.test.ts`；`apps/core/src/migration-v7.test.ts`；`apps/core/src/sqlite-store.test.ts`；`apps/core/src/maintenance-cli.test.ts`；真实迁移备份 |
| 固定 Node Runtime 与原生模块 | `scripts/stage-core-runtime.mjs`；`pnpm smoke:core-package` |
| 升级活动 Session 阻断 | `apps/core/src/upgrade-state.test.ts`；`build/installer.nsh`；`scripts/verify-installer-lifecycle.ps1` 验证退出码 32 |
| 打包桌面与真实 ConPTY | `apps/desktop/e2e/packaged.spec.ts`；`scripts/verify-installer-lifecycle.ps1` 从静默安装目录复跑 2/2 |
| 备份、回滚与卸载保留 | `scripts/smoke-packaged-maintenance.ts`；`scripts/verify-installer-lifecycle.ps1` |

## 真实只读验收

| 验收 | 结果与证据 |
| --- | --- |
| 用户已保存模型配置 | `mimo-v2.5-pro` 检测为 available，streaming=true、toolCalls=true；`docs/evidence/real-agent-session.log`；密钥始终留在平台凭据存储 |
| 无 Tool 普通对话 | `scripts/verify-real-agent.mts` 完成中文一句话和 Markdown 输出，未获取 terminal lease |
| 自主 Tool Loop | 两次 `terminal_execute` 后完成独立复核，`Get-Date` 与 `Get-Location` Tool Result 均为 `completed/read_only/exitCode=0`，最终答复自包含 |
| Electron -> SSH `example-host` | `apps/desktop/e2e/real-environment.spec.ts` 通过已有 SSH 配置连接，不创建主机资产对象 |
| 远端只读命令 | 仅执行 `uname -a`、`uptime`、`free -b`、`df -P`、`cat /proc/loadavg`、`cat /proc/meminfo`、`cat /proc/net/dev` |
| 风险与审批 | 七条命令各执行一次，全部 `risk=read_only`、`requiresApproval=true`，由验收流程逐条批准后 exitCode 0；Approval 请求与批准各 7 次，本机写 Tool 计数为 0，无远端写操作 |
| 完成性复核 | 候选文本不进入复核上下文；最终答复不得引用隐藏候选，并包含 Linux、负载、容量、磁盘百分比等实际证据 |
| 资源快照 | CPU、内存、磁盘、网络、host、OS、uptime 均有可确认值；日志 `docs/evidence/example-host-readonly-e2e.log`；截图 `docs/evidence/example-host-readonly-1440x900.png` |

最终命令、测试数量、安装生命周期与 SHA-256 记录在 [发布报告](release-report.md)。
