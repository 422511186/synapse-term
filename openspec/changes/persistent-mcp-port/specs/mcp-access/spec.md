## ADDED Requirements

### Requirement: Stable Loopback Port
MCP 端点 MUST 在首次启用时确定监听端口并持久化到设置；后续启用、停用再启用或应用重启 MUST 复用同一端口。首选端口被占用时 MUST 回退到临时端口，并将实际端口持久化，下一次启动继续复用回退后的端口。设置页展示的连接串 MUST 始终反映当前实际监听端口。

#### Scenario: Port survives disable and re-enable
- **WHEN** 用户启用 MCP Server 后停用，再重新启用
- **THEN** 两次启用的监听端口 MUST 相同，连接串不变

#### Scenario: Port survives an application restart
- **WHEN** 应用退出后重新启动且 MCP 设置仍为启用
- **THEN** 端点 MUST 使用持久化端口监听，连接串与上次一致

#### Scenario: Preferred port is occupied
- **WHEN** 首次启用的默认端口已被其他进程占用
- **THEN** 端点 MUST 回退到可用临时端口继续运行，并把实际端口写入设置供后续复用
