# Synapse Term 文档

这页是面向读者的唯一文档导航。先选择你要完成的任务，再进入对应页面；不要从仓库目录结构猜测文档归属。

自动化 Agent 的强制上下文加载顺序由根目录 [AGENTS.md](../AGENTS.md) 维护。领域术语以 [CONTEXT.md](../CONTEXT.md) 为准，本文不重复这些规则。

## 第一次使用

| 我想要…… | 从这里开始 |
| --- | --- |
| 下载并安装应用 | [安装与首次启动](getting-started/install.md) |
| 创建第一个终端环境 | [创建第一个 Session](getting-started/first-session.md) |
| 把一个 Session 提供给外部客户端 | [首次共享 Session](getting-started/share-a-session.md) |

## 常见任务

- [使用终端工作区](guides/terminal-workspace.md)
- [连接外部客户端](guides/connect-external-client.md)
- [选择审批模式与处理审批卡片](guides/approvals.md)
- [更新 Synapse Term](guides/updates.md)
- [排查常见问题](guides/troubleshooting.md)

## 查询事实

- [MCP 工具参考](reference/mcp-tools.md)：八个 `synapse_*` 工具、调用顺序、参数和稳定错误码。
- [平台支持](reference/platform-support.md)：正式安装包、源码开发和平台限制。
- [本地数据边界](reference/data-boundary.md)：哪些数据存在、保存在哪里、何时失效。
- [设置参考](reference/settings.md)：通用、主题、终端和 MCP 设置的职责。

## 理解产品

- [Session 与 Sharing](concepts/session-and-sharing.md)
- [本地优先边界](concepts/local-first-boundary.md)
- [MCP 安全模型](concepts/security-model.md)
- [完整安全边界](security/security.md)

## 参与开发

- [贡献入口](../CONTRIBUTING.md)
- [开发环境](development/setup.md)
- [编码与协作约定](development/conventions.md)
- [测试指南与验证矩阵](development/testing.md)
- [当前架构](architecture/architecture.md)

## 维护与发布

- [发布正式版本](maintainers/releasing.md)
- [编写发布说明](maintainers/release-notes.md)
- [维护应用更新链](maintainers/application-updates.md)
- [发布与更新验收](maintainers/release-validation.md)
- [维护文档体系](maintainers/documentation.md)

## 架构决策与规格

- [ADR 索引](adr/README.md) 记录已经接受、实现或取代的长期决策。
- [CONTEXT.md](../CONTEXT.md) 只记录领域统一语言和边界语义。
- [`openspec/`](../openspec/) 保存变更 proposal、design、specs、tasks 和归档记录；它是变更生命周期，不是用户文档。

## 内容约定

文档按 Tutorial、How-to、Reference 和 Explanation 的内容契约写作，但导航优先使用读者能识别的任务名称。每项事实只保留一个 canonical 页面；旧路径只提供迁移入口，不继续维护重复正文。完整规则见[文档维护指南](maintainers/documentation.md)。
