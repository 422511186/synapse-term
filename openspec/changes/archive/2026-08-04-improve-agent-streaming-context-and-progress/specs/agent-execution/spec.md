## MODIFIED Requirements

### Requirement: Post-Tool Completion Review

AgentRuntime MUST in a Turn that has called any Tool treat the first assistant text without a Tool Call as a candidate answer and perform a bounded completion review using the same model selection, original user goal, structured Tool evidence, and current structured progress snapshot. The candidate answer MUST NOT enter assistant history or the review context; if review finds missing work, Runtime MUST continue the existing bounded Tool Loop and update progress; after confirmation it SHALL publish and persist exactly one complete, self-contained final answer that does not reference hidden candidate text. Candidate text and internal review instructions MUST NOT enter user Timeline or Conversation history.

#### Scenario: Model stops after partial diagnostics

- **WHEN** user requests several server metrics and model calls Tools for only a subset before emitting a no-Tool candidate
- **THEN** Runtime enters verifying progress, does not complete or publish the candidate, and continues the existing Terminal Tool loop when review identifies missing evidence

#### Scenario: Complete a pure conversation without review

- **WHEN** model has not called a Tool in the current Turn and directly answers ordinary conversation
- **THEN** Runtime publishes the text stream and completes without a completion review or progress Tool steps

#### Scenario: Completion review limit is exhausted

- **WHEN** a Tool task reaches the configured completion review limit without confirming completion
- **THEN** Runtime fails with a stable visible error, terminates progress as failed, does not publish the unreviewed candidate, and preserves Tool/audit evidence

#### Scenario: Reviewer would reuse the hidden candidate

- **WHEN** candidate text is not visible to the user and review confirms all goals have evidence
- **THEN** review generates a complete self-contained final response from the original goal, Tool evidence and progress state, without referring to invisible text

### Requirement: Persisted Conversation Compaction

Automatic compaction MUST generate a traceable persisted summary using a no-Tool Provider summary when available and a deterministic evidence fallback when it is not, then replace older Items in later Model Runs while retaining the original Conversation, Tool and audit records. The returned history MUST NOT exceed the configured token threshold.

#### Scenario: Continue after compaction

- **WHEN** user continues a Conversation that has been compacted
- **THEN** model receives a bounded Provider or fallback summary plus recent exact history, while old messages remain queryable locally and through audit

#### Scenario: Provider summarization fails

- **WHEN** the no-Tool summary Provider fails or returns invalid output
- **THEN** Core persists a bounded redacted deterministic fallback and the user Turn continues without a summary Tool Call

#### Scenario: Existing summary already exceeds threshold

- **WHEN** existing summary token count is already over `thresholdTokens`
- **THEN** compactor re-fits or deterministically truncates the summary before returning history, and fails closed if the minimum summary system item cannot fit
