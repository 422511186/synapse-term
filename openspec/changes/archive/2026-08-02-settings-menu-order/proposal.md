## Why

桌面全局设置菜单里“模型配置”排在“服务商配置”之前，而模型配置必须引用服务商（Provider）。按“先配置服务商、再配置模型”的操作顺序组织菜单，可以减少用户来回跳转。

## What Changes

- 全局设置菜单顺序调整：“服务商配置”移到“模型配置”上方，其余菜单项（MCP 服务、ACP 驱动等）顺序不变。
- 纯 UI 顺序调整，不改变任何配置项的语义、接口或持久化格式。

## Capabilities

### New Capabilities

### Modified Capabilities
- `desktop-model-management`: 新增“全局设置菜单顺序”需求，规定服务商配置入口位于模型配置入口上方。

## Impact

- `apps/desktop/src/renderer/app.tsx`：设置菜单中“服务商配置”与“模型配置”两个菜单项的顺序互换。
