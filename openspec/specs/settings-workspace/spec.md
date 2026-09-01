# settings-workspace Specification

## Purpose
规定桌面端设置工作区：独立进入、返回终端工作区，通过左侧分类导航组织通用、外观与 MCP 服务等配置区块。

## Requirements

### Requirement: Dedicated Settings Workspace
桌面端 MUST 提供独立的 Settings Workspace。用户点击 Header 设置按钮时，系统 MUST 进入设置工作区而不是打开混合下拉菜单；设置工作区 MUST 保留 `Synapse Term` 品牌外观、返回 Terminal Session 工作区的入口和真实配置区块，MUST NOT 显示左侧主题导航。

#### Scenario: Open the Settings Workspace
- **WHEN** 用户点击 Header 的“设置”按钮
- **THEN** 系统 MUST 进入单页 Settings Workspace，显示配置区块，且 MUST NOT 显示任何主题导航或设置下拉菜单

### Requirement: MCP Service Configuration Section
设置工作区 MUST 提供“MCP 服务”配置区块，包含：启用/禁用开关（默认关闭，附运行状态）；连接串复制（仅启用后可用）；审批模式三选一（只读／托管／完全权限），其中完全权限选项 MUST 附高风险提示文案；Token 管理（生成、吊销、显示/隐藏、复制）；已共享会话列表（会话名与共享时间），每项 MUST 提供单独取消共享动作。所有操作 MUST 经受限 preload API 交由 Main 处理，Renderer MUST NOT 直接访问设置文件或 HTTP 端点。

#### Scenario: Toggle MCP endpoint
- **WHEN** 用户打开启用开关
- **THEN** 运行状态变为运行中，连接串区域可复制；关闭开关后端点停止且状态回到已停用

#### Scenario: Review and revoke a shared session
- **WHEN** 用户查看已共享会话列表并点击某项的取消共享
- **THEN** 该会话从列表移除，其外部调用随后收到 `SESSION_EXPIRED`

#### Scenario: Choose full permission mode
- **WHEN** 用户选择完全权限模式
- **THEN** 界面展示高风险提示文案后保存该选择，且该选择被显式记录为用户操作

### Requirement: Return to Terminal Workspace
Settings Workspace MUST 提供明确的“返回工作区”操作；返回后 MUST 恢复 Terminal Session 工作区的 Header、终端和活动 Session 状态，不得创建新的 Session。

#### Scenario: Return from settings
- **WHEN** 用户点击 Settings Workspace 的“返回工作区”
- **THEN** 系统 MUST 返回 Terminal Session 工作区，并保留进入设置前的活动 Session
