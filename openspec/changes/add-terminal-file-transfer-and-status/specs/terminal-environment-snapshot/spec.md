## Purpose

规定用户在当前终端环境中按需查看身份、目录和资源状态的行为，明确三平台采集范围、指标口径、采样时间、结果完整性与不可用状态，使快照不会被误用为实时监控或执行授权。

## ADDED Requirements

### Requirement: Snapshot of the Current Execution Environment

快照 MUST 表示本次有界采集实际响应的最内层环境，包含真实 OS、环境显示名、当前用户、目录和采样时间。实际 OS 与 Shell 方言 MUST 分别验证，不从本机启动配置或提示符推断；快照不得构成主机资产、连接拓扑、MCP 就绪状态或执行授权。

#### Scenario: PowerShell runs on a Unix target

- **WHEN** 当前 Shell 为 PowerShell，真实 OS 为 Linux 或 macOS
- **THEN** 系统 MUST 根据实际 OS 采集和标记结果，不将其标为 Windows

#### Scenario: A nested environment responds

- **WHEN** 用户在容器、WSL 或切换用户后请求快照
- **THEN** 系统 MUST 使用本次响应的身份、目录与平台事实，不混入上一层数据

### Requirement: On-Demand Literal Collection

系统 MUST 在明确启用流程中采集一次，此后仅根据用户在空闲 Shell 的刷新请求采集。采集 MUST 使用固定明文命令，在同一有限执行范围内取得开始、结束和环境一致性证据，并设置时间与输出预算。MUST NOT 定时注入命令、自动中断前台或在后台猜测空闲后补发。

#### Scenario: No refresh was requested

- **WHEN** 面板保持打开但没有刷新请求
- **THEN** 系统 MUST 保留原采样时间，不向 PTY 写入采集命令

#### Scenario: Session is busy or unverified

- **WHEN** 文件操作、外部执行或未知前台阻止采集
- **THEN** 系统 MUST 显示暂停或待验证并保留旧样本，不注入命令或 Ctrl+C

#### Scenario: Collection cannot be verified

- **WHEN** 采集超时、环境前后不一致或缺少结束证据
- **THEN** 系统 MUST 不发布成功快照，显示此次结果未确认并将旧样本标为过期

### Requirement: CPU Memory and Disk Metrics

Linux、macOS、Windows 适配 MUST 提供平台能力允许的 CPU、内存及当前目录所在文件系统的磁盘指标，附单位、统计口径和采样区间。CPU 差分 MUST 使用同一操作内的有效计数及时间间隔。缺少工具、权限、字段或支持时 MUST 对该项显示不可用原因，不能用零值代替。

#### Scenario: Compute a CPU percentage

- **WHEN** 当前平台需要差分计数计算 CPU 利用率
- **THEN** 系统 MUST 使用同一采集范围的两次样本及其时间间隔，不把累计值当作百分比

#### Scenario: A metric is unavailable

- **WHEN** 某项采集失败而其他项已验证
- **THEN** 系统 MUST 展示有效指标，并对失败项显示具体原因

### Requirement: Explicit Container Metric Scope

容器指标 MUST 区分可验证的配额与使用量、宿主机值和系统可见值；无法确认容器口径时 MUST 标明范围或不可用。WSL MUST 使用本次 Linux 环境数据，不使用 Windows 宿主机指标冒充。

#### Scenario: Container exposes host totals

- **WHEN** 当前只能读取宿主机总量而无法验证容器限额
- **THEN** 系统 MUST 明确标记宿主机或系统可见口径，不能将该值标为容器限额

#### Scenario: Container quota is verified

- **WHEN** CPU 或内存配额及使用量可以验证
- **THEN** 系统 MUST 使用匹配范围计算与展示，不混入宿主机利用率

### Requirement: Snapshot Freshness and Runtime Access

快照 MUST 始终显示原采样环境与时间；用户输入、外部写入、文件操作、环境失效或生命周期变化后 MUST 标为过期或待验证。本次成功采集正常收敛所需的 MCP 环境验证失效 MUST NOT 使刚完成的样本立即过期；样本有效也不得恢复 MCP 环境验证。普通输出增长不得刷新采样时间。快照 MUST 仅在应用运行期通过受限桌面接口访问，不进入 MCP 状态、工具或 Sharing 历史，不作为环境验证缓存。

#### Scenario: Collection finishes and invalidates external preconditions

- **WHEN** 采集成功且无其他输入或环境变化，操作终态使 MCP 执行前提失效
- **THEN** 系统 MUST 展示本次新样本，MCP 环境验证仍保持失效，不将新样本直接标为过期

#### Scenario: User leaves the sampled environment

- **WHEN** 用户退出当前目标或进入另一层环境
- **THEN** 系统 MUST 保留旧样本的环境和时间并标为过期，只有新的成功采集才能替换

#### Scenario: External access or application restart

- **WHEN** 外部客户端观察 Session，或应用退出后重启
- **THEN** 外部客户端 MUST 不获得内部快照结构，应用重启 MUST 不恢复快照或采集资格
