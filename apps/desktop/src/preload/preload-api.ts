import type { LocalShellDescriptor } from '@synapse-term/terminal-service';

import type { DesktopAttachmentKind, PickedAgentAttachment } from '../shared/desktop-attachment.js';

import type {
  AgentHistoryView,
  AgentTextDelta,
  AgentTimelineItem,
  DiscoveredModel,
  ModelConfigurationInput,
  ModelConfigurationView,
  ProviderProfileInput,
  ProviderProfileView,
  ReasoningEffort,
  SessionSummary,
  TerminalOutputEvent,
  TerminalReplay,
} from '@synapse-term/ui-platform';

export type {
  AgentHistoryView,
  AgentTextDelta,
  AgentModelSelectionView,
  AgentTimelineItem,
  AgentAttachmentKind,
  AgentAttachmentMetadata,
  DiscoveredModel,
  ModelCapabilities,
  ModelConfigurationInput,
  ModelConfigurationView,
  ModelValidation,
  ProviderProfileInput,
  ProviderProfileView,
  ReasoningEffort,
  SessionSummary,
  TerminalOutputEvent,
  TerminalReplay,
} from '@synapse-term/ui-platform';

export type { DesktopAttachmentKind, PickedAgentAttachment } from '../shared/desktop-attachment.js';

export interface RendererIpc {
  invoke(channel: string, ...argumentsValue: unknown[]): Promise<unknown>;
  on(channel: string, listener: (payload: unknown) => void): () => void;
}

export interface SessionLaunchInput {
  title: string;
  terminalType: string;
  executable: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  executionDialect: 'posix' | 'powershell' | 'observe_only';
}

export interface SessionEnvironment {
  home: string;
  shells: LocalShellDescriptor[];
}

export type ResourceUnavailableReason = 'not_reported' | 'command_unavailable' | 'invalid_output';

export type ResourceMetric<T> =
  | { status: 'available'; value: T }
  | { status: 'unavailable'; reason: ResourceUnavailableReason; message: string };

export interface SessionResourceSnapshot {
  dialect: 'posix' | 'powershell';
  collectedAt: string;
  status: 'complete' | 'partial' | 'unavailable';
  host: ResourceMetric<{ name: string }>;
  os: ResourceMetric<{ name: string; version?: string; architecture?: string }>;
  uptime: ResourceMetric<{ seconds: number }>;
  cpu: ResourceMetric<{
    logicalProcessors?: number;
    usagePercent?: number;
    loadAverage?: { oneMinute: number; fiveMinutes: number; fifteenMinutes: number };
  }>;
  memory: ResourceMetric<{
    totalBytes: number;
    usedBytes: number;
    availableBytes?: number;
  }>;
  swap: ResourceMetric<{ totalBytes: number; usedBytes: number; availableBytes?: number }>;
  disks: ResourceMetric<
    Array<{
      name: string;
      mountPoint?: string;
      totalBytes: number;
      usedBytes: number;
      availableBytes?: number;
      usagePercent?: number;
    }>
  >;
  network: ResourceMetric<Array<{ name: string; receivedBytes: number; transmittedBytes: number }>>;
}

export type SessionResourceRefreshResult =
  | { ok: true; snapshot: SessionResourceSnapshot }
  | {
      ok: false;
      error: {
        code:
          | 'session_not_found'
          | 'session_not_ready'
          | 'execution_dialect_unsupported'
          | 'lease_unavailable'
          | 'collection_timeout'
          | 'collection_failed';
        message: string;
      };
    };

export interface SessionResourceEvent {
  sessionId: string;
  snapshot: SessionResourceSnapshot;
}

export interface AuditEventView {
  id: string;
  type: string;
  sessionId?: string;
  taskId?: string;
  occurredAt: string;
  summary: string;
}

export type McpApprovalMode = 'read_only' | 'managed' | 'full';

export interface McpStatus {
  enabled: boolean;
  running: boolean;
  approvalMode: McpApprovalMode;
  hasToken: boolean;
  token?: string;
  port?: number;
  connectionString?: string;
}

export type AcpApprovalMode = 'managed' | 'manual';

export interface AcpStatus {
  enabled: boolean;
  running: boolean;
  approvalMode: AcpApprovalMode;
  activeSessionId?: string;
  activeTurn: boolean;
  agentName?: string;
}

export interface AcpTurnView {
  id: string;
  conversationId: string;
  sessionId: string;
  driver: 'acp';
  userMessage: string;
  status: string;
  revision: number;
  occurredAt: string;
}

export interface AcpHistoryView {
  sessionId: string;
  conversation?: {
    id: string;
    sessionId: string;
    driver: 'acp';
    status: 'active' | 'closed';
    revision: number;
  };
  turns: AcpTurnView[];
  projection: {
    userText: string[];
    assistantText: string[];
    toolCalls: Array<{
      toolCallId: string;
      title: string;
      status: string;
      command?: string;
      occurredAt: string;
    }>;
  };
}

