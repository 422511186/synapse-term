import {
  transitionAgentTask,
  type AgentTask,
  type AgentTaskStatus,
  type ReasoningEffort,
} from '@synapse-term/domain';

import type { ContextBuildInput, ContextBuilder } from '../context/context-builder.js';
import type {
  ModelAdapter,
  ModelEvent,
  ModelInputItem,
  ModelToolDefinition,
} from '@synapse-term/model-providers';
import { ToolCallAssembler, type AssembledToolCall } from '../tools/tool-call-assembler.js';

export const TERMINAL_MODEL_TOOLS = [
  tool('terminal_observe', 'Observe the bound terminal without changing it.', {
    type: 'object',
    properties: {
      view: { type: 'string', enum: ['screen', 'output'] },
      afterCursor: { type: 'integer', minimum: 0 },
      maxBytes: { type: 'integer', minimum: 1, maximum: 1_048_576 },
    },
    additionalProperties: false,
  }),
  tool('terminal_execute', 'Execute one bounded command in the bound terminal Session.', {
    type: 'object',
    properties: {
      command: { type: 'string', minLength: 1 },
      observationWindowMs: { type: 'integer', minimum: 1, maximum: 3_600_000 },
    },
    required: ['command'],
    additionalProperties: false,
  }),
  tool('terminal_wait', 'Wait for more output or completion of a terminal transaction.', {
    type: 'object',
    properties: {
      transactionId: { type: 'string', minLength: 1 },
      afterCursor: { type: 'integer', minimum: 0 },
      timeoutMs: { type: 'integer', minimum: 1, maximum: 3_600_000 },
    },
    required: ['transactionId'],
    additionalProperties: false,
  }),
  tool('terminal_interrupt', 'Interrupt the active terminal transaction with Ctrl+C.', {
    type: 'object',
    properties: { transactionId: { type: 'string', minLength: 1 } },
    required: ['transactionId'],
    additionalProperties: false,
  }),
  tool('local_list_files', 'List files under the current user home directory.', {
    type: 'object',
    properties: {
      path: { type: 'string' },
      maxDepth: { type: 'integer', minimum: 1, maximum: 64 },
      maxResults: { type: 'integer', minimum: 1, maximum: 10_000 },
    },
    additionalProperties: false,
  }),
  tool('local_search_files', 'Search file names or text under the current user home directory.', {
    type: 'object',
    properties: {
      path: { type: 'string' },
      query: { type: 'string', minLength: 1 },
      mode: { type: 'string', enum: ['filename', 'content'] },
      maxDepth: { type: 'integer', minimum: 1, maximum: 64 },
      maxResults: { type: 'integer', minimum: 1, maximum: 10_000 },
      maxBytes: { type: 'integer', minimum: 1, maximum: 67_108_864 },
      timeoutMs: { type: 'integer', minimum: 1, maximum: 60_000 },
    },
    required: ['query', 'mode'],
    additionalProperties: false,
  }),
  tool('local_read_file', 'Read a bounded local text file under the current user home directory.', {
    type: 'object',
    properties: {
      path: { type: 'string', minLength: 1 },
      startLine: { type: 'integer', minimum: 1 },
      endLine: { type: 'integer', minimum: 1 },
      maxBytes: { type: 'integer', minimum: 1, maximum: 4_194_304 },
    },
    required: ['path'],
    additionalProperties: false,
  }),
  tool('local_write_file', 'Create or atomically replace a local text file.', {
    type: 'object',
    properties: {
      path: { type: 'string', minLength: 1 },
      mode: { type: 'string', enum: ['create', 'replace'] },
      content: { type: 'string' },
      expectedSha256: { type: 'string' },
    },
    required: ['path', 'mode', 'content'],
    additionalProperties: false,
  }),
  tool('local_edit_file', 'Atomically apply exact text edits to a local file.', {
    type: 'object',
    properties: {
      path: { type: 'string', minLength: 1 },
      expectedSha256: { type: 'string' },
      edits: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            oldText: { type: 'string', minLength: 1 },
            newText: { type: 'string' },
            replaceAll: { type: 'boolean' },
          },
          required: ['oldText', 'newText'],
          additionalProperties: false,
        },
      },
    },
    required: ['path', 'expectedSha256', 'edits'],
    additionalProperties: false,
  }),
] as const satisfies readonly ModelToolDefinition[];

