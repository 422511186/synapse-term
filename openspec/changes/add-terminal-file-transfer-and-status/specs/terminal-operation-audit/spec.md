## Purpose

规定桌面本地终端操作的主动启用、固定明文执行、工具检测、组件提供与安装复检行为，使用户能够在当前认证环境中使用功能，并清楚了解执行条件、结果及不可用原因。

## ADDED Requirements

### Requirement: Literal Local Operation Commands

工具检测、组件部署、安装复检、传输启动和环境采集 MUST 使用固定、完整可检查的明文命令或采集片段。系统 MUST NOT 发送编码命令或脚本、解码执行、`eval`、`EncodedCommand` 或协议内隐藏执行指令。文件内容允许编码与压缩，但 MUST 只写入指定文件，不得自动执行、source、加载为插件或作为命令求值。

#### Scenario: Upload a script file

- **WHEN** 用户明确上传脚本文件
- **THEN** 系统 MUST 仅保存该文件，不因内容是脚本而执行它

#### Scenario: An operation contains hidden execution

- **WHEN** 操作需要编码脚本、任意执行消息或未经检查的下载即执行内容
- **THEN** 系统 MUST 在发送前拒绝该路径并说明原因，不自动更换混淆方式

### Requirement: Explicit Activation in an Idle Shell

新环境 MUST 由用户在空闲 Shell 主动启用，启用步骤和实际命令 MUST 可检查。打开面板、拖入文件、普通输出和 PTY running MUST NOT 触发检测、启动命令或 Ctrl+C。启用记录只表示准备状态；每次实际操作 MUST 有用户当前请求、明确的空闲前提和匹配本次操作的响应，不能使用旧环境名称作为执行资格。

#### Scenario: Open a panel inside an editor

- **WHEN** 用户在编辑器、密码提示或跳板菜单中打开面板或拖入文件
- **THEN** 系统 MUST 只准备界面并提示回到 Shell，不注入命令或中断

#### Scenario: Activate a nested environment

- **WHEN** 用户进入新的 SSH、容器、WSL 或身份环境并主动启用
- **THEN** 系统 MUST 根据本次响应建立操作前提，不重新认证，不复用上一层绑定

### Requirement: Directional Tool Detection

系统 MUST 提供手动检测、明确启用流程内的一次自动检测和有效传输准备流程内的按需复检。上传与下载能力 MUST 分别检查可执行路径、兼容版本和运行能力。结果 MUST 附环境与检测时间，区分未检测、检测中、可用、缺失、不兼容、执行受限、检测未完成和过期。计时器、切换 Session 和未知前台 MUST NOT 触发检测或延迟补发。

#### Scenario: Only one direction is available

- **WHEN** 当前工具只支持上传或下载中的一个方向
- **THEN** 系统 MUST 分别展示两侧结果，允许准备可用方向，不把另一侧标为可用

#### Scenario: Detection does not finish reliably

- **WHEN** 检测超时、输出不可解析或缺少可靠结束证据
- **THEN** 系统 MUST 显示检测未完成，不判定缺失或自动安装

#### Scenario: Activation includes detection and a snapshot

- **WHEN** 用户主动启用且流程仍有有效资格
- **THEN** 系统 MUST 按序检测工具并采集首次快照，工具缺失不阻断独立可用的快照，也不建立周期检测权限

### Requirement: Auditable Component Provisioning

系统 MUST 优先使用当前环境已有的兼容工具。组件提供基线 MUST 支持满足明确基础条件的 Linux、macOS、Windows 目标，通过现有 PTY 在普通用户可写且允许运行的位置离线准备组件。来源、固定版本、完整引导、安装位置和基础条件 MUST 可检查；MUST NOT 索取新凭证、自动提权、修改 Shell 启动文件、绕过执行策略或创建后台服务。预编译文件或脚本 MUST NOT 被作为编码文件载荷自动执行以规避明文规则。

#### Scenario: Provision on an offline target

- **WHEN** 当前环境缺少工具且满足已声明的明文部署条件
- **THEN** 系统 MUST 能使用随应用提供的资源完成普通用户部署，无需目标联网或重新认证

#### Scenario: Target prerequisites are missing

- **WHEN** 缺少基础工具、允许的可执行位置或执行权限
- **THEN** 系统 MUST 说明具体不可用原因，保持普通终端可用，不绕过限制

### Requirement: Explicit Installation and Verified Completion

快速安装 MUST 展示完整命令、目标、来源、版本、位置及联网和权限条件；仅在用户选择执行并重新验证操作前提后写入 PTY。联网包管理器安装为显式可选路径，MUST 验证其安装脚本与内部行为，不能替代离线基线。复制命令 MUST 不执行；无适用已验证模板时 MUST 提供原因与手工安装指引。

安装完成 MUST 在同一有界流程中复核路径、版本和运行能力，取得返回同一 Shell 的结束证据后才能自动复检。复检成功 MUST 返回文件准备步骤，不自动传输或延长失效文件引用；结果不确定时 MUST 停止后续步骤，不自动重装。

#### Scenario: An install plan becomes stale

- **WHEN** 预览安装方案后发生用户输入或环境变化，随后用户选择执行
- **THEN** 系统 MUST 拒绝旧方案，要求重新建立当前操作前提

#### Scenario: Installed tools are absent from PATH

- **WHEN** 工具安装到声明的用户目录但 PATH 未更新
- **THEN** 系统 MUST 验证该明确绝对路径，或报告不可用原因，不修改 Shell 配置或要求重新登录

#### Scenario: Installation lacks completion evidence

- **WHEN** 安装可能已执行但结束证据丢失，或用户接管终端
- **THEN** 系统 MUST 显示结果未确认并暂停复检，不发送额外安装命令

#### Scenario: Recheck succeeds

- **WHEN** 安装或手工安装后的检测确认所需工具可运行
- **THEN** 系统 MUST 返回准备状态，由用户复核目标与文件后启动独立传输

### Requirement: General-Purpose Verification

交付 MUST 验证明文命令、完整引导、组件来源及真实执行行为，覆盖三个目标平台的检测、离线部署、安装复检、传输、快照、取消与失败路径。第三方审计系统的通过记录 MUST NOT 成为交付或快捷安装的条件。若提供特定审计产品的兼容性结论，MUST 说明实际验证范围；编码文件名不得被描述为可读的逐文件审计记录。产品 MUST NOT 新增集中审计收集或持久化运行日志。

#### Scenario: No third-party audit product is available

- **WHEN** 通用功能及必需验证均已完成，但没有第三方审计记录
- **THEN** 本变更 MUST 允许交付，不能因此禁用已验证的安装方案或宣称特定审计产品已通过

#### Scenario: A target platform has not been exercised

- **WHEN** Linux、macOS 或 Windows 中任一目标平台尚未完成实际验证
- **THEN** 三平台验收 MUST 保持未完成，不能以客户端在该系统启动或将整个平台标为不可用代替
