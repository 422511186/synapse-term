## ADDED Requirements

### Requirement: External Session Status Semantics
`terminal_status` MUST 在会话存在、已共享且 PTY 运行时返回 `ready` 或 `not_ready`，并 MUST 按 Shell 状态返回可执行的恢复指引；`shell: unknown` MUST 提示“执行一次 terminal_execute 自动探测”，不得提示等待用户完成初始化。用户复制 sessionId 共享会话后，系统 SHOULD 自动运行一次 Shell 探测，使 Shell 状态尽快推进到 `ready`；探测因用户占用或超时失败时 MUST NOT 影响共享流程或阻塞调用。

#### Scenario: Newly shared session with an unknown shell
- **WHEN** 用户复制 sessionId 共享一个 `shell: unknown` 的会话，随后外部客户端调用 terminal_status
- **THEN** 若自动探测已成功，状态为 ready；若探测尚未完成或失败，状态为 not_ready 且 hint 说明执行一次 terminal_execute 即可自动探测

#### Scenario: Auto probe succeeds after sharing
- **WHEN** 会话共享时 Shell 未就绪且外部租约可获取
- **THEN** 系统自动运行 ShellProbe，Shell 状态推进到 ready，且不阻塞共享响应

#### Scenario: Auto probe cannot acquire the lease
- **WHEN** 用户正占用终端导致自动探测无法取得外部租约
- **THEN** 共享流程正常返回，会话保持未探测状态，后续 terminal_execute 的懒探测仍可使其就绪
