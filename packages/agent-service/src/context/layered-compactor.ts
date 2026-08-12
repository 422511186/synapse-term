import type {
  ConversationCompaction,
  ConversationCompactionTier,
  TierClassification,
} from '@synapse-term/domain';
import { SecretRedactor } from '@synapse-term/infrastructure';
import type { ModelInputItem } from '@synapse-term/model-providers';
import { estimateModelItemsTokens } from './token-estimator.js';

// =============================================================================
// LayeredCompactor（Ch37 分层压缩 + Decision 1 cache-stable 投影）
// -----------------------------------------------------------------------------
// 现状缺口：ThreeGate 三闸门按 token 阈值压缩，但不区分 tool_result 的"新旧"——
// 刚产出的结果与 20 轮前的结果同等对待。Ch37 按距离分层：近的保留全量（Tier3）、
// 中老的语义摘要（Tier2）、最老的元数据桩（Tier1），让模型在有限上下文里保留
// 最相关的细节、压缩不相关的旧细节。
//
// 距离定义（design.md）：distance = currentTurn − 该 tool_result 所在 turn 序号。
// - Tier3（dist ≤8）：全量保留（最近活动，模型刚用过或即将用到）。
// - Tier2（dist 9-19）：语义摘要（cap 300 chars），仅当 Tier2 组总 token > 阈 2000
//   才摘要；否则保留全量（不值得付摘要成本）。
//   Tier2 floor 保护内容型工具（local_read_file/local_search_files/local_list_files）
//   ——其结果是 ground truth，永不降级到 Tier2 摘要（始终 Tier3 全量）。
// - Tier1（dist ≥20）：元数据桩（toolCallId + toolName + error 状态），保留 tool_use。
//
// first-touch 分类：首次遇到 toolCallId 时按距离分类并持久化（分类可能调过摘要器，
// 贵），崩溃恢复经 restoreClassifications 重建，MUST NOT 重新分类。
//
// tool_use_id 配对：Tier1 保留 assistant_tool_call（推理轨迹）只桩化 tool_result；
// Tier2 摘要成功时整块（tool_use + result 对）替换为摘要段（不产生孤儿）；
// Tier2 摘要失败退化为 per-item 截断时保留 tool_use 只截断 result。三种路径均不
// 产生孤儿 tool_call/tool_result。
//
// 每 pass 语义尝试上限 2（design.md）：一次 compact() 调用中，Tier2 语义摘要器最多
// 调用 2 次（首次 + 重试一次）；仍失败则整组退化为 per-item 确定性截断（head+tail
// ≤cap），MUST NOT 让摘要器死循环。
//
// 单 pass 语义：本 compactor 是无状态的单次投影工具——给定 items + 既有分类，产出
// 投影 + 新分类 + 新 Tier2 摘要记录。跨 turn 的"已摘要 toolCallId 不重复摘要"由
// Governor 负责（Decision 2/3：Governor 持有持久化摘要段，每轮只把未摘要的 items
// 喂给本 compactor）。
// =============================================================================

/** Tier2 语义摘要生产者：把 Tier2 块产成 ≤cap chars 摘要文本。 */
export type LayeredSummaryProducer = (input: {
  conversationId: string;
  /** Tier2 块（assistant_tool_call + tool_result 对；生产者只读不改源）。 */
  items: readonly ModelInputItem[];
  createdAt: string;
  signal?: AbortSignal;
}) => Promise<string | undefined>;

/** LayeredCompactor.compact 输入。 */
export interface LayeredCompactInput {
  conversationId: string;
  /** 待分层投影（已外溢替换 + 脱敏，compactor 只读不改源 #items）。 */
  items: readonly ModelInputItem[];
  /** 当前 turn 序号（距离 = currentTurn − originTurn）。 */
  currentTurn: number;
  /**
   * toolCallId → 该 tool_result 产出的 turn 序号（计算距离用）。
   * 缺失的 toolCallId 视为 distance=0（保守不降级，Tier3 保留全量）——
   * 不确定来源的结果不冒险摘要，保留全量给模型。
   */
  toolCallTurns?: ReadonlyMap<string, number>;
  /** ISO 时间戳（落 ConversationCompaction.createdAt）。 */
  createdAt: string;
  /** 取消信号（透传给 summaryProducer）。 */
  signal?: AbortSignal;
}

