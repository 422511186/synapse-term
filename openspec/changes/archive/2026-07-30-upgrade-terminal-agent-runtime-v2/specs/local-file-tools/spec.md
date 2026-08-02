## ADDED Requirements

### Requirement: Dynamic Current User Home Root
Local File Tool 根目录 MUST 在运行时解析为当前 Windows 用户主目录，模型不得传入或改变该根目录，生产代码不得写死用户名、盘符或开发机路径。

#### Scenario: Different Windows user launches the app
- **WHEN** 应用由另一个 Windows 用户启动
- **THEN** LocalFileService 使用该用户动态 home 且相同相对 Tool 参数解析到该用户自己的文件

### Requirement: Canonical Relative Path Boundary
所有 Local File Tool MUST 只接受相对路径，并通过规范化、realpath、父目录检查和 reparse point 检查阻止逃逸当前用户 home。

#### Scenario: Relative path escapes home
- **WHEN** 模型提交包含 `..`、绝对驱动器、UNC、设备路径或 Alternate Data Stream 的路径
- **THEN** Core 拒绝 Tool Call且不访问目标

#### Scenario: Junction points outside home
- **WHEN** home 内目录联接的 canonical target 位于 home 外
- **THEN** Core 拒绝通过该路径读取或写入

### Requirement: Local File Listing
`local_list_files` MUST 有界列出指定相对目录，返回相对路径、类型、大小和修改时间，并支持结果数量和深度限制。

#### Scenario: List a project directory
- **WHEN** Agent 列出 home 下项目目录
- **THEN** Tool 返回有界、稳定排序的条目且不读取文件内容

### Requirement: Local File Search
`local_search_files` MUST 在指定相对目录内按文件名或文本搜索，并执行结果数、遍历深度、读取字节、超时和取消限制。

#### Scenario: Search a large home subtree
- **WHEN** 搜索达到配置结果或时间上限
- **THEN** Tool 返回截断元数据和已找到结果且不继续无界遍历

### Requirement: Local Text File Read
`local_read_file` MUST 支持有界读取 UTF-8 或带 BOM UTF-16 文本的行/字节范围，并返回相对路径、内容、SHA-256、编码和截断信息。

#### Scenario: Read a binary file
- **WHEN** 文件包含被识别为二进制的内容
- **THEN** Tool 拒绝把原始二进制作为模型文本披露并返回可识别错误

### Requirement: Local File Write
`local_write_file` MUST 要求显式 `create` 或 `replace` 模式；replace MUST 携带匹配当前文件的预期 SHA-256，并使用同目录临时文件和原子替换。

#### Scenario: Create a new file
- **WHEN** create 模式目标不存在且父目录在 home 内
- **THEN** Tool 原子创建文件并返回新 SHA-256

#### Scenario: Replace changed file
- **WHEN** replace 的预期 SHA-256 与当前文件不匹配
- **THEN** Tool 拒绝覆盖并返回 conflict 供 Agent 重新读取

### Requirement: Local File Edit
`local_edit_file` MUST 使用精确 oldText/newText 编辑和预期 SHA-256；匹配数量、文件哈希或编码不符合预期时不得部分写入。

#### Scenario: Apply multiple exact edits
- **WHEN** 所有编辑在同一预期版本中唯一匹配
- **THEN** Tool 在内存完成全部修改后一次原子替换并返回前后 SHA-256

#### Scenario: One edit does not match
- **WHEN** 任一 oldText 不存在或匹配数量不符合请求
- **THEN** Tool 不写入任何部分变更并返回 recoverable conflict

### Requirement: Local and Remote File Separation
Local File Tool MUST 始终操作本机当前用户 home，不得把 Terminal Session 的 cwd、SSH 目标或容器路径解释为本机文件根。

#### Scenario: Terminal is connected to a remote server
- **WHEN** Agent 调用 `local_read_file` 读取 `project/config.yaml`
- **THEN** Tool 读取本机 home 下的相对文件，远端文件只能通过 Terminal Tool 处理

### Requirement: No Destructive Local File Tools
首版 Local File Tool MUST 不提供删除、移动、权限修改、注册表写入或任意本机进程执行能力。

#### Scenario: Model requests local file deletion
- **WHEN** Provider 返回未声明的删除 Tool 或试图通过 write/edit 表达删除
- **THEN** Schema 或策略拒绝调用且目标文件保持不变

