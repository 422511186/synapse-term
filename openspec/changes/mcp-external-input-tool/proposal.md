## Why

外部客户端（Agent）通过 MCP 驱动终端时，大量真实场景卡在"命令已发出、但进程在等待后续输入"：`sudo su` 等密码、`vim` 等按键、堡垒机交互菜单等方向键导航。现有五个 `synapse_*` 工具只有 execute（结构化命令，交互式命令被 `INTERACTIVE_COMMAND_UNSUPPORTED` 拒绝）与 interrupt（发送中断），没有向运行中 PTY 写入输入的能力，Agent 无法闭环这些场景。

## What Changes

- 新增第六个工具 `synapse_input`：向已共享 Session 的 PTY 写入交互输入（可打印文本 + 白名单特殊键），单工具双模式。
- **事务内输入**（传 `transactionId`）：挂靠进行中的外部事务帮助其收敛（如 sudo 密码）；继承原事务审批结果，不校验/不轮换 `executionContextId`，不递增 capability epoch，前提语义与 `synapse_interrupt` 相同（租约 + 事务存活）。
- **自由输入**（传 `expectedContextId`）：不挂靠事务的纯键盘模拟（vim、堡垒机菜单）；必须携带有效执行上下文 ID，写入后轮换该 ID 并保守递增 capability epoch。
- `synapse_execute` 的交互式命令拒绝保持不变，交互式程序由 `synapse_input` 自由模式启动并驱动。
- 输入内容协议：`text` 原样键入（`\n` 规范化为 `\r`），`keys` 为封闭白名单枚举（方向键、回车、esc 等 26 键），禁止任意转义序列与原始字节；两者可同传（先 text 后 keys）。
- 响应只含发送元数据（`textLength` + 键名）与即时输出窗口，不回显 `text` 原文（防密码进入外部客户端日志）。
- 新增稳定错误码 `TRANSACTION_NOT_ACTIVE`（事务存在但尚未写入 PTY 的窗口）。

## Capabilities

### New Capabilities

### Modified Capabilities
- `mcp-access`: 工具面从五个扩展为六个（`synapse_input` 加入 Synapse Tool Surface）；新增「External Interactive Input」需求（双模式前提、审批分级、键白名单、响应元数据契约）；Stable External Error Codes 增加 `TRANSACTION_NOT_ACTIVE`。

## Impact

- `packages/domain/src/external/external-caller.ts`：`ExternalErrorCode` union 新增 `TRANSACTION_NOT_ACTIVE`。
- `packages/terminal-service/src/session/session-actor.ts`：新增 `writeExternalInput`（事务内裸写入）与 `writeExternalFreeform`（校验 + 失效 + 写入）两个写入方法。
- `packages/terminal-service/src/session/command-executor.ts`：新增 `respond(transactionId, payload)`。
- `apps/desktop/src/main/mcp/mcp-tools.ts`：工具清单、错误码集、`registerTool(synapse_input)`、`validateToolInput` 分支、"仅提供五个"文案。
- `apps/desktop/src/main/mcp/mcp-controller.ts`：`callTool` switch 新增分发。
- `apps/desktop/src/main/mcp/external-tool-pipeline.ts`：新增 `input()` 方法（双模式管线：租约、审批、写入、即时输出窗口）。
- 测试：`external-tool-pipeline.test.ts`、`mcp-tools.test.ts`、`command-executor.test.ts` 新增用例。
- 决策依据：ADR-0019（`docs/adr/0019-mcp-external-input-tool.md`）与 `CONTEXT.md` 词条已同步（交互式命令改写 + 外部输入/事务内输入/自由输入新增）。
