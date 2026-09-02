# 文档导航

docs/ 按主题分类维护；新增文档必须放入对应分类目录，不要在 docs/ 根目录平铺散文档。

| 分类 | 内容 | 文档 |
| ---- | ---- | ---- |
| `adr/` | 架构决策记录（编号递增；现存决策有效，推翻需同步更新） | `adr/` |
| `architecture/` | 产品边界、仓库结构、进程与模块、IPC 契约 | `architecture/architecture.md` |
| `security/` | 安全边界与进程隔离 | `security/security.md` |
| `engineering/` | 开发工程约定：编码/提交、测试、命令手册、发布流程 | `engineering/conventions.md`、`engineering/testing.md`、`engineering/runbook.md`、`engineering/release.md` |

## 加载指引

- Agent 的文档入口是根目录 `AGENTS.md`：其中的「渐进式加载」路由表按任务类型指向上述文档，按需读取即可。
- 首次接触代码库先读 `architecture/architecture.md`；改动行为前结合对应分类文档核对边界。
- 领域术语与边界语义见根目录 `CONTEXT.md`；规格变更与归档在 `openspec/`，不属于 docs/。