/** LayeredCompactor.compact 输出。 */
export interface LayeredCompactResult {
  /** 分层后的投影（Tier3 全量 + Tier2 段/截断 + Tier1 桩，cache-stable）。 */
  items: ModelInputItem[];
  /** 是否应用了 Tier2/Tier1 变换。 */
  compacted: boolean;
  /** 本轮产出的 Tier2 摘要记录（若有，经 onCompaction 落盘，gate='layered' tier='tier2'）。 */
  tier2Compaction?: ConversationCompaction;
  /** 本轮首次分类的记录（经 onGovernanceState 落盘）。 */
  newClassifications: TierClassification[];
  /** 治理状态是否有未落盘变更（有新分类则 dirty）。 */
  governanceDirty: boolean;
}

export interface LayeredCompactorOptions {
  /** Tier2 语义摘要生产者（未注入或失败时用 per-item 确定性截断）。 */
  summaryProducer?: LayeredSummaryProducer;
  /** token 估算函数（默认 token-estimator）。 */
  estimateTokens?: (items: readonly ModelInputItem[]) => number;
  /** Tier2 语义摘要触发阈值（Tier2 组总 token 超此才摘要；默认 2000）。 */
  tier2ThresholdTokens?: number;
  /** Tier2 摘要字符上限（默认 300）。 */
  tier2SummaryCap?: number;
  /** 每 pass 语义尝试上限（默认 2；超出退化为确定性截断）。 */
  maxSemanticAttempts?: number;
  /** Tier2 floor 保护工具（内容型，永不降级到 Tier2 摘要；默认 3 个 local 工具）。 */
  tier2FloorProtectedTools?: ReadonlySet<string>;
  /** id 工厂（落 ConversationCompaction.id）。 */
  idFactory?: () => string;
  /** 脱敏器（确定性截断用）。 */
  redactor?: SecretRedactor;
}

const TIER2_DEFAULT_THRESHOLD_TOKENS = 2_000;
const TIER2_DEFAULT_SUMMARY_CAP = 300;
const DEFAULT_MAX_SEMANTIC_ATTEMPTS = 2;
const TIER2_SUMMARY_PREFIX = '历史工具摘要：\n';
const TRUNCATION_MARKER = ' … ';

/**
 * Tier2 floor 保护工具（Ch37）：内容型工具的结果是 ground truth，永不降级到
 * Tier2 语义摘要——摘要会丢失文件内容/搜索结果的关键细节，模型需要原样结果。
 * 这些工具的结果始终按 Tier3 全量保留（或由 ToolResultSpiller 单独外溢）。
 */
const DEFAULT_FLOOR_PROTECTED: ReadonlySet<string> = new Set([
  'local_read_file',
  'local_search_files',
  'local_list_files',
]);

/**
 * LayeredCompactor：Ch37 按距离分层压缩。
 *
 * Tier3 全量保留 / Tier2 语义摘要（cap 300，阈 2000，attempt ≤2）/ Tier1 元数据桩。
 * first-touch 分类（持久化，崩溃不重分类）；tool_use_id 配对（不产生孤儿）；
 * Tier2 floor 保护内容型工具。
 */
export class LayeredCompactor {
  readonly #summaryProducer: LayeredSummaryProducer | undefined;
  readonly #estimateTokens: (items: readonly ModelInputItem[]) => number;
  readonly #tier2ThresholdTokens: number;
  readonly #tier2SummaryCap: number;
  readonly #maxSemanticAttempts: number;
  readonly #tier2FloorProtectedTools: ReadonlySet<string>;
  readonly #idFactory: () => string;
  readonly #redactor: SecretRedactor;

