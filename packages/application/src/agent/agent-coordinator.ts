import { randomUUID } from 'node:crypto';

import {
  type AgentAttachmentInput,
  type AgentAttachmentMetadata,
  type StagedAgentAttachment,
  createAgentConversation,
  createAgentModelSelection,
  createAgentTurn,
  createModelItem,
  createToolCallRecord,
  transitionAgentTurn,
  resetAgentConversation,
  setConversationPermissionMode,
  transitionToolCall,
  type AgentTask,
  type AgentTurn,
  type AgentTurnStatus,
  type ToolCallRecord,
  type ToolCallStatus,
  type ProviderProfile,
  type ModelConfiguration,
  type AgentPermissionMode,
  type ReasoningEffort,
} from '@synapse-term/domain';
import { type AgentHistoryView, type AgentTimelineItem } from '@synapse-term/protocol';

import {
  AgentRuntime,
  ContextBuilder,
  calculateContextBudget,
  ConversationCompactor,
} from '@synapse-term/agent-service';
import type { AuditService } from '@synapse-term/infrastructure';
import type { CoreRepositories } from '@synapse-term/infrastructure';
import type { ModelContentPart, ModelEvent, ModelInputItem } from '@synapse-term/model-providers';
import {
  ApprovalManager,
  hashCommand,
  TerminalToolGateway,
  type AgentTaskScheduler,
  type LocalFilePolicy,
  type PolicyEngine,
  type ToolGatewayResult,
} from '@synapse-term/platform-kernel';
import {
  CommandExecutor,
  ShellProbe,
  type CommandExecutorEvent,
  type SessionActor,
  type SessionManager,
} from '@synapse-term/terminal-service';
import type { LocalFileService } from '@synapse-term/tooling';
import type { OutputJournal } from '@synapse-term/terminal-service';

import type { CoreSecretStore, ProviderAdapterFactory } from '../router/core-request-router.js';
import { coordinatorError, type AgentState, type PendingApproval } from './agent-state.js';
import {
  ApprovalAwareGateway,
  extractTransactionId,
  isWaitingApproval,
} from './approval-aware-gateway.js';
import {
  AgentTimelineProjector,
  buildSessionSummary,
  commandTimelineStatus,
  nextModelSequence,
} from './agent-timeline-projector.js';
import {
  cleanupAgentAttachmentSession,
  stageAgentAttachments,
  type StagedAgentAttachmentBundle,
} from './agent-attachment-staging.js';

export interface AgentCoordinatorOptions {
  sessions: SessionManager;
  repositories: CoreRepositories;
  providers: {
    get(id: string): ProviderProfile | undefined;
    list(): ProviderProfile[];
  };
  models: {
    get(id: string): ModelConfiguration | undefined;
    listEligible(): ModelConfiguration[];
  };
  secrets: CoreSecretStore;
  scheduler: AgentTaskScheduler;
  policy: PolicyEngine;
  localFiles?: LocalFileService;
  localFilePolicy?: LocalFilePolicy;
  journal?: OutputJournal;
  contextBuilder?: ContextBuilder;
  createAdapter: ProviderAdapterFactory;
  emitTimeline(item: AgentTimelineItem): void;
  audit?: Pick<AuditService, 'record' | 'recordCommand'>;
  maxTurns?: number;
  onActivityChange?(activity: { sessions: number; agentTasks: number }): void;
}

export interface AgentStartOptions {
  attachments?: readonly AgentAttachmentInput[];
  modelConfigurationId?: string;
  reasoningEffort?: ReasoningEffort;
  permissionMode?: AgentPermissionMode;
}

export interface AgentStartResult {
  taskId: string;
  conversationId: string;
  turnId: string;
}

export class AgentCoordinator {
  readonly #sessions: SessionManager;
  readonly #repositories: CoreRepositories;
  readonly #providers: AgentCoordinatorOptions['providers'];
  readonly #models: AgentCoordinatorOptions['models'];
  readonly #secrets: CoreSecretStore;
  readonly #scheduler: AgentTaskScheduler;
  readonly #policy: PolicyEngine;
  readonly #localFiles: LocalFileService | undefined;
  readonly #localFilePolicy: LocalFilePolicy | undefined;
  readonly #journal: OutputJournal | undefined;
  readonly #contextBuilder: ContextBuilder;
  readonly #conversationCompactor = new ConversationCompactor();
  readonly #createAdapter: ProviderAdapterFactory;
  readonly #emitTimeline: (item: AgentTimelineItem) => void;
  readonly #audit: Pick<AuditService, 'record' | 'recordCommand'> | undefined;
  readonly #maxTurns: number | undefined;
  readonly #onActivityChange: (activity: { sessions: number; agentTasks: number }) => void;
  readonly #projector: AgentTimelineProjector;
  readonly #states = new Map<string, AgentState>();
  readonly #runs = new Set<Promise<void>>();

