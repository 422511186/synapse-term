# ADR-0019：单用户本地 Core 与可替换部件

状态：已实现

## 决策

产品的稳定边界是单用户本地 Core；Agent、终端、模型、工具和传输都通过 package/adapter 边界替换。MCP 和 ACP 是访问本地 Core 的接入方式，不自动变成远程多用户产品。

## 当前实现

Core API 位于 `@synapse-term/protocol`，业务装配位于 `@synapse-term/application`；桌面、MCP 和 ACP 都通过 Core API 调用 Session、Provider、Model、Agent 和外部工具用例。

## 影响

未来增加 CLI 或本机 Web 入口时仍需复用同一套策略和审计。远程托管、多用户和共享工作区必须另立产品架构。
