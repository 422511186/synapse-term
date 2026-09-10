# 文档维护指南

本文规定 Synapse Term 文档的信息所有权、写作边界和验证流程。它服务贡献者和维护者，不是用户教程。

## 读者与入口

| 读者 | 入口 | 目标 |
| --- | --- | --- |
| 初次了解项目的人 | 根 [README](../../README.md) | 判断项目是否适用并找到下载、快速开始和文档 |
| 首次使用者 | [`getting-started/`](../getting-started/) | 按顺序取得第一个可验证结果 |
| 正在完成任务的用户 | [`guides/`](../guides/) | 解决一个具体工作目标 |
| 查询协议和限制的人 | [`reference/`](../reference/) | 获得准确、中性的字段、状态和边界事实 |
| 想理解设计的人 | [`concepts/`](../concepts/) | 理解为什么存在某个边界或模型 |
| 贡献者 | [`development/`](../development/) 与 [CONTRIBUTING](../../CONTRIBUTING.md) | 搭建环境、修改代码并验证 |
| 发布和架构维护者 | [`maintainers/`](./)、[`architecture/`](../architecture/)、[`adr/`](../adr/) | 维护发布链、当前架构和长期决策 |

`docs/README.md` 是唯一的人类导航。`AGENTS.md` 是自动化 Agent 的强制加载规则，两者不能互相复制整套路由。

## 内容契约

### Tutorial

帮助读者第一次成功。它应给出前置条件、顺序步骤和可观察结果，不解释所有选项。当前放在 `getting-started/`。

### How-to

帮助已经知道目标的读者完成具体任务。标题应是动作，例如“连接外部客户端”；步骤可以链接 Reference，但不复制完整参数表。当前放在 `guides/`。

### Reference

准确、中性地描述工具、字段、状态、限制和平台支持。结构应贴近被描述的协议或设置，不加入教学叙事。当前放在 `reference/`。

### Explanation

解释概念、边界、取舍和相互关系。它回答“为什么”，不写成操作清单或字段百科。当前放在 `concepts/`、`architecture/`、`security/` 和 `adr/`。

## 唯一事实来源

| 信息 | Canonical 来源 |
| --- | --- |
| 最新可下载版本 | GitHub Releases |
| 当前包版本 | 根 `package.json` 与 `apps/desktop/package.json` |
| 历史变化 | GitHub Release notes |
| 领域术语与边界语义 | `CONTEXT.md` |
| 用户操作 | Getting Started 或 Guides 中的一页 |
| 工具参数、状态和错误码 | `reference/` |
| 当前进程、模块和依赖结构 | `architecture/architecture.md` |
| 安全边界和信任假设 | `security/security.md` |
| 开发、测试和发布流程 | `development/` 与 `maintainers/` |
| 难以回退的真实取舍 | `adr/` |
| 正在设计或实施的行为变更 | `openspec/` |

摘要页只保留读者选择下一步所需的信息，并链接 canonical 页面。发现两份正文陈述同一事实时，应选定所有者并删除另一份的细节。

## 版本与时效

- README 和长期概念文档不写“当前版本是 X.Y.Z”。
- Release 链接使用 `https://github.com/422511186/synapse-term/releases/latest`。
- 只有兼容性或迁移确实需要时，具体页面才写适用版本，并说明删除或复核条件。
- 一次性发布准备、某台机器尚未执行的验收和分支状态属于 OpenSpec validation、Issue 或 Release checklist，不写成长期现状。

## 文件和链接

- 文件名使用小写 kebab-case；目录按读者任务或维护角色命名。
- 文档内部优先使用相对 Markdown 链接，链接文字描述目标，不使用裸路径充当导航。
- 页面迁移时，旧路径保留一页短兼容说明，只链接新的 canonical 页面。
- ADR 编号递增且不回收；状态和取代关系见 [ADR 索引](../adr/README.md)。
- OpenSpec 和 ADR 的历史记录可以引用旧路径；不要为了表面整齐批量改写已归档证据。

## 修改流程

1. 确定目标读者、读者要完成的任务和内容类型。
2. 在 `docs/README.md` 中确认是否已有 canonical 页面。
3. 更新正文及所有直接导航入口；移动页面时增加兼容页。
4. 检查术语是否符合 `CONTEXT.md`，检查决定是否需要 ADR 或 OpenSpec。
5. 运行格式、内部链接和仓库验证。

```bash
pnpm format:check
pnpm verify
```

纯文档变更仍须执行内部 Markdown 链接检查；仓库未引入文档站生成器前，`docs/README.md` 就是可审查的导航清单。

## 参考标杆

本信息架构的取舍和一手来源记录在 [ADR-0022](../adr/0022-documentation-information-architecture.md)。借鉴重点是 README 克制、用户任务优先、内容类型分工、唯一导航和链接验证；不照搬大型项目的独立站点、多语言、云服务或插件生态结构。
