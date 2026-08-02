## Context

当前 Core 通过 `ShellDriver` 向交互式 PTY 注入结构化事务。POSIX 实现把 UTF-8 脚本编码为 Base64，PowerShell 实现把 UTF-16LE 脚本编码为 Base64，再分别使用 `base64 -d`/`eval` 和 `FromBase64String`/`ScriptBlock::Create` 还原并执行。这样可以规避 PTY 行长度、引号和换行问题，但目标服务器在输入审计、会话录像或命令白名单阶段只能看到载荷拼接和解码器，不能审查真实命令。

目前 `ShellProbe` 主要依据 Session 创建时的本地 Shell 方言，并只在 capability epoch 已失效时运行跨环境指纹。用户从 PowerShell 通过 SSH 进入 Linux、进入容器或切换嵌套 Shell 后，本地启动信息不再是当前 PTY 解析器的事实源。`terminal_execute`、Probe 和资源刷新最终都进入同一个执行器，但缺少一个能从类型和测试上阻止未来旁路写入的明文 dispatch 边界。

审计范围还包括所有生产进程入口：`node-pty` 的 Shell 启动、`SessionActor` 的用户/Agent PTY 输入、Core 维护用的 `taskkill.exe`、桌面端读取注册表的 `reg.exe` 以及 Core 子进程 IPC。直接使用可见 executable 和 argv 的进程启动不是编码后动态执行；握手 token、输出日志和资源协议字段中的 Base64 是数据编码，也不应与命令载荷混淆。新设计只禁止“编码内容在目标 Shell 中被解码并作为代码执行”，同时要求这些边界有自动化证据。

## Goals / Non-Goals

**Goals:**

- 在第一次结构化 PTY 写入前，以及人工输入或接管使 capability epoch 失效后，识别当前 PTY 的 Shell dialect 和可用的环境平台；启动 Shell 只能提供候选提示。
- 让 POSIX 和 PowerShell 的命令、Probe、资源脚本在写入 PTY 时保持原始可读文本，并保持当前 Shell 的目录、变量和确定完成事件。
- 用一个受控 dispatch 入口覆盖所有 Core 生成的可执行 PTY 输入，阻止 `terminal_execute`、Probe、资源刷新或未来调用者绕过明文检查。
- 对环境不明确、事务无法安全明文封装、协议完成证据缺失或发现编码动态执行的情况 fail closed，返回稳定错误并保持 observation-only。
- 记录足以关联服务器会话审计的 transport、方言、平台、capability epoch、命令哈希和拒绝原因，同时不把 Protected Input 或秘密明文写入长期审计。

**Non-Goals:**

- 不解析 SSH、堡垒机、容器或 WSL 的拓扑，也不在产品中创建远端主机连接对象；系统只观察当前本地 PTY 的响应。
- 不保证任意交互式程序、恶意 `exit`/`exec`、不完整语法或用户自定义 Shell 都能被结构化事务可靠控制；无法证明时必须拒绝或交给用户接管。
- 不删除握手认证、日志存储或资源结果序列化中的所有 Base64；这些编码不得进入代码执行路径即可保留。
- 不在本变更中新增 `cmd.exe` 方言或任意远程文件/进程 Tool。
- 不把完整命令文本永久复制到长期审计以替代秘密保护；服务器 PTY 输入审计和本地命令哈希承担不同职责。

## Decisions

### 1. 将启动信息与当前环境身份分离

Session 增加独立的 environment capability 状态，而不是把启动时的 `executionDialect` 当作已验证事实。状态至少包含 `status = unverified | verified | observation_only`、`dialect = posix | powershell | unknown`、`platform = windows | unix | unknown`、`capabilityEpoch`、验证来源和时间。旧的启动方言保留为 hint，不能跳过验证。

验证分两步完成：先写入一条固定、无副作用、同时能被 POSIX Shell 和 PowerShell 解释的明文指纹；从其输出确定候选 dialect 后，只写入该 dialect 的固定明文环境/能力 Probe。两步都必须在有界时间内得到带 nonce 的响应。手工选择 dialect 只改变候选，不改变“必须验证”的要求。这样可以覆盖 PowerShell -> SSH -> POSIX、POSIX -> PowerShell 和容器/嵌套 Shell 切换，而不需要猜测 SSH 拓扑。

备选方案是依次向 PTY 注入 POSIX、PowerShell 两套 Probe；它会把错误语法写入目标 Shell，可能改变提示符、触发错误处理或污染服务器审计，因此否决。只信任本地启动方言的方案无法处理 SSH 跳转，也否决。

### 2. 使用方言专用的明文当前作用域事务块

POSIX 使用当前 Shell 的 brace group，PowerShell 使用 dot-sourced script block。两者都把原始命令逐字放在可读的事务块中，外围只增加固定的开始标记、退出码捕获、OSC 777 nonce 事件、可读完成行和清理语句。POSIX brace group 不创建子 Shell，PowerShell dot-sourcing 不创建子作用域，因此 `cd`、`export`、变量和函数状态继续留在当前 Session。

