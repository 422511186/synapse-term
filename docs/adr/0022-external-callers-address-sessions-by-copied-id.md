# ADR-0022：外部调用者使用用户复制的 Session ID

状态：已实现

## 决策

外部 MCP/ACP 调用必须提供 Session ID，但只能使用用户在桌面端显式标记共享并复制的 ID。端点不提供 Session 枚举或发现能力，无效 ID 返回稳定错误且不泄露其他会话。

## 当前实现

`session.markShared` 记录共享状态；`external-handler.ts` 在进入外部工具管线前校验 shared Session。MCP 的外部 schema 在边界层包含 `sessionId`，内置 Tool Schema 不包含它。

## 影响

用户复制 ID 是一次明确的外部授权动作，但它不等于授予全部权限；外部调用仍受配置驱动审批、租约、路径和审计限制。