  /** first-touch 分类记录（基于 toolCallId，崩溃恢复经 restoreClassifications 重建）。 */
  readonly #classifications = new Map<string, TierClassification>();

  constructor(options: LayeredCompactorOptions = {}) {
    this.#summaryProducer = options.summaryProducer;
    this.#estimateTokens = options.estimateTokens ?? estimateModelItemsTokens;
    this.#tier2ThresholdTokens = options.tier2ThresholdTokens ?? TIER2_DEFAULT_THRESHOLD_TOKENS;
    this.#tier2SummaryCap = options.tier2SummaryCap ?? TIER2_DEFAULT_SUMMARY_CAP;
    this.#maxSemanticAttempts = options.maxSemanticAttempts ?? DEFAULT_MAX_SEMANTIC_ATTEMPTS;
    this.#tier2FloorProtectedTools =
      options.tier2FloorProtectedTools ?? DEFAULT_FLOOR_PROTECTED;
    this.#idFactory = options.idFactory ?? (() => crypto.randomUUID());
    this.#redactor = options.redactor ?? new SecretRedactor();
  }

  /** 获取某 toolCallId 的已分类层级（未分类返回 undefined）。 */
  getClassification(toolCallId: string): TierClassification | undefined {
    return this.#classifications.get(toolCallId);
  }