示意协议如下，实际实现会使用严格 quoted nonce 和受控标记：

```text
POSIX:
printf '__TA_START__'
{
<original command>
}
__ta_exit=$?
printf '<OSC-777 nonce and exit>'
printf '__TA_DONE_<nonce>;%s__\n' "$__ta_exit"
```

```text
PowerShell:
[Console]::Write('__TA_START__')
try {
  . {
<original command>
  } | Out-String -Stream | ForEach-Object { [Console]::WriteLine($_) }
  ...
}
finally {
  [Console]::Write('<OSC-777 nonce and exit>')
  [Console]::WriteLine('<readable completion line>')
}
```

不使用临时远端文件、Base64、hex、压缩载荷、`eval`、`Invoke-Expression` 或动态创建 ScriptBlock。临时文件虽然能隔离语法边界，却引入未声明的远端写操作、清理失败和额外审计事件；纯明文动态 `eval` 虽可读，但仍会让服务器白名单只能看到二次解释器，因此也不采用。

由于任意 Shell 源码可能包含不完整语法、`exit`、`exec` 或改变错误处理，外围协议不能承诺所有输入都有完成标记。dispatch 在写入前做 nonce/分隔符/控制字符和本地可验证语法边界检查；目标 Shell 没有在 deadline 内返回匹配完成事件时，事务只进入 `protocol_error`/`shell_lost`，不会报告成功，并使 capability 失效。

### 3. 保持明文的有界 PTY 传输

现有按 Base64 行切片的 `shellInputLines` 改为 plaintext writer：按配置的最大字节/字符块写入原始字符串，不在块边界插入字符；只有源代码中的换行被转换为目标 PTY 的提交回车。实现必须避免拆分 UTF-16 surrogate pair，并统一 CR、LF、CRLF 规则。这样长命令和 Unicode 不需要编码，服务器收到的输入仍可逐段重组为原始源文本。

PTY 写入仍只在 Lease、environment epoch、风险/审批和 dispatch 校验全部通过后发生。用户手工输入保持独立的原始输入路径；它会使 capability epoch 失效，但不能被 Agent dispatch 冒充。

备选方案是继续把每个明文逻辑行限制在 80/110 字符以内；长 heredoc、Unicode 和单行 JSON 会被截断或改变语义，因此否决。使用 bracketed paste 依赖目标终端和 Shell 配置，也否决。

### 3.1 单行事务与语义保留边界

对不含物理换行、行尾注释或未闭合续行语法的短命令，POSIX brace transaction 和 PowerShell dot-sourced transaction SHALL 组装为一个物理 PTY 输入行。例如 POSIX 的 `df -h` 将以 `start; { df -h; }; exit-capture; done` 的明文形式提交，服务器输入审计可在同一行看到原始命令及协议边界。固定 capability Probe 同样使用单行事务。

不得把任意用户源文本以字符串替换方式压平：here-doc、换行敏感脚本、`#` 注释、续行符和方言特有复合语法可能因把换行替换为分号而改变含义或吞掉完成标记。此类命令保留原有多行文本和当前 Shell 作用域；writer 必须按物理行提交 CR/LF，而不是把整个多行 payload 作为一个无界写入块。

### 3.2 资源采集使用短的固定事务

真实交互 PTY 验证表明原 POSIX 资源脚本有 83 行、4,369 个字符，连事务包装后达到 4,598 个字符，超过常见 Linux canonical PTY 单行缓冲的约 4 KiB 边界。将它压成一行会截断输入或使 Shell 停留在续行提示符，不能作为兼容方案。

资源刷新改为 host、OS、uptime、CPU、memory/swap、disk、network 等固定只读命令序列；每条均为独立、自包含、明文、受控长度的事务，并继续输出既有资源协议行。Collector 在同一 Lease/environment epoch 下顺序执行、合并输出并使用总 deadline，任一命令的不可用字段应产生 partial snapshot，而不是退回隐藏脚本、编码执行或超长行。PowerShell 使用同一分批规则。

### 4. 以统一 dispatch 保护所有系统生成的 PTY 执行

引入内部 `PlaintextShellDispatcher`（名称可按现有模块约定调整），其输入包括 Session、Task、操作类型、原始命令、nonce、已验证 environment epoch 和 dialect。它负责构造、审查、分片并调用 Agent PTY 写入；`ShellProbe`、`CommandExecutor` 和 `SessionResourceService` 不再直接拼装或写入 payload。未验证环境下的 Probe 只能调用 Dispatcher 内建的固定指纹或方言能力源，接口不得接受调用方提供的任意 Shell source。SessionActor 的低层写入 API 通过内部 capability/token 或模块边界限制调用方，避免新增调用者直接获得“任意 Agent 字节写入”能力。

生产执行入口建立静态清单：

