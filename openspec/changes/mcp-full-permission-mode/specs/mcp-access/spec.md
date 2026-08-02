## MODIFIED Requirements

### Requirement: External Approval Configuration
MCP 端点 MUST 按设置页配置的三级权限审批外部调用：read-only 模式只放行读类工具并拒绝写类；managed 模式按本地 PolicyEngine 自动放行低危并拒绝高危；full 完全权限模式不审查命令，任何风险级别的命令 MUST 自动放行。未配置或配置无效时 MUST 默认回退 read-only 拒绝。

#### Scenario: Managed mode low-risk command
- **WHEN** 权限为 managed 且外部调用被 PolicyEngine 判定为低危
- **THEN** 调用自动放行并记录审批来源为配置策略

#### Scenario: High-risk command in managed or read-only mode
- **WHEN** 权限为 managed 或 read-only 且外部调用被判定为 destructive 或 unknown 高危命令
- **THEN** 调用被拒绝，不得自动放行，并记录审计

#### Scenario: High-risk command in full mode
- **WHEN** 用户在设置页显式选择 full 完全权限模式且外部调用提交任意风险级别的命令
- **THEN** 调用自动放行并记录审计（含 risk 与 approvalMode: full），策略引擎只用于审计分类，不拦截执行

#### Scenario: Invalid approval configuration
- **WHEN** 设置文件缺失、损坏或包含未知的审批模式值
- **THEN** 设置加载回退为 read-only，外部写类调用默认被拒绝
