import type { ConversationCompaction, ModelItem } from '@terminal-agent/domain';

import type { ModelInputItem } from './model-adapter.js';
import { SecretRedactor } from './secret-protection.js';
import { estimateModelItemsTokens } from './token-estimator.js';

export class ConversationCompactor {
  readonly #idFactory: () => string;
  readonly #redactor: SecretRedactor;

  constructor(options: { idFactory?: () => string; redactor?: SecretRedactor } = {}) {
    this.#idFactory = options.idFactory ?? (() => crypto.randomUUID());
    this.#redactor = options.redactor ?? new SecretRedactor();
  }

  compact(input: {
    conversationId: string;
    items: readonly ModelItem[];
    existing?: ConversationCompaction;
    thresholdTokens: number;
    targetTokens: number;
    createdAt: string;
  }): { history: ModelInputItem[]; compaction?: ConversationCompaction } {
    const remaining = input.items.filter(
      (item) => input.existing === undefined || item.sequence > input.existing.throughSequence,
    );
    const existingSummary =
      input.existing === undefined
        ? []
        : [{ role: 'system' as const, content: `对话摘要：\n${input.existing.summary}` }];
    const exact = remaining.map(modelItemToInput);
    if (estimateModelItemsTokens([...existingSummary, ...exact]) <= input.thresholdTokens) {
      return { history: [...existingSummary, ...exact] };
    }

    const turns = groupByTurn(remaining);
    const kept: ModelItem[][] = [];
    let keptTokens = 0;
    while (turns.length > 0) {
      const candidate = turns.at(-1)!;
      const candidateTokens = estimateModelItemsTokens(candidate.map(modelItemToInput));
      if (keptTokens + candidateTokens > input.targetTokens) break;
      kept.unshift(turns.pop()!);
      keptTokens += candidateTokens;
    }
    const compactedItems = turns.flat();
    if (compactedItems.length === 0) return { history: [...existingSummary, ...exact] };
    const throughSequence = compactedItems.at(-1)!.sequence;
    const summary = summarizeItems(input.existing?.summary, compactedItems, this.#redactor);
    const compaction: ConversationCompaction = {
      id: this.#idFactory(),
      conversationId: input.conversationId,
      throughSequence,
      summary,
      sourceItemCount: (input.existing?.sourceItemCount ?? 0) + compactedItems.length,
      estimatedTokensBefore: estimateModelItemsTokens([
        ...existingSummary,
        ...remaining.map(modelItemToInput),
      ]),
      createdAt: input.createdAt,
    };
    return {
      history: [
        { role: 'system', content: `对话摘要：\n${summary}` },
        ...kept.flat().map(modelItemToInput),
      ],
      compaction,
    };
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
  return [...(previous === undefined ? [] : [previous]), ...lines].join('\n').slice(-6_000);
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
