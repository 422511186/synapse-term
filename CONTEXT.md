# Terminal Agent 上下文

本上下文描述一个本地终端系统：Agent 通过一个已经准备好的交互式终端，以自然语言目标执行任务。远程连接拓扑不属于本上下文。

## 语言

**Terminal Session（终端会话）**:
一个长期存在的交互式终端上下文，由输入流、输出流、终端状态和历史构成；与它的 shell 如何到达远程环境无关。
_Avoid_: SSH 会话、服务器连接

**Session Alias（会话别名）**:
用户在桌面端为 Terminal Session 看到和编辑的可读名称，用于识别和切换，不承担唯一身份；别名可以使用默认编号、被重命名或与其他 Session 重复。
_Avoid_: Session ID、唯一名称、服务器名称

**Ready Session（就绪会话）**:
用户已将其带到可用 shell 状态、并显式提供给 Agent 的终端会话。
_Avoid_: 已连接服务器、已认证端点

**Agent Task（Agent 任务）**:
Agent 在同一时间通过恰好一个就绪会话追求的自然语言目标。
_Avoid_: Agent 会话、聊天会话

**Suspended Task（挂起任务）**:
保留其历史和会话关联、但在满足既定恢复条件前不得发起新的模型轮次或命令事务的 Agent 任务。
_Avoid_: 失败任务、已取消任务

**Provider Profile（Provider 档案）**:
一个可复用的模型服务连接，包含支持的协议、端点、凭据引用、请求头和超时；它不标识具体模型，密钥凭据值不属于档案本身。
_Avoid_: 模型配置、模型账户、API 密钥配置

**Model Configuration（模型配置）**:
一个可被 Agent 选择的具名模型条目，引用一个 Provider 档案，并定义模型 ID、上下文限制、声明能力、校验状态和是否启用；一个 Provider 档案可支持多个模型配置。
_Avoid_: Provider 档案、端点配置、裸模型 ID

**Discovered Model（发现的模型）**:
Provider 模型列表端点返回的已脱敏模型标识和可选展示元数据；它只是导入候选，在创建、校验并启用模型配置之前不会成为可选择的 Agent 模型。
_Avoid_: 模型配置、可用模型

**Agent Model Selection（Agent 模型选择）**:
Agent 任务启动时绑定的不可变模型配置修订版和已解析的 Provider/模型快照；后续的配置编辑、禁用或删除都不会改写该任务的历史。
_Avoid_: 当前模型、Provider 选择

**Session Lease（会话租约）**:
由用户或 Agent 任务持有的、向终端会话发送输入的排他权利；用户可随时撤销 Agent 持有的租约。
_Avoid_: 输入锁、终端锁

**Observation Context（观察上下文）**:
显式调用 Agent 时向其披露的当前终端屏幕和有限范围的近期历史。
_Avoid_: 完整记录、持续监控

**Protected Input（受保护输入）**:
因可能包含密码或其他密钥而被有意排除在 Agent 上下文、输出日志和审计载荷之外的终端输入。
_Avoid_: 隐藏文本、掩码命令

**Command Transaction（命令事务）**:
一次由 Agent 发起的 shell 操作，包含明确的输入、流式输出、完成证据和（可用时的）退出结果。
_Avoid_: 裸命令、PTY 写入

**Interactive Control（交互控制）**:
当终端程序需要按键级交互而非有界命令事务时使用的会话租约模式。
_Avoid_: 命令执行

**User Takeover（用户接管）**:
将会话租约从挂起的 Agent 任务显式转移给用户，让用户先完成一次交互式或敏感交换，再交还控制权。
_Avoid_: Agent 取消、终端解锁

**Detached Session（脱离会话）**:
桌面 UI 当前未连接、但仍存活的终端会话；其 PTY、输出序列和所有权状态继续由本地 Core 管理，直到会话被显式终止。
_Avoid_: 已关闭会话、后台连接

**Approval Grant（审批授权）**:
用户对一个终端会话上精确有序命令集的授权；任何命令编辑、插入、重排或目标变更都需要新的授权。
_Avoid_: 永久权限、一揽子审批

**Audit Record（审计记录）**:
对 Agent 或用户操作的不可变结构化记录，包括谁发起的、针对哪个会话、适用了什么授权、观察到了什么结果；它不意味着保留完整终端字节流。
_Avoid_: 终端录制、转录

**Permission Mode（权限模式）**:
用户为单个 Agent Conversation 选择的审批策略：手动审批、普通变更自动审批、或不再提示审批；它绝不扩大可用工具集或文件系统边界。
_Avoid_: 沙箱模式、管理员模式

**Context Budget（上下文预算）**:
配置的模型上下文窗口减去预留的输出和工具余量，用于决定多少对话历史可以进入一次模型运行。
_Avoid_: 消息上限、记录大小

**Conversation Compaction（对话压缩）**:
对较旧的结构化对话条目的持久化摘要，用其替换未来模型上下文中的这些条目，同时保留原始审计和历史记录。
_Avoid_: 删除历史、清空聊天

**Session Resource Snapshot（会话资源快照）**:
通过当前就绪会话获取的 CPU、内存、磁盘、网络、主机和运行时间的即时只读观察。
_Avoid_: 服务器资产、被监控主机

**External Caller（外部调用者）**:
平台 Agent Conversation 模型之外的客户端——例如通过 MCP 端点接入的 Codex——通过提供会话 id 对共享会话调用能力。外部调用不携带 Agent 任务或轮次；审计将其绑定到调用者身份和目标会话。
_Avoid_: MCP 客户端、远程用户、外部 Agent 任务

**Shared Session（共享会话）**:
用户已显式复制其标识并披露给外部调用者的终端会话。只有共享会话可被外部调用寻址，调用者无法枚举或发现其他会话。
_Avoid_: 暴露的会话、开放会话

**External Client Permission（外部客户端权限）**:
应用于外部调用者工具调用的审批策略，在桌面设置中配置：read-only（读操作自动放行、写操作拒绝）或 managed（低危自动放行、高危拒绝）。需要人工决定时复用现有审批 UI，批准授予同一条命令单次执行许可（approved_once），执行后即失效；高危操作永远不能被配置为放行。
_Avoid_: 权限模式（仍按 Agent Conversation 生效）、MCP 规则集

**Agent Driver（Agent 驱动者）**:
运行 Agent Conversation 推理循环的组件：内置 Agent 或外部 ACP Agent。模型选择只适用于内置驱动者；外部驱动者的模型不在平台配置范围内。
_Avoid_: Agent 适配器、模型 Provider

**External Agent Process（外部 Agent 进程）**:
平台以 ACP 模式启动的、用于承载外部 Agent 驱动者的长驻子进程。一个进程服务一个 Agent Conversation，且只能由显式用户动作启动。
_Avoid_: 插件、内嵌 SDK、worker

**Conversation Projection（对话投影）**:
平台对外部 Agent 对话的存储视图——用户文本、助手文本和工具调用摘要——用于展示、审计和恢复，而完整记忆由 Agent 自身持有。
_Avoid_: 记录副本、上下文存储
