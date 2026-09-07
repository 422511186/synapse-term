## ADDED Requirements

### Requirement: Literal Local Operation Commands

应用发起的工具检测、组件安装/部署、安装后复检、启用、文件操作及环境采集 MUST 使用固定且完整可检查的明文命令。系统 MUST NOT 加密或 Base64 编码待执行命令/脚本，不得使用等价混淆、解码执行、`eval`、`EncodedCommand` 或通过辅助程序协议传送隐藏执行指令。每次实际操作 MUST 有明确的明文启动语义，单个通用辅助程序启动不能替代后续执行命令的可审计性。

#### Scenario: Snapshot uses readable commands

- **WHEN** 用户请求当前平台的环境快照
- **THEN** 目标 PTY MUST 收到该平台固定采集命令或完整明文采集片段，实际执行内容不得只存在于编码字符串或隐藏 RPC 中

#### Scenario: Encoded execution is rejected before writing

- **WHEN** 某个部署或执行路径需要发送编码脚本、解密后执行或协议内任意命令
- **THEN** 系统 MUST 拒绝该路径并报告具体不可用原因，MUST NOT 写入该执行载荷或寻找另一种混淆编码继续执行

### Requirement: File Payload Is Never an Execution Channel

文件内容 MUST 只作为用户明确选择的文件操作数据，允许协议为传输进行编码、压缩与完整性校验。接收器 MUST NOT 将文件数据、文件名或配置中的内容求值为命令、加载为插件或自动执行；系统 MUST NOT 以上传文件后自动执行的方式规避明文部署要求。SSH 既有传输加密不改变明文命令规则。

#### Scenario: Upload a script as a user file

- **WHEN** 用户明确上传一个脚本文件，其内容经过文件协议编码传输
- **THEN** 系统 MUST 只保存用户选择的文件，MUST NOT 自动执行、source 或导入该文件

#### Scenario: Protocol requests arbitrary execution

- **WHEN** 对端或 Renderer 试图在文件协议中提交任意执行指令
- **THEN** 系统 MUST 拒绝该消息并停止受影响操作，不能将其转交 Shell

### Requirement: Explicit Activation in an Idle Shell

尚未验证的新环境 MUST 由用户在空闲 Shell 主动启用，应用 MUST 提供可检查的明文步骤。打开面板、拖入文件或 PTY 处于 running 状态 MUST NOT 自动授权 Probe、Ctrl+C 或启动命令；提示符文本和旧环境信息 MUST NOT 被当作当前 Shell 空闲证明。

#### Scenario: Open a panel inside an editor

- **WHEN** 用户在编辑器、密码提示或跳板菜单中打开文件/快照面板或拖入文件
- **THEN** 应用 MUST 只准备 UI 操作并提示回到 Shell，MUST NOT 自动中断当前程序或向 PTY 注入命令

#### Scenario: Activate after a nested hop

- **WHEN** 用户在最内层新环境回到空闲 Shell 并主动执行启用步骤
- **THEN** 应用 MUST 仅根据本次匹配响应建立操作前提，不要求重新认证，也不复用上一层的操作绑定

### Requirement: Guarded Transfer Tool Detection

系统 MUST 提供用户发起的当前环境工具检测，并在用户明确选择的有界启用流程内自动检测一次；有效上传/下载准备流程内可按需复检。所有检测 MUST 使用通过当前 PTY 发送的固定明文命令，具有本次空闲 Shell 的明确操作前提、有限时间/输出预算和结束证据。打开面板、拖入、切换 Session、普通输出或计时器 MUST NOT 触发检测；繁忙或未知前台状态下不得注入命令、自动 Ctrl+C 或等待猜测空闲后补发。

对于 `trzsz` 候选，系统 MUST 分别检查上传接收工具 `trz` 和下载发送工具 `tsz` 的实际路径、兼容版本及所需运行能力；只找到同名命令不能判为可用。结果 MUST 绑定检测时的 Session、环境和操作，前提失效后只作过期参考，不能继承为后续执行授权。检测、安装和复检 MUST 与其他本地操作、MCP Probe 及外部写入遵循相同的 Session 级有序协调。

#### Scenario: Explicit activation includes one detection

