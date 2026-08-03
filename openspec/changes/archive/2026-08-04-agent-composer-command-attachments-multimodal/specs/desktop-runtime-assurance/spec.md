## ADDED Requirements

### Requirement: Renderer Attachment Selection
Electron DesktopApi 必须新增受控的附件选择通道，Renderer 不得直接访问 Node.js 文件系统。Main 进程 MUST 通过 Electron `dialog` 或等价安全的文件选择器打开文件，限制图片/文件数量与大小，返回名称、MIME、大小和本地 `sourcePath`；返回失败或取消时 MUST 不产生附件。Renderer 提交 Agent 任务时，必须把附件元数据连同 `agent.start` payload 发送给 Core。

#### Scenario: Pick a file from the desktop
- **WHEN** 用户在 Composer 点击文件入口
- **THEN** Main 打开系统文件选择器，用户选择后被选文件 MUST 裁剪到约定数量和大小，并返回声明只读的元数据

#### Scenario: Pick an image from the desktop
- **WHEN** 用户在 Composer 点击图片入口
- **THEN** Main 只接受允许的 `image/png`、`image/jpeg`、`image/webp`、`image/gif` 文件，拒绝超大图片并返回可识别错误

#### Scenario: Cancel the file dialog
- **WHEN** 用户取消系统文件选择器
- **THEN** Preload MUST 返回空选择且不修改 Composer 现有附件

### Requirement: Desktop API Attachment Contract
`DesktopApi.agent.start` MUST 接受与 Core 一致的 `attachments` 参数，并将字段映射到经过 Schema 校验的 `agent.start` Core 请求。Preload 声明、Desktop Main 转发和 Core Protocol payload 的附件字段 MUST 保持一致，任何一层拒绝附件时 MUST 以原字段原文的语言返回给 Renderer。

#### Scenario: Attachment fields reach Core
- **WHEN** Renderer 调用带两份附件的 `agent.start`
- **THEN** Preload 和 Desktop Main 均不丢弃或改写 attachment 字段，Core 收到相同元数据

#### Scenario: Unknown attachment field is rejected
- **WHEN** Renderer 或测试调用带未知 attachments 字段的 IPC
- **THEN** Schema 校验拒绝请求并返回明确的校验错误，不得将非法字段转发给 Core AgentCoordinator

### Requirement: Oversized Attachment Defense in Depth
Desktop Main 和 Core 都必须执行附件大小预算，不能只依赖 Renderer，单个响应或 payload 超过控制帧预算时 MUST 按协议返回有界的 `resource_exhausted` 或附件限制错误，不能破坏 IPC 连接。

#### Scenario: Oversized image reaches Main
- **WHEN** 用户通过特殊途径尝试提交超过 10 MiB 的图片
- **THEN** Main 或 Core 校验拒绝，IPC 连接继续可用

#### Scenario: Aggregate attachments exceed frame budget
- **WHEN** 附件元数据和图片内容编译后超过控制帧预算
- **THEN** Core 返回有界错误且不创建部分 Agent Task
