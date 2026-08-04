## ADDED Requirements

### Requirement: Assistant Text Delta Event

Core MUST provide a validated `agent.text_delta` event for non-empty assistant text increments. The event MUST include a stable assistant item ID, Session/Turn identity, `append` or `replace` operation, and a monotonically increasing sequence for that assistant stream.

#### Scenario: Append a provider text delta

- **WHEN** Provider emits a non-empty `text_delta` during a normal assistant response
- **THEN** Core emits only that new text in an `append` delta event and does not place the accumulated full text in the delta payload

#### Scenario: Replace a speculative progress response

- **WHEN** completion review starts a new final response after a visible progress response
- **THEN** the first final delta uses `replace`, clears the previous assistant accumulator in the Renderer, and later deltas use `append`

#### Scenario: Empty provider delta

- **WHEN** Provider emits an empty text delta
- **THEN** Core MUST NOT emit an assistant delta event

### Requirement: Ordered Renderer Delta Aggregation

The Desktop Renderer MUST apply assistant deltas by stable ID and sequence, MUST reject a gap or stale sequence, and MUST keep the latest complete timeline/history item as the recovery source.

#### Scenario: Aggregate ordered append events

- **WHEN** Renderer receives append deltas `"a"` and `"bc"` with consecutive sequences
- **THEN** it renders one assistant item with text `"abc"` and does not create multiple timeline items

#### Scenario: Refresh after a sequence gap

- **WHEN** Renderer receives a delta whose sequence is not the next expected sequence
- **THEN** it does not append the untrusted delta and requests or retains history hydration for the Session

#### Scenario: Final timeline event closes a stream

- **WHEN** Renderer receives a complete assistant timeline item for the same stable ID
- **THEN** it replaces the live accumulator with the complete text and terminal status

### Requirement: Delta Event Compatibility

Existing `agent.timeline` events and history responses MUST remain valid without delta metadata, and a client that misses delta events MUST still converge to the complete assistant item after history refresh or terminal emission.

#### Scenario: Legacy timeline item is received

- **WHEN** a timeline consumer receives an assistant item without delta metadata
- **THEN** it renders the item using its complete `text` exactly as before

#### Scenario: Delta delivery is unavailable

- **WHEN** a Desktop client does not subscribe to the delta channel
- **THEN** the terminal assistant timeline event and history response remain sufficient to render the final answer
