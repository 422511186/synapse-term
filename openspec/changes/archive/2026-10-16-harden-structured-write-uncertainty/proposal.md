# Proposal

## Why

结构化执行（`synapse_execute`）在 PTY 写入调用已经开始、但 `write()` 抛错或后端无法确认交付时，当前系统把它当作「写入前失败」，向外部客户端返回 `SESSION_NOT_READY`。同一个物理事件在交互启动路径上被正确判为不确定态（`INTERACTIVE_START_WRITE_UNKNOWN` ＋ 立即失效 environment、递增 epoch、轮换 context），两条路径对同一事实给出了相反结论。外部客户端因此可能把已经执行或部分写入的命令当作「未执行」，并在已被污染的执行前提上继续提交下一条命令。

## What Changes

- `synapse_execute` 的结构化写入在「写入尝试已开始但交付无法确认」时 MUST 以新的稳定错误码 `EXECUTION_WRITE_UNKNOWN` 失败：不返回可操作的 transactionId，立即失效当前 PTY environment、递增 capability epoch、轮换 executionContextId，并明确该命令可能已执行、不得自动重试。
- 写入前的既有失败保持原样：缺少或失配 `expectedContextId`、环境未验证、Session 不再运行仍分别返回 `EXECUTION_CONTEXT_REQUIRED`、`EXECUTION_CONTEXT_STALE`、`SESSION_NOT_READY`、`SESSION_EXPIRED`。
- 澄清事务内 `synapse_input` 的前提措辞：environment 验证状态属于 Session 就绪前提，交互事务句柄与 `inputGrantId` 只取代 executionContext 前提，不取代 Session 就绪；其对外错误码与行为不变（仍为 `INPUT_WRITE_UNKNOWN`）。
- 把 `EXECUTION_WRITE_UNKNOWN` 加入稳定错误码枚举，并补充一个与 `INTERACTIVE_START_WRITE_UNKNOWN` 平行的外部可观察场景。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `mcp-access`：新增结构化写入不确定态的外部契约与稳定错误码 `EXECUTION_WRITE_UNKNOWN`；澄清事务内输入的前提措辞。

## Impact

- `packages/domain`：`ExternalErrorCode` 增加 `EXECUTION_WRITE_UNKNOWN`；写入前提判定抽为纯函数，与 `SessionState` 的既有状态转换同处。
- `packages/terminal-service`：`SessionActor` 的外部写入族由五个方法收敛为一个写入方法加一张前提/后果策略表；本地通道 `writeUser` / `writeProbe` 保留具名方法但共用同一前提助手与写入后果处理；`CommandExecutor` 的写入抛错分支由「写入前失败」改为不确定态；「前提码 → `ExternalErrorCode`」的映射由三处合并为一处。以上属于内部重构，除本提案明列的行为外不改变可观察结果。
- `packages/mcp-runtime`：`ExternalToolPipeline` 与 MCP 工具错误序列化暴露新错误码；两份字面重复的稳定错误码集合收为同一常量。
- 外部 Interface：`synapse_execute` 增加一种失败结果 `EXECUTION_WRITE_UNKNOWN`。**BREAKING**——依赖以 `SESSION_NOT_READY` 判定「用户命令肯定未写入」的客户端需要区分两种情况；错误文本同时给出原因与不可自动重试的指引，不静默兼容为旧码。
- 文档：`CONTEXT.md` 的「事务不确定态」补充「包含写入尝试本身未取得交付确认」；新增 ADR 记录该取舍，并在 ADR-0018 标注接管关系。
- 验证范围：`pnpm verify` 与 `openspec validate <change> --strict`。本次不改 UI、IPC 契约与打包，因此不新增 E2E 或平台冒烟。
- **与进行中的事实源冲突**：`add-terminal-file-transfer-and-status` 计划在 `SessionActor` 内引入「有序操作槽」，统一本地操作、外部 Probe 与外部事务的写入资格（其 design 决策 4、tasks 3.1），与本提案收敛外部写入族的范围重叠在同一处接口。两者需要确定先后：本提案先落地会给操作槽提供一个现成的写入策略表入口；若操作槽先落地，本提案的策略表需要挂到该操作槽上，而不是另建一个并行入口。
