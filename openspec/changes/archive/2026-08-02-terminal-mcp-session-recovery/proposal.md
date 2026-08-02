## Why

共享终端会话的 MCP 调用在会话未就绪或失效时表现不一致：`terminal_execute` 先返回“Session shell is not ready”，随后同一会话的 `terminal_*` 调用在客户端变成“unsupported call”，而文件类工具仍正常。外部客户端无法区分会话未就绪、会话过期还是工具注册丢失，也没有可用的探测或重连路径，只能等用户手动重新复制 session id，形成死胡同。

## What Changes

- MCP 端点统一返回稳定、可解析的错误码：会话未就绪返回 `SESSION_NOT_READY`（可重试），会话不存在/PTY 已退出/未共享返回 `SESSION_EXPIRED`（需要重新共享），租约被占用返回 `SESSION_BUSY`，其余业务错误保留原有稳定码。错误文本同时包含错误码、原因与客户端应采取的下一步。
- 外部调用边界区分会话状态：`SessionManager` 中已删除（PTY 退出）或未共享的会话不再被当作“未就绪”，而是稳定返回 `SESSION_EXPIRED`，并清理 `ExternalRequestHandler` 中缓存的该会话管线注册，避免悬挂引用。
- 新增只读探测工具 `terminal_status`：返回会话的共享状态、PTY/Shell 状态与恢复提示，作为会话未就绪/失效后的重连与重新初始化路径；会话恢复后既有 `terminal_execute` 等工具可继续使用。
- MCP 工具面收敛为仅 `terminal_*`：移除 `local_list_files`、`local_search_files`、`local_read_file` 三个工具注册。**BREAKING**：依赖 MCP 文件工具的客户端需改用自身文件能力；ACP 的 `external.localReadFile` 内部通道不受影响。

## Capabilities

### New Capabilities

### Modified Capabilities
- `mcp-access`: 新增“稳定错误码与会话状态探测”要求，规定外部调用在会话未就绪/失效时返回稳定错误码与恢复指引；新增 `terminal_status` 工具；移除 MCP 的 `local_*` 工具面。

## Impact

- `apps/desktop/src/mcp/mcp-tools.ts`：错误码映射与文本格式、`terminal_status` 工具注册、移除 `local_*` 注册。
- `packages/application/src/router/handlers/external-handler.ts`：会话失效时清理缓存管线；区分 `SESSION_EXPIRED` 与 `SESSION_NOT_READY`。
- `packages/protocol/src/core-api/core-api.ts`：新增 `external.terminalStatus` 用例（如需在 Core 层探测会话状态）。
- `apps/desktop/src/mcp/embedded-mcp-server.test.ts`、`mcp-controller.test.ts`：工具清单与错误码断言更新。
- 测试：`mcp-tools`/`external-handler` 相关单元测试新增稳定错误码、缓存清理与 `terminal_status` 场景。
