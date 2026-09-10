# 编码与协作约定

## 编码风格

- 统一使用 UTF-8、LF、两个空格缩进并保留文件末尾换行。
- Prettier 配置为单引号、尾随逗号、100 字符行宽；提交前运行 `pnpm format` 或 `pnpm format:check`。
- ESLint 要求一致的类型导入（`import type`），并禁止显式 `any`。
- 文件通常采用 kebab-case；类型与 React 组件使用 PascalCase，变量与函数使用 camelCase。

## Git 与 PR

- Commit 使用简洁中文动宾短句，采用 `fix:`、`feat:`、`docs:`、`chore:` 等前缀；每个提交只解决一个问题。
- PR 说明背景、变更内容、影响/风险和验证方式，并关联 Issue 或 OpenSpec Change。
- UI 改动提供关键状态的截图或录屏，尤其是窄窗口和主题状态。
- 合并前确认格式、Lint、类型检查和测试通过。
- 禁止提交 `dist/`、`release/`、测试报告、用户数据、凭据、真实主机/IP 等环境敏感信息。

## 边界与依赖

- Renderer 不直接访问 Node API、PTY 或 Session 内部状态；能力必须经过受限 preload API。
- 跨包依赖必须经过公共出口；领域模型不得反向依赖终端服务、Electron 或 UI。
- 保留 Session 的传输无关语义，不把 SSH、跳板机、容器或 WSL 建模成主机资产。
- 外部客户端只能操作用户明确 Sharing 的 Session；不引入自动枚举、远程端点或永久授权。

## 术语与决策

- 优先使用 `CONTEXT.md` 中的 Session、Sharing、Share Text、内嵌 MCP Server、外部客户端、审批模式、审批卡片、会话内放行和风险分类。
- 出现新的稳定领域概念时，在同一变更中更新 `CONTEXT.md`；它只记录术语和边界语义。
- 难以回退、缺少背景会令人困惑，并且来自真实权衡的决定才新增 ADR；模板和索引见 [`docs/adr/`](../adr/README.md)。
- 文档页面先确定读者任务和内容类型，再选择 canonical 目录；规则见[文档维护指南](../maintainers/documentation.md)。