  constructor(options: AgentCoordinatorOptions) {
    this.#sessions = options.sessions;
    this.#repositories = options.repositories;
    this.#providers = options.providers;
    this.#models = options.models;
    this.#secrets = options.secrets;
    this.#scheduler = options.scheduler;
    this.#policy = options.policy;
    this.#localFiles = options.localFiles;
    this.#localFilePolicy = options.localFilePolicy;
    this.#journal = options.journal;
    this.#contextBuilder = options.contextBuilder ?? new ContextBuilder();
    this.#createAdapter = options.createAdapter;
    this.#emitTimeline = options.emitTimeline;
    this.#audit = options.audit;
    this.#maxTurns = options.maxTurns;
    this.#onActivityChange = options.onActivityChange ?? (() => undefined);
    this.#projector = new AgentTimelineProjector(options.repositories);
  }

  get activeTaskCount(): number {
    return this.#states.size;
  }

  hasActiveTask(sessionId: string): boolean {
    return this.#states.has(sessionId);
  }

  async start(
    sessionId: string,
    goal: string,
    options: AgentStartOptions = {},
  ): Promise<AgentStartResult> {
    const actor = this.#sessions.get(sessionId);
    if (actor === undefined)
      throw coordinatorError('session_not_found', `Session ${sessionId} not found`);
    const model = chooseModel(this.#models.listEligible(), options.modelConfigurationId);
    if (model === undefined) {
      throw coordinatorError(
        'provider_unavailable',
        'Requested Model Configuration is not enabled',
      );
    }
    const profile = this.#providers.get(model.providerProfileId);
    if (profile === undefined) {
      throw coordinatorError('provider_unavailable', 'Referenced Provider Profile is unavailable');
    }
    const reasoningEffort = options.reasoningEffort ?? model.defaultReasoningEffort;
    if (!model.supportedReasoningEfforts.includes(reasoningEffort)) {
      throw coordinatorError(
        'provider_capability_missing',
        `Model does not support reasoning effort ${reasoningEffort}`,
      );
    }
    const secret = await this.#secrets.get(profile.credentialRef);
    if (secret === undefined)
      throw coordinatorError('provider_unavailable', 'Provider credential is missing');

    const task = this.#scheduler.create({
      id: randomUUID(),
      sessionId,
      providerProfileId: profile.id,
      goal,
    });
    const running = this.#scheduler.start(task.id);
    this.#repositories.saveAgentTask(running);
    let staging: StagedAgentAttachmentBundle | undefined;
    // H-4: task 已持久化为 running，但 state 尚未入表；此区间抛错需回滚 task 为 failed，
    // 否则 cancel 找不到 state 而遗留孤立 running task，污染 activeTaskCount。
    try {
      staging = await stageAgentAttachments({
        sessionId,
        taskId: running.id,
        attachments: options.attachments ?? [],
        multimodal: model.declaredCapabilities.multimodal === true,
        ...(this.#localFiles === undefined ? {} : { localFiles: this.#localFiles }),
      });
      this.#buildAndStartAgentState(
        sessionId,
        running,
        profile,
        model,
        secret,
        actor,
        goal,
        options,
        reasoningEffort,
        staging,
      );
    } catch (error) {
      await staging?.dispose();
      try {
        const failed = this.#scheduler.transition(running.id, 'failed');
        this.#repositories.saveAgentTask(failed);
      } catch {
        /* 回滚失败不应掩盖原始错误 */
      }
      // H-4 补全：task 回滚之外，同时清理已持久化的 running turn / 半成品 state，
      // 避免历史中残留永远 running 的 Turn 或污染 activeTaskCount。
      this.#rollbackPartialStart(sessionId);
      throw error;
    }
    return {
      taskId: running.id,
      conversationId: this.#states.get(sessionId)!.conversation.id,
      turnId: this.#states.get(sessionId)!.turn.id,
    };
  }

  #buildAndStartAgentState(
    sessionId: string,
    running: AgentTask,
    profile: ProviderProfile,
    model: ModelConfiguration,
    secret: string,
    actor: SessionActor,
    goal: string,
    options: AgentStartOptions,
    reasoningEffort: ReasoningEffort | undefined,
    staging: StagedAgentAttachmentBundle | undefined,
  ): void {
    let conversation = [...this.#repositories.listAgentConversations(sessionId)]
      .reverse()
      .find((candidate) => candidate.status === 'active');
    if (conversation === undefined) {
      conversation = createAgentConversation({ id: randomUUID(), sessionId });
      if (
        options.permissionMode !== undefined &&
        conversation.permissionMode !== options.permissionMode
      ) {
        conversation = setConversationPermissionMode(conversation, options.permissionMode);
      }
      this.#repositories.saveAgentConversation(conversation);
    } else if (
      options.permissionMode !== undefined &&
      conversation.permissionMode !== options.permissionMode
    ) {
      conversation = setConversationPermissionMode(conversation, options.permissionMode);
      this.#repositories.saveAgentConversation(conversation);
    }
    const priorItems = this.#repositories.listModelItems(conversation.id);
    const budget = calculateContextBudget(model);
    const existingCompaction = this.#repositories
      .listConversationCompactions(conversation.id)
      .at(-1);
    const compacted = this.#conversationCompactor.compact({
      conversationId: conversation.id,
      items: priorItems,
      ...(existingCompaction === undefined ? {} : { existing: existingCompaction }),
      thresholdTokens: model.autoCompact ? budget.compactAtTokens : Number.MAX_SAFE_INTEGER,
      targetTokens: budget.compactTargetTokens,
      createdAt: new Date().toISOString(),
    });
    if (compacted.compaction !== undefined) {
      this.#repositories.saveConversationCompaction(compacted.compaction);
      this.#audit?.record({
        actor: { kind: 'system' },
        sessionId,
        type: 'conversation.compacted',
        payload: {
          conversationId: conversation.id,
          throughSequence: compacted.compaction.throughSequence,
          sourceItemCount: compacted.compaction.sourceItemCount,
          estimatedTokensBefore: compacted.compaction.estimatedTokensBefore,
        },
      });
    }
    const queuedTurn = createAgentTurn({
      id: randomUUID(),
      conversationId: conversation.id,
      sessionId,
      model: createAgentModelSelection(profile, model),
      reasoningEffort,
      permissionMode: conversation.permissionMode,
      userMessage: goal,
    });
    const runningTurn = transitionAgentTurn(queuedTurn, 'running');
    if (!runningTurn.ok) throw new Error(runningTurn.error);
    this.#repositories.saveAgentTurn(runningTurn.value);
    const userItem = createModelItem({
      id: randomUUID(),
      conversationId: conversation.id,
      turnId: runningTurn.value.id,
      sequence: nextModelSequence(priorItems),
      type: 'user_text',
      content: goal,
      ...(staging === undefined || staging.attachments.length === 0
        ? {}
        : { attachments: staging.attachments.map(toAttachmentMetadata) }),
    });
    this.#repositories.saveModelItem(userItem);
    this.#audit?.record({
      actor: { kind: 'user' },
      sessionId,
      taskId: running.id,
      type: 'task.started',
      payload: {
        providerProfileId: profile.id,
        modelConfigurationId: model.id,
        modelId: model.modelId,
      },
    });
    const adapter = this.#createAdapter(profile, model, secret);
    const approvals = new ApprovalManager();
    const executor = new CommandExecutor(actor);
    const stagedAttachments = staging?.attachments ?? [];
    const stateLocalFiles = stagedAttachments.length > 0 ? staging!.localFiles : this.#localFiles;
    const state: AgentState = {
      task: running,
      conversation,
      turn: runningTurn.value,
      actor,
      profile,
      model,
      adapter,
      leaseEpoch: undefined,
      approvals,
      executor,
      gateway: undefined as never,
      wrapper: undefined as never,
      runtime: undefined,
      activeProbe: undefined,
      pendingApproval: undefined,
      executorSubscription: undefined as never,
      history: compacted.history,
      attachments: stagedAttachments,
      nextModelSequence: userItem.sequence + 1,
      assistantTimelineId: randomUUID(),
      assistantText: '',
      activeToolCallId: undefined,
      transactionToolCallIds: new Map(),
    };
    const gateway = new TerminalToolGateway({
      sessionId,
      taskId: running.id,
      conversationId: conversation.id,
      turnId: runningTurn.value.id,
      prepareExecution: () => this.#prepareExecution(state),
      actor,
      executor,
      policy: this.#policy,
      approvals,
      permissionMode: conversation.permissionMode,
      ...(this.#journal === undefined ? {} : { journal: this.#journal }),
      ...(this.#audit === undefined ? {} : { audit: this.#audit }),
      ...(stateLocalFiles === undefined ? {} : { localFiles: stateLocalFiles }),
      ...(this.#localFilePolicy === undefined ? {} : { localFilePolicy: this.#localFilePolicy }),
    });
    state.gateway = gateway;
    state.wrapper = new ApprovalAwareGateway(
      state,
      (approval) => {
        state.pendingApproval = approval;
        this.#audit?.record({
          actor: { kind: 'agent', taskId: state.task.id },
          sessionId,
          taskId: state.task.id,
          type: 'approval.requested',
          payload: {
            approvalId: approval.id,
            commandHash: hashCommand(approval.approvalTarget),
            risk: approval.level,
            reasons: approval.reasons,
            conversationId: state.conversation.id,
            turnId: state.turn.id,
            toolCallId: approval.toolCallId,
            ...(approval.change === undefined
              ? {}
              : {
                  path: approval.change.path,
                  operation: approval.change.operation,
                  beforeSha256: approval.change.beforeSha256,
                  afterSha256: approval.change.afterSha256,
                }),
          },
        });
        this.#emitTimeline({
          id: approval.id,
          sessionId,
          kind: 'approval',
          text: approval.displayText,
          status: 'waiting_approval',
          risk: approval.level,
          reasons: [...approval.reasons],
          conversationId: state.conversation.id,
          turnId: state.turn.id,
          toolCallId: approval.toolCallId,
          ...(approval.change === undefined ? {} : { change: approval.change }),
          occurredAt: new Date().toISOString(),
        });
      },
      (toolCallId) => this.#markToolCallResuming(state, toolCallId),
      (toolCallId, result) => this.#recordToolCallResult(state, toolCallId, result),
    );
    state.executorSubscription = executor.onEvent((event) =>
      this.#handleExecutorEvent(state, event),
    );
    this.#states.set(sessionId, state);
    this.#emitTimeline({
      id: randomUUID(),
      sessionId,
      kind: 'user',
      text: goal,
      ...(stagedAttachments.length === 0
        ? {}
        : { attachments: stagedAttachments.map(toAttachmentMetadata) }),
      conversationId: conversation.id,
      turnId: runningTurn.value.id,
      occurredAt: new Date().toISOString(),
    });
    this.#onActivityChange({
      sessions: this.#sessions.activeCount,
      agentTasks: this.activeTaskCount,
    });

    const run = this.#runModel(state);
    this.#track(run);
  }

  async cancel(sessionId: string, expectedTurnId?: string): Promise<void> {
    const state = this.#states.get(sessionId);
    if (state === undefined) return;
    if (expectedTurnId !== undefined && state.turn.id !== expectedTurnId) {
      throw coordinatorError('agent_task_conflict', 'Agent Turn changed before cancellation');
    }
    if (state.pendingApproval !== undefined) {
      const pending = state.pendingApproval;
      state.pendingApproval = undefined;
      this.#emitApprovalTimeline(state, pending, 'cancelled');
      this.#audit?.record({
        actor: { kind: 'user' },
        sessionId,
        taskId: state.task.id,
        type: 'approval.rejected',
        payload: { approvalId: pending.id },
      });
    }
    const runtime = state.runtime;
    state.activeProbe?.cancel();
    if (runtime !== undefined) {
      runtime.cancel();
      const activeTransactionId = state.executor.activeTransactionId;
      if (activeTransactionId !== undefined) {
        await state.executor.interrupt(activeTransactionId);
      }
      await this.#finish(state, 'cancelled');
      return;
    }
    await this.#finish(state, 'cancelled');
  }

  async history(sessionId: string): Promise<AgentHistoryView> {
    const state = this.#states.get(sessionId);
    return this.#projector.project(sessionId, state?.turn.id);
  }

  async resetConversation(sessionId: string, expectedConversationId: string): Promise<void> {
    if (this.#states.has(sessionId)) {
      throw coordinatorError('agent_task_conflict', 'Cannot reset an active Agent Turn');
    }
    const conversation = [...this.#repositories.listAgentConversations(sessionId)]
      .reverse()
      .find((candidate) => candidate.status === 'active');
    if (conversation === undefined || conversation.id !== expectedConversationId) {
      throw coordinatorError('agent_task_conflict', 'Conversation changed before reset');
    }
    await cleanupAgentAttachmentSession({
      sessionId,
      ...(this.#localFiles === undefined ? {} : { localFiles: this.#localFiles }),
    });
    this.#repositories.saveAgentConversation(resetAgentConversation(conversation));
    this.#audit?.record({
      actor: { kind: 'user' },
      sessionId,
      type: 'conversation.reset',
      payload: { conversationId: conversation.id },
    });
    this.#emitTimeline({
      id: randomUUID(),
      sessionId,
      kind: 'system',
      text: '对话已重置',
      status: 'completed',
      conversationId: conversation.id,
      occurredAt: new Date().toISOString(),
    });
  }

  async interrupt(sessionId: string, transactionId: string): Promise<void> {
    const state = this.#states.get(sessionId);
    if (state === undefined) throw coordinatorError('session_not_found', 'Agent Task not found');
    const target =
      transactionId === 'active-transaction' ? state.executor.activeTransactionId : transactionId;
    if (target !== undefined) await state.executor.interrupt(target);
  }

  async approve(
    sessionId: string,
    approvalId: string,
    confirmedDestructive: boolean,
  ): Promise<void> {
    const state = this.#states.get(sessionId);
    if (state === undefined || state.pendingApproval?.id !== approvalId) {
      throw coordinatorError('approval_invalid', 'Approval is no longer pending');
    }
    const pending = state.pendingApproval;
    if (state.actor.snapshot.environment.capabilityEpoch !== pending.environmentEpoch) {
      // H-3: 不提前清空 pendingApproval，让 #finish 通过 hadPendingApproval 判定走强制 takeover 路径。
      this.#emitApprovalTimeline(state, pending, 'cancelled');
      state.runtime?.cancel();
      await this.#finish(state, 'cancelled');
      throw coordinatorError('approval_invalid', 'Approval environment is no longer current');
    }
    if (pending.level === 'destructive' && !confirmedDestructive) {
      throw coordinatorError('approval_invalid', 'Destructive confirmation is required');
    }
    const grant = state.gateway.createApproval({
      toolCallId: pending.toolCallId,
      commands: [
        {
          command: pending.approvalTarget,
          level: pending.level,
          reasons: pending.reasons,
        },
      ],
    });
    this.#repositories.saveApprovalGrant(grant);
    this.#audit?.record({
      actor: { kind: 'user' },
      sessionId,
      taskId: state.task.id,
      type: 'approval.granted',
      payload: {
        approvalId,
        grantId: grant.id,
        commandHash: hashCommand(pending.approvalTarget),
        risk: pending.level,
        confirmedDestructive,
      },
    });
    state.wrapper.setGrant(grant);
    state.pendingApproval = undefined;
    this.#emitApprovalTimeline(state, pending, 'completed');
    this.#transitionTurn(state, 'running');
    const runtime = state.runtime;
    if (runtime === undefined) {
      throw coordinatorError('approval_invalid', 'Agent Runtime cannot resume this approval');
    }
    const run = this.#resumeModel(state, runtime);
    this.#track(run);
  }

  async takeover(sessionId: string): Promise<void> {
    const state = this.#states.get(sessionId);
    if (state === undefined) return;
    if (state.pendingApproval !== undefined) {
      const pending = state.pendingApproval;
      state.pendingApproval = undefined;
      this.#emitApprovalTimeline(state, pending, 'cancelled');
      this.#audit?.record({
        actor: { kind: 'user' },
        sessionId,
        taskId: state.task.id,
        type: 'approval.rejected',
        payload: { approvalId: pending.id },
      });
    }
    state.runtime?.cancel();
    await state.actor.takeoverUser();
    this.#audit?.record({
      actor: { kind: 'user' },
      sessionId,
      taskId: state.task.id,
      type: 'session.takeover',
      payload: {},
    });
    await this.#finish(state, 'cancelled');
  }

  disconnectUi(): void {
    for (const state of this.#states.values()) state.runtime?.disconnectUi();
  }

  async idle(): Promise<void> {
    while (this.#runs.size > 0) await Promise.all([...this.#runs]);
  }

  async closeAll(): Promise<void> {
    for (const sessionId of [...this.#states.keys()]) await this.cancel(sessionId);
    await this.idle();
  }

  async #runModel(state: AgentState): Promise<void> {
    const initialSnapshot = state.actor.snapshot;
    if (initialSnapshot.executionDialect !== 'observe_only') {
      try {
        await this.#prepareExecution(state);
      } catch (error) {
        await this.#finish(state, 'failed', error instanceof Error ? error.message : String(error));
        return;
      }
    }
    const currentSnapshot = state.actor.snapshot;
    const runtime = new AgentRuntime({
      task: state.task,
      model: state.model.modelId,
      adapter: state.adapter,
      gateway: state.wrapper,
      contextBuilder: this.#contextBuilder,
      initialContext: {
        goal: state.task.goal,
        sessionSummary: buildSessionSummary(currentSnapshot),
        history: state.history,
        ...(state.attachments.length === 0
          ? {}
          : { attachments: state.attachments.map(toAttachmentMetadata) }),
        ...(state.attachments.filter((attachment) => attachment.kind === 'image').length === 0
          ? {}
          : {
              imageParts: state.attachments
                .filter((attachment) => attachment.kind === 'image')
                .map((attachment) => ({
                  type: 'image' as const,
                  mimeType: attachment.mimeType,
                  dataBase64: attachment.dataBase64,
                })),
            }),
      },
      ...(this.#maxTurns === undefined ? {} : { maxTurns: this.#maxTurns }),
      maxOutputTokens: state.model.maxOutputTokens,
      ...(state.turn.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: state.turn.reasoningEffort }),
      maxInputTokens: calculateContextBudget(state.model).inputTokens,
      onTaskChange: (task) => {
        state.task = this.#syncTask(state, task);
      },
      onModelEvent: (event, delivery) =>
        this.#handleModelEvent(state, event, delivery?.replaceAssistantText === true),
      onItem: (item) => this.#persistRuntimeItem(state, item),
      // 被跳过的 call 不会经过 gateway，占位结果需显式推进 ToolCallRecord，
      // 否则记录会停留在 validating（H-13 数据一致性）。
      onSkippedToolResult: (toolCallId, result) =>
        this.#recordToolCallResult(state, toolCallId, result),
    });
    state.runtime = runtime;
    await this.#consumeRuntime(state, runtime, runtime.run());
  }

  async #resumeModel(state: AgentState, runtime: AgentRuntime): Promise<void> {
    await this.#consumeRuntime(state, runtime, runtime.resumeAfterApproval());
  }

  async #consumeRuntime(
    state: AgentState,
    runtime: AgentRuntime,
    run: Promise<Awaited<ReturnType<AgentRuntime['run']>>>,
  ): Promise<void> {
    const result = await run.catch((error: unknown) => ({
      status: 'failed' as const,
      task: state.task,
      answer: '',
      toolResults: [],
      turns: 0,
      error: error instanceof Error ? error.message : String(error),
    }));
    state.task = this.#syncTask(state, result.task);
    if (result.answer.length > 0) {
      state.assistantText = result.answer;
      this.#repositories.saveModelItem(
        createModelItem({
          id: randomUUID(),
          conversationId: state.conversation.id,
          turnId: state.turn.id,
          sequence: state.nextModelSequence++,
          type: 'assistant_text',
          content: result.answer,
        }),
      );
      this.#emitTimeline({
        id: state.assistantTimelineId,
        sessionId: state.task.sessionId,
        kind: 'assistant',
        text: result.answer,
        status: result.status,
        conversationId: state.conversation.id,
        turnId: state.turn.id,
        occurredAt: new Date().toISOString(),
      });
    }
    if (result.status === 'waiting_approval') {
      this.#transitionTurn(state, 'waiting_approval');
      return;
    }
    if (state.runtime === runtime) state.runtime = undefined;
    await this.#finish(state, result.status, result.error);
  }

  async #finish(
    state: AgentState,
    status: Extract<
      AgentTask['status'],
      'completed' | 'failed' | 'cancelled' | 'suspended' | 'waiting_user'
    >,
    error?: string,
  ): Promise<void> {
    if (this.#states.get(state.task.sessionId) !== state) return;
    const hadPendingApproval = state.pendingApproval !== undefined;
    state.pendingApproval = undefined;
    state.activeProbe?.cancel();
    if (state.task.status !== status) {
      state.task = this.#syncTask(state, this.#scheduler.transition(state.task.id, status));
    }
    this.#transitionTurn(state, status);
    this.#audit?.record({
      actor: { kind: 'system' },
      sessionId: state.task.sessionId,
      taskId: state.task.id,
      type: `task.${status}`,
      payload: error === undefined ? {} : { error },
    });
    if (status === 'failed' && error !== undefined) {
      this.#emitTimeline({
        id: randomUUID(),
        sessionId: state.task.sessionId,
        kind: 'system',
        text: `Agent 执行失败：${error}`,
        status: 'failed',
        conversationId: state.conversation.id,
        turnId: state.turn.id,
        occurredAt: new Date().toISOString(),
      });
    }
    if (status === 'cancelled') {
      this.#emitTimeline({
        id: randomUUID(),
        sessionId: state.task.sessionId,
        conversationId: state.conversation.id,
        turnId: state.turn.id,
        kind: 'system',
        text: 'Agent 任务已取消',
        status: 'cancelled',
        occurredAt: new Date().toISOString(),
      });
    }
    const snapshot = state.actor.snapshot;
    if (snapshot.lease.owner.kind === 'agent' && snapshot.lease.owner.taskId === state.task.id) {
      const mustInvalidateEnvironment =
        hadPendingApproval || state.transactionToolCallIds.size > 0 || snapshot.shell !== 'ready';
      if (mustInvalidateEnvironment) {
        await state.actor.takeoverUser();
      } else {
        const released = await state.actor.returnAgentLeaseToUser(
          state.task.id,
          snapshot.lease.epoch,
        );
        if (!released.ok) await state.actor.takeoverUser();
      }
    }
    state.executorSubscription.dispose();
    this.#states.delete(state.task.sessionId);
    this.#onActivityChange({
      sessions: this.#sessions.activeCount,
      agentTasks: this.activeTaskCount,
    });
  }

  /**
   * start() 失败时回滚 #buildAndStartAgentState 已写入的部分数据：
   * - state 已入表（极端路径）：移除 state、取消 runtime、释放 executor 订阅并回滚 Turn；
   * - state 未入表：回滚该会话最新一个 running Turn（如 createAdapter 抛错路径）。
   */
  #rollbackPartialStart(sessionId: string): void {
    const partial = this.#states.get(sessionId);
    if (partial !== undefined) {
      this.#states.delete(sessionId);
      partial.runtime?.cancel();
      partial.executorSubscription.dispose();
      this.#rollbackRunningTurn(partial.turn);
      this.#onActivityChange({
        sessions: this.#sessions.activeCount,
        agentTasks: this.activeTaskCount,
      });
      return;
    }
    const conversation = [...this.#repositories.listAgentConversations(sessionId)]
      .reverse()
      .find((candidate) => candidate.status === 'active');
    if (conversation === undefined) return;
    const turn = [...this.#repositories.listAgentTurns(conversation.id)].at(-1);
    if (turn !== undefined) this.#rollbackRunningTurn(turn);
  }

  #rollbackRunningTurn(turn: AgentTurn): void {
    // waiting_* / suspended → cancelled 分支在当前实现下为防御性死代码：
    // #buildAndStartAgentState 是同步路径，start 失败瞬间 turn 必为 running。
    // 保留该分支以防未来 async 化后出现半成品 waiting turn，但不为其编写白盒测试。
    const target: AgentTurnStatus =
      turn.status === 'running'
        ? 'failed'
        : turn.status === 'waiting_approval' ||
            turn.status === 'waiting_user' ||
            turn.status === 'suspended'
          ? 'cancelled'
          : turn.status;
    if (target === turn.status) return;
    const failed = transitionAgentTurn(turn, target);
    if (failed.ok) this.#repositories.saveAgentTurn(failed.value);
  }

  #emitApprovalTimeline(
    state: AgentState,
    approval: PendingApproval,
    status: 'waiting_approval' | 'completed' | 'cancelled',
  ): void {
    this.#emitTimeline({
      id: approval.id,
      sessionId: state.task.sessionId,
      kind: 'approval',
      text: approval.displayText,
      status,
      risk: approval.level,
      reasons: [...approval.reasons],
      conversationId: state.conversation.id,
      turnId: state.turn.id,
      toolCallId: approval.toolCallId,
      ...(approval.change === undefined ? {} : { change: approval.change }),
      occurredAt: new Date().toISOString(),
    });
  }

  #syncTask(state: AgentState, next: AgentTask): AgentTask {
    const current = this.#scheduler.get(next.id);
    if (current !== undefined && current.status !== next.status) {
      // 终态（如 cancelled）不允许转换；runtime 在 cancel 后仍可能回传 failed/running 等
      // 旧状态。此处兜底捕获非法转换，避免 unhandled rejection 破坏 #consumeRuntime/idle。
      try {
        const transitioned = this.#scheduler.transition(next.id, next.status);
        this.#repositories.saveAgentTask(transitioned);
        return transitioned;
      } catch {
        // 保留 current（已是终态），仅同步 next 的其他字段
        this.#repositories.saveAgentTask(current);
        return current;
      }
    }
    this.#repositories.saveAgentTask(next);
    return next;
  }

  #handleModelEvent(state: AgentState, event: ModelEvent, replaceAssistantText = false): void {
    if (event.type !== 'text_delta') return;
    if (replaceAssistantText) state.assistantText = '';
    state.assistantText += event.delta;
    this.#emitTimeline({
      id: state.assistantTimelineId,
      sessionId: state.task.sessionId,
      kind: 'assistant',
      text: state.assistantText,
      status: 'streaming',
      conversationId: state.conversation.id,
      turnId: state.turn.id,
      occurredAt: new Date().toISOString(),
    });
  }

  #persistRuntimeItem(state: AgentState, item: ModelInputItem): void {
    if ('role' in item) {
      if (item.role !== 'assistant') return;
      this.#repositories.saveModelItem(
        createModelItem({
          id: randomUUID(),
          conversationId: state.conversation.id,
          turnId: state.turn.id,
          sequence: state.nextModelSequence++,
          type: 'assistant_text',
          content: modelContentText(item.content),
        }),
      );
      return;
    }
    if (item.type === 'assistant_tool_call') {
      const persisted = createModelItem({
        id: randomUUID(),
        conversationId: state.conversation.id,
        turnId: state.turn.id,
        sequence: state.nextModelSequence++,
        type: item.type,
        toolCallId: item.toolCallId,
        name: item.name,
        argumentsJson: item.argumentsJson,
      });
      this.#repositories.saveModelItem(persisted);
      this.#emitTimeline({
        id: `tool-call-${item.toolCallId}`,
        sessionId: state.task.sessionId,
        conversationId: state.conversation.id,
        turnId: state.turn.id,
        kind: 'tool',
        toolRole: 'call',
        toolCallId: item.toolCallId,
        text: `${item.name}\n${item.argumentsJson}`,
        status: 'running',
        occurredAt: new Date().toISOString(),
      });
      if (this.#repositories.getToolCall(item.toolCallId) === undefined) {
        let record = createToolCallRecord({
          id: item.toolCallId,
          conversationId: state.conversation.id,
          turnId: state.turn.id,
          name: item.name,
          argumentsJson: item.argumentsJson,
        });
        record = transitionToolCallRecord(record, 'validating');
        this.#repositories.saveToolCall(record);
      }
      return;
    }
    const persisted = createModelItem({
      id: randomUUID(),
      conversationId: state.conversation.id,
      turnId: state.turn.id,
      sequence: state.nextModelSequence++,
      type: item.type,
      toolCallId: item.toolCallId,
      content: item.content,
      isError: item.isError,
    });
    this.#repositories.saveModelItem(persisted);
    this.#emitTimeline({
      id: `tool-result-${item.toolCallId}`,
      sessionId: state.task.sessionId,
      conversationId: state.conversation.id,
      turnId: state.turn.id,
      kind: 'tool',
      toolRole: 'result',
      ...(item.toolCallId === undefined ? {} : { toolCallId: item.toolCallId }),
      text: item.content,
      status: item.isError === true ? 'failed' : 'completed',
      occurredAt: new Date().toISOString(),
    });
  }

  #markToolCallResuming(state: AgentState, toolCallId: string): void {
    state.activeToolCallId = toolCallId;
    const record = this.#repositories.getToolCall(toolCallId);
    if (record?.status === 'waiting_approval') {
      this.#repositories.saveToolCall(transitionToolCallRecord(record, 'running'));
    }
  }

  #recordToolCallResult(state: AgentState, toolCallId: string, result: ToolGatewayResult): void {
    const transactionId = extractTransactionId(result);
    if (transactionId !== undefined) {
      state.transactionToolCallIds.set(transactionId, toolCallId);
    }
    if (state.activeToolCallId === toolCallId) state.activeToolCallId = undefined;
    let record = this.#repositories.getToolCall(toolCallId);
    if (record === undefined) return;
    if (result.ok && isWaitingApproval(result.result)) {
      record = transitionToolCallRecord(record, 'waiting_approval');
      this.#repositories.saveToolCall(record);
      return;
    }
    if (!result.ok) {
      const status = result.recoverable === true ? 'recoverable_error' : 'fatal_error';
      record = transitionToolCallRecord(record, status);
      this.#repositories.saveToolCall(record);
      return;
    }
    if (record.status === 'validating') record = transitionToolCallRecord(record, 'running');
    record = transitionToolCallRecord(record, 'completed');
    this.#repositories.saveToolCall(record);
  }

  async #prepareExecution(state: AgentState): Promise<number> {
    let snapshot = state.actor.snapshot;
    if (snapshot.lease.owner.kind !== 'agent' || snapshot.lease.owner.taskId !== state.task.id) {
      const lease = await state.actor.grantAgentLease(state.task.id, snapshot.lease.epoch);
      if (!lease.ok) {
        throw coordinatorError(
          lease.error === 'lease-unavailable' ? 'lease_unavailable' : 'stale_lease_epoch',
          lease.error,
        );
      }
      snapshot = lease.value;
    }
    state.leaseEpoch = snapshot.lease.epoch;
    if (
      snapshot.shell !== 'ready' ||
      snapshot.environment.verificationStatus !== 'verified' ||
      snapshot.environment.platform === 'unknown' ||
      snapshot.environment.operatingSystem === 'unknown'
    ) {
      const probe = new ShellProbe(state.actor);
      state.activeProbe = probe;
      try {
        const result = await probe.run({
          taskId: state.task.id,
          leaseEpoch: state.leaseEpoch,
        });
        if (result.mode !== 'structured') {
          throw coordinatorError('session_not_ready', `Shell probe failed: ${result.reason}`);
        }
      } finally {
        if (state.activeProbe === probe) state.activeProbe = undefined;
        probe.dispose();
      }
    }
    return state.leaseEpoch;
  }

  #transitionTurn(state: AgentState, status: AgentTurnStatus): void {
    if (state.turn.status === status) return;
    const transition = transitionAgentTurn(state.turn, status);
    if (!transition.ok) throw new Error(transition.error);
    state.turn = transition.value;
    this.#repositories.saveAgentTurn(state.turn);
  }

  #handleExecutorEvent(state: AgentState, event: CommandExecutorEvent): void {
    if (event.type !== 'transaction') return;
    const transactionStatus = event.transaction.status;
    const status = commandTimelineStatus(transactionStatus, event.transaction.exitCode);
    this.#audit?.recordCommand({
      actor: { kind: 'agent', taskId: state.task.id },
      sessionId: state.task.sessionId,
      taskId: state.task.id,
      command: event.transaction.command,
      risk: event.transaction.risk ?? 'unknown',
      ...(event.transaction.approvalGrantId === undefined
        ? {}
        : { grantId: event.transaction.approvalGrantId }),
      status: transactionStatus,
      ...(event.transaction.exitCode === undefined ? {} : { exitCode: event.transaction.exitCode }),
      ...(event.transaction.reason === undefined ? {} : { reason: event.transaction.reason }),
    });
    if (
      transactionStatus !== 'running' &&
      transactionStatus !== 'completed' &&
      transactionStatus !== 'interaction_required' &&
      transactionStatus !== 'interrupted' &&
      transactionStatus !== 'shell_lost' &&
      transactionStatus !== 'protocol_error'
    ) {
      return;
    }
    this.#emitTimeline({
      id: event.transaction.id,
      sessionId: state.task.sessionId,
      kind: 'command',
      text: event.transaction.command,
      status,
      conversationId: state.conversation.id,
      turnId: state.turn.id,
      ...(event.transaction.toolCallId === undefined &&
      state.transactionToolCallIds.get(event.transaction.id) === undefined &&
      state.activeToolCallId === undefined
        ? {}
        : {
            toolCallId:
              event.transaction.toolCallId ??
              state.transactionToolCallIds.get(event.transaction.id) ??
              state.activeToolCallId,
          }),
      occurredAt: new Date().toISOString(),
    });
  }

  #track(run: Promise<void>): void {
    this.#runs.add(run);
    void run.finally(() => this.#runs.delete(run));
  }
}

function chooseModel(
  models: readonly ModelConfiguration[],
  requestedId?: string,
): ModelConfiguration | undefined {
  if (requestedId !== undefined) return models.find((model) => model.id === requestedId);
  return models.find((model) => model.isDefault) ?? models[0];
}

function toAttachmentMetadata(attachment: StagedAgentAttachment): AgentAttachmentMetadata {
  return {
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    kind: attachment.kind,
    ...(attachment.relativePath === undefined ? {} : { relativePath: attachment.relativePath }),
  };
}

function modelContentText(content: string | readonly ModelContentPart[]): string {
  if (typeof content === 'string') return content;
  return content.map((part) => (part.type === 'text' ? part.text : '[图片附件]')).join('');
}

function transitionToolCallRecord(record: ToolCallRecord, status: ToolCallStatus): ToolCallRecord {
  const transition = transitionToolCall(record, status);
  if (!transition.ok) throw new Error(transition.error);
  return transition.value;
}
