# agent-delta-streaming Specification

## Purpose
规定 Assistant 文本在 Core、Desktop IPC 和 Renderer 之间以增量事件传输，并在顺序异常或终态事件到达时安全收敛为一个完整时间线条目。

## Requirements

### Requirement: Assistant Text Delta Event
Core MUST 为非空的 Assistant 文本增量提供经过校验的 `agent.text_delta` 事件。事件 MUST 包含稳定的 Assistant 条目 ID、Session/Turn 身份、`append` 或 `replace` 操作，以及该 Assistant 流单调递增的 sequence。

#### Scenario: Append a provider text delta
- **WHEN** Provider 在普通 Assistant 响应期间发出非空 `text_delta`
- **THEN** Core 只在 delta 事件中发送新增文本，不得把累计的完整文本放入 delta payload

#### Scenario: Replace a speculative progress response
- **WHEN** completion review 在可见的进度响应后开始新的最终响应
- **THEN** 第一片最终 delta 使用 `replace` 清除 Renderer 中旧的 Assistant 累积文本，后续 delta 使用 `append`

#### Scenario: Empty provider delta
- **WHEN** Provider 发出空的 text delta
- **THEN** Core MUST 不发送 Assistant delta 事件

### Requirement: Ordered Renderer Delta Aggregation
Desktop Renderer MUST 按稳定 ID 和 sequence 应用 Assistant delta，MUST 拒绝缺口或过期 sequence，并 MUST 保留最新的完整 timeline/history 条目作为恢复来源。

#### Scenario: Aggregate ordered append events
- **WHEN** Renderer 收到 sequence 连续的 append delta `"a"` 和 `"bc"`
- **THEN** Renderer 显示一个文本为 `"abc"` 的 Assistant 条目，不得为每个 delta 创建新的时间线条目

#### Scenario: Refresh after a sequence gap
- **WHEN** Renderer 收到的 delta sequence 不是下一个预期值
- **THEN** Renderer 不得追加不可信片段，并 MUST 请求或保留该 Session 的 history hydration

#### Scenario: Final timeline event closes a stream
- **WHEN** Renderer 收到同一稳定 ID 的完整 Assistant timeline 条目
- **THEN** Renderer 用完整文本和终态替换 live accumulator 并关闭该流

### Requirement: Delta Event Compatibility
已有 `agent.timeline` 事件和 history response MUST 在没有 delta metadata 时继续有效；遗漏 delta 事件的客户端 MUST 仍能在 history refresh 或终态 emission 后收敛到完整 Assistant 条目。

#### Scenario: Legacy timeline item is received
- **WHEN** timeline consumer 收到不含 delta metadata 的 Assistant 条目
- **THEN** consumer 按既有方式使用其完整 `text` 渲染

#### Scenario: Delta delivery is unavailable
- **WHEN** Desktop client 未订阅 delta channel
- **THEN** 终态 Assistant timeline event 和 history response 仍足以渲染最终答案
