export const DESKTOP_IPC_REQUEST_CHANNELS = [
  'sessions:list',
  'sessions:environment',
  'sessions:create',
  'sessions:set-dialect',
  'sessions:mark-shared',
  'sessions:close',
  'terminal:write',
  'terminal:resize',
  'terminal:replay',
  'resources:get',
  'resources:refresh',
  'attachments:pick',
  'agent:start',
  'agent:cancel',
  'agent:history',
  'agent:reset-conversation',
  'agent:interrupt',
  'agent:approve',
  'agent:takeover',
  'providers:list',
  'providers:save',
  'providers:discover-models',
  'providers:cancel-discovery',
  'providers:remove',
  'models:list',
  'models:save',
  'models:test',
  'models:set-enabled',
  'models:set-default',
  'models:remove',
  'models:import-discovered',
  'audit:list',
  'audit:cleanup',
  'core:status',
  'core:exit',
] as const;

/** MCP 端点配置通道：由桌面主进程本地处理，不经过 Core 桥接 */
export const DESKTOP_MCP_IPC_CHANNELS = [
  'mcp:get-status',
  'mcp:set-enabled',
  'mcp:set-approval-mode',
  'mcp:regenerate-token',
  'mcp:revoke-token',
] as const;

/** ACP 外部驱动者通道：由桌面主进程本地处理，子进程会话不经 Core 桥接 */
export const DESKTOP_ACP_IPC_CHANNELS = [
  'acp:get-status',
  'acp:set-enabled',
  'acp:set-approval-mode',
  'acp:start-turn',
  'acp:cancel-turn',
  'acp:respond-approval',
  'acp:close-conversation',
  'acp:get-history',
] as const;

export const DESKTOP_IPC_EVENT_CHANNELS = [
  'terminal:output',
  'agent:timeline',
  'session:resources',
  'session:changed',
  'acp:status-changed',
] as const;

export type DesktopIpcEventChannel = (typeof DESKTOP_IPC_EVENT_CHANNELS)[number];
