# Synapse Term

本地优先的桌面终端。用户在应用内准备本地 Shell、SSH、跳板机、容器或 WSL 终端会话；应用持有 PTY 与实时输出，并可通过内嵌 MCP Server 把已共享会话的能力提供给本机外部客户端。

## Language

### 终端与会话

**会话（Session）**:
一个由应用持有的 PTY 终端实例，具有独立生命周期。
_Avoid_: 标签页、连接

**共享（Sharing）**:
用户通过复制会话 ID 把某个会话显式开放给外部客户端的动作；未共享的会话对外部客户端不存在。
_Avoid_: 发布、暴露、连接

**共享文本（Share Text）**:
执行共享时写入剪贴板的预置提示词块：包含会话 ID、可用工具清单与连接前提说明，供用户整段粘贴给外部客户端；另提供仅复制裸 ID 的次级动作。
_Avoid_: 分享链接、邀请码

**Sharing 输出边界（Sharing Output Boundary）**:
当前外部客户端只能读取本次 Sharing 开始之后的 Session PTY 输出历史；取消 Sharing 或 Session 重新 Sharing 会建立新的边界，边界之前的内容不对外回放。
_Avoid_: Session 全量回放、审计日志

### MCP 接入

**内嵌 MCP Server**:
运行于 Electron Main、只监听本机回环地址的 MCP 服务端，向外部客户端提供终端工具。
_Avoid_: MCP 客户端（那是对方的角色）、远程端点

**外部客户端（External Client）**:
通过 MCP 连接本应用的本机程序（如 Codex）。
_Avoid_: Agent、AI 助手

**外部调用（External Call）**:
外部客户端经 MCP 发起的单次工具调用，必须携带已共享的会话 ID。
_Avoid_: 远程请求

**外部事务（External Transaction）**:
外部客户端针对一个已共享 Session 发起的一次命令执行尝试；命令被接受写入 PTY 后，必须以可验证的完成、确认的中断或结果不可确认的终态结束。
_Avoid_: 外部请求、远程任务

**PTY 中断（PTY Interrupt）**:
外部客户端通过当前 Session 的 PTY 发起的中断输入；其结果只说明本地 PTY 是否收到中断以及外部事务是否取得可验证终态，不说明远程进程或进程组是否已终止。
_Avoid_: 远端杀进程、进程终止确认

**交互式命令（Interactive Command）**:
需要持续读取交互输入或不会返回当前 Shell 提示符的命令；明确识别为此类的命令不适合结构化外部执行，应由用户先在本地 PTY 中完成交互，并以 `INTERACTIVE_COMMAND_UNSUPPORTED` 拒绝。无法静态判定的命令不因此被视为交互式命令，而按风险分类和完成证据结果处理。
_Avoid_: 远程会话、后台任务

**事务不确定态（Unknown Transaction State）**:
外部命令可能已经写入并执行，但系统未获得可靠完成证据的事务终态；用户输入干扰、PTY/连接断开或完成探针丢失都可能导致该状态。它不等同于失败或中断，不能自动重新提交，必须要求用户判断后续动作。
_Avoid_: 执行失败、已取消

**事务等待超时（Transaction Wait Timeout）**:
单次 `synapse_wait` 调用达到等待时限而返回当前事务快照的结果；它不改变外部事务状态，运行中的事务仍可继续等待、观察或中断，也不等同于事务不确定态。
_Avoid_: 命令超时、事务取消

### 权限与审批

**审批模式（Approval Mode）**:
外部调用的基础策略档位，共三档：`read_only` 只放行观察类调用；`managed` 额外自动放行低危调用，其余交由人工审批；`full` 不做风险审查全部放行。配置缺失或损坏时回退 `read_only`。
_Avoid_: 权限等级、安全模式

**审批卡片（Approval Card）**:
高危外部调用触发的同步人工确认界面；一次批准只对当次调用生效，超时视为拒绝。
_Avoid_: 弹窗、确认框

**会话内放行（In-session Grant）**:
审批卡片上可授予的会话范围记忆：同一命令全文在本会话内的后续调用自动通过，随会话关闭而消失，不持久化。
_Avoid_: 白名单、永久授权

**风险分类（Risk Class）**:
基于外部命令原文和已验证的当前 PTY 环境进行的保守判断，分为 `read_only`、`mutating`、`privileged`、`destructive` 和 `unknown`；分类应同时说明置信度、判定原因与是否需要审批，但不保证远程主机的真实权限或实际影响范围。
_Avoid_: 权限、严重度

### 当前 PTY 环境与诊断显示

**当前 PTY 环境（Current PTY Environment）**:
由当前 Session 的 PTY 通过固定 Probe 验证得到的 Shell 方言和平台事实；启动时的 Shell 提示只是 hint，环境变化后由 capability epoch 失效。
_Avoid_: 远程连接对象、SSH 连接、服务器资产

**能力代际（Capability Epoch）**:
绑定当前 PTY 环境验证的单调标记；用户输入或环境失效时递增，外部事务以提交时的能力代际校验写入资格，代际不匹配表示之前的环境验证已不能继续使用。它不表示主机编号、连接层级或传输代数。
_Avoid_: environment_generation、主机代数、连接 ID

**完成探针回显可见性（Completion Probe Echo Visibility）**:
只控制完成探针输入回显是否显示在本地终端 UI 的通用设置；不控制探针是否写入 PTY，也不承诺目标 Shell、SSH 或远程服务器审计设施不可见。
_Avoid_: 远程隐藏、审计关闭、禁发探针

