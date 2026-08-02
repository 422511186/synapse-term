## ADDED Requirements

### Requirement: Custom Provider Profiles
系统 MUST 允许用户创建、修改、验证和删除 Provider Profile，字段包括协议、base URL、模型名、凭据引用、额外请求头、超时和声明能力。

#### Scenario: Save a provider profile
- **WHEN** 用户提交通过 Schema 校验的 Provider 配置和凭据
- **THEN** 系统保存非敏感 Profile，并将密钥存入独立 SecretStore

### Requirement: OpenAI Responses Support
系统 SHALL 支持通过官方 OpenAI SDK 调用 Responses API 的流式文本和 Tool Call。

#### Scenario: Stream a Responses turn
- **WHEN** Agent Task 使用有效的 OpenAI Responses Profile
- **THEN** Adapter 将响应转换为统一内部 ModelEvent 流

### Requirement: OpenAI-Compatible Chat Completions Support
系统 SHALL 支持具有自定义 base URL 的 OpenAI-compatible Chat Completions streaming 和 Tool Call。

#### Scenario: Use a compatible endpoint
- **WHEN** 用户配置通过能力探测的 Chat Completions 端点
- **THEN** Agent Task 可使用该端点且 Provider 特有事件不泄漏到 AgentRuntime

### Requirement: Anthropic Messages Support
系统 SHALL 支持通过官方 Anthropic SDK 调用 Messages streaming 和 Tool Use。

#### Scenario: Stream an Anthropic turn
- **WHEN** Agent Task 使用有效的 Anthropic Messages Profile
- **THEN** Adapter 将文本、Tool Use、usage 和结束原因转换为统一 ModelEvent

### Requirement: Provider Capability Validation
系统 MUST 在 Profile 可用于 Agent Task 前验证连接、鉴权、streaming 和 Tool Call 能力，不能仅信任用户声明。

#### Scenario: Endpoint lacks tool support
- **WHEN** 自定义端点能返回文本但不支持 Tool Call
- **THEN** Profile 标记为能力不足且不能用于终端 Agent 执行

### Requirement: Normalized Model Events
所有 Provider Adapter MUST 输出统一的 text delta、tool call started/delta/completed、usage、turn completed 和 provider error 事件。

#### Scenario: Provider emits partial tool arguments
- **WHEN** Provider 分多个流事件返回 Tool 参数
- **THEN** Adapter 按 call ID 组装并仅在完整 Schema 校验后交给 AgentRuntime

### Requirement: Provider Cancellation
模型请求 MUST 接受 `AbortSignal`，并在 Agent Task 取消、UI 安全策略或 Core 关闭时停止网络流。

#### Scenario: Cancel an active model stream
- **WHEN** 用户取消尚未产生终端副作用的模型轮次
- **THEN** Core 中止 Provider 请求且不得执行不完整 Tool Call

### Requirement: Explicit Retry Semantics
Provider Adapter MUST 显式控制重试；流式响应产生首个事件后不得进行隐式重试。

#### Scenario: Network fails before first event
- **WHEN** 可重试网络错误发生在任何模型事件之前
- **THEN** Adapter 可按配置进行有界重试并记录尝试次数

#### Scenario: Network fails after partial stream
- **WHEN** 网络错误发生在已经接收部分文本或 Tool Call 之后
- **THEN** Adapter 返回 provider error 且不得静默重新生成另一轮响应

### Requirement: Provider Credential Isolation
API Key MUST 存入 Windows Credential Manager，Provider Profile、SQLite、日志和 Renderer 不得包含密钥明文。

#### Scenario: Core loads a credential
- **WHEN** Provider Adapter 发起模型请求
- **THEN** Core 通过 credential reference 临时读取密钥且不将其加入审计 payload

### Requirement: Per-Task Provider Selection
每个 Agent Task SHALL 在创建时固定一个 Provider Profile，运行中切换 Profile 必须开始新的模型轮次并记录审计。

#### Scenario: Selected profile is deleted
- **WHEN** 活动 Task 引用的 Provider Profile 被请求删除
- **THEN** 系统拒绝删除或先终止相关 Task，不能留下悬空凭据引用

