## MODIFIED Requirements

### Requirement: Desktop Terminal Workspace
系统 MUST 提供桌面终端工作区，允许当前用户创建、查看、切换和关闭 Terminal Session 标签页。每个活动标签 MUST 显示会话标题、来自运行时摘要的终端类型和可访问的关闭操作；新建标签入口 MUST 始终可达，且不得依赖用户在标题中手工标注类型。

#### Scenario: Create a terminal tab
- **WHEN** 用户选择一个有效的启动配置创建终端
- **THEN** 系统创建新的 Session 标签页，显示其真实终端类型，并显示其实时终端内容

#### Scenario: Switch terminal tabs
- **WHEN** 用户在多个活动 Session 标签页之间切换
- **THEN** 系统显示所选 Session 的终端状态且不改变其他 Session 的运行状态

#### Scenario: Navigate many terminal tabs
- **WHEN** 活动 Session 数量超过标签栏可见宽度或全部会话弹层可见高度
- **THEN** 用户 MUST 能通过水平滚动标签栏或搜索、滚动全部会话视图选择任一 Session，且新建入口仍可达

#### Scenario: Session runtime state changes
- **WHEN** Core 广播某个活动 Session 的状态、方言或终端类型变化
- **THEN** 对应标签和全部会话视图 MUST 更新该 Session，且不得重建其他 Session 的终端状态

### Requirement: Basic Terminal Interaction
桌面终端 MUST 支持人工输入、复制、粘贴、滚动、搜索和随窗口变化调整终端尺寸；Renderer 同一时刻 MUST 只挂载活动 Session 的 xterm，并通过 replay 恢复切换目标的输出。

#### Scenario: Resize terminal
- **WHEN** 终端可视区域尺寸发生变化
- **THEN** 系统更新 xterm 渲染尺寸并向对应 PTY 发送新的行列数

#### Scenario: Search scrollback
- **WHEN** 用户在当前终端中搜索文本
- **THEN** 系统在可用滚动区中定位匹配结果且不向 PTY 写入内容

#### Scenario: Reopen an inactive terminal tab
- **WHEN** 用户选择此前未在 Renderer 中挂载的活动 Session 标签
- **THEN** 系统 MUST 调用该 Session 的 replay 接口并仅显示该 Session 的有序终端输出
