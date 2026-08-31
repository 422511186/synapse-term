## Why

当前 MCP 外部调用虽然没有使用 Base64 或加密，但 `CommandExecutor` 会把用户命令放进 `eval`、变量赋值和完成帧包装器后再写入 PTY。目标机器的 SSH/PTY 录制、Shell history 或命令审计因此可能记录包装器，而不是用户实际要求执行的原始命令；`develop` 的 brace group 和 PowerShell dot-source 方案虽然去掉了编码，也仍然没有满足严格的字面审计要求。

## What Changes

- **BREAKING** 将外部命令执行协议改为字面 Shell 执行：用户提交的命令文本必须以原始形式进入目标 PTY，不得使用 `eval`、Base64、变量承载、brace group、dot-source、`bash -c` 或 `powershell -EncodedCommand` 包裹用户命令。
- 复用 `develop` 已验证的环境识别、Shell Driver、Session/外部调用者租约、命令安全校验和真实 PTY 测试思路，但重新定义执行 Driver 的审计契约。
- 将完成检测从用户命令包装器中拆出，使用独立、固定、可审计的 Shell 完成探针，并通过 Main 侧控制帧解析过滤探针噪声；探针不得改变用户命令的语义或隐藏用户命令。
- 外部调用的策略、审批、命令哈希和执行可见性继续针对原始命令工作；不满足字面审计约束的输入必须在写入 PTY 前被拒绝并返回可识别原因。
- 增加 POSIX/Git Bash 与 PowerShell 的真实 PTY 回归测试，验证目标 PTY 输入包含原始命令、不包含旧包装器，并验证退出码、输出、Shell 状态、控制帧隔离和中断行为。
- 补充 MCP `synapse_execute` 的契约说明，使外部客户端知道命令会以目标 Session 当前 Shell 的原始语法执行，且完成探针属于工具基础设施命令。

## Capabilities

### New Capabilities

- `literal-shell-audit`: 规定外部调用如何以字面 Shell 命令进入已共享 Session、如何传递独立完成探针、哪些输入不可审计，以及如何向目标机器和本地终端分别呈现命令与协议控制信息。

### Modified Capabilities

<!-- 当前仓库没有可直接修改的 MCP 主规格；已有 mcp-access 内容属于已完成 Change 的 delta。新能力单独建立契约，避免改写已完成 Change。 -->

## Impact

- `packages/terminal-service/`：新增或调整 Shell Driver、字面命令分发、完成帧解析与 SessionActor 控制帧隔离；保留同一 Session Shell 状态与 PTY 语义。
- `packages/domain/`：补充字面执行、审计性和稳定错误边界所需的公共类型或协议函数。
- `apps/desktop/src/main/mcp/`：让 `synapse_execute` 经过字面执行分发，并继续执行共享 Session、审批、租约和输出脱敏校验。
- `apps/desktop/src/renderer/`：不改变用户命令内容；仅确保完成探针和控制帧不污染终端视图，必要时补充执行方式提示。
- 测试：新增单元、协议、Git Bash/PowerShell ConPTY 集成和 MCP 外部调用回归覆盖。
- 不新增远程服务、账户、审计日志持久化或目标机器上的常驻安装项；目标机器审计仍由其 Shell、SSH、跳板机或操作系统审计设施负责。
