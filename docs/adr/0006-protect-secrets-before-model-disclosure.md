# ADR-0006：在向模型披露前保护秘密

状态：已实现

## 决策

Protected Input 不进入 Agent 上下文、原始输入日志或审计载荷。终端输出和本机文件在发送给模型、外部调用者或长期审计前经过脱敏。

## 当前实现

`@synapse-term/infrastructure` 提供 `CredentialSecretStore` 和 `SecretRedactor`；`@synapse-term/agent-service` 的 ContextBuilder 与外部工具管线在披露边界调用脱敏逻辑。

## 影响

检测器采用 fail-safe 处理，但自动识别可能漏报或误报。用户明确批准的本地 UI Diff 可以显示原文，不应复制到模型上下文以外的公共日志。
