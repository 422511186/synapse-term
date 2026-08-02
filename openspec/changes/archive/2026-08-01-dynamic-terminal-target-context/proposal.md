## Why

Agent 当前可能只知道终端使用 `bash`/POSIX 语法，却不知道 PTY 实际位于 Windows Git Bash、Linux、macOS 或 SSH/容器切换后的远端环境，因此会生成 `free -h` 等平台不兼容命令。执行失败后，审批事件、Tool 结果和历史恢复又可能被错误合并，导致同一命令再次出现审批卡片，用户点击已失效卡片时收到 `Approval is no longer pending`。

现有规格已经要求维护当前 PTY environment 和 capability epoch，但运行时尚未把这条事实链路完整接入模型上下文、命令选择、审批和桌面时间线，需要尽快补齐以避免错误命令和误导性授权交互。

## What Changes

- 为当前 PTY 建立可信、动态且带 freshness/epoch 的执行环境上下文，至少区分操作系统、平台、Shell dialect 和 capability epoch；不把 SSH/容器连接拓扑建模为独立事实源。
- 在首次结构化执行、环境 epoch 失效或用户通过 SSH/容器/嵌套 Shell 改变当前目标后，重新执行有界的只读环境与能力 Probe。
- 将当前已验证的环境摘要传递给模型，并让资源监控和平台相关命令依据当前目标选择；环境未知时 fail closed 并返回结构化诊断结果。
- 将 Approval Grant 绑定到精确 Tool Call、命令文本和当前 environment capability epoch，避免旧目标或已结束审批继续可操作。
- 修复审批事件、Tool 事件和历史恢复的时间线去重与状态合并，确保执行失败后不会显示重复/过期审批按钮，也不会因旧审批卡片触发误导性错误。
- 增加 Windows Git Bash、Linux/macOS、SSH/容器切换、命令不可用、执行失败和重复审批回归测试。

## Capabilities

### New Capabilities

- 无

### Modified Capabilities

- `agent-execution`: Agent 结构化执行必须使用当前已验证的动态环境上下文，并在不可用命令或环境失效时停止猜测和重复调用。
- `terminal-sessions`: 当前 PTY environment、平台/方言能力和 capability epoch 必须在 SSH、容器、接管及重连等目标变化后重新验证并供执行链路使用。
- `terminal-safety-audit`: 审批和执行授权必须绑定当前目标环境，命令能力验证失败不得产生无效审批或新的副作用。
- `desktop-terminal`: 审批卡片必须与唯一审批生命周期关联，完成、取消、过期或执行失败后不可继续操作，且时间线不得显示重复状态卡片。

## Impact

- Core：环境 Probe、Session environment 状态、Agent context、ToolGateway/Approval 生命周期、资源命令选择和审计字段。
- Desktop：Agent timeline 的 live/history 合并、审批按钮可操作状态和失败提示。
- 测试：Core 的 shell/session/agent/policy 测试，以及 Desktop timeline/approval 测试；不新增外部依赖或连接拓扑领域模型。
