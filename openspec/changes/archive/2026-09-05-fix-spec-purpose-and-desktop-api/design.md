## Context

三份主规格的用途说明未充分概括已有需求，导致 strict 校验失败。`Complete DesktopApi Contract` 仍使用裁剪 MCP 前的限制，而 `DesktopApi`、IPC 白名单、preload 和 Main 已具备 MCP 设置、Token、Sharing、审批及事件能力；ADR-0014、ADR-0015 和 ADR-0020 也明确了相应边界。

## Goals / Non-Goals

**Goals:**

- 消除三处 `Purpose` 长度警告，并提供能说明能力用途的正文。
- 让 `DesktopApi` 规格准确描述当前本地管理能力、事件和 Renderer 隔离要求。
- 通过全库 strict 校验与既有契约测试验证文档修正。

**Non-Goals:**

- 不新增 API、MCP 工具、权限、领域术语或架构决策。
- 不修改应用代码、历史归档或其他能力的需求。

## Decisions

1. `Purpose` 依据各规格现有需求概括交互反馈、字面 Shell 审计和 macOS 打包用途，仅修改主规格说明文字。OpenSpec 同步保留既有主规格的 `Purpose`，因此这三处修订在 apply 任务中直接完成，不通过虚构需求或重复 delta 表达。
2. `DesktopApi` 的受限能力以 `contracts.ts`、`desktop-ipc-channels.ts`、`preload-api.ts` 和 Main handlers 为实现依据，通过一个完整的 MODIFIED requirement 同步。保留原三个场景，修正实际事件名及运行时名称，补充已有 MCP 管理和事件场景。
3. 明确 `DesktopApi.mcp` 是本地 Renderer 的管理接口。外部客户端继续通过内嵌 MCP Server 操作已显式共享的 Session，不能获得本地 Session 列表、设置或审批能力；Renderer 也不能直接调用 MCP HTTP 端点或经 preload 转发任意工具。

## Risks / Trade-offs

- 把解除旧 MCP 禁令理解为放开任意访问：用明确的管理能力清单和独立的外部访问边界场景限制解释。
- 文档合并丢失原场景：保留原场景名称，核对 delta 和主规格的完整需求与场景。
- 为清除警告引入新承诺：三段 `Purpose` 仅概括各自已有要求，不修改对应 Requirements。

## Migration Plan

1. 完成并校验本 change 的文档，按任务更新三段 `Purpose`。
2. 同步 `desktop-runtime-assurance` delta，运行全库 strict 校验、既有契约测试、格式和差异检查。
3. 归档本 change 并单独提交文档修正。无需数据或运行时迁移；回退只涉及本次规格与变更文档。
