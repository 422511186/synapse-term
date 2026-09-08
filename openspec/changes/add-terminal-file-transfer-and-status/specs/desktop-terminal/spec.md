## MODIFIED Requirements

### Requirement: Terminal-Only Workspace

桌面工作区 MUST 以终端 Session 为主要内容，MUST NOT 展示 Agent 面板、Composer、ACP 切换或审计入口。Header MUST 只包含品牌、会话标签操作和设置入口，不展示资源监控。会话菜单 MUST 提供文件传输和环境快照入口，面板位于对应 Session 内容区并可关闭。会话菜单可提供显式 Sharing；外部调用的审批卡片与外部执行状态遵循 ADR-0015，本地输入保持可用。

#### Scenario: Workspace loads without agent surfaces

- **WHEN** 用户打开桌面工作区
- **THEN** 页面 MUST NOT 渲染 Agent 时间线、Composer、Agent 状态条、共享 Session ID 按钮或提示词历史入口

#### Scenario: Open settings from header

- **WHEN** 用户点击 Header 设置按钮
- **THEN** 系统 MUST 进入单页 Settings Workspace 并保留返回入口

#### Scenario: Open a local capability panel

- **WHEN** 用户从会话菜单选择文件传输或环境快照
- **THEN** 对应面板 MUST 在该 Session 内容区打开，不向 Header 增加资源监控

## ADDED Requirements

### Requirement: File Transfer Preparation

界面 MUST 提供多文件与目录选择、真实拖入、指定远端路径下载和本机保存位置选择，展示目标、路径、选择摘要及启动入口。未启用或未明确回到空闲 Shell 时 MUST 只准备请求，不发送命令或 Ctrl+C。安装、文件选择等等待后 MUST 重新核对目标及选择有效性。

#### Scenario: Drag into an unknown foreground

- **WHEN** 用户向编辑器或未验证 Session 拖入文件
- **THEN** 界面 MUST 展示选择摘要及启用说明，不中断前台或开始传输

#### Scenario: Start a download

- **WHEN** 用户指定远端路径、选择本机保存位置并在有效前提下启动
- **THEN** 界面 MUST 显示本次目标和路径，文件仅保存到授权范围

### Requirement: Detection and Installation Controls

文件面板 MUST 提供检测与重新检测入口，分别展示上传、下载工具状态、路径、版本、检测环境和时间。状态 MUST 区分缺失、不兼容、受限、未完成与过期。存在适用固定方案时提供快速安装和复制命令；预览 MUST 展示完整命令、来源、版本、位置及联网和权限条件，复制不执行。第三方审计记录不影响已验证方案可用性。

安装与复检 MUST 分别显示进度和结果。复检成功返回准备页面，不自动传输；过期引用要求重新选择。无适用方案时 MUST 提供具体原因与手工安装后复检指引。

#### Scenario: Only upload is available

- **WHEN** 上传能力通过检测，下载能力缺失
- **THEN** 界面 MUST 分别显示上传可准备与下载不可用原因

#### Scenario: Preview is copied or cancelled

- **WHEN** 用户仅复制安装命令或关闭预览
- **THEN** 系统 MUST 不执行安装，保留可展示的选择摘要，不延长旧引用

#### Scenario: Installation recheck fails or remains unknown

- **WHEN** 安装结束后存在 PATH、版本、权限问题或没有可靠结果
- **THEN** 界面 MUST 显示具体原因和复检入口，不显示传输就绪或自动重试

### Requirement: Operation Results and Recovery Feedback

界面 MUST 区分准备、忙碌、执行中、取消中、成功、部分完成、失败、未确认与输出不可用，展示逐文件跳过、冲突和换名处理。输出不可用时 MUST 显示“无法安全区分文件数据与终端输出”的原因及新建 Session 指引，保留本地输入和关闭入口，不提供强制显示原始数据或自动重连。

#### Scenario: A filename cannot be represented or already exists

- **WHEN** 目的文件系统拒绝名称或存在同名冲突
- **THEN** 界面 MUST 说明原因并允许跳过或换名，默认保留原文件

#### Scenario: Cancellation lacks confirmation

- **WHEN** 用户点击取消但未取得对应结束证据
- **THEN** 界面 MUST 显示未确认；输出边界也无法确认时，同时显示输出不可用

#### Scenario: User switches Sessions or reloads the window

- **WHEN** Session A 的操作仍运行，用户切换至 B 或重载界面
- **THEN** 状态 MUST 保持归属 A，重载只读取当前状态，不复活旧操作或覆盖 B

### Requirement: Snapshot Presentation

快照面板 MUST 显示环境、身份、目录、CPU、内存、磁盘、采样时间与统计口径，并提供手动刷新。过期、暂停、待验证和逐项不可用 MUST 用文本说明，不能仅靠颜色或以零值代替。未知状态不得触发自动采集。

#### Scenario: Display stale or partially available data

- **WHEN** 用户已离开采样环境或部分指标不可用
- **THEN** 界面 MUST 保留原环境和时间，显示过期及各项原因，不改标签冒充新数据

### Requirement: Restricted Local Capability API

本机文件访问、组件资源和协议处理 MUST 由 Main 通过受限 preload API 管理。Renderer 只能提交固定操作、有限选择或安装方案引用及已校验参数，接收有界状态；MUST NOT 通过该接口执行任意命令、读取任意本机路径、访问任意网络端点或取得原始协议。Main MUST 验证来源、参数、Session 及引用有效性。

#### Scenario: Renderer fabricates a capability

- **WHEN** Renderer 提交伪造本机路径、自定义安装命令、任意下载源或跨 Session 引用
- **THEN** Main MUST 在文件访问或终端写入前拒绝请求
