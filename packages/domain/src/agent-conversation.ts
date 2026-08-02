import type { AgentModelSelection, ModelReasoningEffort } from './model-configuration.js';

export type AgentConversationStatus = 'active' | 'reset';
export type AgentPermissionMode = 'manual' | 'auto' | 'full_access';
export type ReasoningEffort = ModelReasoningEffort;

export interface AgentConversation {
  id: string;
  sessionId: string;
  status: AgentConversationStatus;
  permissionMode: AgentPermissionMode;
  revision: number;
}

export interface CreateAgentConversationInput {
  id: string;
  sessionId: string;
}

export function createAgentConversation(input: CreateAgentConversationInput): AgentConversation {
  return { ...input, status: 'active', permissionMode: 'auto', revision: 0 };
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

export interface AgentTurn extends AgentModelSelection {
  id: string;
  conversationId: string;
  sessionId: string;
  reasoningEffort: ReasoningEffort;
  permissionMode: AgentPermissionMode;
  userMessage: string;
  status: AgentTurnStatus;
  revision: number;
}

export type CreateAgentTurnInput = Omit<
  AgentTurn,
  'status' | 'revision' | 'reasoningEffort' | 'permissionMode'
> &
  Partial<Pick<AgentTurn, 'reasoningEffort' | 'permissionMode'>>;

export function createAgentTurn(input: CreateAgentTurnInput): AgentTurn {
  return {
    ...input,
    capabilities: { ...input.capabilities },
    reasoningEffort: input.reasoningEffort ?? 'low',
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
