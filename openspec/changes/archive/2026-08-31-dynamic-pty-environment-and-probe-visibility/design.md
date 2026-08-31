## Context

当前分支的字面执行链路由 `CommandExecutor` 直接使用 `SessionState.terminalType` 选择 Shell Driver。`terminalType` 是创建 Session 时的启动提示，用户进入 SSH、跳板机、容器或 WSL 后，同一个 PTY 里运行的当前 Shell 可能已经改变，因此继续使用启动提示会把完成探针写成错误方言。

本变更还要处理完成探针的输入回显。`SessionActor` 当前在事件分发前统一过滤探针回显，所以终端 UI、命令输出缓冲和外部客户端使用了同一条输出链路。用户需要一个只影响本地终端 UI 的诊断开关；无论开关状态如何，OSC 777 控制帧、事务解析和外部客户端返回值都必须继续隔离。

实现必须遵守现有边界：Session 仍然只是应用持有的本地 PTY，不创建 SSH/服务器拓扑；Renderer 只能通过 preload API；用户命令保持字面原文写入，不使用 Base64、`eval` 或命令 wrapper。

## Goals / Non-Goals

**Goals:**

- 为每个 Session 保存当前 PTY environment 的 dialect、platform、验证状态、验证时间和 capability epoch。
- 在外部结构化命令写入前，用固定、有限、带 nonce 的明文 Probe 识别当前 PTY 方言；SSH/容器/WSL 后按当前结果选择 Driver。
- 用户输入使环境 capability 失效；外部写入使用独立的租约校验，不把自己误标记为用户接管；未知、歧义、超时和竞态均拒绝结构化写入。
- 将“隐藏完成探针回显”作为通用设置持久化，并通过受限 IPC 应用到本地终端 UI。
- 保持外部客户端输出缓冲、控制帧隔离和脱敏不受 UI 开关影响。

**Non-Goals:**

- 不解析 SSH 跳转、堡垒机、容器或 WSL 拓扑，也不新增主机资产或凭据模型。
- 不把用户命令改写为脚本、wrapper、Base64 或 `eval`；Probe 本身也只能使用固定的明文命令。
- 不让“显示探针回显”改变探针是否写入 PTY、远程服务器/终端审计可见性、退出码或事务完成语义。
- 不为资源目录、任意命令能力数据库或跨应用持久化 Session 增加新模型。

## Decisions

### 1. 启动 Shell 只作为 hint，environment 是唯一执行事实

`SessionState` 保留现有 `terminalType` 供 UI 展示，但新增 `environment`。environment 初始为 `unverified`，dialect/platform 为 `unknown`；即使启动提示能推断出方言，也不得直接授权结构化写入。这样可以保证从 PowerShell SSH 到 Linux、或从 Bash 进入 PowerShell 时都遵循同一条路径。

### 2. 用两阶段、固定来源的明文 Probe

Probe 第一阶段发送固定的跨方言 fingerprint 命令并带 nonce，从当前 PTY 输出中严格识别 `posix` 或 `powershell`；第二阶段由已识别的 Driver 发送只读的操作系统指纹和 OSC 777 完成帧。Probe 只接受匹配 nonce、成功完成帧和明确平台值。Probe 受 deadline 限制，不能由调用方注入任意脚本。

选择 Probe 而不是信任 `terminalType`，是因为终端中的 SSH/容器/WSL 只改变 PTY 内的当前环境；选择固定命令而不是模型生成诊断命令，是为了在环境未验证时仍然可审计且不产生副作用。

### 3. capability epoch 与外部租约双重校验

用户输入会递增 environment capability epoch 并归还用户租约。外部调用先取得与 caller 绑定的 Session 租约，再以租约 epoch 和 environment epoch 启动 Probe/命令写入。SessionActor 新增独立的外部写入入口；`writeUser` 继续只表示本地输入并触发失效。任一校验失败都在 PTY 写入前返回 observation-only/拒绝。

### 4. 输出拆分为协议链路和 UI 链路

SessionActor 先分离 OSC 777 控制帧，再产生两类输出：协议链路始终过滤完成探针输入回显，供 CommandExecutor 和 MCP 缓冲使用；UI 链路根据 `hideCompletionProbeEcho` 过滤或保留探针输入回显。控制帧在两条链路都不可见。关闭开关只让 UI 获得诊断信息，不会把协议噪声重新放入外部客户端输出。

### 5. 通用设置独立于 MCP 服务设置

新增 `GeneralSettings` 与独立的设置存储文件、IPC 通道和 preload API。默认 `hideCompletionProbeEcho: true`；Main 在加载设置后把值下发给 TerminalHost/SessionActor。MCP 端口、Token 和审批模式继续由 MCP 服务设置持有，避免把本地 UI 偏好错误地放进 MCP 服务配置。

### 6. 失败安全而非猜测回退

Probe 超时、输出含糊、SSH 登录仍在交互、用户在 Probe 期间输入、PTY 退出或 epoch 过期时，Session 保持可观察但不允许结构化命令。实现不得退回启动 `terminalType`，也不得因为 UI 开关关闭而放宽协议过滤。

## Risks / Trade-offs

- [交互式 SSH 登录或密码提示吞掉 Probe] → 使用共享 deadline、唯一 nonce 和严格成功条件；失败只返回 observation-only，不发送用户命令。
- [某个 Shell 的输出包含 Probe 标记] → 标记包含随机 nonce，且必须同时满足方言、平台和 OSC 完成帧校验；异常输出不升级为 verified。
- [ConPTY 重绘让 Probe 输入回显变形] → UI/协议两条链路都使用可跨 ANSI 控制序列的匹配；协议链路始终隐藏，UI 开关关闭时保留原始诊断回显。
- [用户输入与外部调用竞态] → 所有写入经过 SessionActor 队列，用户写入递增 epoch；外部调用在真正写入前重新检查租约和 epoch。
- [旧设置文件没有新字段] → sanitize 使用默认 `true`，不需要迁移脚本；设置仅保存在本机用户数据目录。

## Migration Plan

1. 先扩展 domain environment 类型和 SessionActor 的失效/外部写入边界，再添加失败测试。
2. 添加固定明文 Shell Probe，并让 CommandExecutor 在发送用户命令前取得 verified environment；更新外部管线使用当前 environment 做策略提示。
3. 拆分 UI 与协议输出事件，加入 GeneralSettings 的 Main/preload/Renderer 链路和默认值兼容。
4. 运行定向单测、全量 `pnpm verify`、构建和真实 Electron E2E；确认启动后的正式应用仍只在回环地址提供 MCP。

回滚时可移除本变更代码；新增设置字段缺失时自动回到默认值。Probe 不兼容时保持 observation-only，不恢复未经验证的旧执行路径。

## Open Questions

- 后续是否需要把 Probe 识别结果展示为单独的 Session 状态徽标？本变更只要求安全执行和通用设置，不增加新的 UI 状态面板。
