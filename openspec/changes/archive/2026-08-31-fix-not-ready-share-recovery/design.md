## Context

当前 `synapse_status` 正确地只读取单个 Sharing Session 的状态，不创建 Lease，也不写入 PTY。Session 创建后或用户输入触发 current PTY environment 失效后，status 会返回 `not_ready`，而固定明文 Probe 只在 `synapse_execute` 的执行管线中运行。现有 Share Text 却把 `not_ready` 解释为“稍后重试 status”，外部客户端因此会重复调用一个不会改变状态的只读工具。

本次修复只收敛状态指导，不改变明文审计边界，不让 status 隐式发送命令，也不根据启动 Shell hint 推断 SSH 后的远端方言。

## Goals / Non-Goals

**Goals:**

- 让 `synapse_status` 的 guidance 明确说明 `not_ready` 是 current PTY environment 未验证，而不是 PTY 故障。
- 指导外部客户端在远端 Shell 提示符就绪后直接提交原文用户命令给 `synapse_execute`，由执行管线先运行 Probe。
- 明确 Probe 失败时返回 `SESSION_NOT_READY`，用户命令不会写入；成功后使用 `synapse_wait` 获取最终事务结果。
- 通过 MCP tool description、Share Text 和单元测试保持同一恢复语义。

**Non-Goals:**

- 不让 `synapse_status` 发送 Probe 或改变终端内容。
- 不新增 `synapse_probe` 工具，不自动执行外部客户端未提交的命令。
- 不自动重试 status，不自动翻译、编码或包装用户命令。
- 不改变 Session、Sharing、Bearer Token、风险分类、审批模式或输出排空实现。

## Decisions

### 1. 保持 status 只读，修正 guidance 的下一步

`not_ready` 响应继续保留未验证 environment 摘要和 `status` 三态语义。guidance 改为明确：status 不会触发 Probe；如果用户已经确认远端 Shell 提示符就绪，应直接调用 `synapse_execute` 提交要执行的明文命令。执行管线会先验证当前环境，验证失败时不发送用户命令。

备选方案是让 `synapse_status` 自动发送 Probe。该方案会让一个只读查询改变用户正在使用的 PTY，并可能把 Probe 写入尚未完成 SSH 登录或密码交互的终端，因此不采用。

### 2. Share Text 使用可执行的分支指导

Share Text 保留“先调用 status”的状态检查步骤，但不再要求对 `not_ready` 循环调用 status。它会区分两种情况：远端提示符尚未就绪时由用户先完成 SSH/嵌套 Shell 交互；提示符已就绪时直接调用 `synapse_execute`，并在返回 `SESSION_NOT_READY` 时停止盲目重试、等待交互稳定后再重新提交。

### 3. MCP tool description 与运行时 guidance 对齐

`synapse_status` 的工具说明会直接标注“只读、不写终端、不触发 Probe”，并说明 `not_ready` 的下一步由 `synapse_execute` 负责。这样即使外部客户端没有完整使用 Share Text，也能从工具元数据获得正确的调用顺序。

## Risks / Trade-offs

- [外部客户端仍只轮询 status] → status 和 Share Text 同时明确“轮询不会触发 Probe”，并用稳定的 `SESSION_NOT_READY` 指导客户端停止盲目重试。
- [用户在 SSH 登录尚未完成时提交 execute] → Probe 仍然先行；Probe 无法识别时只返回 `SESSION_NOT_READY`，用户命令不写入 PTY。
- [外部客户端误以为 not_ready 是 Session 失效] → guidance 明确区分 `not_ready` 与 `expired`，并保留 current PTY environment 摘要。
- [文案与执行实现再次漂移] → 增加 Share Text、MCP tool description 和 pipeline status guidance 的断言，并用 OpenSpec delta 固化协议语义。

## Migration Plan

1. 先补 Share Text 和 `synapse_status` guidance 的失败测试。
2. 更新运行时 guidance、MCP tool description 和 Share Text。
3. 运行 MCP、ShellProbe、CommandExecutor、Renderer 与 E2E 回归。
4. 同步主规格并归档 Change。

现有外部客户端无需修改认证或命令格式；只需停止对 `synapse_status` 的无效轮询，在远端提示符就绪后提交原文命令。

## Open Questions

无。`synapse_status` 保持只读，执行前 Probe 保持固定明文且由 Synapse Term 管理。
