## ADDED Requirements

### Requirement: Snapshot of the Current Execution Environment

环境快照 MUST 表示本次有界采集实际响应的最内层环境及当前身份，至少包含真实 OS、环境显示名、当前用户、目录和采样时间。实际 OS MUST 与 Shell 方言分别验证，不能从本地启动配置、提示符或 `posix/powershell` 单独推断。快照 MUST 不构成主机资产、连接拓扑、执行授权或 MCP Session 就绪状态。

#### Scenario: PowerShell is running on a Unix target

- **WHEN** 用户在 Linux 或 macOS 上运行 PowerShell 并请求快照
- **THEN** 系统 MUST 按实际 OS 选择采集能力，不得仅因 PowerShell 方言标记为 Windows

#### Scenario: Nested environment supplies its own facts

- **WHEN** 用户在容器或切换用户后启用并请求快照
- **THEN** 快照 MUST 显示本次环境及身份，不能把上一层的名称、目录或用户混入成功结果

### Requirement: On-Demand Literal Collection

系统 MUST 在明确启用成功后采集一次，此后仅在用户处于空闲 Shell 并请求刷新时采集。采集 MUST 使用固定明文命令或完整可检查的固定采集片段，包含有限执行范围、时间/输出预算和结束证据。系统 MUST NOT 定时向 PTY 注入命令、自动中断前台程序，或通过编码 RPC 请求隐藏的采集执行。

#### Scenario: No refresh was requested

- **WHEN** 快照面板保持打开但用户没有请求刷新
- **THEN** 应用 MUST 保留带采样时间的历史快照，不自动向 PTY 写入采集命令

#### Scenario: Session is busy or unverified

- **WHEN** 文件操作、外部执行、已知前台交互状态或缺少本次空闲 Shell 的明确操作前提阻止安全采集
- **THEN** 系统 MUST 显示暂停/待验证并保留旧样本时间，不向该程序注入采集命令，也不触发 Ctrl+C

#### Scenario: Collection times out or changes environment

- **WHEN** 采集超时、前后环境不一致或结束证据不可靠
- **THEN** 系统 MUST 不发布混合环境的成功快照，旧样本保留为过期，错误明确表示此次结果不可确认

### Requirement: CPU Memory and Disk Metrics

Linux、macOS、Windows 目标适配 MUST 提供其能力允许的 CPU、内存和本次目录所在文件系统的磁盘指标，并附单位、采样区间及统计口径。CPU 利用率需要差分时 MUST 在同一操作的有界区间采样。命令缺失、权限不足、字段不可解析或不支持时 MUST 为该项返回明确不可用原因，不得以零值或其他平台数据代替。

#### Scenario: Compute a sampled CPU percentage

- **WHEN** 当前平台需要两次计数器值来计算 CPU 利用率
- **THEN** 系统 MUST 使用同一采集范围内的两次有效样本和对应时间区间，不把单个累计计数当作百分比

#### Scenario: A metric is unavailable

- **WHEN** 当前身份不能访问某项指标或目标缺少其采集工具
- **THEN** 该指标 MUST 显示不可用及原因，其他已验证指标仍可展示，不能将不可用显示为 0

### Requirement: Explicit Container Metric Scope

容器中的指标 MUST 明确区分可验证的容器配额/使用量和宿主机或系统可见值。可读取 cgroup 等限额时 MUST 使用匹配的统计范围；无法确定时 MUST 标明口径或不可用，不得将宿主机总量冒充容器限制。WSL 目标 MUST 使用本次 Linux 环境的数据，不能套用 Windows 宿主机指标。

#### Scenario: Container exposes host memory totals

- **WHEN** 容器可见的系统数据是宿主机总量且容器限额无法验证
- **THEN** 快照 MUST 明确标记该值的可见范围或将容器指标标为不可用，不能将其标为容器配额

#### Scenario: Container has a verified quota

- **WHEN** 当前环境能验证 CPU/内存限额及对应使用量
- **THEN** 快照 MUST 展示匹配该环境的值及限额口径，不能与宿主机利用率混算

### Requirement: Snapshot Freshness Is Explicit

快照 MUST 始终显示采样时间，不声称实时监控。用户输入、外部写入、环境失效、文件操作或 Session 生命周期变化后，旧样本 MUST 标为过期或待验证。返回上一层或重新启用后，只有本次新采集成功才能替换旧样本，不得仅修改旧样本的环境标签。

#### Scenario: User leaves the sampled machine

- **WHEN** 用户输入退出或跳转命令，或当前绑定失效
- **THEN** 旧快照 MUST 标明过期并保留原采样环境与时间，不能作为新环境的当前状态

#### Scenario: The terminal emits unrelated passive output

- **WHEN** 采样后终端继续产生输出而没有新快照
- **THEN** 面板 MUST 保留原采样时间，不能因输出增长或 PTY running 将旧数据标为新采集

### Requirement: Runtime-Only Snapshot Access

快照结构和本地操作绑定 MUST 只存在于应用运行期，由 Main 经受限 API 提供给对应 Session 的桌面 UI。结构化快照 MUST NOT 加入 MCP `synapse_status`、工具列表或 Sharing 分页历史；普通明文命令及可读输出仍遵循既有 Sharing 规则。应用重启 MUST 不恢复快照或其执行前提。

#### Scenario: A shared Session has a local snapshot

- **WHEN** 外部客户端观察一个用户正在查看快照的已 Sharing Session
- **THEN** 外部工具 MUST 不获得本地快照结构、文件引用或操作句柄，只能按既有规则观察普通脱敏输出

#### Scenario: Application restarts

- **WHEN** 应用退出后重新启动
- **THEN** 系统 MUST 不恢复上次快照、目标绑定或采集任务
