export const DESKTOP_IPC_REQUEST_CHANNELS = [
  'sessions:list',
  'sessions:environment',
  'sessions:create',
  'sessions:rename',
  'sessions:close',
  'terminal:write',
  'terminal:resize',
  'app:status',
  'settings:get-general',
  'settings:update-general',
  'mcp:get-settings',
  'mcp:update-settings',
  'mcp:regenerate-token',
  'mcp:revoke-token',
  'mcp:get-status',
  'mcp:list-shared',
  'mcp:share-session',
  'mcp:unshare-session',
  'mcp:decide-approval',
] as const;

export const DESKTOP_IPC_EVENT_CHANNELS = [
  'terminal:output',
  'session:changed',
  'mcp:approval',
  'mcp:approval-closed',
  'mcp:execution',
] as const;

export type DesktopIpcEventChannel = (typeof DESKTOP_IPC_EVENT_CHANNELS)[number];
