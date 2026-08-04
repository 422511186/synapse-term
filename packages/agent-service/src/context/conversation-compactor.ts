import type { ConversationCompaction, ModelItem } from '@synapse-term/domain';

import { SecretRedactor } from '@synapse-term/infrastructure';
import type { ModelContentPart, ModelInputItem } from '@synapse-term/model-providers';
import { estimateModelItemsTokens } from './token-estimator.js';

const SUMMARY_PREFIX = '对话摘要：\n';
const SUMMARY_TRUNCATION_MARKER = '\n…摘要已截断…\n';

export interface ConversationSummaryRequest {
  conversationId: string;
  previousSummary?: string;
  items: readonly ModelInputItem[];
  maxOutputTokens: number;
  signal?: AbortSignal;
}

export type ConversationSummaryResult =
  string | { text?: string; hasToolCall?: boolean; error?: string };

export type ConversationSummaryCallback = (
  request: ConversationSummaryRequest,
) => Promise<ConversationSummaryResult>;

interface CompactInput {
  conversationId: string;
  items: readonly ModelItem[];
  existing?: ConversationCompaction;
  thresholdTokens: number;
  targetTokens: number;
  createdAt: string;
}

interface AsyncCompactInput extends CompactInput {
  summarize?: ConversationSummaryCallback;
  signal?: AbortSignal;
}

interface CompactionPlan {
  existingSummary: ModelInputItem[];
  remaining: ModelItem[];
  compactedItems: ModelItem[];
  keptItems: ModelItem[];
  summaryBudgetTokens: number;
  throughSequence: number;
  sourceItemCount: number;
  estimatedTokensBefore: number;
  needsCompaction: boolean;
}

export interface ConversationCompactionResult {
  history: ModelInputItem[];
  compaction?: ConversationCompaction;
}

export class ConversationCompactionBudgetError extends Error {
  readonly code = 'context_budget_exceeded';

  constructor(maxTokens: number) {
    super(`context_budget_exceeded: summary cannot fit within ${String(maxTokens)} tokens`);
    this.name = 'ConversationCompactionBudgetError';
  }
}

export class ConversationCompactor {
  readonly #idFactory: () => string;
  readonly #redactor: SecretRedactor;

  constructor(options: { idFactory?: () => string; redactor?: SecretRedactor } = {}) {
    this.#idFactory = options.idFactory ?? (() => crypto.randomUUID());
    this.#redactor = options.redactor ?? new SecretRedactor();
  }

