# terminal-sessions Delta

## ADDED Requirements

### Requirement: Close All Fault Isolation
CoreRequestRouter 的 `closeAll` 关闭流程 MUST 容错隔离 agent 关闭与 session 关闭：agent 关闭抛错时 MUST 记录但不阻断后续 session PTY 关闭，MUST NOT 因 agent 关闭失败而跳过全部 session 关闭与 `#onActivityChange` 通知。

#### Scenario: Agent close fails during shutdown
- **WHEN** `closeAllIfConfigured()` 在关闭 agent 时抛错
- **THEN** Router MUST 捕获并记录该错误，继续执行 session PTY 关闭循环，最终仍触发 `#onActivityChange`
