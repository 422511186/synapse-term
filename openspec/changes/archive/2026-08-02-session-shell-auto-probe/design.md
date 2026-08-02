## Context

会话状态机初始 `shell: unknown`；`markShared()` 只置共享标记，不初始化 Shell 状态。内置 Agent 执行前、外部 `terminal_execute` 懒探测、资源收集器三处会在 Shell 非 ready 时运行 `ShellProbe`，但 `terminal_status` 被刻意设计为只读快照，不触发探测。因此“复制 sessionId 后只调 status”的新会话必然返回 `not_ready + shell: unknown`，即使终端完全可用，且 hint 误导客户端等待用户操作。

## Goals / Non-Goals

**Goals:**
- 用户复制 sessionId（共享会话）后，Shell 状态有机会自动推进到 `ready`，让 `terminal_status` 反映真实可用性。
- `terminal_status` 对 `unknown` 状态给出可执行的下一步（执行一次命令触发懒探测），不再误导“等待用户完成初始化”。
- 自动探测不阻塞共享流程、不打断正在使用终端的用户。

**Non-Goals:**
- 不把 `terminal_status` 改为写操作（仍不创建租约、不写终端）。
- 不引入新状态枚举（`ready` / `not_ready` / `expired` 三态保持兼容）。
- 不改变外部 `terminal_execute` 已有的懒探测行为。

## Decisions

**D1：共享时后台自动探测，失败静默回退。**

`session.markShared` 处理中，在 `await actor.markShared()` 之后触发一次 fire-and-forget 的 Shell 探测：若 `snapshot.shell !== 'ready'`（或环境未验证），尝试以外部租约（`ownerKind: 'external'`）运行 `ShellProbe`；租约不可用（用户正在占用）或探测失败时直接放弃，保持 `unknown`，不向客户端返回错误、不影响 `markSessionShared` 响应。

备选：在 `terminal_status` 内同步探测 —— 不采用，`terminal_status` 必须保持只读契约，且同步探测会阻塞调用并写入 PTY。

**D2：探测失败的审计只记录一次、低噪音。**

自动探测是后台尽力而为行为，不产生 `external.denied` 类噪音；仅记录一次 `session.probe` 审计事件（成功或失败），便于排查“为什么会话长期 not_ready”。失败原因（`busy` / `timeout` 等）放入审计 payload。

**D3：`terminal_status` 的 hint 按 shell 状态细分。**

`unknown` → “会话尚未完成 Shell 探测：执行一次 terminal_execute 即可自动就绪”；`probing` → “正在探测中，请稍后重试”；其余保留现有 `executing` / `interaction_required` / `starting` 分支。`status` 字段仍为 `not_ready`，不破坏客户端三态处理。

## Risks / Trade-offs

- [自动探测与用户输入竞争] → 探测前先尝试外部租约，失败即放弃；探测序列使用 OSC 777 转义，对用户几乎无感。
- [后台探测写 PTY 干扰用户] → 仅发生在共享瞬间且 Shell 未就绪时；与外部 execute 的既有懒探测同语义，风险一致。
- [审计噪音] → 每次共享只记一条，payload 含原因，量级可忽略。

## Migration Plan

无需迁移；旧会话保持 `unknown`，首次共享或首次执行后自然就绪。

## Open Questions

无。
