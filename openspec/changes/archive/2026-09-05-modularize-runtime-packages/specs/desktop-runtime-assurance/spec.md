## MODIFIED Requirements

### Requirement: Main-Process Terminal Host Contract

Electron Main MUST 在主进程中实例化并持有 `@synapse-term/session-runtime`，通过 Desktop IPC adapter 处理 Session 与 PTY 操作，并只向 Renderer 暴露受限的 preload API；Renderer MUST NOT 直接访问 Node API、PTY、`SessionRuntime` 或 `SessionActor` 内部对象。Session 运行行为不得因为从 app 下沉到 package 而转移给 Renderer。

#### Scenario: Renderer requests a session operation

- **WHEN** Renderer 调用 `sessions:create`、`terminal:write` 或订阅 `terminal:output`
- **THEN** 请求经 preload 通道到达 Main 的 IPC adapter，由其调用 Main 持有的 `SessionRuntime` 并返回经过校验的结果

#### Scenario: Runtime implementation is reused without exposing Main internals

- **WHEN** 未来 TUI 或本地 Web renderer 需要复用 Session 行为
- **THEN** 运行端可以依赖 `@synapse-term/session-runtime` 的公共出口，但不得 import `apps/desktop/src/main`、PTY 对象或 Session 内部状态
