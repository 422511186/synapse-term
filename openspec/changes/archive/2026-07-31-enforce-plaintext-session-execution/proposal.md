## Why

当前 ShellDriver 为保证交互式 PTY 传输稳定，会把命令事务编码为 Base64，再在目标 Shell 中解码并通过 `eval` 或 `ScriptBlock::Create` 执行；服务器侧堡垒机、会话录像、命令白名单和输入审计因此无法在执行前看到真实命令。与此同时，Session 的本地启动 Shell 不能代表 SSH、堡垒机、WSL、容器或嵌套 Shell 切换后的当前执行环境，错误方言会进一步注入不可读且不兼容的包装代码。

## What Changes

- 将 execution dialect 从“Session 创建时的本地 Shell 属性”收紧为 capability epoch 下经验证的“当前 PTY 会话环境能力”；本地启动方言只可作为未验证提示，第一次结构化写入以及人工输入、接管或环境切换后的下一次结构化写入都必须重新确认。
- 为 POSIX Shell 与 PowerShell 定义等价的明文命令事务协议，使原始命令、事务边界、退出码和 nonce 完成标记在写入 PTY 时均可读，同时继续保持当前 Shell 的目录、变量和函数状态。
- 对可安全内联的单行命令和 capability Probe 使用单个物理 PTY 输入行，避免把固定事务边界逐行回显；多行、here-doc、行尾注释或其他不能保持语义的命令不得为了压行而改写。
- 将资源刷新从一个超过交互 PTY 单行缓冲的巨型脚本改为一组短小、固定、只读的明文采集命令，逐条完成并汇总协议输出。
- 让 `terminal_execute`、Shell Probe、方言指纹、Session Resource 刷新及未来所有 Core 生成的 PTY 执行共用受控的明文 dispatch 边界，禁止旁路直接写入可执行载荷。
- 禁止 Base64、hex、压缩或其他编码载荷在目标 Shell 中解码后进入 `eval`、`Invoke-Expression`、`ScriptBlock::Create`、dot-source 或等价动态执行机制；非执行数据的编码、握手令牌和日志存储不受此限制。
- **BREAKING**：无法可靠识别当前环境、无法构造明文且语义等价的事务，或检测到不可审计执行载荷时，系统必须返回稳定的 `execution_environment_unverified` 或 `command_not_auditable` 错误并保持 observation-only，不得回退到 Base64 包装或猜测方言执行。
- 扩展结构化审计，记录命令来源、已验证方言、capability epoch、明文 transport 模式、命令哈希和拒绝原因；增加生产执行入口清单及静态/运行时测试，防止新增不可审计路径。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `terminal-sessions`: 将当前执行环境识别、方言验证、capability epoch 失效与 observation-only 降级定义为 Session 级契约，不再把本地启动 Shell 当作执行依据。
- `agent-execution`: 要求全部结构化 Shell 操作使用明文、保持状态且具有确定完成事件的跨 POSIX/PowerShell 事务协议，并在无法安全封装时拒绝执行。
- `terminal-safety-audit`: 增加服务器侧可审计执行不变量、统一执行入口、编码后动态执行禁令以及 transport/dialect 拒绝证据。

## Impact

- Core：`shell-driver.ts`、`shell-probe.ts`、`command-executor.ts`、`plaintext-dispatcher.ts`、`session-resource-service.ts`、`session-resource-parser.ts`、`session-actor.ts`、ToolGateway 和审计服务。
- Domain/Protocol：Session execution environment 状态、capability epoch、稳定错误码、Tool/资源刷新结果与审计 payload schema。
- Desktop：当前环境/仅观察状态和不可审计拒绝原因的显示；本地 Shell 选择仍用于启动进程，但不再作为远端执行方言的最终事实源。
- 测试与验证：捕获真实 Fake PTY/ConPTY 输入，覆盖 PowerShell 经 SSH 进入 POSIX、POSIX 进入 PowerShell、嵌套 Shell/容器切换、首次执行、人工输入失效、资源刷新和所有生产进程/PTY 执行入口；断言原命令可见且不存在编码后动态执行。
- 不新增运行时依赖；现有 Base64 握手、认证、日志和非执行数据序列化可保留，但必须证明其内容不会流入命令执行器。
