## Why

新共享的终端会话初始 `shell: unknown`，`terminal_status` 只是状态快照、不触发 ShellProbe，导致“终端明明可用”却一直返回 `not_ready + shell: unknown`，且提示误导客户端去“等待用户完成初始化”。外部客户端只能靠先执行一次命令触发懒探测才能就绪，形成认知死胡同。

## What Changes

- 会话共享时自动完成一次 Shell 探测：用户复制 sessionId（`session.markShared`）后，若 Shell 未就绪且外部租约可获取，系统后台运行 `ShellProbe` 将状态推进到 `ready`；用户正占用终端导致租约失败时保持现状，不阻塞共享、不打断用户。
- `terminal_status` 状态语义诚实化：`shell: unknown` 时不再提示“等待用户完成初始化”，改为明确“会话尚未完成探测，可执行一次 terminal_execute 自动探测”的指引；`ready` / `not_ready` / `expired` 三态保持不变（非 BREAKING）。
- 自动探测失败（用户占用、探测超时）不产生审计噪音，仅在成功或失败需要排查时记录审计。

## Capabilities

### New Capabilities

### Modified Capabilities
- `mcp-access`: 新增 `terminal_status` 状态语义需求：共享会话应自动完成 Shell 探测，`unknown` 状态返回可执行的恢复指引而非误导性提示。

## Impact

- `packages/application/src/router/handlers/session-handler.ts`：`markSessionShared` 后触发后台 Shell 探测。
- `packages/application/src/router/handlers/external-handler.ts`：`terminalStatus` 对 `shell: unknown` 的 hint 更新。
- `packages/terminal-service/src/shell/shell-probe.ts`：确认/补齐共享探测的外部租约路径（`ownerKind: 'external'`，已有）。
- 测试：`session-handler` 共享后自动探测、`external-handler` 状态提示、`shell-probe` 外部租约探测场景。
