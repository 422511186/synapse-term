## ADDED Requirements

### Requirement: Structured Agent Progress

AgentRuntime MUST expose a bounded progress snapshot with a phase and ordered steps derived only from accepted Tool Calls and observable runtime outcomes. Each step MUST have a stable ID, safe label, status, and optional Tool Call evidence; progress MUST NOT contain chain-of-thought or raw secret-bearing arguments.

#### Scenario: Begin a multi-step task

- **WHEN** a new Agent Runtime starts a Tool-capable Turn
- **THEN** it emits a `planning` progress phase without exposing hidden reasoning

#### Scenario: Tool Call becomes an execution step

- **WHEN** Runtime accepts a validated Tool Call
- **THEN** progress adds one bounded step labeled by the Tool name and marks it running only when execution begins

#### Scenario: Tool Result completes a step

- **WHEN** the Tool returns a completed or failed observable result
- **THEN** progress updates that step to the corresponding terminal status and associates the Tool Call ID as evidence

### Requirement: Progress-aware Completion Review

After Tool use, Runtime MUST expose a `verifying` phase while the existing completion review checks the original goal and structured Tool evidence. If evidence is missing, Runtime MUST return to `executing`, update progress with the additional step, and continue the existing bounded Tool Loop.

#### Scenario: Review finds missing evidence

- **WHEN** completion review determines that a required observable result is missing
- **THEN** Runtime emits a verifying-to-executing progress transition and continues with an existing Tool rather than completing the Turn

#### Scenario: Review confirms completion

- **WHEN** completion review confirms all required evidence
- **THEN** Runtime marks progress completed and publishes only the reviewed final answer

### Requirement: Recoverable Progress Checkpoint

Approval and resumable waiting checkpoints MUST include the current progress snapshot and restore it before the remaining Tool Calls continue. Cancellation, disconnect, loop limits and failures MUST terminate progress with an observable terminal phase.

#### Scenario: Resume after approval

- **WHEN** a Tool step pauses for approval and the user approves it
- **THEN** Runtime restores that step and its prior statuses, continues the same Tool Call, and does not create a duplicate step

#### Scenario: Cancel during execution

- **WHEN** the user cancels while a progress step or model run is active
- **THEN** Runtime emits a cancelled terminal progress state and does not mark the step completed without evidence

### Requirement: Safe Progress Projection

Core and Desktop MUST project progress using a stable timeline identity and bounded structured fields. Progress is informational state, not an authorization decision, and MUST NOT alter Policy, Approval, Lease, Tool Schema, or Session binding behavior.

#### Scenario: Renderer receives a progress update

- **WHEN** Core sends a newer progress snapshot for the same Turn
- **THEN** Renderer replaces the prior snapshot in one progress item and displays phase, step statuses, and evidence-safe labels

#### Scenario: Progress contains a malicious Tool argument

- **WHEN** a Tool argument or result contains instructions, secrets, or excessive output
- **THEN** the progress projection omits raw argument/result content and retains only bounded safe metadata
