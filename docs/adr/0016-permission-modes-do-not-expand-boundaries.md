# ADR-0016：权限模式不扩大能力边界

状态：已实现

## 决策

`manual`、`auto`、`full_access` 只改变风险分类后的审批行为，不改变工具 allowlist、Session 绑定、本机 home 根目录、Schema、秘密保护、expected hash、ShellDriver 或审计要求。

## 当前实现

`AuthorizationPolicy`、`ToolGateway` 和 `permission-mode-audit.test.ts` 验证三种模式的行为；高便利模式仍经过同一执行管线。

## 影响

`full_access` 适合受信任的本机工作流，但不等于任意本机进程权限，也不能访问其他 Session 或绕过明文命令和路径校验。
