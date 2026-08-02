# Own the Agent State Machine

The Core will implement its own small Agent Task state machine for model turns, tool calls, approval waits, Session Lease transitions, cancellation, and completion. Provider SDKs remain protocol clients inside adapters, while general agent frameworks and provider-specific agent runtimes are excluded so terminal safety and lifecycle semantics stay under one application-owned control model.
