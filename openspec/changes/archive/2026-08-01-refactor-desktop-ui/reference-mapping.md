# UX Reference Mapping

This mapping was produced by walking both the checked-in prototype at
`docs/ux/ui/src/app/App.tsx` and the interactive prototype at
<https://cat-portal-41791527.figma.site/>. It records which prototype states
map to real desktop capabilities and which simulated states must not be copied.

## Workspace And Context Controls

| Prototype state | Production source or action | Implementation boundary |
| --- | --- | --- |
| Current Session button and menu | `sessions.list`, local `activeSessionId`, `sessions.close` | Show only active Sessions. Do not show the prototype's simulated History group. |
| New Session Dialog | `sessions.environment`, `sessions.create`, existing `buildSessionLaunch` | Use the real shell descriptors and user home. Preserve the existing launch validation and error handling. |
| Dialect menu | `sessions.setDialect` and `SessionSummary.executionDialect` | Expose only Core-supported dialect values and disable changes while a task is active. |
| Resource button and popover | `resources.get`, `resources.refresh`, `resources.onSnapshot` | Bind snapshots to Session IDs and show complete, partial, unavailable, refreshing, and error states. |
| Model menu | `models.list`, local next-turn `modelConfigurationId` | Show enabled real models only. The prototype model names are mock content. |
| Reasoning effort menu | `ModelConfigurationView.supportedReasoningEfforts` and next-turn `reasoningEffort` | Keep the selection valid when the model changes and disable it during an active task. |
| Permission menu | next-turn `permissionMode` passed to `agent.start` | `manual` and `auto` switch directly. `full_access` requires explicit confirmation before local state changes. |
| Settings menu | local theme preference, model/provider navigation, Core status/exit, audit cleanup | Keep `system`, `light`, and `dark`; preserve terminal search and Core operations. |
| Simultaneous menus shown by the prototype | no production equivalent | Use one `activeOverlay` state so Session, dialect, resources, model, reasoning, permission, settings, and prompt history are mutually exclusive. |

## Terminal And Agent Panel

| Prototype state | Production source or action | Implementation boundary |
| --- | --- | --- |
| Terminal content and search | existing `TerminalView` and xterm search control | Preserve the live terminal stream, theme integration, keyboard behavior, and Session ownership. |
| Timeline tab | Session-filtered `AgentHistoryView` plus live `agent.onTimeline` items | Preserve approval, cancel, interrupt, reset, takeover, tool summaries, file changes, and final output. |
| Audit tab | `audit.list({ sessionId })` | Load on demand, protect against stale requests, and show loading, empty, error, and refresh states. Prototype audit rows are mock data. |
| Prompt history | deduplicated `AgentHistoryView.turns[].userMessage` for the current Session | Search and refill the Composer only. Selecting a prompt must not submit it. |
| Composer model/reasoning/permission fields | moved to the workspace context bar | Remove duplicate controls from the Composer while keeping the same `agent.start` options. |
| Active task state | `activeTurnIds`, `startingTurnSessions`, live timeline transaction state | Disable next-turn configuration while retaining cancel, interrupt, and takeover as independent actions. |
| Resizable desktop Agent panel | existing drag width state | Preserve desktop resizing; at narrow width use a 390 px-safe overlay drawer with no document overflow. |

## Resource Popover

| Prototype state | Production source or action | Implementation boundary |
| --- | --- | --- |
| Host and update summary | `SessionResourceSnapshot.host`, `os`, `collectedAt` | Show real values only and keep the previous snapshot visible when refresh fails. |
| CPU, memory, Swap, uptime | corresponding `ResourceMetric` values | An unavailable metric displays its reason, never a fabricated zero. |
| Disk list | `snapshot.disks` | Render every real disk in a bounded internal scrolling region. |
| Network list | `snapshot.network` | Render every real interface and receive/transmit totals or unavailability reason. |
| Refresh action | `resources.refresh(activeSession.id)` | Disable duplicate refreshes and expose a recognizable failure with retry. |
| No active Session | no API call | Show a no-Session empty state and disable refresh. |

## Model Management

| Prototype state | Production source or action | Implementation boundary |
| --- | --- | --- |
| Model catalog | `models.list` | Use a scannable table with Provider, model ID, validation, enabled, and default state. |
| New/edit model Dialog or Sheet | `models.save` | Preserve name, Provider, model ID, context window, max output, auto-compaction, threshold, supported reasoning efforts, and default reasoning effort. |
| Discover models | `providers.discoverModels`, `providers.cancelDiscovery` | Show loading, cancellation, filtering, truncation, selection, and manual fallback. Do not use the prototype's timed mock results. |
| Validate model | `models.test` | Show checking, available, unavailable, and unverified states based on returned data. |
| Enable/default/remove | `models.setEnabled`, `models.setDefault`, `models.remove` | Surface Core constraint errors and refresh the catalog after every successful mutation. |

## Provider Management

| Prototype state | Production source or action | Implementation boundary |
| --- | --- | --- |
| Provider catalog | `providers.list` | Use cards showing protocol, Base URL, and whether a credential is configured. |
| New/edit Provider Dialog or Sheet | `providers.save` | Preserve protocol, name, Base URL, timeout, optional API Key, and extra headers. Never read or echo a stored API Key. |
| Header validation | local JSON-object validation before `providers.save` | Reject arrays, primitives, non-string values, and invalid JSON with a field-level error. |
| Remove Provider | `providers.remove` | Surface dependency/constraint errors and refresh real data. |
| Prototype provider test result | no API endpoint | Do not show a Provider test button or simulated connection success. Connection health is expressed through discovery and model validation. |

## Navigation, Accessibility, And Explicit Exclusions

- Model and Provider pages return to the existing workspace without closing,
  recreating, or migrating any Session or Agent task.
- Page changes and Escape dismiss transient overlays without mutating domain
  state. Icon-only actions receive stable accessible names and tooltips.
- The production name remains `Terminal Agent`; the prototype's `Synapse Term`
  label is not copied.
- Simulated historical Sessions, static terminal output, fake resources, mock
  models, mock audit events, mock approvals, and any Provider credential values
  are never used as production data.
- The prototype defects observed during the walkthrough are explicitly rejected:
  stacked resource/menu overlays, immediate `full_access` switching, editing the
  wrong Provider record, and icon buttons without accessible names.
