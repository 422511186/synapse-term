import type {
  AppStatus,
  DesktopApi,
  SessionLaunchInput,
  SessionSummary,
  TerminalOutputEvent,
} from '../shared/contracts.js';

export type {
  AppStatus,
  DesktopApi,
  SessionEnvironment,
  SessionLaunchInput,
  SessionSummary,
  TerminalOutputEvent,
} from '../shared/contracts.js';

export interface RendererIpc {
  invoke(channel: string, ...argumentsValue: unknown[]): Promise<unknown>;
  on(channel: string, listener: (payload: unknown) => void): () => void;
}

export function createDesktopApi(ipc: RendererIpc, platform?: string): DesktopApi {
  const invoke = async <T>(channel: string, ...argumentsValue: unknown[]): Promise<T> =>
    (await ipc.invoke(channel, ...argumentsValue)) as T;
  return {
    ...(platform === undefined ? {} : { platform }),
    sessions: {
      list: () => invoke('sessions:list'),
      environment: () => invoke('sessions:environment'),
      create: (input: SessionLaunchInput) => invoke('sessions:create', input),
      rename: (sessionId, alias) => invoke('sessions:rename', sessionId, alias),
      close: (sessionId) => invoke('sessions:close', sessionId),
      onChanged: (listener) =>
        ipc.on('session:changed', (payload) => listener(payload as SessionSummary)),
    },
    terminal: {
      write: (sessionId, data) => invoke('terminal:write', sessionId, data),
      resize: (sessionId, columns, rows) => invoke('terminal:resize', sessionId, columns, rows),
      onOutput: (listener) =>
        ipc.on('terminal:output', (payload) => listener(payload as TerminalOutputEvent)),
    },
    app: {
      status: () => invoke<AppStatus>('app:status'),
    },
  };
}
