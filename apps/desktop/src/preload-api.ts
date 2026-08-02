import type { LocalShellDescriptor } from './shell-locator.js';

export interface RendererIpc {
  invoke(channel: string, ...argumentsValue: unknown[]): Promise<unknown>;
  on(channel: string, listener: (payload: unknown) => void): () => void;
}

export interface SessionSummary {
  id: string;
  title: string;
  terminalType: string;
  pty: 'starting' | 'running' | 'exited' | 'failed' | 'interrupted';
  shell: 'unknown' | 'probing' | 'ready' | 'executing' | 'interaction_required';
  executionDialect: 'posix' | 'powershell' | 'observe_only';
  agentStatus?: string;
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

export interface TerminalOutputEvent {
  sessionId: string;
  sequence: number;
  data: string;
}

export interface TerminalReplay {
  historyGap: boolean;
  snapshot?: string;
  events: Array<{ sequence: number; data: string }>;
  oldestSequence?: number;
  nextSequence: number;
}

export interface AgentTimelineItem {
  id: string;
  sessionId: string;
  kind: 'user' | 'assistant' | 'tool' | 'command' | 'file' | 'approval' | 'system';
  text: string;
  status?: string;
  toolRole?: 'call' | 'result';
  risk?: 'read_only' | 'unknown' | 'mutating' | 'privileged' | 'destructive';
  reasons?: string[];
  change?: {
    path: string;
    operation: 'create' | 'replace' | 'edit';
    beforeSha256?: string;
    afterSha256: string;
    bytes: number;
    diff: string;
    truncated: boolean;
  };
  conversationId?: string;
  turnId?: string;
  toolCallId?: string;
  command?: string;
  toolResult?: string;
  occurredAt: string;
}

export interface AgentHistoryView {
  sessionId: string;
  conversation?: {
    id: string;
    sessionId: string;
    status: 'active' | 'reset';
    permissionMode: 'manual' | 'auto' | 'full_access';
    revision: number;
  };
  turns: Array<{
    id: string;
    conversationId: string;
    sessionId: string;
    modelConfigurationId: string;
    modelConfigurationRevision: number;
    modelConfigurationName: string;
    providerProfileId: string;
    providerProfileRevision: number;
    providerProfileName: string;
    protocol: 'openai_responses' | 'openai_chat_completions' | 'anthropic_messages';
    modelId: string;
    capabilities: ModelCapabilities;
    contextWindowTokens: number;
    maxOutputTokens: number;
    autoCompact: boolean;
    compactThresholdPercent: number;
    supportedReasoningEfforts: ReasoningEffort[];
    defaultReasoningEffort: ReasoningEffort;
    reasoningEffort: ReasoningEffort;
    permissionMode: 'manual' | 'auto' | 'full_access';
    userMessage: string;
    status: string;
    revision: number;
  }>;
  items: Array<Record<string, unknown> & { id: string; type: string; sequence: number }>;
  activeTurnId?: string;
}

export interface ProviderProfileView {
  id: string;
  name: string;
  protocol: 'openai_responses' | 'openai_chat_completions' | 'anthropic_messages';
  baseUrl: string;
  extraHeaders?: Record<string, string>;
  timeoutMs?: number;
  credentialConfigured: boolean;
  revision: number;
}

export type ProviderProfileInput = Omit<ProviderProfileView, 'credentialConfigured' | 'revision'>;

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

export interface ModelCapabilities {
  responses: boolean;
  streaming: boolean;
  toolCalls: boolean;
  reasoning?: boolean | undefined;
}

export type ModelValidation =
  | { status: 'unverified' }
  | { status: 'validating'; attempt: number }
  | {
      status: 'available';
      checkedAt: string;
      attempt: number;
      capabilities: ModelCapabilities;
    }
  | { status: 'unavailable'; checkedAt: string; attempt: number; reason: string };

export interface ModelConfigurationView {
  id: string;
  name: string;
  providerProfileId: string;
  providerName: string;
  providerProtocol: ProviderProfileView['protocol'];
  modelId: string;
  declaredCapabilities: ModelCapabilities;
  contextWindowTokens: number;
  maxOutputTokens: number;
  autoCompact: boolean;
  compactThresholdPercent: number;
  supportedReasoningEfforts: ReasoningEffort[];
  defaultReasoningEffort: ReasoningEffort;
  enabled: boolean;
  isDefault: boolean;
  status: ModelValidation['status'];
  validation: ModelValidation;
  revision: number;
}

export type ModelConfigurationInput = Omit<
  ModelConfigurationView,
  | 'providerName'
  | 'providerProtocol'
  | 'enabled'
  | 'isDefault'
  | 'status'
  | 'validation'
  | 'revision'
>;

export interface DiscoveredModel {
  id: string;
  displayName?: string | undefined;
  ownedBy?: string | undefined;
  createdAt?: string | undefined;
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

export interface DesktopApi {
  readonly platform?: string;
  sessions: {
    list(): Promise<SessionSummary[]>;
    environment(): Promise<SessionEnvironment>;
    create(input: SessionLaunchInput): Promise<SessionSummary>;
    setDialect(
      sessionId: string,
      executionDialect: SessionSummary['executionDialect'],
    ): Promise<SessionSummary>;
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
  agent: {
    start(
      sessionId: string,
      goal: string,
      options?: {
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
      setDialect: (sessionId, executionDialect) =>
        invoke('sessions:set-dialect', sessionId, executionDialect),
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
    core: {
      status: () => invoke('core:status'),
      exit: (mode) => invoke('core:exit', mode),
    },
  };
}