export interface DesktopApi {
  readonly platform?: string;
  sessions: {
    list(): Promise<SessionSummary[]>;
    environment(): Promise<SessionEnvironment>;
    create(input: SessionLaunchInput): Promise<SessionSummary>;
    rename(sessionId: string, alias: string): Promise<SessionSummary>;
    setDialect(
      sessionId: string,
      executionDialect: SessionSummary['executionDialect'],
    ): Promise<SessionSummary>;
    markShared(sessionId: string): Promise<SessionSummary>;
    close(sessionId: string): Promise<boolean>;
    onChanged(listener: (session: SessionSummary) => void): () => void;
  };
  terminal: {
    write(sessionId: string, data: string): Promise<void>;
    resize(sessionId: string, columns: number, rows: number): Promise<void>;
    replay(sessionId: string, afterSequence: number): Promise<TerminalReplay>;
    onOutput(listener: (event: TerminalOutputEvent) => void): () => void;
  };
  resources: {
    get(sessionId: string): Promise<SessionResourceSnapshot | undefined>;
    refresh(sessionId: string): Promise<SessionResourceRefreshResult>;
    onSnapshot(listener: (event: SessionResourceEvent) => void): () => void;
  };
  attachments: {
    pick(options: {
      kind: DesktopAttachmentKind;
      currentCount?: number;
    }): Promise<PickedAgentAttachment[]>;
  };
  agent: {
    start(
      sessionId: string,
      goal: string,
      options?: {
        attachments?: PickedAgentAttachment[];
        modelConfigurationId?: string;
        reasoningEffort?: ReasoningEffort;
        permissionMode?: 'manual' | 'auto' | 'full_access';
      },
    ): Promise<{ taskId: string; conversationId: string; turnId: string }>;
    cancel(sessionId: string, turnId?: string): Promise<void>;
    history(sessionId: string): Promise<AgentHistoryView>;
    resetConversation(sessionId: string, expectedConversationId: string): Promise<void>;
    interrupt(sessionId: string, transactionId: string): Promise<void>;
    approve(sessionId: string, approvalId: string, confirmedDestructive: boolean): Promise<void>;
    takeover(sessionId: string): Promise<void>;
    onTimeline(listener: (event: AgentTimelineItem) => void): () => void;
    onTextDelta(listener: (event: AgentTextDelta) => void): () => void;
  };
  providers: {
    list(): Promise<ProviderProfileView[]>;
    save(profile: ProviderProfileInput, apiKey?: string): Promise<void>;
    discoverModels(
      providerId: string,
    ): Promise<{ providerProfileId: string; models: DiscoveredModel[]; truncated: boolean }>;
    cancelDiscovery(providerId: string): Promise<boolean>;
    remove(providerId: string): Promise<boolean>;
  };
  models: {
    list(): Promise<ModelConfigurationView[]>;
    save(model: ModelConfigurationInput): Promise<void>;
    test(modelConfigurationId: string): Promise<ModelConfigurationView>;
    setEnabled(modelConfigurationId: string, enabled: boolean): Promise<ModelConfigurationView>;
    setDefault(modelConfigurationId: string, isDefault: boolean): Promise<ModelConfigurationView>;
    remove(modelConfigurationId: string): Promise<boolean>;
    importDiscovered(
      providerProfileId: string,
      modelIds: string[],
    ): Promise<{ created: string[]; skipped: string[] }>;
  };
  audit: {
    list(filter?: { sessionId?: string; taskId?: string }): Promise<AuditEventView[]>;
    cleanup(): Promise<{ rawLogs: number; auditEvents: number }>;
  };
  mcp: {
    status(): Promise<McpStatus>;
    setEnabled(enabled: boolean): Promise<McpStatus>;
    setApprovalMode(mode: McpApprovalMode): Promise<McpStatus>;
    regenerateToken(): Promise<McpStatus>;
    revokeToken(): Promise<McpStatus>;
  };
  acp: {
    status(): Promise<AcpStatus>;
    setEnabled(enabled: boolean): Promise<AcpStatus>;
    setApprovalMode(mode: AcpApprovalMode): Promise<AcpStatus>;
    startTurn(
      sessionId: string,
      goal: string,
      cwd?: string,
    ): Promise<{ turnId: string; conversationId: string }>;
    cancelTurn(sessionId: string): Promise<void>;
    respondApproval(approvalId: string, approved: boolean): Promise<void>;
    closeConversation(sessionId: string): Promise<void>;
    history(sessionId: string): Promise<AcpHistoryView>;
    onStatusChanged(listener: (status: AcpStatus) => void): () => void;
  };
  core: {
    status(): Promise<{
      connected: boolean;
      version: string;
      instanceId?: string;
      sessions?: number;
      agentTasks?: number;
    }>;
    exit(mode: 'keep_sessions' | 'terminate_sessions'): Promise<void>;
  };
}