**完成探针（Completion Probe）**:
由当前 Shell Driver 生成、用于取得外部事务完成证据的固定诊断输入；外部命令执行必须依赖它完成收敛，它不是用户命令，也不提供绕过目标 Shell、SSH 或远程服务器记录的能力。
_Avoid_: 隐藏命令、远程审计规避

**完成信息（Completion Metadata）**:
由完成探针的有效结果形成、提供给外部客户端的结构化事务信息，例如完成是否已确认和退出码；不包含 Probe 命令原文、输入回显或协议控制字符。
_Avoid_: Probe 输出、完成日志

**就绪原因（Readiness Reason）**:
描述当前 Session 尚不能接受外部调用的本地可观测原因，只涵盖 PTY 生命周期、当前 PTY 环境验证或用户接管等事实；本地诊断可包括 PTY 启动，外部状态主要使用环境未验证、Probe 进行中、Probe 失败和用户输入导致失效，不推断远程主机、连接方式或连接拓扑。
_Avoid_: 传输状态、主机状态

**输出游标（Output Cursor）**:
外部客户端定位某个 Session 可读输出历史位置的单调标记；Agent 可以将已获得的有效游标自由传入以分页读取指定位置之后的内容，读取不会消费或删除历史。它只在当前应用运行期、当前 Sharing 边界和该 Session 内有效，不跨 Session 或应用重启复用。
_Avoid_: 事务 ID、屏幕位置

**执行上下文 ID（Execution Context ID）**:
Agent 最近通过输出观察获得的当前 Session 执行前提标记；用户输入、外部事务提交或环境失效时变化，被动输出不使其变化。`synapse_observe`、`synapse_execute` 和 `synapse_wait` 可以返回当前标记，`synapse_execute` 必须回传该标记作为期望值，标记缺失或失效时不得写入 PTY，必须先重新观察当前终端内容并取得新的标记。它不等同于事务 ID 或输出游标。
_Avoid_: 事务 ID、输出位置、主机 ID

**执行前上下文冲突（Pre-execution Context Conflict）**:
外部客户端提供的执行上下文 ID 缺失或已失效，表示 Agent 观察到的终端前提不再是当前事实；此时外部命令必须在 PTY 写入前被拒绝，Agent 先重新观察当前终端内容后才能决定是否提交。
_Avoid_: 审批拒绝、Session 忙、执行失败

**执行前原子校验（Atomic Pre-execution Check）**:
执行上下文 ID 的校验与外部命令写入必须遵循同一 Session 的串行顺序；用户输入先到达则外部命令不得写入，外部命令先被接受则后续干扰按事务结果语义处理。
_Avoid_: 非原子检查、竞态放行

**执行前再验证（Pre-execution Revalidation）**:
外部调用在 Probe、人工审批等可能等待的阶段之后，必须再次确认执行上下文仍有效；上下文发生变化时只能停止在用户命令写入之前，不能把旧批准或旧 Probe 结果继续用于执行。
_Avoid_: 一次校验到底、旧上下文放行

**PTY 输出历史（PTY Output History）**:
当前 Session 在本次 Sharing 输出边界之后产生、按到达顺序保留并经过协议帧隔离和输出脱敏边界处理的可读终端输出，包括用户操作造成的普通回显与提示符；对外以清理后的文本提供，不包含未回显的原始按键、原始 PTY 字节流，也不等同于 ANSI 控制序列重绘后的屏幕内容。
_Avoid_: 屏幕快照、审计日志、持久化回放

**输出保留窗口（Output Retention Window）**:
当前应用运行期内某个 Session 可供输出游标读取的有限范围；游标早于该范围时，外部调用必须明确表示历史已截断，并提供可重新同步的最早位置。
_Avoid_: 完整日志、持久化归档

**输出分页（Output Pagination）**:
Agent 通过 `afterCursor` 指定读取起点，并可用页大小限制请求；首次读取可以省略起点，由服务端从当前 Sharing 边界内最早可读位置开始。服务端返回该页内容和下一位置，读取不会改变 Session 的输出历史。
_Avoid_: 消费队列、屏幕滚动

**输出尾部观察（Output Tail Observation）**:
Agent 可请求当前 Sharing 边界内最近一页可读 PTY 输出，用于执行上下文冲突后的快速复核；它不等同于屏幕快照，也不改变从最早位置开始的历史分页。
_Avoid_: 当前屏幕、全量回放

**即时输出（Immediate Output）**:
`synapse_execute` 或 `synapse_wait` 随事务响应返回的有限输出视图，只用于提供当前上下文；完整的 PTY 输出历史必须通过输出分页读取。
_Avoid_: 完整日志、屏幕快照

**事务输出范围（Transaction Output Range）**:
外部事务在 Session 输出历史中的起点和当前终点，由输出游标表示；它指向共享的 PTY 输出历史，不构成独立日志，也不改变输出分页的读取语义。
_Avoid_: 事务专属日志、屏幕范围

**输出截断状态（Output Truncation State）**:
`hasMore` 表示当前页之后仍有可读输出，`historyTruncated` 表示请求位置之前的历史已超出输出保留窗口且不可恢复；两者表达不同事实，不能合并为一个含义模糊的截断标记。
_Avoid_: UI 截断、失败状态
