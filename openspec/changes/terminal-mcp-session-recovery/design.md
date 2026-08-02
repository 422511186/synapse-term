## Context

当前 MCP 端点（`apps/desktop/src/mcp/mcp-tools.ts`）把 Core 层 `ExternalToolResult` 的错误只以 message 文本返回，丢弃了稳定的内部错误码（如 `session_not_ready`、`invalid_session`）。外部客户端因此无法区分“会话未就绪（可重试）”与“会话已失效（需重新共享）”；当终端会话死亡后，`ExternalRequestHandler` 的 `#pipelines` 缓存仍持有旧管线，且没有探测会话状态的工具，客户端只能等待用户手动重新复制 session id。

另外，MCP 端点目前同时暴露 `local_list_files` / `local_search_files` / `local_read_file`，与客户端自带文件能力重叠，扩大了工具面。

## Goals / Non-Goals

**Goals:**
- 所有 `terminal_*` 工具的错误返回稳定、可解析的错误码（`SESSION_NOT_READY`、`SESSION_EXPIRED`、`SESSION_BUSY` 等），并附恢复指引。
- 会话失效时自动清理 `ExternalRequestHandler` 中的缓存管线注册，避免悬挂引用。
- 提供只读探测工具 `terminal_status`，作为会话未就绪/失效后的重连与重新初始化路径；会话恢复后既有工具可直接继续使用。
- MCP 工具面收敛为仅 `terminal_*`，移除 `local_*` 工具注册。

**Non-Goals:**
- 不实现外部客户端直接创建/重启终端会话的能力（终端会话仍由桌面端拥有，共享必须由用户在桌面 UI 显式完成）。
- 不改变内置 Agent 的工具 Schema 与 ACP 文件能力（ACP 仍可走 `external.localReadFile` 内部通道）。
- 不修改 MCP 传输层（Streamable HTTP）与认证语义。

## Decisions

**D1：稳定错误码在 MCP 边界格式化，Core 层错误码语义保持不变。**

`runMcpTool` 增加错误格式化：把内部错误码映射为稳定的外部错误码（`session_not_ready` → `SESSION_NOT_READY`，`invalid_session` → `SESSION_EXPIRED`，`lease_unavailable` → `SESSION_BUSY`，`transaction_not_found` → `TRANSACTION_NOT_FOUND`，`command_*` → `COMMAND_*` 等），返回文本统一为 `CODE: message（恢复指引）`。MCP `CallToolResult` 没有结构化错误码字段，稳定前缀是模型可解析的最小契约。

备选：在结果 JSON 里加 `code` 字段 —— 不采用，因为外部客户端会混用文本与 JSON 两种结果形态，稳定前缀对两者都成立，且不破坏现有调用方。

**D2：新增 `terminal_status` 工具与 `external.terminalStatus` Core API 用例。**

工具只读返回 `{ sessionId, status: 'ready' | 'not_ready' | 'expired', pty?, shell?, shared, hint }`。与 `terminal_observe` 不同，`terminal_status` 对不存在的 sessionId 不抛错，而是返回 `status: 'expired'` 与“请在桌面端重新共享会话 ID”的指引——探测失效会话正是该工具的存在意义。它只应答调用方提供的 sessionId，不提供枚举，符合“不泄露其他会话信息”的既有约束。

备选：复用 `terminal_observe` 的 `view: 'status'` —— 不采用，observe 的无效会话语义必须保持抛错（避免破坏既有客户端），状态探测需要独立的“不抛错”语义。

**D3：`ExternalRequestHandler` 在会话失效时清理缓存管线。**

`#session()` 与 `terminalStatus` 在 `SessionManager` 找不到会话、或会话未共享、或 PTY 不在 running 状态时，`#pipelines.delete(sessionId)` 并继续返回 `invalid_session`（MCP 边界映射为 `SESSION_EXPIRED`）。会话被删除后以相同 id 重建时，`#pipelineFor` 已按 actor 引用变化重建新管线，不会复用旧执行器。

**D4：MCP 工具面只保留 `terminal_*`。**

移除 `local_list_files`、`local_search_files`、`local_read_file` 的 `registerTool` 注册，并从 `runMcpTool` 的方法联合类型中移除对应 `external.local*` 分支。Core 的 `external.local*` 用例与 `ExternalToolPipeline` 文件能力保留，供 ACP 与未来内部用途使用。

## Risks / Trade-offs

- [外部客户端依赖 MCP 文件工具] → 这是本次变更的明确 BREAKING 行为；文档与工具描述中不再出现 local_*，客户端改用自身文件能力。
- [`terminal_status` 可能被当作会话枚举通道] → 只接受单个 sessionId，不提供列表/遍历；未知 id 与未共享 id 返回相同 `expired` 形态，不区分存在性。
- [错误文本包含英文内部 message，模型可能误读] → 统一附中文恢复指引；指引文案固定，便于客户端识别。
- [缓存清理只在调用发生时触发] → 会话删除事件不主动广播；`SessionManager` 删除会话后下一次外部调用即可触发清理，内存泄漏窗口有限，可接受。

## Migration Plan

无数据迁移。MCP 客户端在下次 `tools/list` 时看到新的工具清单（无 local_*、多 terminal_status）。旧客户端调用 local_* 会收到 MCP SDK 的 unknown tool 错误，属预期 BREAKING。

## Open Questions

暂无。
