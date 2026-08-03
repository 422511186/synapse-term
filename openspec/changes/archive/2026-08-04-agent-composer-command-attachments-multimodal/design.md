## Context

桌面 Agent Composer 当前是纯文本 `textarea`，只提供提示词历史和发送按钮；模型和权限切换位于 Header 已有 dropdown，清空对话已经有 `agent.resetConversation` 和 ACP `closeConversation` 路径。模型配置页当前把“启用/停用”和“可用/不可用/待检测”合并成一个状态按钮，模型配置对话框也没有“多模态”能力项。

Provider/Model 层也存在三个缺口：`ModelCapabilities` 没有 `multimodal`，模型请求消息只有 `content: string`，OpenAI Responses、Chat Completions、Anthropic 三种 Adapter 都还不能发送图片内容块。Core Agent 的历史模型项同样只有文本内容类型。Electron Renderer 被要求隔离文件系统和 Node.js，附件不能由 Renderer 直接读取。

约束是保持现有 OpenSpec 生命周期，并且在 `/opsx:apply` 阶段使用 TDD、系统调试和验证前检查。本设计只负责实现路径和取舍。

## Goals / Non-Goals

**Goals:**
- 在 Composer 中用 `/` 弹出与 Codex CLI 一致的过滤命令面板，并让 `/model`、`/permission`、`/clear` 真正改变系统状态。
- 命令候选与选项面板显示在输入框上方，保持输入内容可见；ArrowUp / ArrowDown 在 slash 过滤和发送提示词历史之间按上下文复用。
- 提供独立文件入口和图片入口，附件进入 Agent 任务上下文；非多模态模型不能接收图片。
- 模型配置增加“支持多模态”声明，模型列表把启用状态和检测结果拆成独立列。
- 打通 Renderer → Desktop Main → Core Protocol → Provider Adapter 的图片和文件附件链路。

**Non-Goals:**
- 不做 `/new`、`/compact`、清终端屏幕、命令排队。
- 不做自动生成图片、图片编辑、OCR 或任意文件内容解析。
- 不做自动图片能力检测；`multimodal` 由用户手工声明。
- 不把附件能力扩展到 ACP 外部 Agent 首版。
- 不引入新的通用文件上传系统或云同步。

## Decisions

**D1：斜杠指令是 Renderer 命令注册表，不是新 Core 命令。**
在 Renderer 增加 `AgentSlashCommand` 注册表和 popup 组件，输入 `/` 时按 `description` 过滤，键盘上下选择、Enter 执行。`/model` 复用当前 `activeModel` 与模型列表，在 Composer 内打开模型选择层；`/permission` 在 Composer 内展开权限选项；`/clear` 复用现有 confirm/reset 流程。这样指令能直接用现有 API 执行，不增加 Core 方法。

**D1.1：Composer 面板使用输入框上方定位，方向键按上下文切换。**
slashes 候选面板和 `/model`、`/permission` 面板都放在 Composer 输入框上方（`bottom-full`），避免覆盖用户正在输入的内容。slash 面板打开时 ArrowUp / ArrowDown 用于选择命令；`/model` 与 `/permission` 面板打开时 ArrowUp / ArrowDown 循环选择选项、Enter 确认；面板关闭且输入框聚焦时，ArrowUp / ArrowDown 切换当前 Session 的已发送提示词历史，最新消息在前，发送成功后写入 Session 级记录。

**D2：附件使用 Preload 一次性 ticket，Renderer 不接触 sourcePath。**
`DesktopApi.attachments.pick({ kind })` 由 Main 进程打开系统文件选择器并校验数量、MIME、大小，返回结构。选择成功后 Main 持有 `attachmentId -> sourcePath` 的短期映射，Renderer 只拿到 `attachmentId/name/mimeType/sizeBytes`。提交 `agent.start` 时 Renderer 传这批 ID；Desktop Main 在转发 Core 前解析为 `sourcePath`。这样 Renderer 保持隔离，也避免把任意文件路径暴露给 renderer DOM。

**D3：Core 对附件执行二次校验并 staging。**
Core 的 `agent.start` 接受 protocol attachment payload，并按 `kind` 分档：
- 图片：校验 MIME 和实际解码，必须通过 `image/png|image/jpeg|image/webp|image/gif`，大小不超过 10 MiB，随后生成 `ModelInputItem` 图片内容块。
- 文件：校验大小不超过 50 MiB，复制到 Session/Task 的附件根目录，模型上下文只给 `name/mimeType/sizeBytes/relativePath`，读取走 `local_read_file`。
- 数量：一次任务最多 8 个。
两者都只允许在当前 Agent Turn 中生效，重置对话后清理／释放；附件 staging 失败则在创建前返回错误，不留半初始化任务。

