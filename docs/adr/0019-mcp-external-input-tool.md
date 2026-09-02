# ADR-0019：MCP 外部输入工具 synapse_input

状态：已接受

## 决策

新增第六个外部工具 `synapse_input`：外部客户端向已共享 Session 的 PTY 写入交互输入（可打印文本与白名单特殊键），覆盖三类场景——外部事务执行中补输入（`sudo` 密码）、驱动交互式程序（`vim`）、键盘导航（堡垒机菜单方向键）。

### 单工具双模式

`transactionId` 参数可选，一次调用只处于一种模式：

- **事务内输入**：传入 `transactionId` 时，输入挂靠该进行中的外部事务，语义是帮助事务收敛。前提与 `synapse_interrupt` 相同：租约 + 事务存在且未终态；不校验、不轮换 `executionContextId`，不递增 `capability epoch`（事务收敛依赖系统内部完成探针，不依赖 Agent 手上的标记）。
- **自由输入**：不传 `transactionId` 时为纯键盘模拟，必须传 `expectedContextId`；校验通过才写入，写入后轮换 `executionContextId` 并保守递增 `capability epoch`。系统无法区分自由输入里的方向键与 `cd` 命令，宁可让完成探针重跑，也不假设环境未变。

### execute 的交互式拒绝保持不变

静态识别的交互式命令（`vim`、`ssh`、`top` 等）继续被 `synapse_execute` 以 `INTERACTIVE_COMMAND_UNSUPPORTED` 拒绝；交互式程序一律由 `synapse_input` 自由模式启动并驱动。`synapse_execute` 保持"可验证完成"的强语义不被稀释。

### 审批分级

- 事务内输入继承原事务的审批结果：`sudo su` 已按 `privileged` 过审批，其密码输入是同一事务的延续，不再二次审批。
- 自由输入：`read_only` 拒绝；`managed` 走审批卡片且待发内容明文展示（与 `execute` 展示命令原文一致，遮蔽会让用户无法判断批的是什么）；`full` 放行。

### 输入内容

- `text`：原样键入的可打印字符序列，`\n` 规范化为 PTY 惯例的 `\r`；需要回车由调用方自带 `\n` 或 `keys:["enter"]`。
- `keys`：封闭白名单枚举，共 26 键——`up / down / left / right / enter / esc / tab / backspace / delete / home / end / pageup / pagedown / space / f1`–`f12`。拒绝任意转义序列与原始字节注入，防止绕过输出脱敏与控制序列攻击。
- `text` 与 `keys` 可同传，写入顺序为先文本后按键。`ctrl` 组合键暂不支持（`ctrl+c` 已由 `interrupt` 覆盖）。

### 响应

- 响应体不回显 `text` 原文（防止密码进入外部客户端的日志与会话记录），只返回 `sent` 元数据：`{ textLength, keys }`；键名不是秘密，可回显。
- 附带固定短窗口的即时输出与新输出游标，复用「即时输出」「输出分页」语义；自由模式额外返回新的 `executionContextId`。
- Agent 的输入在本地终端 UI 自然回显可见——可监督性是特性，不做遮蔽。

### 发现机制

不引入"终端正在等待输入"的主动信号。系统只提供输出事实（`execute`/`wait` 的即时输出、`observe` 分页），"终端在等什么"由 Agent 阅读输出判断；识别 `password:` 提示、菜单、编辑器界面属于 LLM 的强项，正则启发式只会脆弱。

## 理由

三种输入场景对 Agent 是同一个心智动作——"往终端里打字或按键"——拆成多个工具会迫使 Agent 先判断模式归属，因此单工具双模式。事务内输入不碰执行上下文，是因为它与 `interrupt` 同构：都是向存活事务的 PTY 写入，事务终态由系统探针决定；而自由输入照抄 `execute` 的写入纪律（先观察、校验、写后轮换），延续 ADR-0018 的乐观并发防护。自由输入保守递增代际的代价是 Agent 每次自由输入后需重新 `observe`，这恰好匹配"看一眼菜单再按一次键"的导航节奏。响应不回显原文、键白名单封闭枚举，都是把密码泄露与注入攻击的口子关在协议层而不是调用方自觉。

## 影响

- `CONTEXT.md`：「交互式命令」词条从"应由用户在本地完成交互"改写为"由外部输入工具驱动"；新增「外部输入」「事务内输入」「自由输入」词条。
- 错误码：新增 `TRANSACTION_NOT_FOUND`、`TRANSACTION_NOT_ACTIVE`（事务内模式）；自由模式复用 `EXECUTION_CONTEXT_REQUIRED` / `EXECUTION_CONTEXT_STALE`；`read_only` 拒绝复用现有路径。
- 租约：两种模式均经会话租约串行化，与 `execute` / `interrupt` 跨工具互斥。
- 完成探针与事务状态机不受影响：事务内输入后事务照常收敛或维持 `running`。
- 本地用户输入优先级不变：用户先按键即导致自由输入前提失效；用户输入打斷事务仍按既有语义处理。
