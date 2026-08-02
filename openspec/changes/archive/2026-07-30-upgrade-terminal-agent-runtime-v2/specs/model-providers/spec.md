## ADDED Requirements

### Requirement: Provider and Model Separation
系统 MUST 将 `Provider Profile` 与 `Model Configuration` 作为独立实体持久化；Provider Profile 只保存协议、端点、凭据引用、请求头和超时，Model Configuration MUST 引用一个 Provider Profile 并保存模型 ID、上下文、能力、启用状态、默认状态和验证结果。

#### Scenario: Reuse one provider connection
- **WHEN** 用户为同一个 OpenAI-compatible 服务配置两个模型 ID
- **THEN** 系统保存一个 Provider Profile 和两个独立 Model Configuration，两个模型共享连接但分别验证和启用

### Requirement: Model Catalog Eligibility
Model Catalog MUST 把所有 `enabled = true` 的 Model Configuration 暴露给 Agent，并 SHALL 保证最多一个已启用的默认模型。Validation MUST 作为独立诊断结果，不得成为启用、停用、设为默认或保存配置的前置条件。

#### Scenario: Disable the default model
- **WHEN** 用户停用当前默认 Model Configuration
- **THEN** 该模型立即从 Agent 可选列表移除，系统要求选择另一个 eligible 默认模型或明确进入无默认模型状态

#### Scenario: Provider configuration changes
- **WHEN** Provider Profile 的协议、端点、凭据引用、请求头或超时发生变化
- **THEN** 所有引用它的 Model Configuration validation 重置为 `unverified`，但各自的 enabled/default 意图保持不变

#### Scenario: Save an enabled model configuration
- **WHEN** 用户编辑并保存一个已启用或默认的 Model Configuration
- **THEN** Core 保留其 enabled/default 状态；连接相关字段变化可以重置 validation，但不得自动停用模型或取消默认选择

#### Scenario: Enable an unverified model
- **WHEN** 用户未先运行模型检测就启用并设为默认 Model Configuration
- **THEN** Core 接受该操作并允许新 Turn 使用声明的能力；实际 Provider 错误通过 Agent 失败状态明确返回

### Requirement: Model Configuration Reference Integrity
系统 MUST 阻止删除仍被 Model Configuration 引用的 Provider Profile，并 MUST 阻止删除活动 Agent Turn 使用的 Model Configuration；历史 Turn SHALL 通过不可变选择快照保持可读。

#### Scenario: Delete a provider in use
- **WHEN** 用户删除仍被一个或多个 Model Configuration 引用的 Provider Profile
- **THEN** Core 拒绝删除并返回引用该 Provider 的模型配置列表或稳定错误

#### Scenario: Delete a model used only by history
- **WHEN** Model Configuration 只被已完成历史 Turn 引用且没有活动 Turn 使用
- **THEN** Core 可删除目录条目，历史仍显示启动时保存的模型名称、模型 ID、Provider 和 revision

### Requirement: Provider Model Discovery
Core MUST 能通过已保存 Provider Profile 的凭据、请求头和超时访问其 Models API，在标准 Base URL 下支持 `/v1/models`，并 SHALL 返回脱敏、去重、稳定排序且有界的 Discovered Model 列表。

#### Scenario: Pull models for a Model Configuration
- **WHEN** 用户在模型配置视图为当前配置选择已保存的 OpenAI-compatible Provider 并拉取模型，且 `/v1/models` 返回多页结果
- **THEN** Core 使用 Secret Store 中的凭据完成有界分页，返回不超过配置上限的唯一模型 ID，Renderer 不接收 API Key 或鉴权头

#### Scenario: Models API is unsupported
- **WHEN** Provider 不支持 Models API、返回非预期结构或分页游标循环
- **THEN** Core 停止请求并返回稳定错误和中文建议，不创建任何 Model Configuration

### Requirement: Quick Model ID Selection
系统 MUST 允许用户把 Discovered Model 作为当前 Model Configuration 的模型 ID 下拉选项，并 MUST 以 `(providerProfileId, modelId)` 防止重复配置。

#### Scenario: Select a discovered model
- **WHEN** 用户从下拉列表选择一个尚未配置的 Discovered Model 并保存
- **THEN** Core 创建一个 `disabled`、`unverified` 的 Model Configuration，模型 ID 来自选中项

#### Scenario: Select an existing model again
- **WHEN** 所选 Provider Profile 下已有相同模型 ID 的配置
- **THEN** Core 拒绝重复创建并返回可定位现有配置的稳定错误

#### Scenario: Imported model is not yet eligible
- **WHEN** 模型仅通过 `/v1/models` 被发现和快速配置且保持未启用
- **THEN** 它不会出现在 Agent 模型列表中；用户无需先检测即可显式启用或设为默认