- **WHEN** 用户在空闲 Shell 主动开始启用流程，且该有界操作仍持有有效资格
- **THEN** 系统 MUST 按序执行一次固定明文工具检测，不能因此建立周期检测或跳转后自动检测权限
- **AND** 检测到文件工具缺失 MUST 不阻断同一启用流程内独立满足前提的首次快照

#### Scenario: Only one transfer direction is available

- **WHEN** 目标只具备上传或下载其中一个方向所需的兼容工具
- **THEN** 系统 MUST 分别报告两个方向的能力，在对应协议前提满足时允许可用方向的操作，不能以发现 `trz` 代替 `tsz` 检查

#### Scenario: Detection lacks completion evidence

- **WHEN** 工具检测超时、取消、输出无法可靠解析或没有取得结束证据
- **THEN** 系统 MUST 报告检测未完成，不能将该结果判为工具缺失、触发自动安装或重放检测命令

#### Scenario: Context changes before a scheduled check

- **WHEN** 用户输入、外部写入或其他失效事件发生在检测写入前，或旧结果尚在界面展示时
- **THEN** 系统 MUST 撤销旧执行资格并将结果标为过期，未发送的检查不得写入新的环境；重新检测需要本次明确操作前提

### Requirement: Auditable Component Provisioning

系统 MUST 优先识别当前环境已存在且兼容的工具。缺少组件时，应用提供组件的基线路径 MUST 使用已验证的完整明文引导，在当前用户允许的位置准备，不依赖目标联网、提权、凭证输入、Shell 启动文件修改或后台服务。组件来源、固定版本、安装位置、完整引导内容、基础工具与权限要求 MUST 可检查；不可满足时 MUST 明确不可用，不得静默改为编码可执行内容后解码运行。

系统可另行提供经验证且目标认可的联网包管理器安装，但 MUST 明示联网与安装条件，由用户明确选择，MUST NOT 替代离线基线验收或静默联网。安装器的脚本/生命周期行为 MUST 纳入审计验证，不能只检查最外层安装命令。快速安装 MUST 先展示完整命令与条件，只有用户选择执行并通过当前操作前提再验证后才可写入当前 PTY；复制命令 MUST 不触发执行。没有已验证适用方案时 MUST 说明原因并提供手工安装后复检的路径，不生成未验证的快捷执行命令。

#### Scenario: A compatible tool is already available

- **WHEN** 当前环境存在兼容且允许运行的工具
- **THEN** 应用 MUST 通过明文能力检查与明文启动使用该工具，不重新安装、不重新认证

#### Scenario: Offline ordinary-user provisioning

- **WHEN** 当前环境缺少工具，但满足已验证明文引导的基础条件
- **THEN** 应用 MUST 能通过既有 PTY 和打包资源在普通用户权限下准备组件，目标无需访问外网，也不得执行编码命令/脚本

#### Scenario: Provisioning is blocked by the target

- **WHEN** 目标缺少必要基础工具、没有允许的可写/可执行位置，或执行策略不接受明文部署
- **THEN** 应用 MUST 显示具体不可用原因，保持普通终端可用，MUST NOT 自动提权、修改执行策略、索取凭证或回退隐藏引导

#### Scenario: User selects an optional network installer

- **WHEN** 当前环境满足已验证联网安装方式的普通用户权限与目标审计条件，用户查看完整命令后选择该方式
- **THEN** 系统 MUST 经当前 PTY 明文执行固定方案，标明联网、来源、版本和安装位置，不重新认证、不自动提权
- **AND** 该方式成功 MUST 不替代三平台离线组件提供的验收证据

#### Scenario: Install confirmation belongs to an old environment

- **WHEN** 用户查看安装预览期间发生输入或环境失效，随后点击执行
- **THEN** 系统 MUST 在安装命令写入前拒绝旧方案的执行资格，要求重新建立当前操作前提，不能把安装转交新响应环境

#### Scenario: No verified installation plan is available

- **WHEN** 当前环境没有符合基础条件与目标审计要求的已验证安装方案
- **THEN** 系统 MUST 禁用快捷执行并说明原因，保留手工安装指引和重新检测入口，不生成编码引导、不自动下载执行不透明脚本

### Requirement: Verified Installation Completion

