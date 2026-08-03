# interaction-feedback Delta

## ADDED Requirements

### Requirement: Untrusted Markdown Rendering
Renderer 在渲染来自模型输出或外部 Agent 的 assistant 文本时 MUST 使用不执行原始 HTML 的 Markdown 渲染路径（如 `react-markdown`），MUST NOT 使用 `dangerouslySetInnerHTML` 直接注入未净化文本；链接 MUST 强制 `rel="noreferrer"` 与 `target="_blank"`。

#### Scenario: Assistant text contains a script tag
- **WHEN** 模型或外部 Agent 输出的 assistant 文本包含 `<script>` 标签
- **THEN** Renderer MUST 将其作为转义文本渲染，MUST NOT 执行该脚本或写入全局对象

#### Scenario: Assistant text contains a markdown link
- **WHEN** assistant 文本包含 `[click](https://evil.example)`
- **THEN** 渲染出的锚点 MUST 携带 `rel="noreferrer"` 与 `target="_blank"`，不得在同源上下文导航
