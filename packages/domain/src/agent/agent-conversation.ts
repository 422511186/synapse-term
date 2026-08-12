import type { AgentAttachmentMetadata } from './agent-attachment.js';
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

/**
 * 上下文压缩来源闸门（Ch35 三道闸门 + Ch37 分层）。
 * - `proactive`：Proactive 闸门（估算达 0.90 阈值）触发压缩。
 * - `preflight`：Preflight 闸门（发送前达 0.95 阈值）触发压缩。
 * - `reactive`：Reactive 闸门（命中 `context_length_exceeded` 后）触发压缩。
 * - `layered`：LayeredCompactor 分层压缩（Tier2 语义摘要）触发。
 */
export type ConversationCompactionGate = 'proactive' | 'preflight' | 'reactive' | 'layered';

/**
 * 分层压缩层级（Ch37）。
 * - `tier3`：距离 ≤8，保留全量。
 * - `tier2`：距离 8-19，语义摘要（cap 300 chars）。
 * - `tier1`：距离 ≥20，元数据桩。
 */
export type ConversationCompactionTier = 'tier3' | 'tier2' | 'tier1';

/**
 * 子任务边界 marker（Ch40 最小子集）。
 * Planning 进入新子任务时打 marker 作为天然 checkpoint；
 * `inProgress` 标记当前是否有进行中的子任务。
 * `InProgress⟺marker` 不变量：有 marker 则必有 InProgress 子任务，反之亦然。
 */
export interface ConversationCompactionSubtaskMarker {
  subtaskId: string;
  inProgress: boolean;
}

export interface ConversationCompaction {
  id: string;
  conversationId: string;
  throughSequence: number;
  summary: string;
  sourceItemCount: number;
  estimatedTokensBefore: number;
  createdAt: string;
  summaryMethod?: 'provider' | 'deterministic' | undefined;
  /** 压缩来源闸门（向前兼容：旧数据缺字段视为 undefined） */
  gate?: ConversationCompactionGate | undefined;
  /** 分层压缩层级（向前兼容：旧数据缺字段视为 undefined） */
  tier?: ConversationCompactionTier | undefined;
  /** 子任务边界 marker 列表（Ch40 checkpoint 载体） */
  subtaskMarkers?: ConversationCompactionSubtaskMarker[] | undefined;
  /** 持久化 schema 版本，向前兼容读取（旧数据缺字段视为 1） */
  schemaVersion?: number | undefined;
}

export function createConversationCompaction(
  input: ConversationCompaction,
): ConversationCompaction {
  return structuredClone(input);
}

// =============================================================================
// 上下文治理（Context Governance）类型骨架
// 依据《AI Agent Book》Ch35/36/37/40 落地：
// - ToolResultSpiller（Ch36）：超大 tool_result 外溢为 preview+pointer
// - LayeredCompactor（Ch37）：按距离分层（Tier3/2/1）
// - ThreeGateCompactor（Ch35）：Proactive/Preflight/Reactive 三闸门
// - ContextGovernanceState（Ch40 精神延伸）：治理状态持久化，崩溃不重分类
// =============================================================================

/**
 * 工具结果可重发性分级（Ch36）。
 * - `re-issuable`：可重发更窄查询取最新结果（如 local_read_file 带 startLine/endLine）。
 *   外溢策略激进，召回工具仅作备选。
 * - `not-replayable`：有副作用不可重放（如 terminal_execute 有副作用、terminal_wait、
 *   terminal_interrupt、local_write_file、local_edit_file）。外溢策略保守，
 *   召回工具是唯一取回途径。
 */
export type ToolReissuabilityGrade = 're-issuable' | 'not-replayable';

/**
 * 外溢的 tool_result 记录（Ch36 Preview+Pointer）。
 * 原始内容不冗余存（仍在 append-only #items），这里只持久化元数据 + 小 preview。
 * preview 头尾各 ≤512 字节，保证模型能看到结果首尾，中间用指针召回。
 */