export function createDesktopApi(ipc: RendererIpc, platform?: string): DesktopApi {
  const invoke = async <T>(channel: string, ...argumentsValue: unknown[]): Promise<T> =>
    (await ipc.invoke(channel, ...argumentsValue)) as T;
  return {
    ...(platform === undefined ? {} : { platform }),
    sessions: {
      list: () => invoke('sessions:list'),
      environment: () => invoke('sessions:environment'),
      create: (input) => invoke('sessions:create', input),
      rename: (sessionId, alias) => invoke('sessions:rename', sessionId, alias),
      setDialect: (sessionId, executionDialect) =>
        invoke('sessions:set-dialect', sessionId, executionDialect),
      markShared: (sessionId) => invoke('sessions:mark-shared', sessionId),
      close: (sessionId) => invoke('sessions:close', sessionId),
      onChanged: (listener) =>
        ipc.on('session:changed', (payload) => listener(payload as SessionSummary)),
    },
    terminal: {
      write: (sessionId, data) => invoke('terminal:write', sessionId, data),
      resize: (sessionId, columns, rows) => invoke('terminal:resize', sessionId, columns, rows),
      replay: (sessionId, afterSequence) => invoke('terminal:replay', sessionId, afterSequence),
      onOutput: (listener) =>
        ipc.on('terminal:output', (payload) => listener(payload as TerminalOutputEvent)),
    },
    resources: {
      get: async (sessionId) =>
        (await invoke<SessionResourceSnapshot | null>('resources:get', sessionId)) ?? undefined,
      refresh: (sessionId) => invoke('resources:refresh', sessionId),
      onSnapshot: (listener) =>
        ipc.on('session:resources', (payload) => listener(payload as SessionResourceEvent)),
    },
    attachments: {
      pick: (options) => invoke('attachments:pick', options),
    },
    agent: {
      start: (sessionId, goal, options) => invoke('agent:start', sessionId, goal, options),
      cancel: (sessionId, turnId) => invoke('agent:cancel', sessionId, turnId),
      history: (sessionId) => invoke('agent:history', sessionId),
      resetConversation: (sessionId, expectedConversationId) =>
        invoke('agent:reset-conversation', sessionId, expectedConversationId),
      interrupt: (sessionId, transactionId) => invoke('agent:interrupt', sessionId, transactionId),
      approve: (sessionId, approvalId, confirmedDestructive) =>
        invoke('agent:approve', sessionId, approvalId, confirmedDestructive),
      takeover: (sessionId) => invoke('agent:takeover', sessionId),
      onTimeline: (listener) =>
        ipc.on('agent:timeline', (payload) => listener(payload as AgentTimelineItem)),
      onTextDelta: (listener) =>
        ipc.on('agent:text-delta', (payload) => listener(payload as AgentTextDelta)),
    },
    providers: {
      list: () => invoke('providers:list'),
      save: (profile, apiKey) => invoke('providers:save', profile, apiKey),
      discoverModels: (providerId) => invoke('providers:discover-models', providerId),
      cancelDiscovery: (providerId) => invoke('providers:cancel-discovery', providerId),
      remove: (providerId) => invoke('providers:remove', providerId),
    },
    models: {
      list: () => invoke('models:list'),
      save: (model) => invoke('models:save', model),
      test: (modelConfigurationId) => invoke('models:test', modelConfigurationId),
      setEnabled: (modelConfigurationId, enabled) =>
        invoke('models:set-enabled', modelConfigurationId, enabled),
      setDefault: (modelConfigurationId, isDefault) =>
        invoke('models:set-default', modelConfigurationId, isDefault),
      remove: (modelConfigurationId) => invoke('models:remove', modelConfigurationId),
      importDiscovered: (providerProfileId, modelIds) =>
        invoke('models:import-discovered', providerProfileId, modelIds),
    },
    audit: {
      list: (filter) => invoke('audit:list', filter),
      cleanup: () => invoke('audit:cleanup'),
    },
    mcp: {
      status: () => invoke('mcp:get-status'),
      setEnabled: (enabled) => invoke('mcp:set-enabled', enabled),
      setApprovalMode: (mode) => invoke('mcp:set-approval-mode', mode),
      regenerateToken: () => invoke('mcp:regenerate-token'),
      revokeToken: () => invoke('mcp:revoke-token'),
    },
    acp: {
      status: () => invoke('acp:get-status'),
      setEnabled: (enabled) => invoke('acp:set-enabled', enabled),
      setApprovalMode: (mode) => invoke('acp:set-approval-mode', mode),
      startTurn: (sessionId, goal, cwd) => invoke('acp:start-turn', sessionId, goal, cwd),
      cancelTurn: (sessionId) => invoke('acp:cancel-turn', sessionId),
      respondApproval: (approvalId, approved) =>
        invoke('acp:respond-approval', approvalId, approved),
      closeConversation: (sessionId) => invoke('acp:close-conversation', sessionId),
      history: (sessionId) => invoke('acp:get-history', sessionId),
      onStatusChanged: (listener) =>
        ipc.on('acp:status-changed', (payload) => listener(payload as AcpStatus)),
    },
    core: {
      status: () => invoke('core:status'),
      exit: (mode) => invoke('core:exit', mode),
    },
  };
}