### Requirement: Structured Tool Conversation Mapping
Provider Adapter MUST 在模型轮次之间保留 assistant tool call 和对应 tool result 的结构关系，并按目标协议生成合法的下一轮请求。

#### Scenario: Continue after a tool call
- **WHEN** 模型调用一个 Tool 且 Core 返回 Tool Result
- **THEN** 下一轮 OpenAI Responses、Chat Completions 或 Anthropic 请求包含协议正确的 call ID、Tool 名、参数和结果

### Requirement: Protocol-Safe Tool Names
Provider 可见 Tool 名 MUST 只使用跨支持协议兼容的字符集合，并 SHALL 由 Adapter 映射到 Core 内部逻辑 Tool 标识。

#### Scenario: Register terminal observe tool
- **WHEN** Adapter 构造 Provider Tool 定义
- **THEN** Provider 收到 `terminal_observe` 而不是可能被兼容端点拒绝的带点名称

### Requirement: Model Validation Details
Model Configuration 测试 MUST 通过其引用的 Provider Profile 调用具体模型，并返回状态、检测时间、尝试次数、streaming、Tool Call、Responses、推理能力和具体失败原因，同时受独立总超时与取消控制。

#### Scenario: HTTPS URL points to an HTTP service
- **WHEN** 模型测试发生 TLS 握手失败且 Provider 端点为 loopback URL
- **THEN** Model Configuration 标记 unavailable，UI 获得稳定错误码和检查 URL scheme 的提示

#### Scenario: Test is clicked repeatedly
- **WHEN** 同一 Model Configuration 已有进行中的验证
- **THEN** 系统复用或拒绝重复测试且不得并发发起多组 Probe 请求

### Requirement: Context and Reasoning Configuration
Model Configuration MUST 保存 context window、最大输出 Token、自动压缩阈值和支持的推理强度能力；Adapter SHALL 只向支持该参数的协议与模型发送推理设置。

#### Scenario: Compatible endpoint ignores reasoning controls
- **WHEN** OpenAI-compatible Model Configuration 未声明 reasoning capability
- **THEN** Adapter 不发送未知推理字段，Turn 仍可执行且 UI 标明该设置不受支持

#### Scenario: Reserve output capacity
- **WHEN** Profile 配置 context window 为 32K、最大输出为 4K
- **THEN** Core 的输入 Context Budget 必须小于 28K 并额外保留 Tool 与系统 headroom

## MODIFIED Requirements

### Requirement: OpenAI Responses Support
系统 SHALL 支持通过官方 OpenAI SDK 调用 Responses API 的流式文本、function call 和 `function_call_output` 多轮链路。

#### Scenario: Complete a Responses tool loop
- **WHEN** Agent Task 使用有效的 OpenAI Responses Profile 并执行一个 Tool
- **THEN** Adapter 在下一轮发送对应 function call output 并继续流式接收最终文本

### Requirement: OpenAI-Compatible Chat Completions Support
系统 SHALL 支持具有自定义 base URL 的 OpenAI-compatible Chat Completions streaming，以及 assistant `tool_calls` 到 role=`tool` message 的多轮链路。

#### Scenario: Complete a compatible tool loop
- **WHEN** 兼容端点返回 Tool Call 且 Core 完成调用
- **THEN** 下一轮请求包含相同 tool call ID 的 tool message且 Provider 特有结构不泄漏到 AgentRuntime

### Requirement: Anthropic Messages Support
系统 SHALL 支持通过官方 Anthropic SDK 调用 Messages streaming，以及 `tool_use` 到 `tool_result` content block 的多轮链路。

#### Scenario: Complete an Anthropic tool loop
- **WHEN** Anthropic 返回 `tool_use` 且 Core 完成调用
- **THEN** 下一轮 user message 包含匹配 Tool Use ID 的 `tool_result` block

### Requirement: Provider Capability Validation
系统 MUST 提供可选的 Model Configuration 诊断，使用其 Provider Profile 验证连接、鉴权、具体模型、streaming 和指定 Probe Tool Call 能力，并将 unavailable 原因返回桌面端，不能仅因任意首个流事件报告检测成功。检测状态不得改写用户的 enabled/default 选择。

#### Scenario: Endpoint streams text but ignores tools
- **WHEN** 自定义端点返回文本但没有调用指定 Probe Tool
- **THEN** Model Configuration 标记为能力不足并记录原因；若用户仍显式启用该模型，Agent Turn 可尝试运行并显示实际错误

### Requirement: Normalized Model Events
所有 Provider Adapter MUST 输出统一 text delta、assistant tool call、usage、turn completed 和 provider error 事件，并使 Runtime 能重建完整结构化 Model Item 历史。

#### Scenario: Provider emits partial tool arguments
- **WHEN** Provider 分多个流事件返回 Tool 参数
- **THEN** Adapter 按 call ID 组装，完整后生成一个 assistant tool call item，再由 Schema 校验参数
