## Why

开启“隐藏自动 Probe 回显”后，终端 UI 在部分终端换行、重绘或 PTY 回显延迟的场景下仍会显示完成 Probe 的 `printf` 等包装器命令片段。该设置因此不能稳定兑现“只隐藏自动 Probe 回显”的诊断语义，且会把内部协议输入暴露给本地 UI。

## What Changes

- 完善本地终端 UI 对环境识别 Probe 和命令完成 Probe 回显的抑制，覆盖 PTY 分块、终端自动换行、重绘控制序列和完成帧之后延迟到达的回显。
- 保持用户命令、用户普通输出和提示符可见；不得通过全局吞掉换行或控制字符来规避误匹配。
- 保持协议输出、完成检测、事务输出、PTY 实际写入和远程审计可见性不变，继续遵循 ADR-0016 的 UI-only 边界。
- 增加覆盖换行、重绘、延迟回显及设置动态切换的回归测试。

## Capabilities

### New Capabilities

无。本变更修正现有 Probe 回显可见性能力。

### Modified Capabilities

- `probe-visibility-settings`: 明确自动 Probe 回显在分块、换行、重绘和延迟到达场景下仍必须按设置隐藏或显示，且不影响协议消费者。

## Impact

- 主要影响 `packages/terminal-service` 的 SessionActor 回显过滤和相关测试。
- 可能调整 Shell Driver 提供的 Probe 回显边界描述，但不改变完成 Probe 语法、用户命令字节序列或 MCP 工具契约。
- 不新增 Electron Renderer 能力，不改变 PTY 写入、外部客户端输出脱敏、审批模式或远程审计边界。
