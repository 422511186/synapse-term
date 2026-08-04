# Audit Serves Security and Execution Diagnosis

The audit surface is a read-only investigation tool for reconstructing who initiated an operation, which Session or Task it targeted, what policy and approval decision applied, and what outcome or failure reason resulted. It is separate from Agent conversation history and is not a full terminal transcript; the current summary-only view does not satisfy this purpose and must evolve toward structured, filterable projections.

## Considered Options

- Treat audit as another Agent history view: rejected because the timeline already serves conversation context and audit records have a different actor, authorization, and retention boundary.
- Expose the raw audit payload directly: rejected because payloads require secret redaction and a stable user-facing projection rather than an infrastructure-shaped dump.

## Consequences

- The audit UI must expose diagnostic fields such as actor, Session/Task correlation, risk, policy/approval result, outcome, and reason.
- The default list groups events into an Audit Trace for an Agent Task or external call; the individual events remain available in an expanded chronological detail view.
- Built-in traces use `taskId`; external terminal command traces use `transactionId`; observations, status checks, file operations, and rejected external calls remain standalone events until a broader correlation contract is justified.
- The audit workspace defaults to the global retained Audit Scope; Session, Task, actor, and time filters narrow that scope without changing the underlying records.
- The aggregate list is newest-first for rapid incident discovery; an expanded Audit Trace is chronological so its cause-to-outcome sequence remains readable.
- The default Audit Query Window is the most recent seven days; users can select the full retained period or a custom range, and results load incrementally rather than as one unbounded response.
- Core Audit Filters are time, Session, actor, operation category, outcome, and risk; internal Task IDs remain visible as correlation details rather than primary everyday controls.
- Selecting an aggregate keeps the list and filters visible while opening a read-only Audit Detail Panel for the associated redacted detail and chronological Audit Trace.
- Aggregate rows use a normalized Audit Outcome (`in_progress`, `success`, `failure`, `rejected`, `interrupted`, or `information`) derived from the trace, while the detail view preserves original event types and reasons.
- Details must remain read-only, structured, and redacted. A human-readable command/path preview may be retained after secret redaction, while raw protected input, complete terminal output, and terminal recordings remain outside the audit view; the exact command hash remains available for integrity correlation.
- Retention controls expose the current policy and allow an explicitly confirmed cleanup of expired records only; the audit surface does not provide an unrestricted clear-all action or arbitrary retention override in the first version.
