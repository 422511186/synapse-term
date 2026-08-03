## ADDED Requirements

### Requirement: Bounded Ordered Terminal Output Frames

Core MUST 在写入 OutputJournal 和向 Desktop 广播前，将任意大小的 PTY 输出拆成不超过协议输出预算的 UTF-8 完整分片；每个分片 MUST 使用新的严格递增 sequence，且所有消费者 MUST 观察到与原始 PTY 输出相同的字节顺序。

#### Scenario: PTY emits output larger than one IPC frame

- **WHEN** 一个 Terminal Session 的 PTY 一次回调返回超过 IPC 单帧上限的输出
- **THEN** Core MUST 写入多个有序 Journal events 并广播多个有界输出帧，Desktop 连接 MUST 保持可用
- **AND** Renderer MUST 按 sequence 将这些分片连续写入终端，不得丢弃同一原始输出的后续分片

#### Scenario: Output contains multibyte UTF-8 characters

- **WHEN** Core 在分片边界遇到多字节 UTF-8 字符
- **THEN** Core MUST 不得拆开该字符或产生替换字符，拼接所有分片后 MUST 与原始输出字节等价

### Requirement: Bounded Terminal Replay Pages

`terminal.replay` MUST 返回受有界字节预算约束的一页事件，并在仍有未返回事件时返回 `hasMore` 和可继续使用的 `nextAfterSequence`；`nextSequence` MUST 继续表示 Session 当前的下一个全局 sequence。

#### Scenario: Replay exceeds one response budget

- **WHEN** UI 请求的增量输出超过单个 Core 控制响应预算
- **THEN** Core MUST 只返回当前页并设置 `hasMore: true`
- **AND** UI MUST 使用 `nextAfterSequence` 继续请求，最终按 sequence 拼接全部可用输出

#### Scenario: Replay has a history gap

- **WHEN** UI 请求的 sequence 早于 OutputJournal 中最旧事件
- **THEN** Core MUST 继续返回 `historyGap: true`，并在可用时返回当前终端 snapshot
- **AND** snapshot 或错误响应 MUST NOT 使 Core IPC 连接断开
