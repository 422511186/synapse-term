## MODIFIED Requirements

### Requirement: Session-Scoped Agent Panel

Desktop MUST provide the current Session with an independent multi-turn Agent Conversation showing natural-language input, one aggregated assistant response, structured progress, Tool calls, command/file results, approvals, takeover and final status. Assistant text MUST be delivered as deltas during streaming and MUST converge to one complete stable timeline item after finalization or history hydration.

#### Scenario: Ask a simple question

- **WHEN** user sends ordinary conversation and model does not call a Tool
- **THEN** panel applies ordered assistant deltas to one response, does not render one timeline item per delta, and does not duplicate the final text

#### Scenario: Run a multi-tool task

- **WHEN** Agent calls terminal and local-file Tools sequentially
- **THEN** panel shows structured progress and each Tool state in order, then shows the evidence-based final conclusion

#### Scenario: Delta stream is interrupted

- **WHEN** Renderer detects a missing or out-of-order delta
- **THEN** it does not append the untrusted fragment, refreshes Agent history, and displays the complete persisted or terminal assistant item when available
