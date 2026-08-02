# 模型配置

Synapse Term 将“如何连接模型”和“选择哪个模型”拆成两个实体：Provider Profile 与 Model Configuration。一个 Provider 可以被多个模型配置复用。

## Provider Profile

在“Provider 管理”中创建连接，字段包括：

- 名称。
- 协议：`openai_responses`、`openai_chat_completions` 或 `anthropic_messages`。
- Base URL。
- API Key。
- 可选额外请求头。
- 请求超时。

API Key 通过 Core 写入当前平台的凭据存储：Windows Credential Manager 或 macOS Keychain。SQLite 和 Renderer 只保存 Provider 的 credential reference 或已配置状态，不保存密钥值。API Key 不会进入模型发现结果、时间线或审计摘要。

修改 Provider 的协议、Base URL、凭据、请求头或超时，会让引用它的 Model Configuration 回到 `unverified`，需要重新检测。

## Model Configuration

在“模型”页面创建模型配置，选择 Provider 后填写：

- 显示名称和具体模型 ID。
- `contextWindowTokens` 和 `maxOutputTokens`。
- 是否自动压缩，以及 `50%` 到 `95%` 的压缩阈值。
- 支持的推理强度及默认值：`low`、`medium`、`high`、`xhigh`。
- 声明能力：Responses、streaming、Tool Calls，以及可选的 reasoning。
- 是否启用，以及是否设为默认。

模型配置必须满足上下文窗口大于最大输出，默认推理强度必须属于支持集合。Agent 只会列出 `enabled = true` 且检测状态为 `available` 的模型；同一时间最多一个可用默认模型。

## 发现模型

在模型配置表单中选择已保存的 Provider，点击“拉取模型”。Core 使用 Provider 的凭据和对应 SDK 调用 Models API；OpenAI-compatible 服务通常使用其 Base URL 下的 `/models` 路径。

发现流程具备以下边界：

- 结果最多 500 条，按模型 ID 去重并稳定排序。
- 支持取消和总超时，网络或协议错误转换为稳定的 UI 错误。
- Renderer 不接收 API Key、Authorization header 或完整原始响应。
- 发现结果只是候选。导入后创建的配置仍是 disabled/unverified，必须检测并启用。
- 同一 Provider 下重复模型 ID 不会创建第二份配置。

如果服务没有 Models API，可以直接在表单中手动填写模型 ID；这不会跳过后续模型检测。

## 检测模型

点击“检测模型”后，Core 会验证：

1. Provider 连接和鉴权是否成功。
2. 指定模型是否可访问。
3. streaming 响应是否可解析。
4. 模型是否能完成检测请求中的 Tool Call。

检测状态为：

| 状态          | 含义                                       |
| ------------- | ------------------------------------------ |
| `unverified`  | 尚未检测，或 Provider 配置发生变化         |
| `validating`  | 当前正在检测，记录本次 attempt             |
| `available`   | 检测通过，可以在启用后供 Agent 选择        |
| `unavailable` | 检测失败，保留时间、attempt 和稳定失败原因 |

同一模型已有检测任务时不会并发启动第二次检测。常见失败原因包括 Base URL 或 TLS 错误、鉴权失败、模型不存在、streaming/Tool Call 不兼容、超时和 Provider SDK 协议错误。

## Turn 快照

发送内置 Agent 目标时，Renderer 只提交模型配置 ID、推理强度和权限模式。Core 会重新确认模型仍然 eligible，并把以下内容冻结到 Turn：

- Model Configuration ID 和 revision。
- Provider Profile ID 和 revision。
- 实际模型 ID、协议和能力快照。
- 上下文窗口、最大输出和压缩设置。
- 本次使用的推理强度。

Turn 启动后禁用、编辑或删除模型配置，不会改写已开始的 Adapter 调用；下一次 Turn 会重新校验可用性。

## 上下文预算与压缩

一次模型请求的可用预算来自模型上下文窗口，并为系统提示、近期工具结果和最大输出保留空间。Token 估算和预算计算位于 `@synapse-term/agent-service`。

启用自动压缩且达到阈值时，Core 将较早的结构化 Model Item 转为持久化摘要，并在后续请求中使用“摘要 + 近期精确条目”。Tool Call 与 Tool Result 的配对不会被拆开；原始条目仍保存在 SQLite，供历史和审计读取，但不会因为保留在本地而自动再次发送给 Provider。

## 安全注意事项

- 不要把 API Key 写进 Provider 的额外 headers 以外的项目文件或命令行历史。
- 非 loopback 的明文 `http://` Base URL 会把凭据暴露在网络传输中；生产服务应使用 HTTPS 或受控的本机安全通道。
- 模型输出属于不可信输入，不能改变 Core 的 Tool allowlist、路径根目录或审批规则。
- 真正的 SSH 凭据仍由用户在终端和远端环境中管理，Provider API Key 与 SSH 凭据是两套独立的秘密。