  /** 所有分类记录（持久化快照用）。 */
  getClassifications(): TierClassification[] {
    return [...this.#classifications.values()];
  }

  /**
   * 崩溃恢复重建分类状态（first-touch：不重新分类）。
   * 持久化的 TierClassification 直接载入；分类可能调过摘要器（贵），重付不可接受。
   */
  restoreClassifications(classifications: readonly TierClassification[]): void {
    this.#classifications.clear();
    for (const c of classifications) {
      this.#classifications.set(c.toolCallId, c);
    }
  }

  /**
   * 分层压缩：按距离 first-touch 分类，Tier2 超阈值时语义摘要（attempt ≤2，失败退化
   * per-item 截断），Tier1 元数据桩。保留 tool_use_id 配对（不产生孤儿）。
   *
   * #items append-only 不被改：投影操作的是新数组，源 #items 不变（ADR-0018 精神）。
   */
  async compact(input: LayeredCompactInput): Promise<LayeredCompactResult> {
    const newClassifications: TierClassification[] = [];
    const toolNameIndex = buildToolNameIndex(input.items);
    const tier2ToolCallIds = new Set<string>();
    const tier1ToolCallIds = new Set<string>();

    // --- 步骤 1：first-touch 分类每个 tool_result ---
    for (const item of input.items) {
      if ('role' in item) continue;
      if (item.type !== 'tool_result') continue;
      const toolCallId = item.toolCallId;
      let classification = this.#classifications.get(toolCallId);
      if (classification === undefined) {
        // 首次遇到：按距离 + floor 保护分类，记录后持久化（崩溃不重分类）
        const toolName = toolNameIndex.get(toolCallId) ?? 'unknown';
        const tier = this.#classify(toolName, this.#distance(input, toolCallId));
        classification = { toolCallId, tier, classifiedAtTurn: input.currentTurn };
        this.#classifications.set(toolCallId, classification);
        newClassifications.push(classification);
      }
      if (classification.tier === 'tier2') tier2ToolCallIds.add(toolCallId);
      else if (classification.tier === 'tier1') tier1ToolCallIds.add(toolCallId);
    }

    // --- 步骤 2：Tier2 语义摘要判定（组 token > 阈值才摘要）---
    const tier2PairItems = collectPairItems(input.items, tier2ToolCallIds);
    const tier2Tokens = this.#estimateTokens(tier2PairItems);
    let tier2SummaryText: string | undefined;
    let tier2Compaction: ConversationCompaction | undefined;
    const tier2Deterministic = new Map<string, string>();

    if (tier2ToolCallIds.size > 0 && tier2Tokens > this.#tier2ThresholdTokens) {
      // Tier2 组超阈值 → 语义摘要（attempt ≤2，成功替换整块为摘要段）
      tier2SummaryText = await this.#produceTier2Summary(input, tier2PairItems);
      if (tier2SummaryText !== undefined) {
        tier2Compaction = {
          id: this.#idFactory(),
          conversationId: input.conversationId,
          throughSequence: input.items.length,
          summary: tier2SummaryText,
          sourceItemCount: tier2PairItems.length,
          estimatedTokensBefore: tier2Tokens,
          createdAt: input.createdAt,
          summaryMethod: 'provider',
          gate: 'layered',
          tier: 'tier2',
          schemaVersion: 1,
        };
      } else {
        // 摘要失败：per-item 确定性截断（保留 tool_use，只截断 result）
        for (const id of tier2ToolCallIds) {
          const resultItem = findResult(input.items, id);
          if (resultItem !== undefined) {
            tier2Deterministic.set(id, this.#deterministicTruncate(resultItem.content));
          }
        }
      }
    }
    // Tier2 组未超阈值：保留全量（不摘要，tier2SummaryText/deterministic 均空）

    // --- 步骤 3：装配投影（Tier1 桩 + Tier2 段/截断 + Tier3 全量）---
    const projection: ModelInputItem[] = [];
    let tier2SegmentEmitted = false;
    for (const item of input.items) {
      if ('role' in item) {
        projection.push(item);
        continue;
      }
      if (item.type === 'assistant_tool_call') {
        // Tier2 摘要成功：整块替换为段，跳过 tool_use（与 result 一起替换，不产生孤儿）
        if (tier2SummaryText !== undefined && tier2ToolCallIds.has(item.toolCallId)) {
          if (!tier2SegmentEmitted) {
            projection.push({ role: 'system', content: `${TIER2_SUMMARY_PREFIX}${tier2SummaryText}` });
            tier2SegmentEmitted = true;
          }
          continue;
        }
        // Tier1 / Tier2-截断 / Tier3：保留 tool_use（推理轨迹 + 配对完整）
        projection.push(item);
        continue;
      }
      // tool_result
      if (tier2SummaryText !== undefined && tier2ToolCallIds.has(item.toolCallId)) {
        // Tier2 段已替换整块：跳过 result（与 tool_use 一起替换）
        continue;
      }
      if (tier2Deterministic.has(item.toolCallId)) {
        // Tier2 截断退化：保留 tool_use，result 截断为 head+tail ≤cap
        projection.push({
          type: 'tool_result',
          toolCallId: item.toolCallId,
          content: tier2Deterministic.get(item.toolCallId)!,
          isError: item.isError,
        });
        continue;
      }
      if (tier1ToolCallIds.has(item.toolCallId)) {
        // Tier1：元数据桩（保留 tool_use，result 桩化为单行）
        const toolName = toolNameIndex.get(item.toolCallId) ?? 'unknown';
        projection.push({
          type: 'tool_result',
          toolCallId: item.toolCallId,
          content: buildTier1Stub(item.toolCallId, toolName, item.isError),
          isError: item.isError,
        });
        continue;
      }
      // Tier3 / 未超阈值 Tier2：全量保留
      projection.push(item);
    }

    const compacted =
      tier2SummaryText !== undefined ||
      tier2Deterministic.size > 0 ||
      tier1ToolCallIds.size > 0;

    return {
      items: projection,
      compacted,
      ...(tier2Compaction === undefined ? {} : { tier2Compaction }),
      newClassifications,
      governanceDirty: newClassifications.length > 0,
    };
  }

  /** 距离 = currentTurn − originTurn（无 origin 信息视为 0，保守不降级）。 */
  #distance(input: LayeredCompactInput, toolCallId: string): number {
    const origin = input.toolCallTurns?.get(toolCallId);
    if (origin === undefined) return 0;
    return Math.max(0, input.currentTurn - origin);
  }

  /**
   * 按距离 + floor 保护分类（first-touch）。
   * - floor 保护工具（内容型）→ 永远 tier3（结果是 ground truth，不摘要）。
   * - dist ≤8 → tier3；dist 9-19 → tier2；dist ≥20 → tier1。
   */
  #classify(toolName: string, distance: number): ConversationCompactionTier {
    if (this.#tier2FloorProtectedTools.has(toolName)) return 'tier3';
    if (distance <= 8) return 'tier3';
    if (distance < 20) return 'tier2';
    return 'tier1';
  }

  /**
   * Tier2 语义摘要：最多 maxSemanticAttempts 次尝试（每 pass 上限 2）。
   * 任一尝试返回非空且 ≤cap 即采纳；全失败返回 undefined（退化为 per-item 确定性截断）。
   * MUST NOT 让摘要器死循环——attempt 硬上限切断。
   */
  async #produceTier2Summary(
    input: LayeredCompactInput,
    tier2Items: readonly ModelInputItem[],
  ): Promise<string | undefined> {
    const producer = this.#summaryProducer;
    if (producer === undefined || input.signal?.aborted) return undefined;
    for (let attempt = 0; attempt < this.#maxSemanticAttempts; attempt += 1) {
      try {
        const result = await producer({
          conversationId: input.conversationId,
          items: tier2Items,
          createdAt: input.createdAt,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        });
        if (result !== undefined && result.trim().length > 0) {
          const capped = capSummary(result, this.#tier2SummaryCap);
          if (capped.trim().length > 0) return capped;
        }
      } catch {
        // 单次失败：继续重试（不超过 maxSemanticAttempts），不抛出
      }
    }
    return undefined;
  }

  /** 确定性截断（head+tail ≤cap chars，中间标记，经脱敏）。Tier2 摘要失败兜底。 */
  #deterministicTruncate(content: string): string {
    const redacted = this.#redactor.redact(content).text;
    return capSummary(redacted, this.#tier2SummaryCap);
  }
}

/** 构建 toolCallId → toolName 索引（从 assistant_tool_call 反查工具名）。 */
function buildToolNameIndex(items: readonly ModelInputItem[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const item of items) {
    if ('role' in item) continue;
    if (item.type === 'assistant_tool_call') index.set(item.toolCallId, item.name);
  }
  return index;
}

/** 收集指定 toolCallId 集合的 tool_use + result 对（Tier2 token 估算/摘要用）。 */
function collectPairItems(
  items: readonly ModelInputItem[],
  ids: ReadonlySet<string>,
): ModelInputItem[] {
  const collected: ModelInputItem[] = [];
  for (const item of items) {
    if ('role' in item) continue;
    if (
      (item.type === 'assistant_tool_call' || item.type === 'tool_result') &&
      ids.has(item.toolCallId)
    ) {
      collected.push(item);
    }
  }
  return collected;
}

/** 按 toolCallId 查找 tool_result。 */
function findResult(
  items: readonly ModelInputItem[],
  toolCallId: string,
): Extract<ModelInputItem, { type: 'tool_result' }> | undefined {
  for (const item of items) {
    if ('role' in item) continue;
    if (item.type === 'tool_result' && item.toolCallId === toolCallId) return item;
  }
  return undefined;
}

/** Tier1 元数据桩：toolCallId + toolName + error 状态（保留 tool_use 推理轨迹）。 */
function buildTier1Stub(toolCallId: string, toolName: string, isError: boolean): string {
  return `[archived:${toolCallId}, tool=${toolName}, error=${isError ? 'true' : 'false'}]`;
}

/** 截断到 ≤cap chars（head+tail 保留，中间标记）。语义摘要超 cap 或确定性截断用。 */
function capSummary(value: string, cap: number): string {
  const normalized = value.replaceAll(/\s+/g, ' ').trim();
  if (normalized.length <= cap) return normalized;
  if (cap <= TRUNCATION_MARKER.length + 2) return normalized.slice(0, cap);
  const remaining = cap - TRUNCATION_MARKER.length;
  const head = Math.ceil(remaining / 2);
  const tail = Math.floor(remaining / 2);
  return `${normalized.slice(0, head)}${TRUNCATION_MARKER}${normalized.slice(-tail)}`;
}
