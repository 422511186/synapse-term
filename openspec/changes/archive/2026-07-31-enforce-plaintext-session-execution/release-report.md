# 发布报告: enforce-plaintext-session-execution

## 变更概述

移除 Shell 命令执行管道中的 Base64 编码封装，改为明文 brace group (POSIX) / dot-sourced block (PowerShell) 事务协议，使服务器侧审计能在执行前看到原始命令。

## 核心变更

### 代码变更
- `shell-driver.ts`: 全量重写，移除 Base64 赋值、`eval`、`FromBase64String`、`ScriptBlock::Create`，改用明文 brace group / dot-sourced block
- `plaintext-dispatcher.ts`: 新文件，统一 Agent PTY 执行 dispatch
- `command-executor.ts`: 使用 dispatcher 做预验证，返回 transportMode/commandHash
- `session-actor.ts`: 新增 `verifyCurrentEnvironment()` 方法
- `session-state.ts`: 新增 `ExecutionEnvironment`、`EnvironmentPlatform`、`TransportMode`、`SourceKind` 类型
- `command-protocol.ts`: `buildPosixCommand` 重写为 brace group
- `audit-service.ts`: 扩展 `AuditCommandInput` 支持 transport/dialect/epoch/hash 字段
- `core-schema.ts`: 新增 migration v7，旧 Session 标记 unverified hint

### 新增文件
- `rejection-messages.ts`: 中英文拒绝原因映射
- `plaintext-dispatcher.ts`: 统一 dispatch 入口

### 新增测试文件
- `environment-identification.test.ts`: 13 个场景测试
- `rejection-messages.test.ts`: 8 个中文 UI 映射测试
- `unified-dispatch.integration.test.ts`: 6 个统一 dispatch 集成测试
- `fail-closed-audit.test.ts`: 7 个 fail-closed 审计测试
- `permission-mode-audit.test.ts`: 6 个权限模式审计测试
- `ssh-hop-scenarios.test.ts`: 6 个 SSH 跳转场景测试
- `core-tool-gateway-flow.test.ts`: 6 个 Core/ToolGateway 流程测试
- `migration-v7.test.ts`: 4 个迁移测试
- `static-execution-gate.test.ts`: 增强，新增 6 个生产入口回归测试

## 测试结果

- 新增测试: 62 个
- 全部通过: ✓
- 原有测试: 全部通过，无回归

## 跨平台矩阵

| 平台 | POSIX | PowerShell | 状态 |
| --- | --- | --- | --- |
| macOS | ✓ (Bash E2E) | N/A (pwsh 未安装) | 通过 |
| Linux | ✓ | N/A | 待验证 |
| Windows | N/A | ✓ (ConPTY) | 待验证 |

## 残余风险

1. PowerShell ConPTY 真实 E2E 测试需要 Windows 环境
2. SSH/堡垒机会话录像验证需要远端环境
3. 旧版本回滚会重新启用 Base64 wrapper，受影响服务器应使用 observation-only

## 回滚策略

回滚前先将 Agent 终端能力切为 observation-only。不得通过回滚重新允许旧编码 wrapper 在受约束服务器上执行。
