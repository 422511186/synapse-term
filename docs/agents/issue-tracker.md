# Issue tracker：GitHub

本仓库的问题（issue）与规格以 GitHub Issues 形式记录。所有操作统一使用 `gh` CLI。

## 约定

- **创建 issue**：`gh issue create --title "..." --body "..."`。多行正文使用 heredoc。
- **读取 issue**：`gh issue view <number> --comments`，用 `jq` 过滤评论，并一并获取标签。
- **列出 issue**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，按需配合 `--label` 与 `--state` 过滤。
- **评论 issue**：`gh issue comment <number> --body "..."`
- **添加 / 移除标签**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **关闭**：`gh issue close <number> --comment "..."`

仓库由 `git remote -v` 推断；在仓库克隆内运行 `gh` 时会自动识别。

## 以 Pull Request 作为 triage 入口

**PR 作为需求入口：否。** _（若本仓库把外部 PR 视作功能需求，改为 `yes`；`/triage` 会读取此开关。）_

当设为 `yes` 时，PR 与 issue 走同一套标签与状态流程，使用对应的 `gh pr` 命令：

- **读取 PR**：`gh pr view <number> --comments`，用 `gh pr diff <number>` 查看 diff。
- **列出待 triage 的外部 PR**：`gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`，仅保留 `authorAssociation` 为 `CONTRIBUTOR`、`FIRST_TIME_CONTRIBUTOR`、`NONE` 的条目（丢弃 `OWNER`/`MEMBER`/`COLLABORATOR`）。
- **评论 / 打标签 / 关闭**：`gh pr comment`、`gh pr edit --add-label`/`--remove-label`、`gh pr close`。

GitHub 的 issue 与 PR 共用同一编号空间，因此裸写的 `#42` 可能是两者之一：先用 `gh pr view 42` 解析，再回退到 `gh issue view 42`。

## 当某个 skill 说「publish to the issue tracker」

创建一个 GitHub issue。

## 当某个 skill 说「fetch the relevant ticket」

运行 `gh issue view <number> --comments`。

## Wayfinding 操作

供 `/wayfinder` 使用。**地图（map）** 是一个 issue，其 **子项（child）** 为工单。

- **地图**：一个带 `wayfinder:map` 标签的 issue，正文承载 Notes / Decisions-so-far / Fog。`gh issue create --label wayfinder:map`。
- **子工单**：一个与地图关联的 issue，通过 GitHub 子 issue（`gh api` 调用 sub-issues 端点）。若未启用子 issue，则把子项加入地图正文的任务列表，并在子项正文顶部写上 `Part of #<map>`。标签：`wayfinder:<type>`（`research`/`prototype`/`grilling`/`task`）。一旦被认领，工单即指派给推进的开发。
- **阻塞关系**：使用 GitHub **原生 issue 依赖**，这是规范且界面可见的表达。用 `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>` 添加边，其中 `<blocker-db-id>` 是阻塞方的数字 **数据库 id**（`gh api repos/<owner>/<repo>/issues/<n> --jq .id`，_不是_ `#number` 或 `node_id`）。GitHub 会报告 `issue_dependencies_summary.blocked_by`（仅计未关闭的阻塞项，即实时闸门）。若依赖不可用，回退为子项正文顶部的 `Blocked by: #<n>, #<n>` 行。当所有阻塞项关闭时，工单即解除阻塞。
- **前沿（frontier）查询**：列出地图下未关闭的子项（`gh issue list --state open`，限定于地图的子 issue / 任务列表），剔除任何带有未关闭阻塞项（`issue_dependencies_summary.blocked_by > 0`，或 `Blocked by` 行中仍有未关闭 issue）或已有指派者的条目；按地图顺序取第一个。
- **认领**：`gh issue edit <n> --add-assignee @me`，这是本次会话的第一次写操作。
- **解决**：`gh issue comment <n> --body "<answer>"`，随后 `gh issue close <n>`，再把一个上下文指针（要点 + 链接）追加到地图的 Decisions-so-far。
