# ADR-0027：ACP Client 只声明终端和只读文件能力

状态：已实现

## 决策

ACP Client 向外部 Agent 声明终端能力和 `fs.readTextFile` 只读文件能力，不声明文件编辑、删除、索引或任意本机进程能力。外部 Agent 的状态变化必须通过平台工具管线。

## 当前实现

`AcpController` 的能力声明包含 `terminal: true` 和 `fs.readTextFile: true`；工具 permission request 只接受平台允许的工具名，其余请求拒绝并审计。

## 影响

外部 Agent 的能力边界与内置 Agent 的安全管线保持一致。读文件路径由 ACP 适配层转为 home 相对路径，再由 Core 再次校验。
