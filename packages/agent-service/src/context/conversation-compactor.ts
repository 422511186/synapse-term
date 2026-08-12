import type {
  ConversationCompaction,
  ConversationCompactionGate,
  ConversationCompactionTier,
  ModelItem,
} from '@synapse-term/domain';

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

/**
 * 摘要生产输入（角色收窄后：Compactor 只产摘要记录，不判阈值、不装配 history）。
 *
 * 压缩触发权完全移交 ContextGovernor 三闸门；Compactor 不再重复压缩 Governor
 * 已投影内容。Governor 产新摘要时经 onCompaction 回调交回 coordinator 落盘。
 */
export interface ProduceSummaryInput {
  conversationId: string;
  /** 待压缩项（Governor 投影后的 ModelInputItem[]，已脱敏；Compactor 只读不改源）。 */
  items: readonly ModelInputItem[];
  /** 既有摘要（增量摘要时作为 previousSummary 上下文 + 累计 sourceItemCount 基数）。 */
  existing?: ConversationCompaction;
  /** 摘要 token 预算上限（fitSummary 裁剪目标，超预算的 provider 输出会被拒绝）。 */
  summaryBudgetTokens: number;
  /** provider 回调 maxOutputTokens 上限（与 summaryBudgetTokens 取小值喂给回调）。 */
  maxOutputTokens: number;
  /** 压缩来源闸门（落 ConversationCompaction.gate；默认 'proactive'）。 */
  gate?: ConversationCompactionGate;
  /** 分层压缩层级（落 ConversationCompaction.tier）。 */
  tier?: ConversationCompactionTier;
  /** throughSequence 估算（Governor 传；未传时用 items.length 近似）。 */
  throughSequence?: number;
  createdAt: string;
  /** provider 摘要回调（失败/空/tool-call/超预算走确定性兜底）。 */
  summarize?: ConversationSummaryCallback;
  signal?: AbortSignal;
}

/**
 * 无压缩纯加载输入（为 Governor/Runtime 初始上下文提供既有摘要上下文，不触发压缩）。
 */
export interface LoadHistoryInput {
  /** 持久化的 ModelItem（coordinator 经 listModelItems 取得，含 sequence/turnId）。 */
  items: readonly ModelItem[];
  /** 既有摘要（首轮 undefined；后续从 ConversationCompaction 加载）。 */
  existing?: ConversationCompaction;
}

export interface ConversationCompactionResult {
  /**
   * 摘要记录（durable 持久化）。角色收窄后不再返回 history——
   * 投影由 ContextGovernor 负责，Compactor 不重复压缩 Governor 已投影内容。
   */
  compaction?: ConversationCompaction;
}

export class ConversationCompactionBudgetError extends Error {
  readonly code = 'context_budget_exceeded';

  constructor(maxTokens: number) {
    super(`context_budget_exceeded: summary cannot fit within ${String(maxTokens)} tokens`);
    this.name = 'ConversationCompactionBudgetError';
  }
}

// =============================================================================
// ConversationCompactor（Decision 3：角色收窄为"durable 摘要持久化 + summary 回调"）
// -----------------------------------------------------------------------------
// 现状缺口：原 compact/compactAsync 做"单阈值压缩 + 历史装配"——收到 thresholdTokens
// 后自行判定哪些 turn 压缩、哪些保留，再装配 history 返回。这与 ContextGovernor 的
// 每轮投影职责重叠：Governor 用 spill→分层→三闸门产出 cache-stable 投影，Compactor
// 再做一次阈值压缩会造成"双重压缩"（Governor 投影过的内容被 Compactor 再压一遍）。
//
// 角色收窄后：
//   - produceSummary：只产摘要记录（provider 回调 + 确定性兜底 + fitSummary + 脱敏），
//     不判阈值、不装配 history。是否压缩由 Governor 三闸门决定；Compactor 只在被
//     要求时生产摘要文本 + 持久化记录。
//   - loadHistory：无压缩纯加载，把既有摘要作前缀 system 消息 + throughSequence 之后
//     的增量项转 ModelInputItem，为 Governor 提供初始摘要上下文。
// 两者均不改源 #items（ADR-0018 原件保留精神不变）。
// =============================================================================

export class ConversationCompactor {
  readonly #idFactory: () => string;
  readonly #redactor: SecretRedactor;

  constructor(options: { idFactory?: () => string; redactor?: SecretRedactor } = {}) {
    this.#idFactory = options.idFactory ?? (() => crypto.randomUUID());
    this.#redactor = options.redactor ?? new SecretRedactor();
  }

