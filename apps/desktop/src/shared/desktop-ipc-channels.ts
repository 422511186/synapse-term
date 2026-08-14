export const DESKTOP_IPC_REQUEST_CHANNELS = [
  'sessions:list',
  'sessions:environment',
  'sessions:create',
  'sessions:rename',
  'sessions:close',
  'terminal:write',
  'terminal:resize',
  'core:status',
  'core:exit',
] as const;

export const DESKTOP_IPC_EVENT_CHANNELS = ['terminal:output', 'session:changed'] as const;

export type DesktopIpcEventChannel = (typeof DESKTOP_IPC_EVENT_CHANNELS)[number];
