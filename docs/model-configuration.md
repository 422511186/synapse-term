# 模型配置

Synapse Term 将模型服务拆成 `Provider Profile` 和 `Model Configuration`。Provider 负责连接，Model Configuration 负责 Agent 实际使用的具体模型；一个 Provider 可以被多个模型配置复用。

## Provider 连接

在顶层“模型”页面切换到“Provider 连接”，配置：

- 名称
- 协议：OpenAI Responses、OpenAI-compatible Chat Completions 或 Anthropic Messages
- Base URL
- API Key
- 可选额外请求头
- 总超时

API Key 只保存到平台凭据存储（Windows Credential Manager / macOS Keychain）。SQLite、Renderer、模型拉取结果和审计只保存凭据引用或“已配置”状态。编辑 Provider 的协议、URL、凭据、请求头或超时后，所有引用它的模型都会重置为 `unverified`。

## Model Configuration

在“模型配置”视图中选择 Provider，再配置：

- 显示名称与模型 ID
- Context Window 和最大输出 Token
- 自动压缩开关与压缩阈值
- 支持的推理强度和默认值：`low | medium | high | xhigh`
- 模型声明能力
- 启用状态和默认模型状态

Agent 只显示同时满足 `enabled = true` 和 `validation.status = available` 的模型。默认模型也必须满足这一条件；同一时刻最多一个 eligible 默认模型。

## 拉取模型

模型拉取入口位于“模型配置”，不在 Provider 页面。选择已保存的 Provider 后点击“拉取模型”，Core 使用该 Provider 的凭据和官方 SDK 调用 Models API；标准 OpenAI-compatible 地址对应 `/v1/models`。

发现流程具有以下边界：

- 支持有界分页、取消和总超时
- 按模型 ID 去重并稳定排序
- 最多返回 500 条结果
- Renderer 不接收 API Key、Authorization header 或完整原始响应
- 支持搜索下拉，也可切换为手动输入自定义模型 ID

从发现结果创建的配置固定为 disabled/unverified，不会自动进入 Agent 模型列表。相同 Provider 下重复的模型 ID 会被 Core 拒绝。

## 模型检测

保存后点击“检测模型”。检测通过必须同时确认：

- Provider 连接和鉴权成功
- 指定模型存在且可访问
- 流式响应正常
- 模型能够调用检测请求指定的 Tool

页面显示检测状态、时间、尝试次数、streaming、Tool Call、Responses/推理能力和具体失败原因。同一模型已有检测运行时不会并发启动第二次检测。

常见错误包括网络连接、TLS/URL scheme、鉴权失败、模型不存在、响应协议错误、缺少 Tool Call、超时和 Provider 不支持 Models API。loopback HTTP 可用于本机服务；非 loopback HTTP 会显示凭据明文传输风险。

## Turn 快照

发送消息时，Renderer 只提交 `modelConfigurationId`、推理强度和 Permission Mode。Core 会重新校验模型仍然 eligible，并把以下信息固定到 Turn：

- Model Configuration ID 与 revision
- Provider Profile ID 与 revision
- 实际模型 ID 与能力快照
- Context Window、输出限制和压缩设置
- `low | medium | high | xhigh` 推理强度

Turn 启动后修改或停用模型不会改变正在运行的 Adapter；后续 Turn 才重新解析当前目录状态。历史展示使用 Turn 快照，不依赖模型配置仍然存在。
