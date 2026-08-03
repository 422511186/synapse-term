## ADDED Requirements

### Requirement: Multimodal Model Capability
`ModelCapabilities` MUST 支持 `multimodal: boolean`，用于声明模型是否可接收图片内容；旧配置或未显式声明时 MUST 按 `false` 处理。检测通过后的模型能力 MUST 保留该声明值，模型能力 Schema、Agent Model Selection、协议 View 三个层级 MUST 使用同一字段语义。

#### Scenario: Model declares multimodal support
- **WHEN** 模型配置保存 `declaredCapabilities.multimodal: true` 且检测可用
- **THEN** `AgentModelSelection.capabilities.multimodal` MUST 为 `true`，Composer 允许该模型接收图片

#### Scenario: Legacy model omits multimodal
- **WHEN** 已有模型配置未包含 `multimodal` 字段
- **THEN** 系统 MUST 将其归一化为 `multimodal: false`，且不允许图片发送

### Requirement: Provider Image Content Blocks
ModelRequest 的用户消息 MUST 支持结构化内容块：文本部分 `{ type: 'text', text: string }` 与图片部分 `{ type: 'image', mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif', dataBase64: string }`。三种 Adapter MUST 分别转换为目标 Provider 的图片格式：OpenAI Responses 使用 `input_image`，OpenAI-compatible Chat Completions 使用 `image_url` 内容块，Anthropic Messages 使用 base64 `image` source。不支持的 MIME 或缺失 `dataBase64` MUST 在发送前报错。

#### Scenario: Responses API receives image content
- **WHEN** 内置 Agent 使用 OpenAI Responses 模型且用户上传 PNG 图片
- **THEN** Adapter 将用户消息转换为包含文本和 `type: 'input_image'` 内容块的 Responses input item

#### Scenario: Chat Completions receives image content
- **WHEN** 内置 Agent 使用 OpenAI-compatible Chat Completions 模型且用户上传 JPEG 图片
- **THEN** Adapter 将用户消息转换为 `{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,...' } }` 内容数组

#### Scenario: Anthropic receives image content
- **WHEN** 内置 Agent 使用 Anthropic Messages 模型且用户上传 WebP 图片
- **THEN** Adapter 将用户消息转换为 `{ type: 'image', source: { type: 'base64', media_type: 'image/webp', data: '...' } }` 内容块

#### Scenario: Unsupported image type is rejected
- **WHEN** 用户尝试上传非 `png/jpeg/webp/gif` 并声明为图片
- **THEN** Adapter 或上游附件校验 MUST 拒绝请求，且不向 Provider 发送该消息