| 入口 | 允许的传输 | 审计分类 |
| --- | --- | --- |
| Agent 命令、Probe、资源脚本 | 明文 Shell source | `plaintext_shell` |
| 用户在终端中的按键 | 原始用户输入 | `user_input` |
| `node-pty` 启动 Shell、`reg.exe`、`taskkill.exe`、Core IPC 子进程 | 显式 executable + argv，不经过 Shell | `direct_argv` |
| 握手、日志和资源字段编码 | 仅数据序列化，不得进入执行器 | `data_encoding` |

静态测试扫描生产执行模块中的动态解码/执行组合（例如 `base64 -d`、`FromBase64String`、`EncodedCommand`、`ScriptBlock::Create`、`Invoke-Expression` 和编码载荷后的 `eval`），运行时 Fake PTY 测试则捕获实际写入字节。单纯在认证或日志模块出现 Base64 不应触发误报，但必须有明确的非执行归类。

### 5. Fail closed 与审计证明

新增稳定错误 `execution_environment_unverified`、`command_not_auditable` 和必要的 `plaintext_protocol_error`。任一错误发生时不得静默切换 dialect、回退旧 Base64 driver 或继续写下一条 Agent 命令；Session 可观察但保持 observation-only，用户可通过人工输入/重新连接触发新的 epoch。

每次尝试记录 `transportMode`、`sourceKind`、`executionDialect`、`platform`、`capabilityEpoch`、命令哈希、审批/Lease 关联、最终状态和拒绝原因。长期审计不保存 Protected Input；完整命令仍由现有 Tool/审批边界和服务器 PTY 输入审计按其保留策略处理。资源命令中的 Base64 只用于字段编码，必须以测试证明其结果不经过任何解码执行。

## Risks / Trade-offs

- [明文多行事务受目标 Shell 解析器差异影响] → 只支持已验证的 POSIX/PowerShell 能力子集；将语法边界、完成超时和非零/缺失事件视为失败，禁止猜测成功。
- [原始命令可能包含秘密并出现在服务器审计] → 这是服务器明文审计的明确约束；本地长期审计继续只保存哈希/脱敏值，Protected Input 永不进入 Agent payload。
- [每个 capability epoch 首次执行增加一次固定 Probe 延迟] → Probe 有界、惰性且只在首次执行或失效后运行；普通对话和观察不写 PTY。
- [旧版本事务与新协议不兼容] → 会话升级时中断未完成旧事务并将旧 Session 标记为未验证；受影响服务器禁止回滚到会重新启用 Base64 的版本，回滚只能关闭 Agent 执行并保留观察模式。
- [资源脚本仍可能包含用于输出字段的 Base64] → 将数据编码和可执行载荷分开建模，增加静态/运行时断言；若目标服务器连数据编码命令也禁止，则资源刷新返回不可用，不得改用隐藏载荷。
- [把任意命令压成单行会改变语义] → 只压平经过保守语法筛选的单行文本；其余命令保留原始行结构，不用 `eval`、`sh -c` 或编码载荷规避边界。
- [交互 PTY 的 canonical 行缓冲截断大输入] → 固定资源采集按受控短事务分批，测试断言每条物理输入行低于项目安全上限。
- [静态扫描可能误报测试、认证或日志代码] → 扫描按生产执行模块和调用链分类，允许在非执行模块保留数据编码，并要求每个例外有测试说明。

## Migration Plan

1. 先加入环境状态、错误码、dispatch 接口和输入捕获测试；旧 Session 读取时把持久化 dialect 降级为 unverified hint，不迁移为 verified。
2. 实现 POSIX/PowerShell 明文 driver、统一 Probe 和资源调用，完成 Fake PTY、真实 Bash/Git Bash 与 PowerShell/ConPTY 的跨跳转回归。
3. 在审计模式下运行生产入口清单和静态扫描，确认只有认证/日志/数据字段使用非执行编码；再将 `plaintext_required` 作为默认且不可静默关闭的策略启用。
4. 发布时停止或完成旧的 Base64 事务；Core 重启后旧活动 Session 标记 `interrupted + unverified`，下一次 Agent 执行必须重新验证。
5. 若发布回滚，先把 Agent 终端能力切为 observation-only；不得通过回滚重新允许旧编码 wrapper 在受约束服务器上执行。

## Open Questions

- 目标支持矩阵是否要把 `bash/zsh/dash` 分开建模，还是继续以经过验证的 POSIX 能力集合统一处理？当前提案默认后者，并在协议不兼容时 fail closed。
- `platform` 指纹是否需要细分 `wsl`、Git Bash 和原生 Unix，还是只保留 `windows | unix | unknown` 供资源命令选择？方言识别不依赖该字段。
- 服务器侧合规方是否要求本地结构化审计保存完整明文命令，还是 PTY 会话录像/输入审计已经足够？当前设计默认长期本地审计只存 hash 与 transport attestation，以遵守秘密保留边界。
- 目标堡垒机对单次 PTY write 的最大安全大小是多少？实现默认使用可配置的小块并通过真实 SSH/ConPTY 测试校准，不以 Base64 作为超长输入方案。
