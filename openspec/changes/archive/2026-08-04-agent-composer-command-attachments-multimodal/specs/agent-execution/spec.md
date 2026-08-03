## MODIFIED Requirements

### Requirement: Restricted Terminal Tools
内置 Agent MUST 只能调用 `terminal.observe`、`terminal.execute`、`terminal.wait`、`terminal.interrupt` 以及有界附件文件工具 `local_list_files`、`local_search_files`、`local_read_file`；不得获得任意本机文件、浏览器或插件访问。本地文件工具 MUST 只能访问当前 Session/Agent 附件根目录及其子路径，不得因用户附件而扩大为任意路径访问。未知工具 MUST 被拒绝并记录协议错误。

#### Scenario: Model requests an unknown tool
- **WHEN** Provider 返回不在允许集合中的 Tool Call
- **THEN** AgentRuntime 拒绝执行并记录协议错误

#### Scenario: Agent reads a staged attached file
- **WHEN** 模型调用 `local_read_file` 且路径指向用户附件清单中的相对路径
- **THEN** ToolGateway MUST 返回文件内容，且路径被限制在附件根目录内

#### Scenario: Agent requests an absolute file path
- **WHEN** 模型调用 `local_read_file` 并传绝对路径
- **THEN** ToolGateway MUST 返回可恢复的 `invalid_tool_call`，不能读取附件根目录外的文件

## ADDED Requirements

### Requirement: Agent Attachment Submission
`agent.start` MUST 接受可选 `attachments` 列表，每个附件包含稳定 `id`、原始 `name`、`mimeType`、`sizeBytes`、`kind: 'image' | 'file'` 和本地 `sourcePath`。Core 启动 Agent Task 前 MUST 对附件数量、大小、MIME 和当前模型能力做统一校验；校验失败 MUST 拒绝整个任务并返回明确的分类错误。附件列表 MUST 与本次 Agent Turn 一起显示在历史中，重置对话后 MUST 释放对应附件上下文。

#### Scenario: Start task with image and file attachments
- **WHEN** 用户在 Composer 中加入一张图片和一个 PDF 文件后提交目标
- **THEN** Core 校验并接收两份附件，Task/Turn 历史保留附件元数据，模型消息包含图片内容块和文件清单上下文

#### Scenario: Too many attachments are rejected
- **WHEN** 用户提交超过 8 个附件
- **THEN** `agent.start` MUST 返回数量超限错误且不创建 Agent Task

#### Scenario: Oversized attachment is rejected
- **WHEN** 用户提交超过 50 MiB 的文件或超过 10 MiB 的图片
- **THEN** `agent.start` MUST 返回大小超限错误且不创建 Agent Task

### Requirement: Multimodal Upload Gate
包含 `kind: 'image'` 附件的 Agent 任务 MUST 只能使用声明支持多模态的可用模型；模型 `capabilities.multimodal` 不为 `true` 时，请求 MUST 被拒绝并返回 `multimodal_unsupported`。该门槛由 Core 在创建 Task 前执行，不能只依赖 Renderer 禁用按钮。

#### Scenario: Image attachment with multimodal model
- **WHEN** 当前模型 `capabilities.multimodal` 为 `true` 且用户提交图片
- **THEN** 任务正常创建，图片进入首个用户模型消息

#### Scenario: Image attachment with text-only model
- **WHEN** 当前模型 `capabilities.multimodal` 不是 `true`，用户仍尝试提交图片附件
- **THEN** Core 拒绝创建 Agent Task，返回 `multimodal_unsupported`，且不向 Provider 发送图片请求

### Requirement: File Attachment Context and Access
非图片附件 MUST 不直接把原始字节塞入模型消息；Core MUST 在创建 Task 时将每个文件附件放入本次附件根目录，并在模型上下文提供文件名、MIME、大小和相对路径清单。Agent MUST 通过 `local_read_file` 按相对路径读取文本文件；无法文本解码的文件 MUST 返回二进制不读，并停止 Agent 可读取的附件范围。

#### Scenario: Text file is attached and read
- **WHEN** 用户附加一个 UTF-8 文本文件并让 Agent 分析它
- **THEN** 模型上下文包含该文件路径元数据，Agent 可调用 `local_read_file` 读取内容并返回结论

#### Scenario: Binary file cannot be injected as text
- **WHEN** 用户附加二进制文件且模型尝试直接读取为文本
- **THEN** 系统 MUST 返回 `local_file_binary` 或等价错误，不能把二进制内容作为纯文本注入模型消息

### Requirement: Attached Content History
Agent 时间线 MUST 能回显图片附件和文件附件。图片历史项 MUST 使用本地/内存数据源渲染可用缩略图，文件历史项 MUST 展示名称、类型、大小和相对路径；所有附件历史 MUST 在对话重置后不再参与后续模型上下文。

#### Scenario: Timeline renders an uploaded image
- **WHEN** 用户消息包含图片附件且任务已启动
- **THEN** Timeline 在用户消息附近展示图片附件的预览，不依赖模型输出

#### Scenario: Timeline renders a file attachment
- **WHEN** 用户消息包含文件附件且任务已启动
- **THEN** Timeline 展示文件名称、MIME、大小和 Agent 可用相对路径
