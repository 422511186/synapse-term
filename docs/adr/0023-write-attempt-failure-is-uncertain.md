# ADR-0023：PTY 写入尝试发起后的失败一律判为不确定态

状态：已接受

日期：2026-10-14

## 背景

结构化执行（`synapse_execute`）在「写入尝试已经开始、但 PTY 后端 `write()` 抛错或无法确认交付」时，被当作写入前失败处理，向外部客户端返回 `SESSION_NOT_READY`。同一个物理事件在交互启动路径上已经被判为不确定态：`synapse_start_interactive` 以 `INTERACTIVE_START_WRITE_UNKNOWN` 失败，并立即失效当前 PTY environment、递增 capability epoch、轮换 `executionContextId`。

两条路径对同一事实给出相反结论，而 `write()` 抛错本身不证明命令未写入：后端可能在部分交付之后失败。按写入前失败处理会让外部客户端把「可能已经执行」的命令当成「肯定没执行」，并在已被污染的执行前提上继续提交下一条命令。

## 决策

PTY 写入尝试发起之后的失败一律判为不确定态。

- `synapse_execute` 以稳定错误码 `EXECUTION_WRITE_UNKNOWN` 失败，不返回可操作的 transactionId，立即失效当前 PTY environment、递增 capability epoch 并轮换 `executionContextId`；用户命令可能已经部分写入或执行，不得自动重试，外部客户端必须先重新 `synapse_observe` 并由用户判断后续动作。
- 写入尝试发起**之前**的失败仍是写入前失败，保持既有稳定错误码（`EXECUTION_CONTEXT_REQUIRED`、`EXECUTION_CONTEXT_STALE`、`SESSION_NOT_READY`、`SESSION_EXPIRED`），且不失效 environment、不轮换 `executionContextId`。
- 本决策细化 ADR-0018 中「`not_sent` 是写入前错误」的适用范围：它只覆盖写入尝试发起之前的失败；写入尝试发起之后的失败不再算「未写入」。
- 交互启动写入不确定态（`INTERACTIVE_START_WRITE_UNKNOWN`）、事务内输入（`INPUT_WRITE_UNKNOWN`）与自由输入（`INPUT_WRITE_UNKNOWN`）的既有结论不变，本决策只是让结构化执行与它们对齐。

## 备选方案

**把「写入已发起」重新定义为事务可见的前提，产出 `status: unknown` 的可见事务。** 否决：那会松动「事务 ID 只在 `write()` 正常返回后可见」这条已生效规则，而 `EXECUTION_WRITE_UNKNOWN` 已经能承载「可能已执行、不可自动重试、需要用户判断」的全部语义，不必额外造一个客户端句柄。

**保留「`write()` 抛错即未写入」的假设。** 否决：该假设与 ADR-0018 对「PTY 在完成证据到达前断开即不确定态」的判定直接冲突，且会让客户端在旧前提上重放一条可能已执行的命令。

## 影响

- 依赖以 `SESSION_NOT_READY` 判定「用户命令肯定未写入」的外部客户端需要区分两种情况；错误文本同时给出原因与不可自动重试的指引，不静默兼容为旧码。
- 稳定错误码集合新增 `EXECUTION_WRITE_UNKNOWN`（`specs/mcp-access` 的 Stable External Error Codes）。
- 写入前提判定与写入后果收敛为 `domain` 的一张策略表；`SessionActor` 的外部写入族由五个方法收敛为单一写入方法加该表，前提码到对外错误码的映射只有一份实现。
- 本地通道（用户输入与本地诊断写入）不受影响：它没有事务可以承载不确定态，写入抛错照旧抛给调用方。
