# MCP 审批配置驱动、默认拒绝

MCP 工具调用由配置而非 UI 审批：权限要么是 read-only（读操作自动放行、写操作拒绝），要么是 managed（低危自动放行、高危由本地 PolicyEngine 拒绝），高危操作永远不能配置为放行。桌面 UI 存在时可在同一审批流之上叠加；客户端侧 human-in-the-loop（MCP sampling）推迟到验证通过后。terminal_observe 视为读操作，其结果在披露给外部调用者之前先脱敏。
