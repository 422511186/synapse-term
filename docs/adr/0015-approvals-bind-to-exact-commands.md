# ADR-0015：审批绑定精确命令和参数

状态：已实现

## 决策

Approval Grant 绑定 Conversation、Turn、Tool Call、目标 Session、Lease epoch、完整命令、风险和命令哈希。命令文本、顺序、目标或文件 expected hash 改变后，旧授权不可复用。

## 当前实现

`packages/domain/src/approval/approval-grant.ts` 定义匹配规则，`ApprovalManager` 和 Tool Gateway 在执行前再次校验；Local File write/edit 同样要求 expected SHA-256。

## 影响

审批提示可能比自然语言目标更频繁，但授权边界是机械可比较的，不依赖“用户大概同意了这个意图”。
