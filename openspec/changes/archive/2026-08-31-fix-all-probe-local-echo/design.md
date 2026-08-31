## Context

当前 `SessionActor` 在收到 PTY 数据后先分离 OSC 777，再用 `suppressInputEcho()` 过滤命令完成 Probe 的协议输入回显；隐藏开关打开时，终端 UI 复用过滤后的协议数据，因此完成 Probe 的回显可以隐藏。环境识别 Probe 由 `ShellProbe` 直接通过 `writeProbe()` 写入，既没有注册输入回显抑制，也没有过滤识别结果，所以截图中的 `echo __SYNAPSE_DIALECT_...` 和结果行仍会进入本地 UI。

Renderer 只能通过受限 preload API 访问设置，SessionActor 是 PTY/UI 输出边界。Probe 必须继续以明文写入当前 PTY，不能使用隐藏 wrapper；本次只改变本地 UI 消费的显示内容。

## Goals / Non-Goals

**Goals:**

- 开启隐藏时，环境识别 Probe 的命令回显和合法识别结果行不显示在本地终端 UI。
- 开启隐藏时，命令完成 Probe 的既有隐藏行为保持不变。
- 支持 Probe 命令、识别结果和终端控制字符跨多个 PTY 数据块到达。
- 关闭隐藏时仍可看到自动 Probe 回显以便诊断。
- 保持 `pty_output` 协议数据、Probe 解析、用户命令原文、退出码和远程审计语义不变。

**Non-Goals:**

- 不从 PTY 中删除 Probe，不阻止远程 Shell、SSH 或服务器记录 Probe。
- 不隐藏用户主动输入的命令、用户命令 stdout 或普通远程输出。
- 不改变 `synapse_status`、MCP Sharing、Shell Driver 或命令完成帧协议。
- 不新增永久审计日志或跨重启显示状态。

## Decisions

### 1. 在 SessionActor 增加 UI-only 环境 Probe 过滤器

`SessionActor` 增加按 nonce 管理的环境 Probe 显示状态。该过滤器只作用于 `terminal_output`，不作用于 `pty_output`；ShellProbe 仍能从协议数据读取 `__SYNAPSE_DIALECT_...` 并完成验证。过滤器识别固定的环境 Probe 命令、合法的 POSIX 数字结果和 PowerShell `True/False` 结果，并在 Probe 生命周期结束时清理状态。

不复用现有 `suppressInputEcho()`，因为它会同时修改协议数据，可能让 ShellProbe 无法解析环境指纹。

### 2. ShellProbe 显式注册和释放环境 Probe 显示状态

ShellProbe 在写入固定明文环境 Probe 前注册 nonce，成功、超时、失效、PTY 退出或写入拒绝时统一释放。释放必须幂等，不能影响已验证结果或后续用户输出。

### 3. 设置文案明确“所有自动 Probe”

设置标签和安全说明改为“隐藏自动 Probe 回显”或等价明确文案，说明只影响本地终端 UI；Probe 仍写入当前 PTY，远程服务器仍可能记录。已有配置字段 `hideCompletionProbeEcho` 保持兼容，不做数据迁移。

## Risks / Trade-offs

- [环境 Probe 输出跨块或带 ANSI 控制字符] → 过滤器保留跨块状态并复用 SessionActor 的终端控制字符匹配逻辑，增加分块回归测试。
- [过滤器误吞普通远程输出] → 只在已注册的 nonce 生命周期内匹配固定命令和合法指纹结果，协议链路不受影响，Probe 结束后立即清理。
- [用户关闭设置后 Probe 正在进行] → 过滤器状态继续维护但 UI 使用原始数据；设置变化不会改变 PTY 写入或 Probe 解析。
- [旧配置字段名称仍然是 completion] → 保持持久化和 IPC 字段兼容，只更新用户可见语义和实现覆盖范围。

## Migration Plan

1. 先增加实际 ShellProbe 回显隐藏的失败测试，覆盖协议输出保留和跨块数据。
2. 实现 SessionActor UI-only 过滤器，并由 ShellProbe 管理生命周期。
3. 更新设置文案和 Renderer/E2E 断言。
4. 运行定向测试、`pnpm verify`、构建、E2E 和 OpenSpec strict 校验。

回滚时可保留现有 `hideCompletionProbeEcho` 字段；本次没有数据格式或外部协议迁移。

## Open Questions

无。设置字段保持向后兼容，所有 Probe 仍以明文进入 PTY。