export interface ToolResultSpillRecord {
  /** 被外溢的原始 tool_result 的 toolCallId */
  toolCallId: string;
  /** 可重发性分级，决定召回策略 */
  reissuability: ToolReissuabilityGrade;
  /** 头部 preview（≤512 字节） */
  previewHead: string;
  /** 尾部 preview（≤512 字节） */
  previewTail: string;
  /** 原始结果总字节，用于诊断与召回预算 */
  originalBytes: number;
}

/**
 * 分层压缩分类记录（Ch37）。
 * distance = 当前 turn 序号 − 该 tool_result 所在 turn 序号。
 * 首次分类后持久化，崩溃恢复不重新分类（分类可能调过摘要器，重付不可接受）。
 */
export interface TierClassification {
  toolCallId: string;
  tier: ConversationCompactionTier;
  /** 分类时该 tool_result 所在的 turn 序号 */
  classifiedAtTurn: number;
}

/**
 * 持久化的上下文治理状态（Ch40 精神延伸）。
 * 按 conversationId 整体 upsert；原始结果内容不冗余存（仍在 #items）。
 * 崩溃恢复时 Governor 从此状态重建 spill/tier/Seen，不重新分类、不重新外溢。
 */
export interface ContextGovernanceState {
  conversationId: string;
  spillRecords: ToolResultSpillRecord[];
  tierClassifications: TierClassification[];
  /** Seen set：防全量回灌（投影路径不回灌全量，但允许 context_recall 显式召回） */
  seenToolCallIds: string[];
  /** 持久化 schema 版本，向前兼容读取（初始 1） */
  schemaVersion: number;
}

/**
 * LoopDetector 裁决（Ch43 三级裁决）。
 * - `continue`：继续 ReAct 循环。
 * - `nudge`：提示模型改变策略；滚动窗口（2 次后续调用）内未升级则升 ForceStop。
 * - `force_stop`：强制停止 ReAct，走 ForceStop-with-summary 管道。
 */
export type LoopVerdict = 'continue' | 'nudge' | 'force_stop';

/**
 * LoopDetector 观察到的循环路径（Ch43 9 路径）。
 * 按序求值，先命中者胜。
 */
export type LoopObservation =
  | 'empty_think'
  | 'tool_mode_switch'
  | 'success_after_error'
  | 'consecutive_duplicate'
  | 'exact_duplicate'
  | 'same_tool_error'
  | 'family_no_progress'
  | 'search_escalation'
  | 'no_progress';

/**
 * Planning 分解结果（Ch10）。
 * 确定性代码按依赖拓扑排序执行子任务。
 */
export interface DecompositionResult {
  /** 分解模式：direct（直接执行，跳过分解）/ decomposed（已分解） */
  mode: 'direct' | 'decomposed';
  /** 任务复杂度评估 */
  complexity: 'simple' | 'moderate' | 'complex';
  /** 子任务列表（mode=decomposed 时非空，按拓扑序） */
  subtasks: Subtask[];
  /** 执行策略说明 */
  strategy: string;
}

/**
 * Planning 子任务（Ch10）。
 * Dependencies/Produces/Consumes/Boundaries 描述子任务间依赖与边界。
 */
export interface Subtask {
  id: string;
  title: string;
  /** 依赖的子任务 id 列表（拓扑排序依据） */
  dependencies: string[];
  /** 产出的 artifact 标识 */
  produces: string[];
  /** 消费的 artifact 标识 */
  consumes: string[];
  /** 边界：在范围内的目标 */
  boundariesInScope: string;
  /** 边界：不在范围内的目标（防止越界） */
  boundariesOutOfScope: string;
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
  | (ModelItemBase & {
      type: 'system_text' | 'assistant_text';
      content: string;
    })
  | (ModelItemBase & {
      type: 'user_text';
      content: string;
      attachments?: AgentAttachmentMetadata[] | undefined;
    })
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
