import type { AgentDriverKind } from './agent-driver.js';
import type { AgentModelSelection, ModelReasoningEffort } from '../provider/model-configuration.js';

export type AgentConversationStatus = 'active' | 'reset';
export type AgentPermissionMode = 'manual' | 'auto' | 'full_access';
export type ReasoningEffort = ModelReasoningEffort;

export interface AgentConversation {
  id: string;
  sessionId: string;
  /** 驱动者维度：builtin（内置 Agent）或 acp（外部 Agent 主驾驶），旧数据默认 builtin */
  driver: AgentDriverKind;
  status: AgentConversationStatus;
  permissionMode: AgentPermissionMode;
  revision: number;
}

export interface CreateAgentConversationInput {
  id: string;
  sessionId: string;
  driver?: AgentDriverKind;
}

export function createAgentConversation(input: CreateAgentConversationInput): AgentConversation {
  return {
    ...input,
    driver: input.driver ?? 'builtin',
    status: 'active',
    permissionMode: 'auto',
    revision: 0,
  };
}

export function resetAgentConversation(conversation: AgentConversation): AgentConversation {
  return { ...conversation, status: 'reset', revision: conversation.revision + 1 };
}

export function setConversationPermissionMode(
  conversation: AgentConversation,
  permissionMode: AgentPermissionMode,
): AgentConversation {
  return { ...conversation, permissionMode, revision: conversation.revision + 1 };
}

export type AgentTurnStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'waiting_user'
  | 'suspended'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface AgentTurn {
  id: string;
  conversationId: string;
  sessionId: string;
  /** 驱动者维度：内置驱动者必须有模型快照，外部驱动者由自身管理模型 */
  driver: AgentDriverKind;
  /** 平台模型快照：内置驱动者必填；外部驱动者允许为空 */
  model?: AgentModelSelection | undefined;
  reasoningEffort?: ReasoningEffort | undefined;
  permissionMode: AgentPermissionMode;
  userMessage: string;
  status: AgentTurnStatus;
  revision: number;
}

export type CreateAgentTurnInput = Omit<
  AgentTurn,
  'status' | 'revision' | 'reasoningEffort' | 'permissionMode' | 'driver' | 'model'
> &
  Partial<Pick<AgentTurn, 'reasoningEffort' | 'permissionMode' | 'driver' | 'model'>>;

export function createAgentTurn(input: CreateAgentTurnInput): AgentTurn {
  const driver = input.driver ?? 'builtin';
  const model =
    input.model === undefined
      ? undefined
      : {
          ...input.model,
          capabilities: { ...input.model.capabilities },
          supportedReasoningEfforts: [...input.model.supportedReasoningEfforts],
        };
  if (driver === 'builtin' && model === undefined) {
    throw new RangeError('builtin agent turn requires a model selection');
  }
  return {
    ...input,
    driver,
    model,
    reasoningEffort: input.reasoningEffort ?? model?.defaultReasoningEffort,
    permissionMode: input.permissionMode ?? 'auto',
    status: 'queued',
    revision: 0,
  };
}

export interface ConversationCompaction {
  id: string;
  conversationId: string;
  throughSequence: number;
  summary: string;
  sourceItemCount: number;
  estimatedTokensBefore: number;
  createdAt: string;
}

export function createConversationCompaction(
  input: ConversationCompaction,
): ConversationCompaction {
  return structuredClone(input);
}

export type AgentTurnTransitionResult =
  { ok: true; value: AgentTurn } | { ok: false; error: 'invalid-agent-turn-transition' };

export function transitionAgentTurn(
  turn: AgentTurn,
  status: AgentTurnStatus,
): AgentTurnTransitionResult {
  const allowed: Readonly<Record<AgentTurnStatus, readonly AgentTurnStatus[]>> = {
    queued: ['running', 'cancelled'],
    running: ['waiting_approval', 'waiting_user', 'suspended', 'completed', 'failed', 'cancelled'],
    waiting_approval: ['running', 'cancelled'],
    waiting_user: ['running', 'cancelled'],
    suspended: ['running', 'cancelled'],
    completed: [],
    failed: [],
    cancelled: [],
  };
  if (!allowed[turn.status].includes(status)) {
    return { ok: false, error: 'invalid-agent-turn-transition' };
  }
  return { ok: true, value: { ...turn, status, revision: turn.revision + 1 } };
}

interface ModelItemBase {
  id: string;
  conversationId: string;
  turnId: string;
  sequence: number;
}

export type ModelItem =
  | (ModelItemBase & { type: 'system_text' | 'user_text' | 'assistant_text'; content: string })
  | (ModelItemBase & {
      type: 'assistant_tool_call';
      toolCallId: string;
      name: string;
      argumentsJson: string;
    })
  | (ModelItemBase & {
      type: 'tool_result';
      toolCallId: string;
      content: string;
      isError: boolean;
    });

export function createModelItem(input: ModelItem): ModelItem {
  return structuredClone(input);
}

export type ToolCallStatus =
  | 'proposed'
  | 'validating'
  | 'waiting_approval'
  | 'running'
  | 'completed'
  | 'recoverable_error'
  | 'fatal_error'
  | 'cancelled';

export interface ToolCallRecord {
  id: string;
  conversationId: string;
  turnId: string;
  name: string;
  argumentsJson: string;
  status: ToolCallStatus;
  revision: number;
}

export type CreateToolCallRecordInput = Omit<ToolCallRecord, 'status' | 'revision'>;

export function createToolCallRecord(input: CreateToolCallRecordInput): ToolCallRecord {
  return { ...input, status: 'proposed', revision: 0 };
}

export type ToolCallTransitionResult =
  { ok: true; value: ToolCallRecord } | { ok: false; error: 'invalid-tool-call-transition' };

export function transitionToolCall(
  call: ToolCallRecord,
  status: ToolCallStatus,
): ToolCallTransitionResult {
  const allowed: Readonly<Record<ToolCallStatus, readonly ToolCallStatus[]>> = {
    proposed: ['validating', 'cancelled'],
    validating: ['waiting_approval', 'running', 'recoverable_error', 'fatal_error', 'cancelled'],
    waiting_approval: ['running', 'cancelled'],
    running: ['completed', 'recoverable_error', 'fatal_error', 'cancelled'],
    completed: [],
    recoverable_error: [],
    fatal_error: [],
    cancelled: [],
  };
  if (!allowed[call.status].includes(status)) {
    return { ok: false, error: 'invalid-tool-call-transition' };
  }
  return { ok: true, value: { ...call, status, revision: call.revision + 1 } };
}
