# session-resource-monitoring Specification

## ADDED Requirements

### Requirement: Prototype Session Menu and New Session Dialog

工作区 MUST 复刻原型的会话菜单外观，其中会话列表来自 `sessions.list()`；新建会话 MUST 打开原型居中 Dialog，并使用 `sessions.environment()` 与 `sessions.create()` 创建和选中会话。菜单还必须提供关闭现有会话的入口。

#### Scenario: Open the new session dialog
- **WHEN** 用户从会话菜单选择“新建终端会话”
- **THEN** 系统 MUST 显示原型的遮罩、Dialog 尺寸、字段和操作按钮

#### Scenario: Close the new session dialog
- **WHEN** 用户选择取消、创建并连接或关闭图标
- **THEN** 系统 MUST 调用 `sessions.create()`，关闭 Dialog，选中新会话并恢复原型工作区

### Requirement: Prototype Resource Monitor

“资源监控” MUST 打开原型右上角的 340px 资源浮层，显示“目标资源监控”、最后更新、获取/刷新、CPU、Memory 和 Network I/O。数据必须来自活动会话的 `resources.get()`、`resources.refresh()` 和 `resources.onSnapshot()`。

#### Scenario: Open the monitor
- **WHEN** 用户点击 Header 的“资源监控”
- **THEN** 系统 MUST 在原型的 Header 下方右侧位置显示资源浮层，且不改变工作区列宽

#### Scenario: Refresh the monitor
- **WHEN** 用户选择“获取/刷新”
- **THEN** 系统 MUST 调用 `resources.refresh()`，显示加载状态，并呈现返回的快照或错误

### Requirement: Prototype Prompt History

Composer 的“提示词历史” MUST 打开原型顶部居中的搜索 Dialog，其中包含搜索框、当前会话 `agent.history()` 的用户提示词和关闭按钮；选择任意记录 MUST 回填 Composer 且不改变 Timeline 内容。

#### Scenario: Reuse a prototype prompt
- **WHEN** 用户在提示词历史中选择一条记录
- **THEN** 系统 MUST 关闭 Dialog 并将完整原型文本回填输入框
