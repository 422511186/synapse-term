# MCP Server 是内嵌桌面功能

近期内 MCP server 是内嵌的桌面应用功能（设置开关、权限配置、回环 HTTP 端点），而不是独立的 apps/mcp-server 进程，因此使用 MCP 时桌面应用必须运行。端点使用用户生成的 bearer token 认证，可吊销、无过期。独立或 Core 托管的 MCP server 可在日后重新评估。