export const COMPLETION_REVIEW_PROMPT = `完成性复核（内部）：对照最初目标与全部 Tool Call/Result，不采信或引用候选答案。若有子目标缺少成功证据、仍在运行或结果不确定，立即调用现有 Tool 补全且不要输出结论；仅当全部目标均有证据时，不调用 Tool，并输出完整、自包含的最终答复，直接重述决定性证据、结论与必要限制。候选答案不会展示给用户；不得引用“候选答案”“上一条/前述答复或报告”，也不得仅说“无需修正”或“沿用原答案”。`;

export interface RuntimeToolGateway {
  call(
    name: string,
    argumentsValue: unknown,
  ): Promise<
    | { ok: true; result: unknown }
    | { ok: false; error: string; message?: string; recoverable?: boolean }
  >;
  callWithContext?(
    name: string,
    argumentsValue: unknown,
    context: { toolCallId: string; signal?: AbortSignal },
  ): ReturnType<RuntimeToolGateway['call']>;
}

export interface AgentRuntimeOptions {
  task: AgentTask;
  model: string;
  adapter: ModelAdapter;
  gateway: RuntimeToolGateway;
  contextBuilder: ContextBuilder;
  initialContext: ContextBuildInput;
  maxTurns?: number;
  maxToolCalls?: number;
  maxActiveDurationMs?: number;
  maxRepeatedNoProgress?: number;
  maxCompletionReviews?: number;
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
  maxInputTokens?: number;
  onTaskChange?: (task: AgentTask) => void;
  onModelEvent?: (event: ModelEvent, delivery?: { replaceAssistantText?: boolean }) => void;
  onItem?: (item: ModelInputItem) => void;
}

export interface AgentRuntimeResult {
  status: Extract<
    AgentTaskStatus,
    'completed' | 'waiting_approval' | 'waiting_user' | 'suspended' | 'failed' | 'cancelled'
  >;
  task: AgentTask;
  answer: string;
  toolResults: unknown[];
  turns: number;
  error?: string;
}

interface ApprovalCheckpoint {
  items: ModelInputItem[];
  toolResults: unknown[];
  answer: string;
  turn: number;
  calls: AssembledToolCall[];
  toolCallCount: number;
  completionReviewCount: number;
  hasUsedTool: boolean;
}

type CallOutcome =
  { kind: 'continue' } | { kind: 'paused'; result: AgentRuntimeResult } | { kind: 'completed' };

export class AgentRuntime {
  readonly #options: AgentRuntimeOptions;
  readonly #controller = new AbortController();
  readonly #maxTurns: number;
  readonly #maxToolCalls: number;
  readonly #maxActiveDurationMs: number;
  readonly #maxRepeatedNoProgress: number;
  readonly #maxCompletionReviews: number;
  readonly #maxInputTokens: number;
  #task: AgentTask;
  #runPromise: Promise<AgentRuntimeResult> | undefined;
  #cancelRequested = false;
  #disconnectRequested = false;
  #toolActive = false;
  #approvalCheckpoint: ApprovalCheckpoint | undefined;
  #activeDurationMs = 0;
  #durationExceeded = false;
  #lastProgressSignature: string | undefined;
  #repeatedNoProgress = 0;
  #lastUnavailableCallSignature: string | undefined;

