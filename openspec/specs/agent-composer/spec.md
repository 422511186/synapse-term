# agent-composer Specification

## Purpose

规定桌面 Agent Composer 的斜杠指令、发送提示词历史、附件交互与多模态图片上传入口。

## Requirements

### Requirement: Agent Composer Slash Commands
桌面 Agent Composer MUST 在文本输入区输入 `/` 时打开可过滤的命令面板，面板入口 MUST 使用 Codex CLI 形态：候选列表支持键盘上下选择、输入过滤、Enter 执行、Escape 关闭。第一版命令 MUST 包含 `/clear`、`/model`、`/permission`，选择命令 MUST 执行对应系统动作，不得把斜杠命令作为自然语言目标提交给 Agent。

#### Scenario: Open slash command popup
- **WHEN** 用户在当前 Session 的 Composer 输入 `/`
- **THEN** 系统 MUST 在 Composer 上方显示命令候选面板，并高亮第一个可用命令

#### Scenario: Command panel stays above the composer
- **WHEN** 斜杠命令候选面板或 `/model`、`/permission` 面板打开
- **THEN** 面板 MUST 显示在输入框上方，不遮挡正在编辑的输入内容；命令名称与描述 MUST 保持清晰间距

#### Scenario: Filter and execute a command
- **WHEN** 用户继续输入过滤词并使用 Enter 选择命令
- **THEN** Composer MUST 执行该命令且不清空命令面板之外的非系统文本

#### Scenario: /model switches current model
- **WHEN** 用户在命令面板选择 `/model` 并选择一个已启用模型
- **THEN** 系统 MUST 更新当前 Session 的活动模型，关闭命令面板，并显示所选模型名称

#### Scenario: /permission switches permission mode
- **WHEN** 用户在命令面板选择 `/permission` 并选择人工审批、自动审批或完全权限
- **THEN** 系统 MUST 更新当前 Agent 权限模式，关闭命令面板，并显示新的权限状态

#### Scenario: Model and permission panels accept keyboard selection
- **WHEN** 用户打开 `/model` 或 `/permission` 面板
- **THEN** 用户 MUST 能用 ArrowUp / ArrowDown 循环选择选项，用 Enter 确认并关闭面板

#### Scenario: /clear resets Agent conversation
- **WHEN** 用户选择 `/clear` 且存在当前 Agent 对话
- **THEN** 系统 MUST 展示现有清空确认流程，确认后调用 Agent 对话重置 API 或 ACP 对话关闭 API，并保留当前终端 Session

#### Scenario: Running agent disables state-changing commands
- **WHEN** Agent 任务正在运行且用户打开命令面板
- **THEN** `/model`、`/permission`、`/clear` MUST 显示为禁用并说明任务进行中

#### Scenario: Unknown slash input falls back to normal text
- **WHEN** 用户输入 `/` 后没有命令匹配并继续输入普通字符
- **THEN** 系统 MUST 关闭命令面板且不执行系统动作，该文本按普通 Agent 目标处理

### Requirement: Composer Sent Prompt History Shortcuts
桌面 Agent Composer MUST 按当前 Session 记录已发送的 Agent 提示词，并支持 ArrowUp / ArrowDown 在发送历史中导航。ArrowUp MUST 从最近发送的消息开始逐条回退，ArrowDown MUST 向较新的消息移动并在最新位置恢复导航前草稿；历史导航 MUST 只修改 Composer 文本，不得重新提交任务。

#### Scenario: ArrowUp walks previous sent prompts
- **WHEN** 用户先后发送两条提示词后按 ArrowUp
- **THEN** Composer 依次显示最近一次和上一条已发送提示词，且不会触发 Agent 任务

#### Scenario: ArrowDown returns to newer prompt or draft
- **WHEN** 用户已用 ArrowUp 回退到较早提示词后按 ArrowDown
- **THEN** Composer 先恢复较新的提示词，在最新位置再按 ArrowDown 时恢复导航前草稿

### Requirement: Agent Composer Attachments
桌面 Agent Composer MUST 提供独立的“文件”和“图片”上传入口用于当前内置 Agent 任务。文件入口允许任意本地文件成为附件引用；图片入口以图片内容块输入；附件 MUST 在 Composer 中可见、可移除、有数量与大小上限，并在提交后随实例标题显示。非图片附件不能向模型发送原始字节，而是把文件放入当前任务可访问位置，并把名称、类型、大小和相对路径写入模型上下文。

#### Scenario: File attachment is selected
- **WHEN** 用户通过文件入口选择一个本地文件
- **THEN** Composer 显示该文件名称、大小和类型，用户可移除该附件，提交时附件随 `agent.start` 一起发送

#### Scenario: Image attachment is selected by multimodal model
- **WHEN** 当前已启用模型声明支持多模态且用户通过图片入口选择图片
- **THEN** Composer 显示图片 chip，提交后图片作为用户消息的内容块进入模型

#### Scenario: Image attachment is rejected without multimodal capability
- **WHEN** 当前模型未声明支持多模态且用户尝试选择或提交图片
- **THEN** 系统 MUST 拒绝图片附件、禁用图片入口并展示明确原因，非图片文件附件不受此限制

#### Scenario: Attachment limits are enforced
- **WHEN** 附件数量超过 8 个，或单个文件超过 50 MiB，或单个图片超过 10 MiB
- **THEN** 系统拒绝新增附件并展示原因，不改变已添加附件

#### Scenario: ACP driver attachment entry is disabled
- **WHEN** 当前 Agent 驱动者为外部 ACP 驱动者
- **THEN** 文件与图片附件入口 MUST 禁用并说明附件仅支持内置 Agent，不向 ACP startTurn 发送附件

#### Scenario: Conversation reset clears pending attachments
- **WHEN** 用户执行 `/clear` 或系统清空当前 Agent 对话
- **THEN** Composer 中尚未发送的附件 MUST 被移除，后续新目标不带旧附件
