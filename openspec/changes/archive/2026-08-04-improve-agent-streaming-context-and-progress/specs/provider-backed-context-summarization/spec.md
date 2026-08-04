## ADDED Requirements

### Requirement: Provider-backed Conversation Summary

When automatic compaction is required, Core SHOULD attempt one no-Tool summary Model Run with the current Turn's Provider and Model after applying SecretRedactor. The summary request MUST have an independent output budget and MUST NOT count as a user Tool Call.

#### Scenario: Provider summary succeeds

- **WHEN** compaction is required and the Provider returns non-empty text without Tool Call or Provider error within the summary budget
- **THEN** Core uses the returned text as the persisted compaction summary and records that Provider summarization was used

#### Scenario: Provider summary fails

- **WHEN** summary streaming fails, times out, is cancelled, returns an empty response, or emits a Tool Call
- **THEN** Core uses deterministic fallback, completes the user Turn without exposing the summary failure as a user Tool failure, and records the fallback method

### Requirement: Deterministic Evidence Fallback

The fallback summary MUST preserve bounded evidence for the user goal, assistant conclusions, executed Tool names and relevant arguments, Tool results/errors, and unresolved work. It MUST redact secrets before persistence or Provider transmission.

#### Scenario: Long Tool result is compacted

- **WHEN** an old Tool Result exceeds the per-item summary bound
- **THEN** fallback keeps a bounded redacted representation with its Tool identity and error status, while the original Model Item remains available in history storage

#### Scenario: Existing summary is already over budget

- **WHEN** an existing compaction summary alone exceeds the configured threshold
- **THEN** compactor re-fits the summary content and MUST NOT return history whose estimated tokens exceed the threshold, or fails with a stable context budget error when the minimum system item cannot fit

### Requirement: Summary Budget and Audit Boundaries

Every produced compaction history MUST be within the configured token threshold. Summary execution MUST have bounded timeout, output size, cancellation, and recursion behavior, and compaction audit MUST include source sequence, estimated input tokens, and summary method without persisting secrets.

#### Scenario: Provider emits oversized summary

- **WHEN** Provider summary text exceeds the available summary budget
- **THEN** Core rejects it and uses a bounded deterministic fallback instead of returning an oversized history

#### Scenario: Summary input contains a secret

- **WHEN** a compacted Model Item contains a credential or token recognized by SecretRedactor
- **THEN** neither the Provider request, persisted summary, audit payload, nor fallback contains the secret value
