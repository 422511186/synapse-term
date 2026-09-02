## Context

MCP 端点现有五个 `synapse_*` 工具（`apps/desktop/src/main/mcp/mcp-tools.ts` 注册，`external-tool-pipeline.ts` 实现管线，`mcp-controller.ts` 分发）。执行链路为：execute 校验 `executionContextId`（ADR-0018）→ Probe → 风险分类 → 审批 → `CommandExecutor` 经 `SessionActor.writeExternal` 写入 PTY 并轮换上下文。`SessionActor` 现有三条写入路径：`writeUser`（UI 输入，使环境失效 + 事务转 `unknown`）、`writeProbe`（裸写）、`writeExternal`（校验 epoch + contextId 后写入并轮换）；所有写入经 `#enqueue` Promise 链串行。`ExternalLeaseRegistry.acquire` 对同一 caller 可重入（`synapse_interrupt` 已依赖此行为在事务存续期写入）。静态识别的交互式命令（vim、ssh 等）被 `INTERACTIVE_COMMAND_UNSUPPORTED` 拒绝，导致 Agent 无法闭环 sudo 密码、vim 编辑、堡垒机菜单导航三类场景。决策依据与领域词条见 ADR-0019 与 `CONTEXT.md`（外部输入 / 事务内输入 / 自由输入）。

## Goals / Non-Goals

**Goals:**
- 新增 `synapse_input` 工具：向已共享 Session 的 PTY 写入交互输入（可打印文本 + 白名单特殊键），覆盖三场景。
- 单工具双模式：事务内输入（挂靠进行中事务，如 sudo 密码）与自由输入（纯键盘模拟，如 vim、菜单导航）。
- 与现有会话管理机制兼容：串行队列、租约、执行上下文 ID、能力代际、完成探针、输出脱敏均不被破坏。
- 响应不泄露输入原文（防密码进入外部客户端日志）。

**Non-Goals:**
- 不放宽 `synapse_execute` 对交互式命令的拒绝（`INTERACTIVE_COMMAND_UNSUPPORTED` 保留）。
- 不支持 ctrl/alt 修饰键组合（`ctrl+c` 由 interrupt 覆盖，有真实需求再扩展）。
- 不提供"终端正在等待输入"的主动信号或输出空闲检测参数（发现靠 Agent 阅读输出）。
- 不做输入内容的启发式风险分类（内容无法静态分类，按模式分级审批）。
- 不引入 vim / 堡垒机菜单的程序语义识别。

## Decisions

**D1：单工具 `synapse_input`，`transactionId` 可选区分双模式。**
三场景对 Agent 是同一心智动作（"往终端打字或按键"）；拆成 `synapse_respond` + `synapse_send_keys` 两工具会迫使 Agent 先判断模式归属。备选：放宽 `synapse_execute` 让它驱动交互——不采用，会稀释"可验证完成"的强语义与完成探针契约。

**D2：事务内输入的前提语义照抄 `synapse_interrupt`——租约重入 + 事务存活，不校验/不轮换执行上下文 ID，不递增能力代际。**
事务收敛依赖系统内部探针（`osc_777` 完成帧），不依赖 Agent 手上的标记；`interrupt` 已验证"向存活事务的 PTY 写入"这一模式。`CommandExecutor` 新增 `respond(transactionId, payload)` 返回 `written / not-found / not-active` 三态（`not-active` 对应新错误码 `TRANSACTION_NOT_ACTIVE`，覆盖 dispatch 未写入的极短窗口，可安全立即重试）。

**D3：`SessionActor` 新增两个写入方法，不复用现有任何一个。**
`writeExternalInput(data)`：仅检查 running 后裸写（实现同 `writeProbe` 但语义独立命名，避免探针演进波及输入通道）。`writeExternalFreeform(data, expectedContextId)`：校验 contextId → `#invalidateEnvironment()`（代际递增 + contextId 轮换 + 发事件）→ 写入 → 返回新 ID。备选：自由输入复用 `writeUser`（不校验 contextId，外部输入必须先证明确实观察过）或 `writeExternal`（不递增代际，无法区分方向键与 `cd`）——均不满足"校验 + 失效"的并集语义，故新增。

**D4：自由输入保守递增能力代际，事务内输入不递增。**
系统无法从内容区分方向键与 `cd /tmp`，宁可让探针重跑也不赌环境未变；代价是 Agent 每次自由输入后须从响应取新 contextId（或重新 observe），与"看一眼菜单再按一次键"的导航节奏天然匹配。事务内输入发生在事务存续期，环境事实由事务自身的收敛路径管理。

