## Why

截图显示“隐藏完成探针回显”开启后，终端仍展示环境识别 Probe 的 `echo __SYNAPSE_DIALECT_...`、识别结果以及完成 Probe 的命令回显。现有设置只覆盖命令完成 Probe，导致本地终端 UI 仍被 Synapse Term 自动注入内容污染，也容易让用户误以为隐藏设置没有生效。

## What Changes

- 将本地 UI 的“隐藏完成探针回显”语义扩展为隐藏所有 Synapse Term 自动注入 Probe 的本地回显，包括环境识别 Probe 和命令完成 Probe。
- 对环境识别 Probe 同时隐藏命令回显和 `__SYNAPSE_DIALECT_...` 识别结果，支持跨 PTY 数据块和终端控制字符分割。
- 保持 Probe 明文写入当前 PTY，保证 Shell、SSH 和远程服务器仍可审计；不改变 current PTY environment 验证、退出码、OSC 777 隔离、CommandExecutor 输出或 MCP 脱敏。
- 保留设置关闭时的诊断能力：关闭隐藏后，本地终端 UI 可以看到自动 Probe 回显，但外部协议输出仍不包含 Probe 噪声。
- 增加环境 Probe 隐藏/显示和跨数据块回归测试，并更新设置文案与规格。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `probe-visibility-settings`: 将本地 UI 回显范围从命令完成 Probe 扩展到所有 Synapse Term 自动注入 Probe。

## Impact

- `packages/terminal-service/src/session/session-actor.ts` 与 `shell-probe.ts`：增加环境 Probe 的 UI-only 回显过滤和生命周期清理。
- `apps/desktop/src/renderer/mcp/mcp-settings-section.tsx`：明确设置覆盖所有自动注入 Probe 的本地回显。
- `packages/terminal-service/src/session/session-actor.test.ts`、ShellProbe/Renderer 测试：补充隐藏、显示、分块和协议不变回归。
- 不新增 IPC、远程端点、凭据、审计日志或命令包装器。