  /**
   * 产摘要记录（角色收窄：不装配 history、不判阈值）。
   *
   * 流程：provider 回调（失败/空/tool-call/超预算走确定性兜底 summarizeItems）
   * → SecretRedactor 脱敏 → fitSummary 裁到 summaryBudgetTokens → 构造 ConversationCompaction。
   *
   * 透传给 provider 回调的 items 与 previousSummary 均先经 SecretRedactor 脱敏，
   * 保证摘要器拿不到原始密钥（与 #emitItem 脱敏路径一致）。
   */
  async produceSummary(input: ProduceSummaryInput): Promise<ConversationCompactionResult> {
    if (!Number.isInteger(input.summaryBudgetTokens) || input.summaryBudgetTokens < 1) {
      throw new RangeError('summaryBudgetTokens must be a positive integer');
    }
    if (!Number.isInteger(input.maxOutputTokens) || input.maxOutputTokens < 1) {
      throw new RangeError('maxOutputTokens must be a positive integer');
    }

    const previousSummary = input.existing?.summary;
    const previousSummaryRedacted =
      previousSummary === undefined ? undefined : this.#redactor.redact(previousSummary).text;
    // 透传给 provider 回调的 items 先脱敏（原始 items 已由 Governor 脱敏，这里对既有可能
    // 残留的密钥二次兜底；previousSummary 同理脱敏）。
    const redactedItems = input.items.map((item) => redactInput(item, this.#redactor));

    let summary: string | undefined;
    let method: 'provider' | 'deterministic' = 'deterministic';
    const summarize = input.summarize;
    if (summarize !== undefined && !input.signal?.aborted) {
      try {
        const result = await summarize({
          conversationId: input.conversationId,
          ...(previousSummaryRedacted === undefined
            ? {}
            : { previousSummary: previousSummaryRedacted }),
          items: redactedItems,
          maxOutputTokens: Math.min(input.maxOutputTokens, input.summaryBudgetTokens),
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        });
        const candidate = typeof result === 'string' ? result : result.text;
        const hasToolCall = typeof result === 'string' ? false : result.hasToolCall === true;
        // provider 输出必须：非 tool-call、非空、不超预算——否则降级确定性兜底。
        if (
          !hasToolCall &&
          candidate !== undefined &&
          candidate.trim().length > 0 &&
          estimateSummaryTokens(candidate) <= input.summaryBudgetTokens
        ) {
          summary = this.#redactor.redact(candidate).text;
          method = 'provider';
        }
      } catch {
        // Provider 摘要只是上下文增强；失败时继续使用 deterministic evidence。
      }
    }
    summary ??= summarizeItems(previousSummary, redactedItems, this.#redactor);

    // fitSummary 把摘要裁到 summaryBudgetTokens 内（二分搜索头尾保留）。
    const fitted = fitSummary(summary, input.summaryBudgetTokens);
    const throughSequence = input.throughSequence ?? input.items.length;
    const estimatedBefore = estimateModelItemsTokens([
      ...(previousSummary === undefined
        ? []
        : [{ role: 'system' as const, content: summaryContent(previousSummary) }]),
      ...input.items,
    ]);
    const compaction: ConversationCompaction = {
      id: this.#idFactory(),
      conversationId: input.conversationId,
      throughSequence,
      summary: fitted,
      sourceItemCount: Math.max(1, (input.existing?.sourceItemCount ?? 0) + input.items.length),
      estimatedTokensBefore: Math.max(1, estimatedBefore),
      createdAt: input.createdAt,
      summaryMethod: method,
      ...(input.gate === undefined ? {} : { gate: input.gate }),
      ...(input.tier === undefined ? {} : { tier: input.tier }),
      schemaVersion: 1,
    };
    return { compaction };
  }

  /**
   * 无压缩纯加载：把既有摘要作为前缀 system 消息 + throughSequence 之后的增量项
   * 转 ModelInputItem。仅为 Governor/Runtime 初始上下文提供既有摘要上下文，
   * 不触发压缩、不判阈值。压缩由 Governor 每轮三闸门驱动（经 onCompaction 落盘）。
   *
   * 替换原 compactAsync 的"启动前预压缩"调用点：coordinator 不再在 runtime 启动前
   * 触发压缩，只加载既有摘要作初始上下文，压缩交给 Governor 首轮投影按三闸门驱动。
   */
  loadHistory(input: LoadHistoryInput): ModelInputItem[] {
    const existing = input.existing;
    if (existing === undefined) {
      return input.items.map(modelItemToInput);
    }
    // 既有摘要作前缀 system 消息；throughSequence 之后的增量项原样转 ModelInputItem。
    const summaryPrefix: ModelInputItem = {
      role: 'system',
      content: summaryContent(existing.summary),
    };
    const remaining = input.items.filter((item) => item.sequence > existing.throughSequence);
    return [summaryPrefix, ...remaining.map(modelItemToInput)];
  }
}

/**
 * 确定性证据摘要（provider 回调失败的兜底）。
 *
 * 角色收窄后接受 ModelInputItem[]（与 Governor 投影 + provider 回调的输入类型一致），
 * 不再依赖持久化 ModelItem[] 的 sequence/turnId——压缩范围已由 Governor 决定。
 * 每条内容经 SecretRedactor 脱敏后取 ≤240 字 bounded 片段，拼成证据行。
 */
function summarizeItems(
  previous: string | undefined,
  items: readonly ModelInputItem[],
  redactor: SecretRedactor,
): string {
  const lines = items.map((item) => {
    if ('role' in item) {
      const label = item.role === 'user' ? '用户' : item.role === 'assistant' ? 'Agent' : '系统';
      return `${label}：${bounded(contentText(redactContent(item.content, redactor)))}`;
    }
    if (item.type === 'assistant_tool_call') {
      return `工具调用：${item.name} ${bounded(redactor.redact(item.argumentsJson).text)}`;
    }
    return `工具结果${item.isError ? '（错误）' : ''}：${bounded(redactor.redact(item.content).text)}`;
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

/**
 * 持久化 ModelItem → ModelInputItem 转换（loadHistory 用）。
 * 复用与 context-governor.ts modelItemsToInput 一致的映射语义。
 */
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

/** 提取 multipart content 的可读文本（确定性兜底用；图片占位为 [图片附件]）。 */
function contentText(content: string | readonly ModelContentPart[]): string {
  if (typeof content === 'string') return content;
  return content.map((part) => (part.type === 'text' ? part.text : '[图片附件]')).join('\n');
}
