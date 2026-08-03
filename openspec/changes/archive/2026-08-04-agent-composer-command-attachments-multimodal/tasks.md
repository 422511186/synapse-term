## 1. 多模态模型能力数据模型

- [x] 1.1 以 TDD 方式在 `packages/domain` 的 `ModelCapabilities` 增加可选 `multimodal`，旧配置解析默认 `false`
- [x] 1.2 扩展 `CreateModelConfigurationInput`、`AgentModelSelection` 与 `createAgentModelSelection` 的多模态语义并补单元测试
- [x] 1.3 修改 `updateModelConfiguration`：修改 `multimodal` 后强制 `validation` 回到 `unverified`
- [x] 1.4 在 `packages/protocol` 的 `modelCapabilitiesSchema`、`modelConfigurationInput/View` schema 和 domain schemas 增加 `multimodal`，补充旧数据兼容测试
- [x] 1.5 更新 `mock-api` 与 `inputs.ts` 初始化默认 `multimodal: false`，同步既有模型 fixture

## 2. Provider Image Content Block

- [x] 2.1 以 TDD 方式增加 `ModelMessage` 结构化内容类型，支持文本和图片 content part，不破坏现有字符串消息
- [x] 2.2 实现 OpenAI Responses 图片 `input_image` 内容映射并补单元测试
- [x] 2.3 实现 OpenAI-compatible Chat Completions 图片 `image_url` 内容映射并补单元测试
- [x] 2.4 实现 Anthropic Messages base64 image 内容映射并补单元测试
- [x] 2.5 Adapter 对不支持的图片 MIME、缺少 `dataBase64`、非多模态输入做前置拒绝并补测试

## 3. Agent 附件领域与 Core 执行

- [x] 3.1 以 TDD 方式定义 `AgentAttachment`、图片/文件模型项与 `agent.start` attachments payload，并同步 protocol schema
- [x] 3.2 实现 Core AgentCoordinator 附件校验：数量≤8、文件≤50 MiB、图片≤10 MiB、MIME 类型与多模态门槛
- [x] 3.3 实现附件 staging：图片读取为模型图片内容块，普通文件复制到 Session/Task 附件根目录并生成相对路径
- [x] 3.4 将文件附件清单注入首轮模型上下文，图片附件转为首个用户消息的图片 content part
- [x] 3.5 扩展 Agent 历史/时间线模型项，支持渲染文件元数据与图片附件
- [x] 3.6 在 `/clear` 重置对话时清理附件 staging 与历史引用
- [x] 3.7 补 AgentCoordinator 单测：多模态拒绝、大小/数量超限、staging 失败、历史清理和路径安全

## 4. Desktop Main / Preload 附件契约

- [x] 4.1 以 TDD 方式新增 `attachments.pick` 或等价 DesktopApi 方法：系统文件对话框、数量/MIME/大小过滤、取消返回空
- [x] 4.2 Main 生成一次性 attachment ticket，渲染进程只拿到 `attachmentId/name/mimeType/sizeBytes`
- [x] 4.3 扩展 `agent.start` Preload/Main 转发：Renderer 提交 attachment ids，Main 解析 sourcePath 后转发 Core payload
- [x] 4.4 扩展 desktop IPC channels 与 desktop-runtime schema 测试，防止未知附件字段越过 Main
- [x] 4.5 更新 Renderer mock-api，让浏览器测试替身与真实 DesktopApi 的附件行为一致

## 5. Agent Composer 交互

- [x] 5.1 以 TDD 方式实现 `AgentSlashCommand` 注册表：`/clear`、`/model`、`/permission`
- [x] 5.2 实现 Codex CLI 形态 slash popover：`/` 打开、过滤、方向键、Enter/Escape、无匹配回退普通文本
- [x] 5.3 实现 `/model` 和 `/permission` 的 Composer 内选择流程，支持 ArrowUp / ArrowDown + Enter 键盘选择，并复用现有状态与模型/权限列表
- [x] 5.4 实现 `/clear` 到现有确认与 `resetConversation`/ACP `closeConversation` 路径，不销毁终端 Session
- [x] 5.5 任务运行中禁用 `/model`、`/permission`、`/clear`，并补组件测试
- [x] 5.6 新增文件与图片入口按钮，按模型 `multimodal` 和驱动者 ACP 禁用图片/附件
- [x] 5.7 实现附件 chips、移除、数量/大小错误提示，以及提交时随 `agent.start` 发送
- [x] 5.8 在 Timeline 渲染图片附件预览和文件附件元数据，重置后清空

## 6. 模型配置页拆列与多模态编辑

- [x] 6.1 以 TDD 方式把模型表格“运行状态”拆成“启用/停用”和“检测结果”两列，多模态状态单独展示
- [x] 6.2 模型编辑框新增“支持多模态”开关，新建/编辑保存 `declaredCapabilities.multimodal`
- [x] 6.3 切换多模态后调用 `models.save` 并刷新模型列表，状态回到 `unverified`
- [x] 6.4 更新模型设置/编辑组件测试，确保启用与检测列互不覆盖、按钮防连点

## 7. 端到端与验证

- [x] 7.1 补充 Playwright：slash 命令打开/过滤/执行、模型和权限切换、/clear 确认、运行中禁用
- [x] 7.2 补充 Playwright：图片入口多模态门槛、文件入口展示与移除、Agent timeline 附件
- [x] 7.3 运行 `openspec validate --all`、完整单元/组件测试与现有 Playwright 回归
- [x] 7.4 验证旧模型配置读取、IPC 帧预算、Renderer 隔离和 reset 后附件清理没有回归

## 8. Composer 面板定位与发送历史快捷键

- [x] 8.1 新增 Session 级发送提示词历史 helper，重复消息移动到最近位置并补单元测试
- [x] 8.2 `submitGoal` 成功后写入发送提示词历史，重置历史导航状态
- [x] 8.3 统一斜杠命令名称与描述间距，确认命令/选项面板显示在输入框上方
- [x] 8.4 补充 Playwright：ArrowUp/ArrowDown 发送历史导航、面板不遮挡输入框
- [x] 8.5 运行类型检查、相关单元/组件测试、Playwright 与 OpenSpec 校验
