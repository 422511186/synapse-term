## ADDED Requirements

### Requirement: Execution Context Revalidation for the Current PTY

结构化外部执行 MUST 同时满足当前 PTY environment 已验证和 `expectedContextId` 仍匹配。用户输入、Shell 接管或环境失效后，之前的执行上下文和 capability epoch MUST 不能继续授权用户 command 写入；Probe、审批等等待阶段结束后，系统 MUST 在用户 command 写入前再次验证这两个前提。该能力 MUST 继续保持 Session 的传输无关语义，不创建 SSH、主机或容器拓扑对象。

#### Scenario: Nested Shell requires a fresh environment and context

- **WHEN** 用户从启动提示为 PowerShell 的 Session 进入 POSIX SSH、容器或 WSL 环境后准备执行外部 command
- **THEN** 系统 MUST 使旧 capability epoch 和执行上下文失效，下一次外部调用 MUST 重新验证当前 PTY environment 为 POSIX 后才能写入用户 command

#### Scenario: User input wins the pre-write race

- **WHEN** 用户输入在外部 command 的执行上下文校验之前进入 Session PTY 串行队列
- **THEN** 外部 command MUST 在 PTY 写入前返回执行上下文冲突，用户 command 不得写入

#### Scenario: Context changes while approval is pending

- **WHEN** 外部 command 已通过 Probe 但审批卡片等待期间用户改变了当前 PTY
- **THEN** 系统 MUST 重新验证 capability epoch 和执行上下文，发现任一失效时不得发送用户 command，旧审批不得跨越该变化继续放行

#### Scenario: External writes do not impersonate user input

- **WHEN** 外部 Probe 或用户 command 在当前有效 capability epoch 下通过独立外部写入入口发送
- **THEN** 该写入 MUST NOT 被当作用户接管或递增 capability epoch；用户后续输入仍 MUST 使当前环境验证失效