安装命令结束后，系统 MUST 复核所需工具的实际路径、兼容版本及可运行性，不能仅凭退出码显示文件能力可用。自动复检 MUST 限定在同一有界安装流程内，并在取得命令返回同一 Shell 的可靠完成证据后重新校验写入资格；缺少证据、用户接管或环境变化后 MUST 暂停并等待用户重新建立操作前提，不自动重试安装。流程终态 MUST 撤销写入资格，安装或检测成功不得自动开始文件传输。

#### Scenario: Installed tools are absent from PATH

- **WHEN** 安装返回成功，但工具只存在于本次方案声明的用户目录而未加入 PATH
- **THEN** 系统 MUST 验证该明确绝对路径的版本及运行能力，或者保持不可用并说明原因；不得自动修改 Shell 启动文件或要求重新登录

#### Scenario: Installer did not produce a compatible executable

- **WHEN** 安装命令返回成功，但实际工具缺失、版本不兼容或被执行策略阻止
- **THEN** 系统 MUST 显示具体复检结果，不能将其标为可用或继续发起上传下载

#### Scenario: Installation result is unknown

- **WHEN** 安装可能已执行但结束证据丢失，或用户在安装中接管终端
- **THEN** 系统 MUST 停止自动复检并报告结果未确认/待验证，不向可能正在登录或交互的前台发送命令，也不重跑安装

#### Scenario: Post-installation checks succeed

- **WHEN** 当前安装流程取得可靠结束证据且复检确认工具兼容可运行
- **THEN** 系统 MUST 结束安装流程并返回上传/下载准备步骤，由用户复核目标和选择后建立新的传输操作；不得自动发送文件或复活失效引用

### Requirement: Target-Side Audit Evidence

对“符合目标审计”的验收 MUST 基于目标审计设施的实际记录，覆盖工具检测、组件安装/部署及其脚本行为、安装后复检、每次启动、采集、取消与失败路径；MUST 区分命令可读性、工具内部行为和逐文件操作记录。若目标要求逐文件路径或覆盖记录，编码的协议元数据 MUST NOT 被当作可读的审计证据。本地 UI、命令预览或自建本地日志 MUST NOT 代替目标记录，产品 MUST NOT 为此新增集中审计收集或持久化运行审计日志。

#### Scenario: Only a helper startup is recorded

- **WHEN** 目标审计只记录辅助程序启动，而实际后续执行发生在编码消息中
- **THEN** 该方案 MUST 判为不符合明文命令要求，不能因为启动命令可读而通过验收

#### Scenario: Encoded metadata does not meet a path audit rule

- **WHEN** 目标要求记录逐文件路径，但所选协议只在编码元数据中携带文件名
- **THEN** 系统 MUST 在确认实际路径记录满足该目标要求前将此审计组合列为未通过，不能仅切换二进制数据模式后宣称解决

#### Scenario: Audit evidence is unavailable

- **WHEN** 没有目标审计设施或实际记录可用于验证
- **THEN** 验证结论 MUST 标记为未验证，MUST NOT 以工具文档、命令字符串测试或 mock 结果宣称目标审计通过

#### Scenario: Installer hides executable setup content

- **WHEN** 最外层安装命令可读，但其下载或生成的待执行脚本未经检查，或实际执行仍隐藏在编码内容中
- **THEN** 系统 MUST 将该安装方式列为未验证或不符合审计要求，不能仅凭包管理器命令原文通过验收

### Requirement: Three-Platform Compatibility Evidence

本变更的验收 MUST 覆盖 Linux、macOS 和 Windows 目标环境，并记录实际 Shell、系统/架构、组件版本、基础工具及多跳/终端组合。MUST 包含明文启用、两个方向的工具检测、离线组件提供、适用的可选安装方式及安装后复检、上传下载、快照、用户接管和协议失败的代表性真实验证。未知或不兼容组合 MUST 有具体不可用说明；MUST NOT 将整个平台标为不可用后宣称完成三平台支持。

#### Scenario: One target platform is not exercised

- **WHEN** 只验证 Linux，macOS 或 Windows 目标尚未验证
- **THEN** 本变更的三平台验收 MUST 保持未完成，不能以客户端可在对应系统启动替代目标能力验证

#### Scenario: An intermediate terminal filters the protocol

- **WHEN** 某条堡垒机或嵌套终端链路不能完整传递协议
- **THEN** 应用 MUST 明确报告该组合不可用并停止操作，不新建认证链路、不自动重放命令或文件数据