  compact(input: CompactInput): ConversationCompactionResult {
    const plan = this.#plan(input);
    if (!plan.needsCompaction) return { history: this.#history(plan, input.existing?.summary) };
    return this.#finish(
      input,
      plan,
      summarizeItems(input.existing?.summary, plan.compactedItems, this.#redactor),
      'deterministic',
    );
  }

  async compactAsync(input: AsyncCompactInput): Promise<ConversationCompactionResult> {
    const plan = this.#plan(input);
    if (!plan.needsCompaction) return { history: this.#history(plan, input.existing?.summary) };

    let summary: string | undefined;
    let method: 'provider' | 'deterministic' = 'deterministic';
    const summarize = input.summarize;
    if (summarize !== undefined && plan.summaryBudgetTokens > 0 && !input.signal?.aborted) {
      try {
        const result = await summarize({
          conversationId: input.conversationId,
          ...(input.existing?.summary === undefined
            ? {}
            : { previousSummary: this.#redactor.redact(input.existing.summary).text }),
          items: plan.compactedItems.map((item) =>
            redactInput(modelItemToInput(item), this.#redactor),
          ),
          maxOutputTokens: plan.summaryBudgetTokens,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        });
        const candidate = typeof result === 'string' ? result : result.text;
        const hasToolCall = typeof result === 'string' ? false : result.hasToolCall === true;
        if (
          !hasToolCall &&
          candidate !== undefined &&
          candidate.trim().length > 0 &&
          estimateSummaryTokens(candidate) <= plan.summaryBudgetTokens
        ) {
          summary = this.#redactor.redact(candidate).text;
          method = 'provider';
        }
      } catch {
        // Provider 摘要只是上下文增强；失败时继续使用 deterministic evidence。
      }
    }
    summary ??= summarizeItems(input.existing?.summary, plan.compactedItems, this.#redactor);
    return this.#finish(input, plan, summary, method);
  }

  #plan(input: CompactInput): CompactionPlan {
    if (!Number.isInteger(input.thresholdTokens) || input.thresholdTokens < 1) {
      throw new RangeError('thresholdTokens must be a positive integer');
    }
    if (!Number.isInteger(input.targetTokens) || input.targetTokens < 1) {
      throw new RangeError('targetTokens must be a positive integer');
    }
    const remaining = input.items.filter(
      (item) => input.existing === undefined || item.sequence > input.existing.throughSequence,
    );
    const existingSummary =
      input.existing === undefined
        ? []
        : [{ role: 'system' as const, content: summaryContent(input.existing.summary) }];
    const exact = remaining.map(modelItemToInput);
    if (estimateModelItemsTokens([...existingSummary, ...exact]) <= input.thresholdTokens) {
      return {
        existingSummary,
        remaining,
        compactedItems: [],
        keptItems: remaining,
        summaryBudgetTokens: 0,
        throughSequence: input.existing?.throughSequence ?? 0,
        sourceItemCount: input.existing?.sourceItemCount ?? 0,
        estimatedTokensBefore: estimateModelItemsTokens([...existingSummary, ...exact]),
        needsCompaction: false,
      };
    }

    const turns = groupByTurn(remaining);
    const kept: ModelItem[][] = [];
    const exactTarget = Math.min(input.thresholdTokens, input.targetTokens);
    let keptTokens = 0;
    while (turns.length > 0) {
      const candidate = turns.at(-1)!;
      const candidateTokens = estimateModelItemsTokens(candidate.map(modelItemToInput));
      if (keptTokens + candidateTokens + estimateSummaryTokens('') > exactTarget) break;
      kept.unshift(turns.pop()!);
      keptTokens += candidateTokens;
    }
    let compactedItems = turns.flat();
    if (compactedItems.length === 0 && kept.length > 0) compactedItems = kept.shift()!;
    const keptItems = kept.flat();
    const summaryBudgetTokens = Math.min(
      input.thresholdTokens - estimateModelItemsTokens(keptItems.map(modelItemToInput)),
      input.targetTokens - estimateModelItemsTokens(keptItems.map(modelItemToInput)),
    );
    const throughSequence = compactedItems.at(-1)?.sequence ?? input.existing?.throughSequence ?? 0;
    return {
      existingSummary,
      remaining,
      compactedItems,
      keptItems,
      summaryBudgetTokens,
      throughSequence,
      sourceItemCount: Math.max(1, (input.existing?.sourceItemCount ?? 0) + compactedItems.length),
      estimatedTokensBefore: estimateModelItemsTokens([...existingSummary, ...exact]),
      needsCompaction: true,
    };
  }

  #finish(
    input: CompactInput,
    plan: CompactionPlan,
    rawSummary: string,
    method: 'provider' | 'deterministic',
  ): ConversationCompactionResult {
    const summary = fitSummary(rawSummary, plan.summaryBudgetTokens);
    const history = [
      { role: 'system' as const, content: summaryContent(summary) },
      ...plan.keptItems.map(modelItemToInput),
    ];
    if (estimateModelItemsTokens(history) > input.thresholdTokens) {
      throw new ConversationCompactionBudgetError(input.thresholdTokens);
    }
    const compaction: ConversationCompaction = {
      id: this.#idFactory(),
      conversationId: input.conversationId,
      throughSequence: plan.throughSequence,
      summary,
      sourceItemCount: plan.sourceItemCount,
      estimatedTokensBefore: Math.max(1, plan.estimatedTokensBefore),
      createdAt: input.createdAt,
      summaryMethod: method,
    };
    return { history, compaction };
  }

  #history(plan: CompactionPlan, existingSummary: string | undefined): ModelInputItem[] {
    const history: ModelInputItem[] = [
      ...(existingSummary === undefined
        ? []
        : [{ role: 'system' as const, content: summaryContent(existingSummary) }]),
      ...plan.keptItems.map(modelItemToInput),
    ];
    return history;
  }
}

function groupByTurn(items: readonly ModelItem[]): ModelItem[][] {
  const groups: ModelItem[][] = [];
  for (const item of items) {
    const current = groups.at(-1);
    if (current === undefined || current[0]?.turnId !== item.turnId) groups.push([item]);
    else current.push(item);
  }
  return groups;
}

function summarizeItems(
  previous: string | undefined,
  items: readonly ModelItem[],
  redactor: SecretRedactor,
): string {
  const lines = items.map((item) => {
    switch (item.type) {
      case 'user_text':
        return `用户：${bounded(redactor.redact(item.content).text)}`;
      case 'assistant_text':
        return `Agent：${bounded(redactor.redact(item.content).text)}`;
      case 'system_text':
        return `系统：${bounded(redactor.redact(item.content).text)}`;
      case 'assistant_tool_call':
        return `工具调用：${item.name} ${bounded(redactor.redact(item.argumentsJson).text)}`;
      case 'tool_result':
        return `工具结果${item.isError ? '（错误）' : ''}：${bounded(redactor.redact(item.content).text)}`;
    }
  });
  const previousLine =
    previous === undefined ? [] : [`既有摘要：${redactor.redact(previous).text}`];
  return [...previousLine, ...lines].join('\n').trim();
}

function fitSummary(value: string, budgetTokens: number): string {
  if (!Number.isInteger(budgetTokens) || budgetTokens < 1) {
    throw new ConversationCompactionBudgetError(budgetTokens);
  }
  const normalized = value.replaceAll(/\s+/g, ' ').trim();
  if (estimateSummaryTokens(normalized) <= budgetTokens) return normalized;
  let low = 1;
  let high = Math.max(1, normalized.length);
  let best = '';
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = boundedHeadTail(normalized, middle);
    if (estimateSummaryTokens(candidate) <= budgetTokens) {
      best = candidate;
      low = middle + 1;
    } else high = middle - 1;
  }
  if (best.length === 0) throw new ConversationCompactionBudgetError(budgetTokens);
  return best;
}

function boundedHeadTail(value: string, maxCharacters: number): string {
  if (value.length <= maxCharacters) return value;
  const markerLength = SUMMARY_TRUNCATION_MARKER.length;
  if (maxCharacters <= markerLength + 2) return value.slice(0, maxCharacters);
  const remaining = maxCharacters - markerLength;
  const headLength = Math.ceil(remaining / 2);
  return `${value.slice(0, headLength)}${SUMMARY_TRUNCATION_MARKER}${value.slice(-Math.floor(remaining / 2))}`;
}

function estimateSummaryTokens(summary: string): number {
  return estimateModelItemsTokens([{ role: 'system', content: summaryContent(summary) }]);
}

function summaryContent(summary: string): string {
  return `${SUMMARY_PREFIX}${summary}`;
}

function bounded(value: string): string {
  return value.replaceAll(/\s+/g, ' ').trim().slice(0, 240);
}

function modelItemToInput(item: ModelItem): ModelInputItem {
  switch (item.type) {
    case 'system_text':
      return { role: 'system', content: item.content };
    case 'user_text':
      return { role: 'user', content: item.content };
    case 'assistant_text':
      return { role: 'assistant', content: item.content };
    case 'assistant_tool_call':
      return {
        type: item.type,
        toolCallId: item.toolCallId,
        name: item.name,
        argumentsJson: item.argumentsJson,
      };
    case 'tool_result':
      return {
        type: item.type,
        toolCallId: item.toolCallId,
        content: item.content,
        isError: item.isError,
      };
  }
}

function redactInput(item: ModelInputItem, redactor: SecretRedactor): ModelInputItem {
  if ('role' in item) return { ...item, content: redactContent(item.content, redactor) };
  if (item.type === 'tool_result') return { ...item, content: redactor.redact(item.content).text };
  return { ...item, argumentsJson: redactor.redact(item.argumentsJson).text };
}

function redactContent(
  content: string | readonly ModelContentPart[],
  redactor: SecretRedactor,
): string | readonly ModelContentPart[] {
  if (typeof content === 'string') return redactor.redact(content).text;
  return content.map((part) =>
    part.type === 'text' ? { ...part, text: redactor.redact(part.text).text } : part,
  );
}
