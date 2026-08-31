## 1. OpenSpec and domain foundation

- [x] 1.1 Extend `SessionState` with current PTY environment, verification status, source, timestamp and capability epoch; keep startup `terminalType` as a hint.
- [x] 1.2 Add domain state transitions for environment verification/invalidation and tests for epoch monotonicity and unknown environments.
- [x] 1.3 Add separate external write contract and tests proving valid external writes do not trigger user takeover while user input invalidates capability.

## 2. Dynamic environment verification

- [x] 2.1 Add a fixed, bounded, nonce-bearing plaintext Shell Probe that can identify POSIX versus PowerShell from the current PTY.
- [x] 2.2 Add OS/platform fingerprint parsing, timeout/cancellation handling and fail-closed behavior for ambiguous output or interactive SSH prompts.
- [x] 2.3 Integrate Probe with `CommandExecutor`/external calls so the current verified environment is required before writing the user command.
- [x] 2.4 Bind lease and environment epoch checks to Probe and command dispatch; cover PowerShell → POSIX, POSIX → PowerShell, stale epoch, user takeover and Probe timeout.
- [x] 2.5 Keep literal user-command dispatch and update policy/error messaging to use current verified environment without wrappers, Base64 or `eval`.

## 3. Probe visibility settings

- [x] 3.1 Add validated, persisted `GeneralSettings` with default `hideCompletionProbeEcho: true` and Main-side application to Session UI output.
- [x] 3.2 Add restricted shared contract, preload API, IPC channels/handlers and contract tests for reading/updating the setting.
- [x] 3.3 Split UI output from protocol output so the setting only changes local probe echo visibility; keep OSC 777 isolation, transaction parsing and MCP redaction invariant.
- [x] 3.4 Add the “通用” settings section, switch, diagnostics copy and responsive modern UI treatment; update Mock Renderer behavior.

## 4. Verification and lifecycle

- [x] 4.1 Add unit, integration and fake-backend regression coverage for ConPTY-style ANSI redraw, split markers, output consumers and settings persistence.
- [x] 4.2 Add or update real Electron/Playwright coverage for the General setting and formal desktop startup path where available.
- [x] 4.3 Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm verify`, `pnpm build` and `pnpm test:e2e`; investigate failures before marking tasks complete.
- [x] 4.4 Run strict OpenSpec validation, review the diff for plaintext/audit and architecture boundaries, then archive this Change only after all tasks and verification are complete.
