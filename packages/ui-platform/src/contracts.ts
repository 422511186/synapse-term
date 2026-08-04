/**
 * ui-platform 共享视图契约
 *
 * 从桌面端 preload-api 迁出的可复用视图类型，以及宿主注入的最小 API 端口
 * （TerminalViewApi / ModelManagementApi）。宿主实现通过结构化类型满足端口。
 */

export interface SessionSummary {
  id: string;
  title: string;
  terminalType: string;
  pty: 'starting' | 'running' | 'exited' | 'failed' | 'interrupted';
  shell: 'unknown' | 'probing' | 'ready' | 'executing' | 'interaction_required';
  executionDialect: 'posix' | 'powershell' | 'observe_only';
  agentStatus?: string;
  /** 用户显式复制过 sessionId 后为 true（Shared Session，ADR-0022） */
  shared?: boolean;
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
  hasMore?: boolean;
  nextAfterSequence?: number;
}

export type AgentAttachmentKind = 'image' | 'file';

export interface AgentAttachmentMetadata {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  kind: AgentAttachmentKind;
  relativePath?: string | undefined;
}

export interface AgentTimelineItem {
  id: string;
  sessionId: string;
  /** 事件来源驱动者：内置 Agent 省略（向后兼容），ACP 外部驱动者标记为 acp */
  driver?: 'builtin' | 'acp';
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
  progress?: AgentProgressSnapshot;
  conversationId?: string;
  turnId?: string;
  toolCallId?: string;
  command?: string;
  toolResult?: string;
  attachments?: AgentAttachmentMetadata[];
  occurredAt: string;
}

export interface AgentTextDelta {
  id: string;
  sessionId: string;
  conversationId?: string;
  turnId: string;
  operation: 'append' | 'replace';
  delta: string;
  sequence: number;
  occurredAt: string;
}

export type AgentProgressPhase =
  | 'planning'
  | 'executing'
  | 'verifying'
  | 'waiting_approval'
  | 'waiting_user'
  | 'suspended'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AgentProgressStepStatus =
  | 'pending'
  | 'running'
  | 'waiting_approval'
  | 'waiting_user'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface AgentProgressStep {
  id: string;
  label: string;
  status: AgentProgressStepStatus;
  toolCallId?: string;
}

export interface AgentProgressSnapshot {
  phase: AgentProgressPhase;
  revision: number;
  steps: AgentProgressStep[];
}

export interface AgentHistoryView {
  sessionId: string;
  conversation?: {
    id: string;
    sessionId: string;
    driver: 'builtin' | 'acp';
    status: 'active' | 'reset';
    permissionMode: 'manual' | 'auto' | 'full_access';
    revision: number;
  };
  turns: Array<{
    id: string;
    conversationId: string;
    sessionId: string;
    driver: 'builtin' | 'acp';
    model?: AgentModelSelectionView | undefined;
    reasoningEffort?: ReasoningEffort | undefined;
    permissionMode: 'manual' | 'auto' | 'full_access';
    userMessage: string;
    status: string;
    revision: number;
  }>;
  items: Array<Record<string, unknown> & { id: string; type: string; sequence: number }>;
  activeTurnId?: string;
}

export interface AgentModelSelectionView {
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
  multimodal?: boolean | undefined;
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

/** 终端视图所需的最小 API 端口（宿主注入完整实现） */
export interface TerminalViewApi {
  terminal: {
    write(sessionId: string, data: string): Promise<void>;
    resize(sessionId: string, columns: number, rows: number): Promise<void>;
    replay(sessionId: string, afterSequence: number): Promise<TerminalReplay>;
    onOutput(listener: (event: TerminalOutputEvent) => void): () => void;
  };
}

/** 模型管理页所需的最小 API 端口（宿主注入完整实现） */
export interface ModelManagementApi {
  providers: {
    save(profile: ProviderProfileInput, apiKey?: string): Promise<void>;
    discoverModels(
      providerId: string,
    ): Promise<{ providerProfileId: string; models: DiscoveredModel[]; truncated: boolean }>;
    cancelDiscovery(providerId: string): Promise<boolean>;
    remove(providerId: string): Promise<boolean>;
  };
  models: {
    save(model: ModelConfigurationInput): Promise<void>;
    test(modelConfigurationId: string): Promise<ModelConfigurationView>;
    setEnabled(modelConfigurationId: string, enabled: boolean): Promise<ModelConfigurationView>;
    setDefault(modelConfigurationId: string, isDefault: boolean): Promise<ModelConfigurationView>;
    remove(modelConfigurationId: string): Promise<boolean>;
  };
}
