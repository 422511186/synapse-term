## Why

当外部客户端先调用 `synapse_status` 得到 `not_ready` 时，当前 Share Text 只指导其稍后重复查询 status；但 status 按安全契约不会写入 PTY，也不会触发 Probe，因此状态不会自行变为 ready。这个恢复流程会让终端实际正常、SSH 已进入远端 Shell 的用户陷入无效轮询。

## What Changes

- 明确 `synapse_status` 的 `not_ready` 是未验证状态，不是 PTY/Session 故障。
- 将恢复指导改为：远端提示符就绪后直接调用 `synapse_execute` 提交原文用户命令，由执行管线先运行固定明文 Probe；不要通过重复调用 `synapse_status` 等待状态改变。
- 说明 Probe 失败时返回 `SESSION_NOT_READY` 且用户命令不会写入 PTY，成功后使用 `synapse_wait` 获取事务最终结果。
- 补充 Share Text、MCP tool description 和状态 guidance 的回归测试，锁定只读 status 不写 PTY、execute 才触发 Probe 的边界。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `mcp-session-sharing`: 修正 `not_ready` 状态的外部客户端恢复流程和可执行指导。

## Impact

- `apps/desktop/src/renderer/mcp/share-text.ts`：更新 Share Text 的状态/执行顺序文案。
- `apps/desktop/src/main/mcp/mcp-tools.ts` 与 `apps/desktop/src/main/mcp/external-tool-pipeline.ts`：补充状态 guidance 和执行前 Probe 语义说明（如需要）。
- `apps/desktop/src/renderer/mcp/share-text.test.ts`、MCP 管线测试和 OpenSpec delta spec：增加回归覆盖。
- 不改变 `synapse_status` 的只读边界，不改变明文命令传输、Probe 审计、SSH/远程 Shell 行为或 MCP 认证方式。