  constructor(options: AgentRuntimeOptions) {
    this.#options = options;
    this.#task = structuredClone(options.task);
    this.#maxTurns = options.maxTurns ?? 24;
    this.#maxToolCalls = options.maxToolCalls ?? 40;
    this.#maxActiveDurationMs = options.maxActiveDurationMs ?? 15 * 60_000;
    this.#maxRepeatedNoProgress = options.maxRepeatedNoProgress ?? 3;
    this.#maxCompletionReviews = options.maxCompletionReviews ?? 3;
    this.#maxInputTokens = options.maxInputTokens ?? 32_000;
    if (!Number.isInteger(this.#maxTurns) || this.#maxTurns < 1) {
      throw new RangeError('maxTurns must be a positive integer');
    }
    if (!Number.isInteger(this.#maxToolCalls) || this.#maxToolCalls < 1) {
      throw new RangeError('maxToolCalls must be a positive integer');
    }
    if (!Number.isInteger(this.#maxActiveDurationMs) || this.#maxActiveDurationMs < 1) {
      throw new RangeError('maxActiveDurationMs must be a positive integer');
    }
    if (!Number.isInteger(this.#maxRepeatedNoProgress) || this.#maxRepeatedNoProgress < 1) {
      throw new RangeError('maxRepeatedNoProgress must be a positive integer');
    }
    if (!Number.isInteger(this.#maxCompletionReviews) || this.#maxCompletionReviews < 1) {
      throw new RangeError('maxCompletionReviews must be a positive integer');
    }
    if (!Number.isInteger(this.#maxInputTokens) || this.#maxInputTokens < 32) {
      throw new RangeError('maxInputTokens must be an integer of at least 32');
    }
  }

  run(): Promise<AgentRuntimeResult> {
    this.#runPromise ??= this.#runTimed();
    return this.#runPromise;
  }

  resumeAfterApproval(): Promise<AgentRuntimeResult> {
    const checkpoint = this.#approvalCheckpoint;
    if (checkpoint === undefined || this.#task.status !== 'waiting_approval') {
      return Promise.reject(new Error('Agent Runtime has no pending approval checkpoint'));
    }
    this.#approvalCheckpoint = undefined;
    this.#runPromise = this.#runTimed(checkpoint);
    return this.#runPromise;
  }

  cancel(): void {
    this.#cancelRequested = true;
    this.#controller.abort();
  }

  disconnectUi(): void {
    this.#disconnectRequested = true;
    if (!this.#toolActive) this.#controller.abort();
  }

  get task(): AgentTask {
    return structuredClone(this.#task);
  }

  async #runTimed(checkpoint?: ApprovalCheckpoint): Promise<AgentRuntimeResult> {
    const remaining = this.#maxActiveDurationMs - this.#activeDurationMs;
    if (remaining <= 0) {
      return this.#finish(
        'failed',
        checkpoint?.answer ?? '',
        checkpoint?.toolResults ?? [],
        checkpoint?.turn ?? 0,
        'agent_loop_limit_reached: maximum active duration exceeded',
      );
    }
    const startedAt = Date.now();
    const timeout = setTimeout(() => {
      this.#durationExceeded = true;
      this.#controller.abort();
    }, remaining);
    timeout.unref?.();
    try {
      return await this.#run(checkpoint);
    } finally {
      clearTimeout(timeout);
      this.#activeDurationMs += Date.now() - startedAt;
    }
  }

  async #run(checkpoint?: ApprovalCheckpoint): Promise<AgentRuntimeResult> {
    if (this.#task.status !== 'running') this.#setStatus('running');
    const built =
      checkpoint === undefined
        ? this.#options.contextBuilder.build(this.#options.initialContext)
        : undefined;
    const items = checkpoint === undefined ? [...built!.items] : structuredClone(checkpoint.items);
    const toolResults = checkpoint === undefined ? [] : structuredClone(checkpoint.toolResults);
    let answer = checkpoint?.answer ?? '';
    let toolCallCount = checkpoint?.toolCallCount ?? 0;
    let completionReviewCount = checkpoint?.completionReviewCount ?? 0;
    let hasUsedTool = checkpoint?.hasUsedTool ?? toolCallCount > 0;
    let completionReviewItemStart: number | undefined;
    let firstTurn = 1;

    if (checkpoint !== undefined) {
      const outcome = await this.#executeCalls(
        checkpoint.calls,
        checkpoint.turn,
        items,
        toolResults,
        answer,
        toolCallCount,
        completionReviewCount,
        hasUsedTool,
      );
      if (outcome.kind === 'paused') return outcome.result;
      toolCallCount += checkpoint.calls.length;
      answer = '';
      firstTurn = checkpoint.turn + 1;
    }

    for (let turn = firstTurn; turn <= this.#maxTurns; turn += 1) {
      if (this.#durationExceeded) {
        return this.#finish(
          'failed',
          answer,
          toolResults,
          turn - 1,
          'agent_loop_limit_reached: maximum active duration exceeded',
        );
      }
      if (this.#cancelRequested) return this.#finish('cancelled', answer, toolResults, turn - 1);
      if (this.#disconnectRequested)
        return this.#finish('suspended', answer, toolResults, turn - 1);

      const assembler = new ToolCallAssembler();
      const calls: AssembledToolCall[] = [];
      let providerError: string | undefined;
      let turnText = '';
      const isCompletionReview = completionReviewItemStart !== undefined;
      const deferModelEvents = hasUsedTool;
      const modelEvents: ModelEvent[] = [];
      try {
        const requestContext = this.#options.contextBuilder.fitModelItems(
          items,
          this.#maxInputTokens,
        );
        for await (const event of this.#options.adapter.stream(
          {
            model: this.#options.model,
            items: requestContext.items,
            tools: TERMINAL_MODEL_TOOLS,
            ...(this.#options.maxOutputTokens === undefined
              ? {}
              : { maxOutputTokens: this.#options.maxOutputTokens }),
            ...(this.#options.reasoningEffort === undefined
              ? {}
              : { reasoningEffort: this.#options.reasoningEffort }),
          },
          this.#controller.signal,
        )) {
          if (deferModelEvents) modelEvents.push(event);
          else this.#options.onModelEvent?.(event);
          if (event.type === 'text_delta') turnText += event.delta;
          if (event.type.startsWith('tool_call_')) {
            const call = assembler.accept(
              event as Extract<ModelEvent, { type: `tool_call_${string}` }>,
            );
            if (call !== undefined) calls.push(call);
          }
          if (event.type === 'provider_error') {
            providerError = `${event.code}: ${event.message}`;
            break;
          }
        }
      } catch (error) {
        if (this.#cancelRequested) return this.#finish('cancelled', answer, toolResults, turn);
        if (this.#disconnectRequested) return this.#finish('suspended', answer, toolResults, turn);
        if (this.#durationExceeded) {
          return this.#finish(
            'failed',
            answer,
            toolResults,
            turn,
            'agent_loop_limit_reached: maximum active duration exceeded',
          );
        }
        providerError = error instanceof Error ? error.message : String(error);
      }
      if (this.#durationExceeded) {
        return this.#finish(
          'failed',
          answer,
          toolResults,
          turn,
          'agent_loop_limit_reached: maximum active duration exceeded',
        );
      }
      if (providerError !== undefined) {
        return this.#finish('failed', answer, toolResults, turn, providerError);
      }
      if (isCompletionReview) {
        items.splice(completionReviewItemStart!);
        completionReviewItemStart = undefined;
      }
      if (calls.length === 0) {
        if (hasUsedTool && !isCompletionReview) {
          if (completionReviewCount >= this.#maxCompletionReviews) {
            return this.#finish(
              'failed',
              answer,
              toolResults,
              turn,
              'agent_completion_review_limit_reached: maximum completion reviews exceeded',
            );
          }
          completionReviewCount += 1;
          completionReviewItemStart = items.length;
          items.push({ role: 'user', content: COMPLETION_REVIEW_PROMPT });
          continue;
        }
        if (isCompletionReview) {
          if (turnText.trim().length === 0) {
            return this.#finish(
              'failed',
              answer,
              toolResults,
              turn,
              'agent_completion_review_failed: reviewer returned an empty final answer',
            );
          }
          let replaceAssistantText = true;
          for (const event of modelEvents) {
            this.#options.onModelEvent?.(
              event,
              event.type === 'text_delta' && replaceAssistantText
                ? { replaceAssistantText: true }
                : undefined,
            );
            if (event.type === 'text_delta') replaceAssistantText = false;
          }
        }
        answer = turnText;
        return this.#finish('completed', answer, toolResults, turn);
      }
      if (toolCallCount + calls.length > this.#maxToolCalls) {
        return this.#finish(
          'failed',
          answer,
          toolResults,
          turn,
          'agent_loop_limit_reached: maximum tool calls exceeded',
        );
      }

      if (turnText.length > 0 && !deferModelEvents) {
        const item = { role: 'assistant' as const, content: turnText };
        items.push(item);
        this.#options.onItem?.(structuredClone(item));
      }
      for (const call of calls) {
        const item = {
          type: 'assistant_tool_call',
          toolCallId: call.id,
          name: call.name,
          argumentsJson: JSON.stringify(call.arguments),
        } as const;
        items.push(item);
        this.#options.onItem?.(structuredClone(item));
      }
      hasUsedTool = true;
      const outcome = await this.#executeCalls(
        calls,
        turn,
        items,
        toolResults,
        answer,
        toolCallCount,
        completionReviewCount,
        hasUsedTool,
      );
      if (outcome.kind === 'paused') return outcome.result;
      toolCallCount += calls.length;
      answer = '';
    }
    return this.#finish(
      'failed',
      answer,
      toolResults,
      this.#maxTurns,
      'agent_loop_limit_reached: maximum model runs exceeded',
    );
  }

  async #executeCalls(
    calls: readonly AssembledToolCall[],
    turn: number,
    items: ModelInputItem[],
    toolResults: unknown[],
    answer: string,
    toolCallCount: number,
    completionReviewCount: number,
    hasUsedTool: boolean,
  ): Promise<CallOutcome> {
    for (let index = 0; index < calls.length; index += 1) {
      const call = calls[index]!;
      if (this.#cancelRequested) {
        return { kind: 'paused', result: this.#finish('cancelled', answer, toolResults, turn) };
      }
      const callSignature = stableJson({ name: call.name, arguments: call.arguments });
      if (this.#lastUnavailableCallSignature === callSignature) {
        const repeatedResult = {
          ok: false as const,
          error: 'repeated_command_without_new_evidence',
          message:
            'repeated command without new evidence: the same unavailable command was not retried',
        };
        toolResults.push(repeatedResult);
        const item = {
          type: 'tool_result' as const,
          toolCallId: call.id,
          content: JSON.stringify(repeatedResult),
          isError: true,
        };
        items.push(item);
        this.#options.onItem?.(structuredClone(item));
        return {
          kind: 'paused',
          result: this.#finish('failed', answer, toolResults, turn, repeatedResult.message),
        };
      }
      if (this.#lastUnavailableCallSignature !== undefined) {
        this.#lastUnavailableCallSignature = undefined;
      }
      this.#toolActive = true;
      let result: Awaited<ReturnType<RuntimeToolGateway['call']>>;
      try {
        result = await (this.#options.gateway.callWithContext?.(call.name, call.arguments, {
          toolCallId: call.id,
          signal: this.#controller.signal,
        }) ?? this.#options.gateway.call(call.name, call.arguments));
      } finally {
        this.#toolActive = false;
      }
      if (!result.ok) {
        if (isCommandUnavailableError(result)) {
          this.#lastUnavailableCallSignature = callSignature;
        }
        const content = JSON.stringify({ error: result.error, message: result.message });
        toolResults.push(result);
        const item = { type: 'tool_result' as const, toolCallId: call.id, content, isError: true };
        items.push(item);
        this.#options.onItem?.(structuredClone(item));
        if (this.#recordNoProgress(call, result)) {
          return {
            kind: 'paused',
            result: this.#finish(
              'failed',
              answer,
              toolResults,
              turn,
              'agent_loop_limit_reached: repeated tool call made no progress',
            ),
          };
        }
        if (result.recoverable === true) {
          if (result.error === 'terminal_busy') continue;
          return { kind: 'continue' };
        }
        return {
          kind: 'paused',
          result: this.#finish('failed', answer, toolResults, turn, result.message ?? result.error),
        };
      }
      if (this.#cancelRequested) {
        toolResults.push(result);
        return { kind: 'paused', result: this.#finish('cancelled', answer, toolResults, turn) };
      }
      if (isCommandUnavailableResult(result.result)) {
        const unavailableResult = {
          ok: false as const,
          error: 'command_not_found',
          message: commandUnavailableMessage(result.result),
          recoverable: true as const,
        };
        this.#lastUnavailableCallSignature = callSignature;
        toolResults.push(unavailableResult);
        const item = {
          type: 'tool_result' as const,
          toolCallId: call.id,
          content: JSON.stringify(unavailableResult),
          isError: true,
        };
        items.push(item);
        this.#options.onItem?.(structuredClone(item));
        return { kind: 'continue' };
      }
      const status = resultStatus(result.result);
      if (status === 'waiting_approval') {
        this.#approvalCheckpoint = {
          items: structuredClone(items),
          toolResults: structuredClone(toolResults),
          answer,
          turn,
          calls: structuredClone(calls.slice(index)),
          toolCallCount,
          completionReviewCount,
          hasUsedTool,
        };
        return {
          kind: 'paused',
          result: this.#finish('waiting_approval', answer, [...toolResults, result], turn),
        };
      }
      toolResults.push(result);
      const item = {
        type: 'tool_result',
        toolCallId: call.id,
        content: JSON.stringify(result),
        isError: false,
      } as const;
      items.push(item);
      this.#options.onItem?.(structuredClone(item));
      if (this.#recordNoProgress(call, result)) {
        return {
          kind: 'paused',
          result: this.#finish(
            'failed',
            answer,
            toolResults,
            turn,
            'agent_loop_limit_reached: repeated tool call made no progress',
          ),
        };
      }
      if (this.#durationExceeded) {
        return {
          kind: 'paused',
          result: this.#finish(
            'failed',
            answer,
            toolResults,
            turn,
            'agent_loop_limit_reached: maximum active duration exceeded',
          ),
        };
      }
      if (status === 'interaction_required') {
        return {
          kind: 'paused',
          result: this.#finish('waiting_user', answer, toolResults, turn),
        };
      }
      if (this.#disconnectRequested) {
        return {
          kind: 'paused',
          result: this.#finish('suspended', answer, toolResults, turn),
        };
      }
    }
    return { kind: 'completed' };
  }

  #recordNoProgress(
    call: AssembledToolCall,
    result: Awaited<ReturnType<RuntimeToolGateway['call']>>,
  ): boolean {
    const signature = stableJson({ name: call.name, arguments: call.arguments, result });
    if (signature === this.#lastProgressSignature) this.#repeatedNoProgress += 1;
    else {
      this.#lastProgressSignature = signature;
      this.#repeatedNoProgress = 1;
    }
    return this.#repeatedNoProgress >= this.#maxRepeatedNoProgress;
  }

  #setStatus(status: AgentTaskStatus): void {
    const transition = transitionAgentTask(this.#task, status);
    if (!transition.ok) throw new Error(transition.error);
    this.#task = transition.value;
    this.#options.onTaskChange?.(structuredClone(this.#task));
  }

  #finish(
    status: Extract<
      AgentTaskStatus,
      'completed' | 'waiting_approval' | 'waiting_user' | 'suspended' | 'failed' | 'cancelled'
    >,
    answer: string,
    toolResults: unknown[],
    turns: number,
    error?: string,
  ): AgentRuntimeResult {
    if (this.#task.status !== status) this.#setStatus(status);
    return {
      status,
      task: structuredClone(this.#task),
      answer,
      toolResults: structuredClone(toolResults),
      turns,
      ...(error === undefined ? {} : { error }),
    };
  }
}

function tool(
  name: string,
  description: string,
  inputSchema: Record<string, unknown>,
): ModelToolDefinition {
  return { name, description, inputSchema };
}

function resultStatus(result: unknown): string | undefined {
  if (typeof result !== 'object' || result === null || !('status' in result)) return undefined;
  const status = (result as { status?: unknown }).status;
  return typeof status === 'string' ? status : undefined;
}

function isCommandUnavailableError(result: { error: string; message?: string }): boolean {
  return (
    result.error === 'command_not_found' ||
    /command not found|is not recognized as the name of a cmdlet/i.test(result.message ?? '')
  );
}

function isCommandUnavailableResult(result: unknown): boolean {
  if (typeof result !== 'object' || result === null) return false;
  const transaction = (result as { transaction?: unknown }).transaction;
  const exitCode =
    typeof transaction === 'object' && transaction !== null
      ? (transaction as { exitCode?: unknown }).exitCode
      : undefined;
  const output = (result as { output?: unknown }).output;
  const text =
    typeof output === 'object' && output !== null ? (output as { text?: unknown }).text : undefined;
  return (
    (exitCode === 127 && typeof text === 'string') ||
    (typeof text === 'string' &&
      /command not found|is not recognized as the name of a cmdlet/i.test(text))
  );
}

function commandUnavailableMessage(result: unknown): string {
  if (typeof result === 'object' && result !== null) {
    const output = (result as { output?: unknown }).output;
    if (typeof output === 'object' && output !== null) {
      const text = (output as { text?: unknown }).text;
      if (typeof text === 'string' && text.length > 0) return text;
    }
  }
  return 'The command is not available in the current terminal environment';
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? String(value);
}
