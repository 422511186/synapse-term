## Why

桌面 Agent Composer 目前只支持纯文本目标词，缺少 Codex CLI 那样的 `/` 快捷指令；用户想切换模型、调整权限或清空当前对话时，需要离开 Composer 或依赖对入口的记忆。与此同时，模型配置不能表达“是否支持多模态”，“启用/停用”和“检测可用性结果”也合并在一个状态按钮里，用户无法快速判断当前模型能否接收图片。

## What Changes

- Agent Composer 新增 Codex CLI 形态的 `/` 快速指令：输入 `/` 弹出可键盘过滤和选择的命令面板，选择后真正执行系统动作，不把指令拼入自然语言 prompt。
- 第一版支持 `/clear`、`/model`、`/permission` 三个指令；任务运行中全部指令禁用并提示任务进行中，不排队。
- `/clear` 真正调用现有 Agent 对话重置或 ACP 对话关闭逻辑，只重置当前 Session 的 Agent 上下文，不删除终端 Session。
- `/model` 和 `/permission` 真正切换当前模型与权限模式，反馈会落在 Composer 或对应 UI 状态上。
- `/model` 和 `/permission` 的选项面板支持 ArrowUp / ArrowDown 循环选择，Enter 确认并关闭面板。
- 斜杠命令候选面板和命令选项面板显示在输入框上方，不遮挡正在编辑的内容；命令名称与描述保持清晰间距。
- Composer 按当前 Session 记录已发送提示词，支持 ArrowUp 回退上一条、ArrowDown 回到较新一条或原草稿。
- Composer 新增独立的“文件”和“图片”上传入口：任意本地文件可作为 Agent 附件引用；图片只能走图片入口，且只有声明支持多模态的模型可接收图片。
- 模型配置新增“支持多模态”手填开关；模型列表把“启用/停用”和“可用性检测结果”拆为独立列，并保留检测、编辑、删除入口。
- 协议、Core Agent 执行与 Provider Adapter 同步增加图片内容块和附件元数据。

## Capabilities

### New Capabilities
- `agent-composer`: 桌面 Agent Composer 的斜杠指令面板、文件/图片附件交互、附件限制与多模态上传门槛。

### Modified Capabilities
- `desktop-model-management`: 模型配置新增多模态能力开关，模型列表将“启用/停用”和“检测结果”拆为独立列。
- `model-providers`: `ModelCapabilities` 新增 `multimodal`，Provider Adapter 支持 OpenAI Responses、OpenAI-compatible Chat Completions 与 Anthropic Messages 的图片内容块。
- `agent-execution`: Agent Task/Turn 可携带文件或图片附件，任务启动时按当前模型的多模态能力组织上下文。
- `desktop-runtime-assurance`: DesktopApi/Preload/Main 增加附件选择与 `agent.start` attachments 传参，Core/IPC 契约同步扩展。

## Impact

- `apps/desktop/src/renderer/app.tsx`：Composer 输入区、slash popup、文件/图片入口、附件 chips、模型和权限指令执行。
- `apps/desktop/src/preload/preload-api.ts`、`apps/desktop/src/main/desktop-core-bridge.ts`、desktop IPC channels：新增附件选择与附件元数据转发。
- `packages/domain`：`ModelCapabilities.multimodal`、Agent attachment 领域对象、启动/重置相关语义。
- `packages/protocol`：`agent.start` payload、模型配置 schema、模型消息 schema、图片/附件内容类型。
- `packages/model-providers`：`ModelInputItem` 图片内容块、三种 Provider 的请求转换与测试。
- `packages/application` / `platform-kernel`：AgentCoordinator 附件校验、上下文组织、附件可访问性和多模态能力门槛。
- 测试：domain/protocol/provider adapter/coordinator/desktop renderer 单元与组件测试，Playwright 覆盖斜杠命令、上传和模型配置拆列。
