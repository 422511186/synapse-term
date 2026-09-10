## Purpose

规定用户通过当前 Session 的终端通道上传、下载多个文件和目录的行为，包括目标响应绑定、本机文件授权、目的文件系统名称规则、流式处理、冲突处理和可确认的逐文件结果。

## ADDED Requirements

### Requirement: Transfer over the Existing PTY

文件操作 MUST 沿用户已经登录的当前 Session PTY 和当前身份进行，不创建新的 SSH/SFTP 认证或网络端点。每次传输 MUST 取得匹配新操作的响应后才发送文件数据，并验证响应环境与用户确认目标一致。相对路径 MUST 根据本次响应目录解析；旧名称、能力代际或执行上下文 ID 不得单独证明目标身份。

#### Scenario: Transfer through multiple authentication hops

- **WHEN** 用户经 SSH、跳板机、容器、WSL 或身份切换到达目标后发起传输
- **THEN** 文件 MUST 使用最内层本次响应环境的路径和权限，不要求再次提供任一跳的凭证

#### Scenario: A hop closes during transfer

- **WHEN** 系统观测到接收器退出、绑定失效或通道退回上一层
- **THEN** 系统 MUST 停止新增发送并报告实际终态，不自动启动新接收器或重放旧路径操作
- **AND** 已交给 PTY 或 SSH 缓冲的字节 MUST 按证据或未确认结果处理，不声称已撤回

### Requirement: Multiple Files and Directories

系统 MUST 支持多个普通文件和目录，保持所选目录内部相对结构与文件内容。遍历 MUST 不跟随符号链接、reparse point 或其他特殊文件，并逐项报告跳过原因。文件内容 MUST 不经过终端脱敏、换行转换或编码替换；传输不提供 owner、ACL、稀疏属性或备份语义保证。

#### Scenario: Transfer a mixed selection

- **WHEN** 选择中包含多个文件、目录和链接
- **THEN** 系统 MUST 传输普通文件与目录结构，跳过链接和特殊文件，并展示各项结果

### Requirement: Selected Files and Bound Paths

本机访问 MUST 由真实文件选择或拖入建立有限引用，并绑定 Session 和本次操作；Renderer 或远端不得凭任意本机路径取得权限。远端路径 MUST 作为字面参数处理，拒绝无法安全引用的控制字符。接收端 MUST 将全部路径限制在选择根目录内，抵抗绝对路径、父目录跳转、分隔符混用、链接逃逸和检查后替换。

#### Scenario: Remote metadata escapes the selected directory

- **WHEN** 远端名称或目录元数据试图越过本机保存根目录
- **THEN** 系统 MUST 在任何越界写入前拒绝该项或操作

#### Scenario: A path contains Shell syntax

- **WHEN** 合法路径含空格、引号或 Shell 元字符
- **THEN** 系统 MUST 将其作为字面路径处理，不执行其中的 Shell 语义

#### Scenario: File selection completes after expiry

- **WHEN** 文件选择返回时 Session 或操作引用已经失效
- **THEN** 系统 MUST 释放该选择，不触发文件访问或终端写入

### Requirement: Destination Filesystem Names

接收端 MUST 按目的文件系统校验每级名称。Windows 名称 MUST 拒绝 NTFS 数据流语法、DOS 设备名及设备命名空间，包括带扩展名的设备名。目的系统的尾随点或空格、大小写及 Unicode 规范化造成的同名解释 MUST 作为不可表示名称或冲突处理，不得静默转换后写入其他文件、数据流或设备。用户换名后 MUST 重新验证。

#### Scenario: A Unix name denotes a Windows stream or device

- **WHEN** 向 Windows 传输 `report.txt:payload`、`NUL.txt` 或同类特殊名称
- **THEN** 系统 MUST 在创建目标前拒绝该名称并允许跳过或换名，不写入命名数据流或设备

#### Scenario: Distinct source names collide at the destination

- **WHEN** 两个源名称在目的文件系统中被解释为同一路径
- **THEN** 系统 MUST 报告冲突并保留已存在文件，不能把两项同时标为成功

### Requirement: Preserve Existing Files by Default

同名文件 MUST 默认保留，允许用户跳过或换名。接收 MUST 先写入本次操作的专属临时文件，完整性验证通过后以不覆盖方式发布，并在最终提交时抵抗同名竞态。MUST NOT 自动覆盖、续传或合并未确认结果；已提交文件不得因批次失败被删除。

#### Scenario: Destination exists or appears during transfer

- **WHEN** 目标开始时已存在，或其他程序在最终提交前创建了同名文件
- **THEN** 系统 MUST 保持原文件不变，报告冲突并提供跳过或换名

### Requirement: Bounded Streaming and Integrity

传输 MUST 对分块、未确认窗口、帧、解压输出、缓冲、等待和进度频率设置明确上限；内存不得随整个文件大小线性增长。目录遍历与逐项结果 MUST 有数量、深度和状态保留预算，超限必须明确报告。接收完成并验证完整性之前 MUST 不发布文件成功。

#### Scenario: Transfer a file larger than the memory budget

- **WHEN** 文件大小远超操作内存预算
- **THEN** 系统 MUST 持续流式处理、实施背压并保持界面可响应

#### Scenario: Corrupted or excessive protocol data arrives

- **WHEN** 校验失败、帧或解压输出超限、目录遍历预算耗尽
- **THEN** 系统 MUST 有界终止受影响操作并说明原因，不发布未经验证的文件或把载荷回灌普通文本

### Requirement: Confirmed Per-File Results and Cancellation

结果 MUST 区分成功、跳过、已确认失败、已确认取消和未确认，多文件批次 MUST 能表示部分完成。本地写入被接受不等于远端落盘。用户取消或接管 MUST 停止新增协议数据并进行有限取消；只有对应结束证据可以确认取消。清理 MUST 仅针对可确认属于本次操作的临时文件，不向失效环境发送删除命令。

#### Scenario: Final acknowledgement is lost

- **WHEN** 文件可能已到达但最终完成证据丢失
- **THEN** 系统 MUST 报告未确认，不显示成功、假定未写入或自动重传

#### Scenario: A batch is partially complete

- **WHEN** 部分文件成功，其他项跳过、失败或未确认
- **THEN** 系统 MUST 保留成功文件并逐项汇总，整体不能显示全部成功

#### Scenario: User takes over and a late reply arrives

- **WHEN** 用户取消或输入后收到迟到确认、进度或文件选择回调
- **THEN** 系统 MUST 不恢复写入或重放按键，不覆盖其他操作状态；已确认成功的文件结果保持成功
