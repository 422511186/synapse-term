## 1. 修正规格

- [x] 1.1 补全 `interaction-feedback`、`literal-shell-audit` 和 `macos-build-packaging` 主规格的 `Purpose`，确保准确概括既有需求且不改动 Requirements。
- [x] 1.2 同步 `desktop-runtime-assurance` 的完整 delta requirement，修正 MCP 禁令、运行时及事件名称，保留原场景并明确本地管理与外部访问边界。

## 2. 验证文档与现有契约

- [x] 2.1 运行 change 与全库规格 strict 校验、现有 Desktop IPC/preload/依赖方向测试、`pnpm format:check` 和 `git diff --check`，核对完整 delta 同步且仅修改本次文档。

## 验证记录

- `openspec validate --specs --strict --json`：13/13 通过，零 WARNING、零 ERROR；本次四份规格的 issues 均为空。
- `openspec validate fix-spec-purpose-and-desktop-api --type change --strict --json`：通过。
- Desktop IPC、preload API、依赖方向既有测试：3 个文件、4 个用例通过。
- `pnpm format:check` 和 `git diff --check`：通过。
- 已核对主规格与 delta 的一条完整需求及六个场景一致；三份用途说明修订未改变对应 Requirements。
- 本次仅改动规格与 OpenSpec 变更文档，未重复运行全量运行时测试或构建。
