import type {
  AppStatus,
  DesktopApi,
  GeneralSettings,
  McpApprovalDecision,
  McpExecutionEvent,
  McpApprovalRequest,
  McpRuntimeStatus,
  McpSettings,
  SessionLaunchInput,
  SessionSummary,
  TerminalOutputEvent,
  SharedMcpSession,
} from '../shared/contracts.js';

export type {
  AppStatus,
  DesktopApi,
  GeneralSettings,
  SessionEnvironment,
  SessionLaunchInput,
  SessionSummary,
  TerminalOutputEvent,
  McpApprovalDecision,
  McpApprovalRequest,
  McpExecutionEvent,
  McpRuntimeStatus,
  McpSettings,
  SharedMcpSession,
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
    general: {
      getSettings: () => invoke<GeneralSettings>('settings:get-general'),
      updateSettings: (patch) => invoke('settings:update-general', patch),
    },
    mcp: {
      getSettings: () => invoke<McpSettings>('mcp:get-settings'),
      updateSettings: (patch) => invoke('mcp:update-settings', patch),
      regenerateToken: () => invoke('mcp:regenerate-token'),
      revokeToken: () => invoke('mcp:revoke-token'),
      getStatus: () => invoke<McpRuntimeStatus>('mcp:get-status'),
      listSharedSessions: () => invoke<SharedMcpSession[]>('mcp:list-shared'),
      shareSession: (sessionId: string) => invoke('mcp:share-session', sessionId),
      unshareSession: (sessionId: string) => invoke('mcp:unshare-session', sessionId),
      decideApproval: (id: string, decision: McpApprovalDecision) =>
        invoke('mcp:decide-approval', id, decision),
      onApproval: (listener) =>
        ipc.on('mcp:approval', (payload) => listener(payload as McpApprovalRequest)),
      onApprovalClosed: (listener) =>
        ipc.on('mcp:approval-closed', (payload) => listener(payload as { id: string })),
      onExecution: (listener) =>
        ipc.on('mcp:execution', (payload) => listener(payload as McpExecutionEvent)),
    },
  };
}
