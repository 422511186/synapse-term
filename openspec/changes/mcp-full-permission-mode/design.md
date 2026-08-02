## Context

当前 MCP 外部审批只有 read-only / managed 两级，均由设置页持久化（`userData/mcp/settings.json`）。`managed` 模式经 `ExternalToolPipeline.decideExternalAuthorization` 只放行 `read_only` / `mutating` 风险，`unknown` / `privileged` / `destructive` 一律 `policy_denied` 且不可配置。对单用户本机自用场景，用户希望有一个“不审查命令、全部放行”的完全权限模式，同时保留审计与租约/事务语义。

## Goals / Non-Goals

**Goals:**
- 新增 `full` 完全权限模式：任何风险级别的命令都进入执行管线并放行。
- 设置页提供第三个模式选项，并明确标注高风险。
- `full` 模式下仍走统一外部管线（策略分类 → 租约 → 独立事务 → 审计），策略结果只用于审计，不用于拦截。
- 保持安全默认：未配置、配置损坏或旧配置文件回退 `read_only`。

**Non-Goals:**
- 不改变 ACP 的 `managed` / `manual` 驱动者审批模式（ACP 仍走人工审批通道）。
- 不引入按命令/按风险的白名单子集（full 是全局开关）。
- 不改变内置 Agent 的权限模型。

## Decisions

**D1：`full` 作为 `ExternalApprovalMode` 的第四取值，在既有裁决函数中直接放行。**

`decideExternalAuthorization(mode, risk, effect)` 在 `mode === 'full'` 时对所有 risk 与 effect 返回 `allowed`。执行继续经过 `#grantLease`、`ShellProbe`、`CommandExecutor` 与审计，`risk` 与 `approvalMode: 'full'` 照常落审计，保证放行不意味着失去可追溯性。

备选：在 `ExternalToolPipeline` 入口对 full 模式短路、跳过 PolicyEngine —— 不采用。策略分类成本低，且保留 risk 审计对安全追溯有价值。

**D2：协议、设置存储、IPC 与 UI 四层同步新增 `full`。**

`externalApprovalModeSchema`、`ExternalApprovalMode`、`McpApprovalMode`（设置存储 + preload IPC 契约）统一增加 `'full'`；`sanitizeMcpSettings` 白名单接受 `'full'`，未知值仍回退 `read_only`。设置页在审批模式区块增加第三个 `ModeButton`，网格从两列改为三列，文案明确“不审查命令、全部放行（高风险）”。

备选：只在 UI 层保存 full、在端点层临时翻译为 approved_once —— 不采用。approved_once 语义是“单次人工批准”，与全局放行不同，混用会污染审计。

**D3：审计中的授权来源。**

`full` 与 `managed` 一样记 `authorization: 'auto_allowed'`（`approved_once` 才记 `user_approved`），但 `approvalMode` 字段保留 `'full'`，消费方可区分来源。

## Risks / Trade-offs

- [完全放行后高危命令（rm -rf / 等）可能破坏机器] → 仅在设置页显式选择才生效；按钮标注高风险；审计保留 risk 与完整命令哈希；恢复默认只需切回 read-only / managed。
- [旧配置文件没有 full 值] → sanitize 将未知值回退 read_only，行为与升级前一致，无需迁移。
- [客户端在 full 模式下误以为所有拒绝都消失] → `SESSION_NOT_READY` / `SESSION_EXPIRED` / `SESSION_BUSY` 等会话级错误仍按原语义返回，full 只影响策略审批，不影响会话生命周期。

## Migration Plan

无需数据迁移：`sanitizeMcpSettings` 对旧文件保持兼容。回滚策略：移除 `full` 分支后旧配置若含 `full` 会被回退为 `read_only`，不会意外放行。

## Open Questions

无。
