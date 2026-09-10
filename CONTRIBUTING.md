# 参与贡献

感谢你改进 Synapse Term。仓库使用简体中文维护领域、规格和工程文档，代码标识、API 和第三方专有名词保留英文。

## 开始之前

1. 阅读 [AGENTS.md](AGENTS.md) 中的仓库规则。
2. 阅读 [CONTEXT.md](CONTEXT.md) 了解 Session、Sharing、Share Text、内嵌 MCP Server、外部客户端和审批模式等规范术语。
3. 阅读 [ADR 索引](docs/adr/README.md)和其中列出的全部生效 ADR；改动开始后，再按任务路由加载对应的当前架构、开发或安全文档。
4. 行为或架构变更以已批准的 OpenSpec proposal、design、specs 和 tasks 为准。

发现 `CONTEXT.md`、ADR、OpenSpec 或代码互相矛盾时，应先说明冲突和影响，不要默默选边。

## 开发环境

仓库只使用根 `package.json` 声明的 pnpm 版本和 `pnpm-lock.yaml`。不要生成或提交 npm、Yarn 等第二套锁文件。

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` 使用 Mock API，适合 Renderer 开发；运行真实 Electron、PTY 和 Shell 前先执行：

```bash
pnpm build
pnpm start
```

完整环境和平台前提见[开发环境](docs/development/setup.md)。

## 提交改动

- 每个提交和 PR 只解决一个清晰问题，保留已有模块边界和公共出口。
- 新行为应补充对应单元、集成或 E2E 测试；提交前至少运行 `pnpm verify`。
- UI 改动应验证关键桌面/窄窗口状态，并在 PR 中提供必要截图。
- 新稳定领域概念写入 `CONTEXT.md`；难以回退、缺少背景会令人困惑的真实取舍才新增 ADR。
- 文档应按读者任务和内容类型放入唯一 canonical 页面，不在 README、架构文档和操作指南之间复制同一事实。

编码、Git、测试和文档规则分别见：

- [编码与协作约定](docs/development/conventions.md)
- [测试指南与验证矩阵](docs/development/testing.md)
- [文档维护指南](docs/maintainers/documentation.md)

## PR 内容

PR 应说明背景、变更内容、影响或风险、验证方式，并关联对应 Issue 或 OpenSpec Change。禁止提交构建产物、测试报告、用户数据、凭据以及真实主机或 IP 等环境敏感信息。