**D5：审批按模式分级：事务内继承原事务审批结果；自由输入 read_only 拒绝 / managed 一律弹卡 / full 放行。**
`sudo su` 在 execute 阶段已按 `privileged` 过人工审批，密码输入是同一事务的延续，二次弹卡只会再暴露一次已到达 Agent 的凭据。自由输入内容无法静态分类，managed 下一律走审批卡片并明文展示待发内容（与 execute 展示命令原文一致，遮蔽会让用户无法判断批的是什么）；`ApprovalRequest.command` 放输入的可读表示（text 原文 + 键序列），`risk: 'unknown'`；会话内放行按该表示串精确匹配，方向键等重复导航放行一次后不再弹卡，密码类内容每次不同天然不命中。备选：内容启发式分类——不可行，密码与普通文本无可靠特征。

**D6：`keys` 封闭白名单 26 键 + `text` 控制字符只放行 `\n`。**
白名单：up/down/left/right、enter、esc、tab、backspace、delete、home、end、pageup、pagedown、space、f1–f12，按 xterm 惯例映射转义序列（与内嵌 xterm.js 一致）。拒绝任意转义序列与原始字节，把注入与绕过脱敏的口子关在协议层。`text` 中 `\n` 规范化为 `\r`；回车由调用方自带 `\n` 或 `keys:["enter"]`；`text` 与 `keys` 可同传，先文本后按键。

**D7：响应只含元数据 + 即时输出窗口 + 新游标，不含 `text` 原文。**
`sent: { textLength, keys }` + 固定短窗口（约 300ms 服务端常量，不做成参数）内从 `SharingOutputHistory` 读取的增量输出（append 时已过 SecretRedactor，自动继承脱敏）+ `nextCursor`（语义同 observe）+ 自由模式返回轮换后的 `executionContextId`。窗口为空不代表失败，兜底走 observe。备选：响应回显原文便于调试——不采用，密码会进入外部客户端日志与会话记录。

**D8：租约生命周期两模式不同；自由输入遇活动事务拒绝。**
事务内输入经同 caller 重入获取租约后**不清除**（由既有 `finished` 事件回调在事务收敛时清除，与 interrupt 终结后清除不同）；自由输入独立获取、finally 清除。自由输入前若存在活动事务，以 `SESSION_BUSY` 拒绝并指引改带 `transactionId`——防止自由输入把活动事务打成 `unknown`，同时帮 Agent 纠正模式误用。

**D9：调用契约（三场景标准序列，工具描述同步写明）。**
- sudo（事务内）：`observe` → `execute "sudo su -"`（即时输出见密码提示）→ `input { transactionId, text: "<密码>\n" }` → `wait` 收敛。
- vim（自由）：`observe` 取 C1 → `input { expectedContextId: C1, text: "vim notes.txt\n" }` → 响应含 C2 → 后续每次 `input` 携带最新 ID（`:wq` + `keys:["enter"]` 退出）。
- 堡垒机菜单（自由）：`observe { tail: true }` → `input { keys: ["down","down"] }` → `input { keys: ["enter"] }`，每步从响应取新 ID。

## Risks / Trade-offs

- [自由输入 + managed 下密码明文出现在审批卡片] → 本机单用户边界（ADR-0013）内接受，ADR-0019 已明示；主路径（sudo）走事务内模式不弹卡。
- [慢速链路下 300ms 即时输出窗口为空] → 非失败语义，Agent 兜底 `synapse_observe`；若实践频繁，后续为 `synapse_wait` 增加"输出空闲提前返回"参数（独立演进，不绑定本变更）。
- [execute 事务期间 echo 抑制可能误吞 agent 输入的回显] → 仅当输入文本命中 echoPattern 的 nonce marker（UUID 片段）才发生，概率可忽略；sudo 自身关闭密码回显，主路径无暴露。
- [F 键序列平台差异] → 按 xterm 惯例映射，与产品内嵌 xterm.js 回显侧一致；对端程序若期望其他方言属目标程序行为，不在本层补偿。
- [Agent 忘带 `\n` 导致输入滞留行缓冲] → 工具描述明确"需要回车请带 `\n` 或 `keys:["enter"]`"；即时输出窗口通常能暴露"命令未提交"的迹象。

## Migration Plan

纯新增工具，无协议破坏：旧客户端不调用 `synapse_input` 即不受影响；`MCP_TOOL_NAMES` 扩展对既有五工具的 schema 与行为零改动。spec 同步点：`openspec/specs/mcp-access/spec.md` 的 Synapse Tool Surface 与 Stable External Error Codes 两条需求按 delta 更新。回滚：移除工具注册与管线分支即可，无状态残留（事务内输入不留痕于事务状态机）。

## Open Questions

无。
