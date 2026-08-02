# ADR-0030：外部 Agent 权限请求使用单一审批通道

状态：已实现

## 决策

ACP permission request 由平台策略判断：低危工具调用直接授予一次性许可，需要人工决定时展示现有审批卡片；非平台工具被拒绝并审计。不实现 `allow_always` 或 `reject_always` 的第二套记忆语义。

## 当前实现

`AcpController` 的 `#gateCommand` 与 `respondApproval` 将批准命令加入一次性集合，并使用 `approved_once` 进入 `ExternalToolPipeline`。

## 影响

用户只需要理解一套审批 UI；ACP 的自动模式也不能把一次批准扩大成永久权限。
