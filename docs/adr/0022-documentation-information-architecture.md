# ADR-0022：按读者任务划分文档并建立唯一事实来源

状态：已接受

日期：2026-09-10

## 背景

根 README 曾同时承担产品定位、当前版本、能力清单、源码开发、MCP 操作、架构和仓库导航。`docs/` 主要按 `architecture`、`security`、`engineering` 分类，读者必须先理解内部目录才能找到任务；更新行为、发布流程、测试和安全说明又在多份文档中重复。

这种结构造成了真实漂移：README 的固定版本落后于包元数据和 GitHub Release，更新手册保留一次性迁移状态，绝大多数 ADR 没有可发现入口。只缩短 README 不能解决信息所有权不清的问题。

## 决策

1. 根 README 是常青的项目入口页，只负责产品定位、正式下载、最短首次使用路径、核心边界和文档/贡献入口；不保存当前版本号、完整协议、包结构或发布操作。
2. `docs/README.md` 是面向人类读者的唯一导航，优先按任务和角色组织：Getting Started、Guides、Reference、Concepts、Development、Maintainers、Architecture & Decisions。
3. 文档采用 Diátaxis 的内容契约：Tutorial 帮助首次成功，How-to 完成具体任务，Reference 陈述可查询事实，Explanation 解释边界与原因。目录名称不必机械复制四种类型，但单个页面不得混写不同职责。
4. 每项事实只有一个 canonical 页面。README、导航页和兼容页只做摘要与链接，不复制正文。
5. 版本事实由 `package.json`、Git tag 和 GitHub Release 承担。只有兼容性确实需要时，具体页面才记录适用版本；一次性迁移状态不得写成长期现状。
6. 移动既有页面时保留短兼容页，指向新的 canonical 页面；兼容页不继续维护业务内容。
7. ADR 保留决策历史，`CONTEXT.md` 保留领域语言，OpenSpec 保留变更生命周期；三者不代替用户、Reference 或维护者文档。
8. 文档变更必须通过格式检查和内部链接检查。导航顺序、页面所有权和迁移规则由[文档维护指南](../maintainers/documentation.md)统一维护。

## 理由

按内部模块分类便于作者放置文件，却不能帮助新用户判断下一步；完全照搬大型项目的独立文档站、复杂侧栏或多语言管线又超出当前规模。任务优先导航加内容类型约束，能在不引入站点框架的前提下提高可发现性和一致性。

保留兼容页比一次性删除旧路径更稳妥，同时又通过唯一正文避免重复维护。把版本交给发布元数据，可以消除手工同步多个说明页造成的过期信息。

## 后果

- 新用户从 README 和 Getting Started 获得最短成功路径；协议和工程细节下沉到可查询页面。
- 贡献者必须先确定文档受众与内容类型，再选择目录；不能用 README 或架构总览兜底所有信息。
- 旧链接继续可达，但兼容页会增加少量文件数量；后续确认无外部依赖后可以通过新 ADR 或维护决策移除。
- 当前仓库不引入独立文档站、搜索服务、多语言镜像或自动生成 Reference；规模增长后再评估。

## 参考

- [VS Code README](https://github.com/microsoft/vscode/blob/322d4efe0fefe31adff4c7deddda06035ba2d8d1/README.md) 与 [VS Code 文档贡献指南](https://github.com/microsoft/vscode-docs/blob/41f450fed309e4f2015743bd5809958a3c1421bc/CONTRIBUTING.md)
- [Zed README](https://github.com/zed-industries/zed/blob/e9d2934edfa5560e5efd8253aaff0d9df39a7c70/README.md) 与 [Zed 文档导航](https://github.com/zed-industries/zed/blob/e9d2934edfa5560e5efd8253aaff0d9df39a7c70/docs/src/SUMMARY.md)
- [Ghostty README](https://github.com/ghostty-org/ghostty/blob/cf4de795be50ec5bfe6675803a3371d4055f2beb/README.md) 与 [Ghostty 文档导航](https://github.com/ghostty-org/website/blob/7962e91e190ff226be1a4983eb9368b7ddb4dff9/docs/nav.json)
- [WezTerm README](https://github.com/wezterm/wezterm/blob/9fa147c9532c7b175335f6453a4dd7ad7e6473b2/README.md)
- [Tauri 文档贡献指南](https://github.com/tauri-apps/tauri-docs/blob/fc154edb1dfa822833d6c6ac4592bee809ca1b74/.github/CONTRIBUTING.md)
- [Diátaxis](https://diataxis.fr/start-here/)

## 取代关系

无。