**D4：多模态能力手动声明，不对检测注入测试图。**
`multimodal` 是 `declaredCapabilities` 的业务声明，新增/编辑模型对话框提供开关，旧配置按 `false` 处理。可用性检测仍验证连接、流式、工具调用；不额外向 Provider 发送测试图片。原因是通用模型列表 API 没有多模态元数据，发送测试图无法稳定区分“成功接收”和“模型忽略图片”，还会增加计费与探测复杂度。

**D5：Provider 入参升级为结构化内容部分。**
`ModelRequest` 的用户消息从 `content: string` 扩展为可接受的 `ModelContentPart[]`，文本部分保留 `type:'text'`，图片部分 `type:'image'`。三种 Adapter 各自映射：
- Responses：`input_image` + `image_url: data...`
- Chat Completions：`content` 数组 + `image_url`
- Anthropic：`content` 数组 + base64 `image`
Adapter 只在模型 `capabilities.multimodal` 为 true 时接收图片。

**D6：模型配置 schema 与查询结果都带 `multimodal` 语义。**
`ModelCapabilities` 增加可选 `multimodal?: boolean`，创建/归一化时默认 `false`。Protocol `modelCapabilitiesSchema`、`modelConfigurationInput/View`、domain `createModelConfiguration`、`createAgentModelSelection` 同步映射；修改 `multimodal` 后 `updateModelConfiguration` 将 validation 置为 `unverified`。

**D7：模型列表拆列但保持现有交互基建。**
将当前“运行状态”列拆为“启用/停用”和“检测结果”两列，“多模态”放到能力列，操作列仍保留检测/编辑/删除。启用/停用继续乐观更新；检测继续使用现有 `PendingButton` 三态和 toast。

**D8：ACP 首版不支持附件。**
内置 Agent 的附件已有明确 Provider 边界；ACP 是一个外部进程协议，首版没有可见附件输入/输出契约。Composer 在 `driver === 'acp'` 时禁用附件入口，避免给外部 Agent 传未定义 payload。

## Risks / Trade-offs

- [附件 sourcePath 暂时不依赖加密校验] → Main 使用一次性 ticket、Core staging 和复制；后续需要时可用 StrictDynamic 托盘或在 Core 注册持票句柄，但要增加 IPC。
- [图片 base64 IPC 可能接近控制帧预算] → Main/Core 双重限制 10 MiB；Core `agent.start` payload 只用路径/ID，不把图片数据往返 Renderer；Provider 请求只传给模型 Adapter。
- [手动 multimodal 可能误标] → 只在声明 true 时开放图片；检测结果保留现有 `available/unavailable`，不把声明当作自动验证。
- [文件读取能力扩展] → 附件文件只在当前 Task 根目录暴露，`local_read_file` 保留路径上限和二进制错误，避免全局工作区或敏感路径读取。
- [Composer popup 与现有模型/权限菜单重复] → 复用同一状态而未新建二套模型参数；V1 调度让事件只从一个入口更新。

## Migration Plan

1. 协议与 domain：先加 `multimodal` 可选字段和附件/turn 内容 schema，迁移旧数据为 `false`；加单元测试。
2. Provider Adapter：实现图片内容块，三种协议测试；协议不向后兼容为 `content:string` 之外新增的并发结构，旧文本调用保持可运行。
3. Core Agent：实现附件校验、staging、图片进入模型消息、文件清单上下文；重置清理。
4. Desktop Main/Preload：附件选择 ticket、`agent.start` attachment 转发与回归测试。
5. Renderer：斜杠命令、文件/图片入口、附件 chips、模型/权限命令状态、表格拆列。
5.1 Renderer：命令/选项面板定位、发送提示词历史快捷导航与对应 Playwright 覆盖。
6. Playwright/Mock API：覆盖 slash、上传、多模态门槛和列拆分。

回滚策略：分层回滚，先移除 Renderer 附件 UI 和斜杠入口不会影响既有 Core 对话；Provider 图片测试失败时可以先禁用图片入口，文件 staged 路径在先于模型请求完成。

## Open Questions

- 文件附件历史是否需要长期持久化；首版建议只保留当前 Session 的 turn，历史数据使用已经存在的 timeline/audit 约束。
- 图片超过 10 MiB 是否在后续提供自动压缩；首版直接拒绝以保持行为可预期。
