## Context

现有工作区以 Header 中的单个会话按钮和下拉列表作为唯一会话导航。`sessions.map()` 没有搜索、高度约束或滚动容器；活动按钮只显示标题，`executionDialect` 既不能表达 Bash、Git Bash、PowerShell 等实际终端类型，也没有随 Core `session.changed` 事件更新到 Renderer。

协议中的 `SessionSummary`、`SessionLaunch` 和持久化 `SessionLaunchMetadata` 都未保存终端类型。另一方面，Core 与 Desktop Main 分别以相同的长 `tmpdir()/appId-hash.sock` 公式推导 IPC endpoint；本机 macOS 的结果达到 125 字节，超过 Unix-domain socket 可绑定路径长度，导致已打包 Electron 只能呈现 UI 而不能连接真实 Core。

## Goals / Non-Goals

**Goals:**

- 为最多 20 个活动 Session 提供桌面端可访问、可搜索且不会遮挡新建入口的标签导航。
- 让每个 Session 以实际终端类型而非用户标题或执行方言显示，并在 Session 状态变化时实时更新。
- 保持单个活动 xterm 的内存边界，使用现有 replay 流恢复切换后的可见输出。
- 在 macOS 上生成并实际绑定长度安全、同一用户范围内确定的 Core IPC endpoint。
- 以接口契约和真实 Electron/Core 冒烟回归证明 UI 所用数据、写操作和事件均经过 `DesktopApi`。

**Non-Goals:**

- 不提高 Core 默认 20 个活动 Session 的资源上限，也不引入虚拟远程连接对象。
- 不同时驻留多个 xterm canvas，不改变 Agent、Provider 或权限策略的领域语义。
- 不把浏览器 mock 当作 Electron 的验收替代，也不要求真实 Provider 凭据来验证本地会话链路。
- 不恢复移动端布局，也不以标签页需求回退已确定的终端字体和双栏桌面几何。

## Decisions

### 1. 终端类型作为持久化 Session 元数据

`SessionLaunch` 将携带受长度限制的 `terminalType` 文本；`buildSessionLaunch` 从已发现的 `LocalShellDescriptor.label` 填充该字段。Core 将它写入 `SessionLaunchMetadata`，并在 `SessionSummary`、`session.changed` 和重新列举的持久化 Session 中返回。标签与全部会话视图只显示该字段，执行方言继续作为 Agent/策略语义而不是用户可见的终端类型。

备选方案是在 Renderer 端从 executable basename 或标题推断类型。该方案会错误区分 Git Bash、WSL 包装器和自定义启动配置，也会在 Core 重启后丢失语义，因此不采用。

### 2. 将 Session 变化事件贯通到 Renderer

Core 已广播经 schema 校验的 `session.changed`。Desktop Core Bridge 增加明确的 Session 变化回调，Electron Main 广播 `session:changed`，Preload 暴露 `sessions.onChanged()`。`App` 以 Session ID upsert 本地列表，并在关闭事件或已消失 ID 时重新收敛活动选择。

这样 PTY 状态、Shell 状态、方言和终端类型不会只在创建操作后更新。备选方案是固定间隔轮询 `sessions.list()`；它会造成无谓 Core 请求、状态闪烁且无法提供实时语义，因此不采用。

### 3. 标签栏与全部会话导航共存

终端面板顶部放置 ARIA `tablist`。每个标签包含截断标题、终端类型徽标和独立关闭按钮；标签轨道只在水平方向滚动，`+` 新建按钮与“全部会话”按钮固定在轨道外。活动标签变化后仅调用 `scrollIntoView({ block: 'nearest', inline: 'nearest' })`，不抢占键盘焦点。

“全部会话”弹层提供搜索、类型、活动状态和关闭动作，列表使用有界内部纵向滚动。Core 默认硬上限为 20，故不引入虚拟化；所有 20 个条目可一次性渲染，但不得因为窗口高度失去可达性。

备选方案是只给原下拉菜单增加 `max-height`。它不能提供持续可见的活动 Session、快速标签切换或固定新建入口，无法满足用户的标签页要求，因此不采用。

### 4. 保持一个活动 xterm 实例

`TerminalView` 仍只接收当前活动 Session。切换时释放旧监听器和 canvas，并以 `terminal.replay()` 恢复目标 Session；未选中 Session 的 PTY、输出 Journal 和 Agent 状态仍由 Core 持有。标签栏不为每个 Session 创建隐藏 xterm，避免会话数增大时线性消耗 Renderer canvas 和订阅资源。

### 5. 共享且受长度保护的本地 IPC endpoint 派生

从现有 Core 路径逻辑抽取一个只供 Node 主进程使用的共享 endpoint helper，由 Core 与 Desktop Main 同时调用。Windows 继续返回 `\\\\.\\pipe\\<app>-<user-scope>`；POSIX 使用短、不可读的哈希 socket 文件名并按 UTF-8 字节数限制在 100 字节以内。优先使用用户当前 `tmpdir()`；若该目录本身过长，回退到 `/tmp` 的短哈希路径。用户范围哈希、现有 token 握手和权限边界保持不变。

备选方案是仅把 appId 截短或允许 Node 绑定失败后重试随机路径。截短不能保证任意临时目录的上限，重试也会使 Desktop 与 Core 推导出不同地址；共享确定性 helper 能同时解决一致性和可测试性，因此采用。

### 6. 分层证明 DesktopApi 可用

新增三层回归：

1. `createDesktopApi` 与 Desktop Core Bridge 的完整通道/事件契约测试，覆盖每个公开方法及拒绝未声明通道。
2. 浏览器 E2E 使用实现同一接口的 runtime mock，覆盖创建、选择、关闭、类型、超过可视数量的搜索与活动 xterm 切换。
3. macOS 实际 Electron/Core 冒烟运行 Core status、Shell 环境、Session 创建、终端输入/输出或 replay、资源读取和关闭，证明 Preload、Main、connector 和 Core 都可达。

## Risks / Trade-offs

- [终端类型输入来自 Renderer] → 使用严格长度校验、仅展示用途，并将类型与可执行路径/方言分开；Agent 策略继续只相信 Core 的 executionDialect。
- [标签增加终端面板顶部高度] → 保持 Header 与 Agent 几何不变，把标签轨道限制为稳定桌面高度并为 xterm 使用剩余空间。
- [切换大型 scrollback 有回放延迟] → 只在切换目标时请求 replay，保留已有有界 10,000 行 xterm scrollback 与 Core journal 限制。
- [`/tmp` fallback 的可预测路径可被抢占] → 仅在用户临时目录超过安全长度时使用；现有 token 握手仍阻止未经认证请求，碰撞或占用会显式启动失败而不连接错误 Core。
- [真实 Electron 测试受本机 Shell 差异影响] → 选择已发现可用的 POSIX Shell，跳过无可用 Shell 的环境，测试协议链路而不依赖 Provider 凭据。

## Migration Plan

1. 先为协议字段、endpoint 长度、标签行为与真实 IPC 建立失败测试。
2. 加入共享 endpoint helper 和 `terminalType`，更新 Core、Desktop Main、Preload、mock 与契约测试。
3. 替换 Header 会话下拉为标签轨道和全部会话导航，保留已有新建 Dialog、Agent 和 xterm 流。
4. 运行浏览器、实际 Electron、类型检查、构建和 macOS `dir` 打包；若回归，按本次变更回滚 Renderer、协议字段和 endpoint helper。

## Open Questions

- 无。Core 的 20 Session 上限已是既有契约；本变更以该上限作为桌面导航容量目标。
