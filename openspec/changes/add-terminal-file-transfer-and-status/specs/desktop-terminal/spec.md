## MODIFIED Requirements

### Requirement: Terminal-Only Workspace

桌面工作区 MUST 以终端会话为主要内容，MUST NOT 展示 Agent 面板、Composer、ACP 切换或审计入口；Header MUST 只包含品牌、会话标签操作和设置入口，不展示资源监控。会话操作菜单可提供显式 Sharing，并 MUST 提供文件传输和环境快照入口；这两个本地功能 MUST 位于对应 Session 内容区的可关闭面板。外部调用触发的审批卡片和外部执行状态遵循 ADR-0015，本地终端输入始终保持可用。

#### Scenario: Workspace loads without agent surfaces

- **WHEN** 用户打开桌面工作区
- **THEN** 页面 MUST NOT 渲染 Agent 时间线、Composer、Agent 状态条、共享 Session ID 按钮或提示词历史入口

#### Scenario: Open settings from header

- **WHEN** 用户点击 Header 的“设置”按钮
- **THEN** 系统 MUST 进入单页 Settings Workspace 并保留返回工作区入口

#### Scenario: Open local capability panels

- **WHEN** 用户从会话操作菜单选择文件传输或环境快照
- **THEN** 对应面板 MUST 在当前 Session 内容区打开，Header 不新增资源监控控件，关闭面板后终端仍可使用

## ADDED Requirements

### Requirement: File Transfer Entry Points

桌面 UI MUST 提供多文件/目录上传按钮、真实文件拖入，以及指定远端文件/目录路径的下载入口。UI MUST 展示当前操作目标、路径、文件选择、进度和取消；不提供远端目录浏览器。未启用、未知目标或尚未声明回到空闲 Shell 时，拖入和按钮操作 MUST 只准备请求，不自动向终端发送命令或 Ctrl+C。

#### Scenario: Drag files into an unprepared Session

- **WHEN** 用户向尚未验证的终端拖入文件或目录
- **THEN** UI MUST 展示待上传选择和启用说明，不自动打断前台程序、不开始传输

#### Scenario: Download explicitly selected remote paths

- **WHEN** 用户指定远端路径并选择本机保存位置，在当前有效操作前提下启动下载
- **THEN** UI MUST 展示本次路径及目标环境，Main 仅在对应选择范围内保存文件

### Requirement: Transfer Tool Detection Controls

文件面板 MUST 提供“检测当前环境”和重新检测入口，在发送命令前满足本次明确启用与空闲 Shell 前提。UI MUST 分别展示上传与下载工具的状态、可用的路径/版本、检测时间及原因；使用 `trzsz` 时明确上传依赖目标的 `trz`、下载依赖目标的 `tsz`。状态 MUST 区分未检测、检测中、可用、缺失、版本/能力不兼容、执行受限、检测未完成和过期，不能把超时或未验证统一显示为未安装。

#### Scenario: User requests a check from an unknown foreground

- **WHEN** 用户点击检测，但尚未明确回到空闲 Shell 或当前操作前提已失效
- **THEN** UI MUST 展示启用步骤与待验证状态，不能直接注入检查命令或自动中断前台程序

#### Scenario: Upload is available but download is missing

- **WHEN** 复核确认上传工具兼容可用，而下载工具缺失
- **THEN** UI MUST 分别展示上传可准备和下载需安装，不将整个文件面板标为已就绪或全部不可用

#### Scenario: A previous check becomes stale

- **WHEN** 用户输入或其他上下文变化使工具检测结果失去当前执行前提
- **THEN** UI MUST 保留可辨认的原检测环境/时间并标为过期，不能沿用旧“可用”状态自动启动操作

### Requirement: Guided Transfer Tool Installation

对于缺失、不兼容或执行受限的工具，UI MUST 说明具体问题，并在存在适用方案时提供“快速安装”“复制安装命令”和“重新检测”。快速安装 MUST 先展示本次目标环境、完整明文命令、来源、固定版本、安装位置及联网/权限/基础工具条件，由用户选择执行；复制只写入剪贴板，不发送 PTY 输入。没有已验证适用方案时 MUST 明确说明快捷执行不可用，保留目标认可的手工安装指引与复检入口。

UI MUST 展示安装及复检的独立进度与结果；只有工具路径、版本和可运行性复检通过后才能表示本次检查可用。安装完成 MUST 返回原上传/下载准备步骤，不自动传文件；保留选择摘要供用户复核，但不得续用过期操作或文件授权。

