## ADDED Requirements

### Requirement: Transfer over the Existing PTY

文件上传和下载 MUST 使用用户已经登录的当前 Session PTY 通道及当前身份，不创建新的 SSH/SFTP 认证、网络端点或拓扑对象。操作 MUST 以当次匹配响应的最内层环境为目标；开始文件数据阶段前 MUST 验证新操作实例。旧 Session 名称、主机名、能力代际或执行上下文 ID MUST NOT 单独证明目标未变化。

#### Scenario: Transfer through multiple authentication hops

- **WHEN** 用户经多跳 SSH 到达目标并在空闲 Shell 启用文件能力
- **THEN** 上传下载 MUST 沿原通道完成，不要求再次提供任何一跳的密码、密钥或验证码

#### Scenario: Transfer in a container or changed user

- **WHEN** 用户进入容器、WSL 或切换用户后启用文件能力
- **THEN** 文件路径和权限 MUST 采用本次最内层响应环境及当前身份，不自动操作宿主机或上一层账户

#### Scenario: A hop closes before payload delivery

- **WHEN** 应用观测到本次握手失效、接收器退出或通道可能退回上一层
- **THEN** 应用 MUST 停止后续文件发送并失效目标绑定，不能在新响应环境自动重启接收器或继续旧路径操作
- **AND** 已经交给 PTY/SSH 缓冲的字节 MUST 按实际证据或未确认结果处理，不能声称已撤回或目标一定没有消费

### Requirement: Multiple Files and Directories

首版 MUST 支持多个普通文件及目录，并保持所选目录内部的相对结构。系统 MUST 不跟随符号链接、reparse point 或其他特殊文件，遇到这些条目 MUST 给出逐项跳过原因；不得将未支持条目当作已完成。文件内容 MUST 不因终端文本脱敏、换行转换或编码替换而改变。

#### Scenario: Transfer a mixed selection

- **WHEN** 用户选择多个普通文件和目录
- **THEN** 系统 MUST 逐项传输并展示各项结果，接收的普通文件内容及目录结构与被选内容一致

#### Scenario: A selected directory contains a symbolic link

- **WHEN** 目录遍历遇到链接或平台特殊文件
- **THEN** 系统 MUST 不跟随其访问目录外内容，结果 MUST 标明该项被跳过以及原因

### Requirement: Selected Files and Bound Paths

本机文件访问 MUST 由 Main 基于真实用户选择/拖入建立有限引用，绑定 Session 和本次操作。Renderer 或远端协议 MUST NOT 通过任意本机路径取得访问权。远端路径 MUST 作为已校验的平台参数提交，相对路径 MUST 根据本次响应的目录解析，不能使用旧快照目录。接收端 MUST 将不可信目录元数据限制在用户选择的根目录内，并抵抗路径检查后被替换的情况。

#### Scenario: Remote metadata escapes the selected directory

- **WHEN** 下载元数据包含绝对路径、父目录跳转、分隔符混用或利用链接逃逸的路径
- **THEN** 接收端 MUST 在越界写入前拒绝该项或操作，用户选择目录之外不得出现文件写入

#### Scenario: A path contains Shell syntax

- **WHEN** 用户选择的合法路径含空格、引号或 Shell 元字符
- **THEN** 路径 MUST 以当前平台的字面参数处理而不能执行附带命令；无法安全引用的控制字符路径 MUST 在写入 PTY 前被拒绝

#### Scenario: File selection completes after the operation expires

- **WHEN** 原生文件选择返回时 Session 或操作绑定已经失效
- **THEN** 该选择引用 MUST 被释放且不得触发 PTY 或文件写入

### Requirement: Preserve Existing Files by Default

上传和下载 MUST 默认不覆盖已有同名文件，遇到冲突 MUST 保留原文件并允许用户跳过或换名。最终发布 MUST 再次保证不覆盖，不能仅依赖开始时的存在性检查。首版 MUST 不自动覆盖、合并不明结果或续传中断任务。

#### Scenario: Destination already exists

- **WHEN** 某个目标路径已有文件
- **THEN** 原文件 MUST 保持不变，界面 MUST 显示冲突并提供跳过/换名处理，不得默认选择覆盖

#### Scenario: A conflicting file appears during transfer

- **WHEN** 初始检查后有其他程序在目标位置创建了文件
- **THEN** 最终发布 MUST 不替换该文件，并报告该项冲突

### Requirement: Bounded Streaming and Integrity

传输 MUST 采用有界分块、未确认窗口、背压和节流进度；内存使用 MUST 不随整个文件大小线性增长。系统 MUST 为协议帧、解压输出、等待时间和缓冲设置明确上限，并在文件接收完成与完整性验证后才发布成功结果。协议错误或载荷内容 MUST NOT 被当作普通 Shell 输入重试。

#### Scenario: Transfer a file larger than the memory budget

- **WHEN** 传输文件明显大于配置的传输内存预算
- **THEN** 应用 MUST 持续流式处理且缓冲受限，终端 UI 保持响应并持续显示有界频率的进度

#### Scenario: Corrupted or oversized protocol data

- **WHEN** 收到校验不符、超大帧或超出解压预算的数据
- **THEN** 系统 MUST 有界终止受影响操作，不发布该文件为成功，也不向普通终端或 Sharing 历史回灌载荷

### Requirement: Confirmed Per-File Results

结果 MUST 逐项区分成功、跳过、已确认失败、已确认取消和结果未确认；目录/多文件批次 MUST 能表示部分完成。backend 写入成功 MUST NOT 被视为远端消费或文件落盘成功。文件接收 MUST 使用本次操作专属临时文件，完整性验证通过后才以不覆盖方式发布。

#### Scenario: Connection is lost before the final acknowledgement

- **WHEN** 文件数据可能已经到达，但最终完成证据丢失
- **THEN** 结果 MUST 标记为未确认，不能显示成功、假定远端未写入或自动重新上传

#### Scenario: A batch completes only some files

- **WHEN** 批次中部分文件成功，另有跳过、失败或未确认项
- **THEN** 系统 MUST 保留已完成文件并逐项报告，整体不得显示为全部成功

### Requirement: Cancellation without Replay

用户 MUST 能取消传输或通过本地输入接管。系统 MUST 立即停止新增协议数据、撤销后续自动写入资格并进行有限取消处理，只有收到对应完成/取消证据才能声称已取消。MUST NOT 自动重放命令、载荷或用户按键。清理 MUST 只作用于能确认属于本次操作的临时文件，不得向失效目标继续发送删除命令。

#### Scenario: User takes over during a transfer

- **WHEN** 用户在传输期间输入或发起中断
- **THEN** 本地输入 MUST 保持可用，自动传输写入 MUST 停止；无可靠终结证据时显示未确认结果，不宣称远端程序已经终止

#### Scenario: A late response arrives after cancellation

- **WHEN** 已取消或失效操作收到迟到确认、进度或文件选择回调
- **THEN** 系统 MUST 不恢复写入、不重新开始传输，也不覆盖后续操作的状态
