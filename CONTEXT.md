# Terminal Agent Context

This context describes a local terminal system in which an Agent pursues a natural-language goal through an already prepared interactive terminal. Remote connection topology is outside the context.

## Language

**Terminal Session**:
A long-lived interactive terminal context represented by its input stream, output stream, terminal state, and history. It is independent of how its shell reaches a remote environment.
_Avoid_: SSH session, server connection

**Ready Session**:
A Terminal Session that the user has brought to a working shell state and explicitly made available to an Agent.
_Avoid_: Connected server, authenticated endpoint

**Agent Task**:
A natural-language goal pursued by an Agent through exactly one Ready Session at a time.
_Avoid_: Agent session, chat session

**Suspended Task**:
An Agent Task that retains its history and Session association but may not start another model turn or Command Transaction until a stated resume condition is satisfied.
_Avoid_: Failed task, cancelled task

**Provider Profile**:
A reusable model-service connection that names a supported protocol, endpoint, credential reference, request headers, and timeout. It does not identify a concrete model, and secret credential values are not part of the profile itself.
_Avoid_: Model Configuration, model account, API key configuration

**Model Configuration**:
A named Agent-selectable model entry that references one Provider Profile and defines a model ID, context limits, declared capabilities, validation state, and whether it is enabled. A Provider Profile may support multiple Model Configurations.
_Avoid_: Provider Profile, endpoint configuration, raw model ID

**Discovered Model**:
A sanitized model identifier and optional display metadata returned by a Provider's model-list endpoint. It is only an import candidate and does not become Agent-selectable until a Model Configuration is created, validated, and enabled.
_Avoid_: Model Configuration, available model

**Agent Model Selection**:
The immutable Model Configuration revision and resolved Provider/model snapshot bound to an Agent Task when it starts. Later configuration edits, disabling, or deletion do not rewrite that Task's history.
_Avoid_: Current model, Provider selection

**Session Lease**:
The exclusive right held by either the user or an Agent Task to send input to a Terminal Session. The user may revoke an Agent-held lease at any time.
_Avoid_: Input lock, terminal lock

**Observation Context**:
The current terminal screen and bounded recent history disclosed to an Agent when it is explicitly invoked.
_Avoid_: Full transcript, always-on monitoring

**Protected Input**:
Terminal input intentionally excluded from Agent context, output journals, and audit payloads because it may contain a password or other secret.
_Avoid_: Hidden text, masked command

**Command Transaction**:
One Agent-initiated shell action with defined input, streamed output, completion evidence, and an exit result when available.
_Avoid_: Raw command, PTY write

**Interactive Control**:
A Session Lease mode used when a terminal program requires keystroke-level exchanges instead of a bounded Command Transaction.
_Avoid_: Command execution

**User Takeover**:
The explicit transfer of a Session Lease from a suspended Agent Task to the user so the user can complete an interactive or sensitive exchange before returning control.
_Avoid_: Agent cancellation, terminal unlock

**Detached Session**:
A live Terminal Session whose desktop UI is not currently connected to it. Its PTY, output sequence, and ownership state remain managed by the local Core until the Session is explicitly terminated.
_Avoid_: Closed session, background connection

**Approval Grant**:
User authorization for an exact ordered command set on one Terminal Session. Any command edit, insertion, reordering, or target change requires a new grant.
_Avoid_: Permanent permission, blanket approval

**Audit Record**:
An immutable, structured account of an Agent or user action, including who initiated it, which Session it targeted, what authorization applied, and what outcome was observed. It does not imply retention of the complete terminal byte stream.
_Avoid_: Terminal recording, transcript

**Permission Mode**:
The user-selected approval policy for one Agent Conversation: manual approval, automatic approval of ordinary mutations, or no approval prompts. It never expands the available Tool set or filesystem boundary.
_Avoid_: Sandbox mode, administrator mode

**Context Budget**:
The configured model context window minus reserved output and Tool headroom, used to decide how much Conversation history can enter a Model Run.
_Avoid_: Message limit, transcript size

**Conversation Compaction**:
A persisted summary of older structured Conversation items that replaces those items in future model context while leaving the original audit and history records intact.
_Avoid_: Delete history, clear chat

**Session Resource Snapshot**:
A point-in-time, read-only observation of CPU, memory, disk, network, host and uptime data obtained through the current Ready Session.
_Avoid_: Server asset, monitored host
