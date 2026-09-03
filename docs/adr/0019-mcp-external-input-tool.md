# ADR-0019：MCP 交互事务与外部输入

状态：已接受

## 决策

外部客户端需要驱动 stdin 时，必须通过显式的交互事务协议完成，而不是把任意输入附加到结构化命令执行上。新增 `synapse_start_interactive` 建立交互事务，`synapse_input` 在绑定的有限输入授权内写入，`synapse_finish_interactive` 在调用方确认程序回到 Shell 后单独发送完成 Probe；`synapse_execute` 保持现有结构化完成语义和已知交互命令拒绝。交互入口仍执行字面 Shell 审计、保留标记检查和 Shell 方言校验，但允许结构化入口因交互性质而拒绝的 command。

交互启动只写命令，不把完成 Probe 拼在命令后面；只有 `write()` 正常返回、表示本地 PTY 后端接受了启动写入调用后才返回 transactionId。交互事务持有 Session 外部租约，公开状态仍只有 `running`、`completed`、`interrupted` 和 `unknown`，内部 `finishing` 不扩展公共状态。finish、interrupt、空闲超时、用户输入、PTY 断开和 Sharing 清理都必须有明确且不可自动重放的终态语义。

如果启动写入调用已经开始，之后 `write()` 抛错，或后端无法判断启动 command 是否已经交付，服务端返回 `INTERACTIVE_START_WRITE_UNKNOWN`，不返回 transactionId 或 inputGrantId，不创建客户端可操作的事务；当前 PTY environment 立即失效，capability epoch 和 executionContextId 轮换，未使用授权撤销，交互租约释放。command 可能已经部分写入或执行，系统不得自动重试，外部客户端必须先重新 observe 并由用户判断后续动作。短生命周期的内部 attempt/tombstone 只能用于清理和并发处理，不得持久化。

输入授权独立于审批结果：`synapse_execute` 不提供后续 stdin 输入能力，预期会读取 stdin 的命令必须走交互入口；交互事务由调用方显式选择 `one_shot` 或 `bounded` 输入授权档位，并获得绑定 Session、事务、调用方和用途的有限能力。`allow_once` 仍只批准当前启动调用及其明确选择的档位，不产生未声明的无限后续输入权限；`allow_session` 只记忆完整 command、执行模式和授权模式，且每次命中都签发新的有限授权。每次输入使用调用方生成的 `inputRequestId` 去重，重试先查询去重记录；记录只保存规范化 payload 的 SHA-256 摘要和已脱敏结果摘要，避免网络重试重复发送密码或按键，也避免在内存中保留密码原文。

交互启动一旦成功就授予后续 PTY 写入能力，因此 `managed` 下按长期可写入能力处理；未命中同一完整授权键的会话内放行时需要审批。结构化 `synapse_execute` 仍沿用 ADR-0015 的风险矩阵，低危调用可以自动放行。

输入只允许可打印文本、换行和固定 xterm normal-mode 特殊键；服务端先规范化、检查 UTF-8 字节/按键/合并 payload 上限，再以一次有序 PTY 写入提交。工具响应只返回发送元数据、输出窗口和游标，不回显文本原文；这不承诺 PTY 回显、终端 UI、Sharing 输出历史或审批卡片不会显示秘密。

## 理由

现有 `ShellDriver` 会把命令和完成 Probe 合并为一次写入。对 `sudo`、编辑器、SSH 或 REPL，目标程序可能先消费 Probe，使系统既无法获得完成证据，也无法可靠判断后续输入属于哪个状态。把 Probe 延后到显式 finish，才能保留完成证据协议而不把诊断输入送进交互程序。

独立的交互入口让结构化执行继续拥有“成功响应对应可验证完成路径”的不变量。有限输入授权和 requestId 去重则把交互所需的连续写入能力与一次审批明确区分，避免一条获批命令变成当前 Shell 的无限追加权限。终结后强制失效 PTY environment，是因为交互过程可能进入嵌套 Shell、SSH、容器或改变工作目录，旧环境验证不能继续复用。

## Consequences

- MCP 工具面从五个增加为八个，调用方需要理解 start -> input/observe -> finish 的生命周期。
- 交互终结依赖调用方观察到 Shell 提示符；过早 finish 可能进入 `unknown`，系统不自动重试。
- 本地用户输入始终可用；它会使活动交互事务进入 `unknown`，但不会被外部租约阻止。
- `TerminalBackend.write()` 没有交付回执；正常返回只能说明本地后端接受了写入调用，不能证明远端程序消费了全部字节。启动写入异常或交付不确定时使用 `INTERACTIVE_START_WRITE_UNKNOWN` 并清理句柄，不自动重试。
- 固定键编码不协商 application cursor/keypad 模式；需要其他方言时必须新增显式协议，不能开放原始转义序列。