#### Scenario: Preview or copy an installation command

- **WHEN** 用户打开快速安装预览或选择复制完整安装命令
- **THEN** UI MUST 显示当前环境与安装条件，系统 MUST 不因此写入 PTY 或启动安装

#### Scenario: User cancels the installation preview

- **WHEN** 用户关闭安装预览或取消执行
- **THEN** 系统 MUST 保留文件操作准备状态且不安装、不丢失可展示的选择摘要，也不延长旧文件引用的有效期

#### Scenario: User finishes manual installation

- **WHEN** 用户通过目标认可的方式手工安装工具后，在当前空闲 Shell 重新启用并请求检测
- **THEN** 系统 MUST 通过明文复检更新实际能力，允许回到原文件操作准备步骤，不要求应用重新安装或再次认证

#### Scenario: Installation completes but recheck fails

- **WHEN** 安装命令结束后发现 PATH、版本或执行权限不满足要求
- **THEN** UI MUST 显示复检原因及重新检测/手工处理入口，不能显示传输已就绪或自动重试安装

#### Scenario: Successful installation returns to transfer preparation

- **WHEN** 安装和复检成功且原上传/下载准备仍可展示
- **THEN** UI MUST 返回准备页面供用户复核当前目标、路径及文件，失效引用要求重新选择；用户启动新的传输操作前不得发送文件

### Requirement: Local Operation Feedback

UI MUST 区分准备/启用、忙碌、执行中、取消中、全部成功、部分完成、失败和未确认结果，展示逐文件冲突/跳过原因及可用的取消/接管入口。用户输入始终保持可用；取消按钮点击或本地 backend 接受写入 MUST NOT 直接显示远端已完成/已取消。切换 Session 后事件 MUST 仍归属于原 Session 和操作。

#### Scenario: A filename conflict occurs

- **WHEN** 接收位置已有同名文件
- **THEN** UI MUST 默认保留原文件，展示跳过或换名处理，不能默认覆盖

#### Scenario: User switches Sessions during transfer

- **WHEN** Session A 的传输仍在进行，用户切到 Session B
- **THEN** 进度和结果 MUST 保持归属 A，不改变 B 的终端或目标；回到 A 时读取其当前操作状态

#### Scenario: Cancellation is not acknowledged

- **WHEN** 用户取消后没有取得可靠远端结束证据
- **THEN** UI MUST 显示结果未确认，不能以取消按钮已点击为由显示已取消

### Requirement: Snapshot Presentation

环境快照面板 MUST 展示环境、身份、目录、CPU、内存、磁盘、采样时间与指标口径，提供手动刷新入口。过期、忙碌、未验证和逐项不可用 MUST 有明确文本状态，不能仅用颜色表示，也不能将缺失值显示为零。面板 MUST 不承诺实时监控或后台刷新。

#### Scenario: Show stale data after a hop

- **WHEN** 用户改变环境或操作前提失效
- **THEN** 面板 MUST 保留旧样本环境和时间并显示过期，不将旧数据重新标记为新目标状态

#### Scenario: Some metrics are unavailable

- **WHEN** 当前权限或平台不支持部分指标
- **THEN** UI MUST 为该项显示原因，其他有效项继续展示，用户可辨认当前统计口径

### Requirement: Restricted Local Capability API

文件选择、路径授权、文件 I/O、工具检测、固定安装方案、组件资源和协议状态 MUST 由 Main 通过受限 preload API 管理。Renderer MUST 只能提交已定义操作、有限选择/安装方案引用和已校验参数，读取完整只读命令预览并接收有界进度/快照；MUST NOT 请求任意本机路径读取、任意命令执行、网络端点、原始 PTY 字节或 Session 内部状态。Main MUST 验证调用来源、参数、Session 和操作引用的有效性。

#### Scenario: Renderer fabricates a local path

- **WHEN** Renderer 试图用未经过真实用户选择的任意路径或其他 Session 的选择引用上传文件
- **THEN** Main MUST 拒绝该请求，不能读取或传输该本机文件

#### Scenario: Renderer submits a custom installer

- **WHEN** Renderer 请求执行自定义安装命令、任意下载源或属于其他 Session/过期操作的安装方案
- **THEN** Main MUST 在命令写入前拒绝请求，不能将安装接口扩展为任意执行或网络访问入口

#### Scenario: Renderer reloads during an operation

- **WHEN** Renderer 重载后重新订阅本地功能
- **THEN** Main MUST 只返回该 Session 当前有界状态，不能暴露文件流、原始载荷或可重放的内部执行资格
