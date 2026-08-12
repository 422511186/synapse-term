import type {
  ContextGovernanceState,
  ConversationCompaction,
  ConversationCompactionGate,
  ModelItem,
  TierClassification,
  ToolResultSpillRecord,
} from '@synapse-term/domain';
import type { ModelInputItem } from '@synapse-term/model-providers';

import type { ContextBudget } from './context-budget.js';
import type { ConversationSummaryCallback } from './conversation-compactor.js';
import { ConversationCompactor } from './conversation-compactor.js';
import { estimateModelItemTokens, estimateModelItemsTokens } from './token-estimator.js';
import {
  ToolResultSpiller,
  buildSpillReplacementFromRecord,
  type SpillOutput,
} from './tool-result-spiller.js';

// =============================================================================
// ContextGovernor（Ch35/36/37 + Decision 1/3）
// -----------------------------------------------------------------------------
// 现状缺口：ContextBuilder.fitModelItems 在超预算时从前向后删除最老的非 protected
// 原子直到放下。#items 本身 append-only（fit 操作的是 clone），但投影前缀每轮都
// 在变——prompt cache 每轮 miss，且超大 tool_result 被头尾截断造成信息销毁。
//
// ContextGovernor 替换该前删路径，每轮产出 cache-stable 投影：
//   1. ToolResultSpiller（Ch36）：超大 tool_result 外溢为 preview+pointer，原始
//      内容仍完整保留在 append-only #items（ADR-0018 原件保留精神不变）。
//   2. LayeredCompactor（Ch37，阶段 2 落地）：按距离分层 Tier3/2/1。
//   3. ThreeGateCompactor（Ch35，阶段 2 落地）：Proactive/Preflight/Reactive 三闸门。
//
// cache-stable 投影（Decision 1）：用"摘要段替换老段 + recent-tail append-only"
// 代替前删。前缀稳定点只随压缩事件变，不随每轮变。
//
// Governor/Compactor 职责分离（Decision 3）：Governor 管每轮投影，ConversationCompactor
// 管 durable 摘要持久化 + summary 回调，两者互不重复压缩。Governor 产出新摘要时经
// onCompaction 回调交回 coordinator 落盘；产出新 spill/tier 分类时经 onGovernanceState
// 回调持久化（防抖约 2s，整体 upsert）。
//
// 增量状态（避免每轮全量重算 + 避免 #items append 导致的 index 漂移）：
// 基于 toolCallId/sequence 而非 item index。崩溃恢复从持久化 ContextGovernanceState
// 重建 spill/tier/Seen，不重新分类、不重新外溢。
// =============================================================================

/** 治理状态持久化回调（交回 coordinator 按 conversationId 整体 upsert）。 */
export type GovernanceStateCallback = (state: ContextGovernanceState) => void;

/** 新摘要落盘回调（交回 coordinator 复用 saveConversationCompaction 路径）。 */
export type CompactionCallback = (compaction: ConversationCompaction) => void;

/** 子任务边界 marker 回调（阶段 4 Planner 落地后激活，阶段 1-3 为 no-op）。 */
export type SubtaskMarkerCallback = (marker: {
  conversationId: string;
  subtaskId: string;
  inProgress: boolean;
}) => void;

/** Governor 投影输入。 */
export interface GovernanceProjectInput {
  /** 当前会话 id（持久化键）。 */
  conversationId: string;
  /**
   * append-only #items（已脱敏），Governor 只读不改源。
   * 与 #emitItem 脱敏路径一致；崩溃恢复后为已脱敏项重建。
   */
  items: readonly ModelInputItem[];
  /** 当前上下文预算（由 ContextBudget 计算，三闸门阈值派生）。 */
  budget: ContextBudget;
  /** 当前 turn 序号（分层距离 = currentTurn − tool_result 所在 turn）。 */
  currentTurn: number;
  /** ISO 时间戳（落 ConversationCompaction.createdAt）。 */
  createdAt: string;
  /** 既有摘要（首轮 undefined；后续从 ConversationCompaction.summary 传入）。 */
  existingCompaction?: ConversationCompaction | undefined;
  /** 取消信号（透传给 provider 摘要回调）。 */
  signal?: AbortSignal | undefined;
}

/** Governor 投影输出。 */
export interface GovernanceProjectResult {
  /** 投影后的模型输入（cache-stable：摘要段 + recent-tail append-only）。 */
  items: ModelInputItem[];
  /** 投影后 token 估算（诊断用）。 */
  estimatedTokens: number;
  /** 本轮是否触发了压缩（产出新摘要）。 */
  compacted: boolean;
  /** 本轮产出的新摘要记录（若有，经 onCompaction 落盘）。 */
  compaction?: ConversationCompaction | undefined;
  /** 本轮是否有新的 spill/tier 分类（若有，经 onGovernanceState 落盘）。 */
  governanceDirty: boolean;
}

/** 三闸门阈值配置（Ch35；派生自 ContextBudget）。 */
export interface ThreeGateThresholds {
  /** Proactive 闸门：估算达 inputTokens × 0.90 触发压缩。 */
  proactiveTokens: number;
  /** Preflight 闸门：发送前达 inputTokens × 0.95 触发压缩。 */
  preflightTokens: number;
  /** Reactive 闸门：命中 context_length_exceeded 后触发（never-reset 标志，阶段 2 落地）。 */
  reactiveOnOverflow: boolean;
}

/** 从 ContextBudget 派生三闸门阈值（Ch35：0.90 / 0.95 / reactive）。 */
export function deriveThreeGateThresholds(budget: ContextBudget): ThreeGateThresholds {
  return {
    proactiveTokens: Math.floor(budget.inputTokens * 0.9),
    preflightTokens: Math.floor(budget.inputTokens * 0.95),
    // Reactive 闸门在阶段 2 重构 #run() 模型调用段为可重试结构后挂钩；
    // 阶段 1 Governor 仅用 proactive/preflight，reactiveOnOverflow 标志位预埋。
    reactiveOnOverflow: true,
  };
}

export interface ContextGovernorOptions {
  /** Spiller 实例（可注入便于测试）。 */
  spiller?: ToolResultSpiller;
  /**
   * ConversationCompactor 实例（角色收窄后：只产摘要记录，不判阈值/装配 history）。
   * Governor 压缩时通过 compactor.produceSummary 委托摘要生产能力；
   * 未注入时退化到直接调 summarize 回调的占位行为。
   */
  compactor?: ConversationCompactor;
  /** 摘要回调（复用 coordinator 的 #summarizeWithAdapter）。 */
  summarize?: ConversationSummaryCallback;
  /** 摘要 id 工厂（落 ConversationCompaction.id）。 */
  idFactory?: () => string;
  /** 新摘要落盘回调（交回 coordinator）。 */
  onCompaction?: CompactionCallback;
  /** 治理状态落盘回调（交回 coordinator，防抖约 2s）。 */
  onGovernanceState?: GovernanceStateCallback;
  /** 子任务边界 marker 回调（阶段 4 激活）。 */
  onSubtaskMarker?: SubtaskMarkerCallback;
}

/** 单条 tool_result 的增量外溢状态（基于 toolCallId，非 item index）。 */
interface SpillState {
  toolCallId: string;
  /** 已外溢（投影路径用 replacement 替换原内容，防全量回灌）。 */
  spilled: boolean;
  /** 外溢记录（持久化进 ContextGovernanceState.spillRecords）。 */
  record: ToolResultSpillRecord;
}

/**
 * ContextGovernor：编排 spill → 分层 → 三闸门，替换 fitModelItems 前删路径，
 * 产出 cache-stable 投影（摘要段替换老段 + recent-tail append-only）。
 *
 * 增量维护 spill/tier 状态（Map<toolCallId, SpillState>），基于 toolCallId/sequence
 * 而非 item index，避免 #items append 导致的 index 漂移。崩溃恢复时从持久化
 * ContextGovernanceState 重建，不重新分类、不重新外溢。
 */
export class ContextGovernor {
  readonly #spiller: ToolResultSpiller;
  readonly #compactor: ConversationCompactor | undefined;
  readonly #summarize: ConversationSummaryCallback | undefined;
  readonly #idFactory: () => string;
  readonly #onCompaction: CompactionCallback | undefined;
  readonly #onGovernanceState: GovernanceStateCallback | undefined;
  readonly #onSubtaskMarker: SubtaskMarkerCallback | undefined;

  /** 增量外溢状态（基于 toolCallId，非 item index）。 */
  readonly #spillStates = new Map<string, SpillState>();
  /** 增量分层分类（基于 toolCallId；阶段 2 LayeredCompactor 落地后填充实）。 */
  readonly #tierClassifications = new Map<string, TierClassification>();
  /** Seen set：防全量回灌（投影路径不回灌全量，但允许 context_recall 显式召回）。 */
  readonly #seenToolCallIds = new Set<string>();
  /** 当前会话 id（持久化键）。 */
  #conversationId: string | undefined;
  /** 治理状态是否有未落盘变更（驱动 onGovernanceState 防抖）。 */
  #governanceDirty = false;

  constructor(options: ContextGovernorOptions = {}) {
    this.#spiller = options.spiller ?? new ToolResultSpiller();
    this.#compactor = options.compactor;
    this.#summarize = options.summarize;
    this.#idFactory = options.idFactory ?? (() => crypto.randomUUID());
    this.#onCompaction = options.onCompaction;
    this.#onGovernanceState = options.onGovernanceState;
    this.#onSubtaskMarker = options.onSubtaskMarker;
  }

  /**
   * 每轮投影：编排 spill → 分层 → 三闸门，产出 cache-stable 模型输入。
   *
   * 投影路径：
   *   1. 增量扫描 #items 中尚未分类的 tool_result，经 Spiller 判定外溢；
   *      已外溢的 tool_result 在投影路径用 replacement 替换（防全量回灌）。
   *   2. 估算投影后 token，达 Proactive/Preflight 阈值时触发压缩：
   *      用"摘要段替换老段 + recent-tail append-only"产出 cache-stable 投影
   *      （替换式而非前删式，前缀稳定点只随压缩事件变）。
   *   3. 产新摘要经 onCompaction 落盘；产新 spill/tier 经 onGovernanceState 落盘。
   *
   * #items append-only 不被改：投影操作的是 clone，源 #items 不变（ADR-0018 精神）。
   *
   * @returns 投影结果 + 落盘回调已在内部触发
   */
  async project(input: GovernanceProjectInput): Promise<GovernanceProjectResult> {
    this.#conversationId = input.conversationId;
    const thresholds = deriveThreeGateThresholds(input.budget);
    let governanceDirty = false;

    // --- 步骤 1：增量外溢扫描（基于 toolCallId，不每轮全量重算）---
    // 扫描 #items 中的 tool_result，对尚未分类的调用 Spiller 判定；
    // 已外溢的 toolCallId 在投影路径用 replacement 替换（防全量回灌）。
    const projection: ModelInputItem[] = [];
    for (const item of input.items) {
      if ('role' in item) {
        projection.push(item);
        continue;
      }
      if (item.type === 'tool_result') {
        const existing = this.#spillStates.get(item.toolCallId);
        if (existing !== undefined) {
          // 增量命中：已分类的 toolCallId 不重新判定（避免每轮全量重算）。
          // 基于 toolCallId 而非 item index——#items append 不致 index 漂移误判。
          if (existing.spilled) {
            // 已外溢：投影路径用持久化的 replacement 替换（防全量回灌）。
            // 崩溃恢复后此路径走 buildSpillReplacementFromRecord（不重新外溢）。
            projection.push({
              type: 'tool_result',
              toolCallId: item.toolCallId,
              content: buildSpillReplacementFromRecord(existing.record),
              isError: item.isError,
            });
          } else {
            // 未外溢 placeholder 命中：投影保留原内容，不重新调 Spiller 判定。
            // placeholder 防止未外溢项每轮被重新扫描全量重算。
            projection.push(item);
          }
          continue;
        }
        // 尚未分类：首次调用 Spiller 判定外溢（首次判定后持久化，崩溃不重判）。
        const spillOutput = this.#spiller.spill({
          toolCallId: item.toolCallId,
          toolName: this.#toolNameFor(input.items, item.toolCallId),
          content: item.content,
        });
        if (
          spillOutput.shouldSpill &&
          spillOutput.record !== undefined &&
          spillOutput.replacement !== undefined
        ) {
          // 新外溢：记录增量状态 + Seen set + 标记 dirty 待落盘
          this.#spillStates.set(item.toolCallId, {
            toolCallId: item.toolCallId,
            spilled: true,
            record: spillOutput.record,
          });
          this.#seenToolCallIds.add(item.toolCallId);
          governanceDirty = true;
          projection.push({
            type: 'tool_result',
            toolCallId: item.toolCallId,
            content: spillOutput.replacement,
            isError: item.isError,
          });
        } else {
          // 未达外溢阈值或无空间收益：投影保留原内容
          this.#spillStates.set(item.toolCallId, {
            toolCallId: item.toolCallId,
            spilled: false,
            record: {
              toolCallId: item.toolCallId,
              reissuability: this.#spiller.classifyReissuability(
                this.#toolNameFor(input.items, item.toolCallId),
              ),
              previewHead: '',
              previewTail: '',
              originalBytes: 0,
            },
          });
          projection.push(item);
        }
        continue;
      }
      // assistant_tool_call 原样保留（投影不改 tool_call 结构）
      projection.push(item);
    }

    // --- 步骤 2：三闸门压缩判定（阶段 1 仅 Proactive/Preflight；Reactive 阶段 2 落地）---
    let compaction: ConversationCompaction | undefined;
    let compacted = false;
    const estimated = estimateModelItemsTokens(projection);
    const needsCompaction = estimated > thresholds.proactiveTokens;

    if (needsCompaction) {
      const result = await this.#compact({
        conversationId: input.conversationId,
        items: projection,
        budget: input.budget,
        thresholds,
        createdAt: input.createdAt,
        existingCompaction: input.existingCompaction,
        signal: input.signal,
      });
      if (result.compaction !== undefined) {
        compaction = result.compaction;
        compacted = true;
        // 产新摘要经 onCompaction 交回 coordinator 落盘（复用 saveConversationCompaction）
        this.#onCompaction?.(result.compaction);
      }
    }

    // --- 步骤 3：治理状态落盘（防抖约 2s，整体 upsert；阶段 1.11 接 coordinator）---
    if (governanceDirty) {
      this.#governanceDirty = true;
      this.#onGovernanceState?.(this.snapshotState(input.conversationId));
      this.#governanceDirty = false;
    }

    return {
      items: compaction !== undefined ? this.#applyCompaction(projection, compaction) : projection,
      estimatedTokens:
        compaction !== undefined
          ? estimateModelItemsTokens(this.#applyCompaction(projection, compaction))
          : estimated,
      compacted,
      compaction,
      governanceDirty,
    };
  }

  /**
   * 从持久化 ContextGovernanceState 重建 spill/tier/Seen 状态。
   * 崩溃恢复调用：不重新分类、不重新外溢（分类可能调过摘要器，重付不可接受）。
   */
  rebuild(state: ContextGovernanceState): void {
    this.#conversationId = state.conversationId;
    this.#spillStates.clear();
    this.#tierClassifications.clear();
    this.#seenToolCallIds.clear();
    for (const record of state.spillRecords) {
      this.#spillStates.set(record.toolCallId, {
        toolCallId: record.toolCallId,
        spilled: true,
        record,
      });
      if (record.originalBytes > 0) this.#seenToolCallIds.add(record.toolCallId);
    }
    for (const classification of state.tierClassifications) {
      this.#tierClassifications.set(classification.toolCallId, classification);
    }
    for (const seen of state.seenToolCallIds) this.#seenToolCallIds.add(seen);
    this.#governanceDirty = false;
  }

  /**
   * 导出当前治理状态快照（按 conversationId 整体 upsert）。
   * 原始结果内容不冗余存（仍在 #items），这里只持久化元数据 + 小 preview。
   */
  snapshotState(conversationId: string): ContextGovernanceState {
    return {
      conversationId,
      spillRecords: [...this.#spillStates.values()]
        .filter((state) => state.spilled)
        .map((state) => state.record),
      tierClassifications: [...this.#tierClassifications.values()],
      seenToolCallIds: [...this.#seenToolCallIds],
      schemaVersion: 1,
    };
  }

  /** 标记某 toolCallId 已被 context_recall 召回（防分片滥用，K2 兜底由 ContextRecallService 持有）。 */
  markRecalled(toolCallId: string): void {
    this.#seenToolCallIds.add(toolCallId);
  }

  /**
   * 压缩（阶段 1 占位实现：用摘要回调或确定性兜底产出摘要段）。
   *
   * 阶段 2 落地 ThreeGateCompactor + LayeredCompactor 后，本方法替换为：
   * Proactive/Preflight/Reactive 三闸门 + Tier3/2/1 分层。
   * 阶段 1 先用"摘要段替换 + recent-tail append-only"的基本形态替换前删路径，
   * 保证 cache-stable 投影立即生效，闸门/分层在阶段 2 作为增强接入。
   */
  async #compact(input: {
    conversationId: string;
    items: readonly ModelInputItem[];
    budget: ContextBudget;
    thresholds: ThreeGateThresholds;
    createdAt: string;
    existingCompaction?: ConversationCompaction | undefined;
    signal?: AbortSignal | undefined;
  }): Promise<{ compaction?: ConversationCompaction | undefined }> {
    // 阶段 1：委托 ConversationCompactor 的摘要生产能力（produceSummary）。
    // 完整的 ThreeGate/Layered 在阶段 2 接入；此处先保证 cache-stable 投影可用。
    // 角色收窄（task 1.8）后，Compactor 不再判阈值/装配 history，只产摘要记录；
    // Governor 通过注入的 compactor 实例调用 produceSummary，再用 #applyCompaction 装配投影。
    const compactor = this.#compactor;
    if (compactor === undefined && this.#summarize === undefined) return {};
    try {
      // 摘要 token 预算：压缩目标与 reservedOutput 取小（与阶段 1 #compact 占位逻辑一致）。
      const summaryBudgetTokens = Math.max(
        1,
        Math.min(input.budget.compactTargetTokens, Math.max(1, input.budget.reservedOutputTokens)),
      );
      const maxOutputTokens = Math.max(1, input.budget.reservedOutputTokens || summaryBudgetTokens);
      const previous = input.existingCompaction;
      // 优先用注入的 Compactor 实例（复用其 produceSummary 的脱敏/fitSummary/deterministic 兜底）；
      // 未注入 Compactor 时退化到直接调 summarize 回调（保留旧占位行为，便于无 Compactor 注入的过渡测试）。
      if (compactor !== undefined) {
        const result = await compactor.produceSummary({
          conversationId: input.conversationId,
          items: input.items,
          ...(previous === undefined ? {} : { existing: previous }),
          summaryBudgetTokens,
          maxOutputTokens,
          gate: 'proactive',
          throughSequence: this.#estimateThroughSequence(input.items),
          createdAt: input.createdAt,
          ...(this.#summarize === undefined ? {} : { summarize: this.#summarize }),
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        });
        return { ...(result.compaction === undefined ? {} : { compaction: result.compaction }) };
      }
      // 退化路径：直接调 summarize 回调（无 Compactor 实例时的占位行为）。
      const previousSummary = previous?.summary;
      const result = await this.#summarize!({
        conversationId: input.conversationId,
        ...(previousSummary === undefined ? {} : { previousSummary }),
        items: input.items,
        maxOutputTokens: Math.min(summaryBudgetTokens, maxOutputTokens),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      const candidate = typeof result === 'string' ? result : result.text;
      if (candidate === undefined || candidate.trim().length === 0) return {};
      const compaction: ConversationCompaction = {
        id: this.#idFactory(),
        conversationId: input.conversationId,
        throughSequence: this.#estimateThroughSequence(input.items),
        summary: candidate,
        sourceItemCount: input.items.length,
        estimatedTokensBefore: estimateModelItemsTokens(input.items),
        createdAt: input.createdAt,
        summaryMethod: 'provider',
        gate: 'proactive',
        schemaVersion: 1,
      };
      return { compaction };
    } catch {
      // 摘要失败不破坏投影：Governor 返回未压缩 projection，下轮再试或阶段 2 三闸门兜底。
      return {};
    }
  }

  /**
   * 把产出的摘要段应用到投影：用摘要 system message 替换老段，recent-tail append-only。
   * cache-stable 投影核心——前缀稳定点只随压缩事件变，不随每轮变。
   */
  #applyCompaction(
    items: readonly ModelInputItem[],
    compaction: ConversationCompaction,
  ): ModelInputItem[] {
    const summaryItem: ModelInputItem = {
      role: 'system',
      content: `对话摘要：\n${compaction.summary}`,
    };
    // 阶段 1 保守策略：保留全部 recent-tail + 头部摘要段。
    // 阶段 2 LayeredCompactor 落地后按 Tier3/2/1 距离替换老段。
    return [summaryItem, ...items];
  }

  /** 从 #items 中按 toolCallId 反查产出 tool_result 的工具名（Spiller 分级用）。 */
  #toolNameFor(items: readonly ModelInputItem[], toolCallId: string): string {
    for (const item of items) {
      if ('role' in item) continue;
      if (item.type === 'assistant_tool_call' && item.toolCallId === toolCallId) return item.name;
    }
    return 'unknown';
  }

  /** 估算投影的 throughSequence（阶段 1 用 item 数近似；阶段 2 接 ModelItem.sequence）。 */
  #estimateThroughSequence(items: readonly ModelInputItem[]): number {
    return items.length;
  }

  /** 暴露 Spiller 供诊断与测试用。 */
  get spiller(): ToolResultSpiller {
    return this.#spiller;
  }
}

/**
 * 从 ModelItem[]（持久化领域模型，含 sequence/turnId）派生 ModelInputItem[]。
 * Governor 投影只消费 ModelInputItem；coordinator 装配时用此 helper 转换。
 *
 * 复用 conversation-compactor.ts 的 modelItemToInput 语义（保持一致）。
 */
export function modelItemsToInput(items: readonly ModelItem[]): ModelInputItem[] {
  return items.map((item) => {
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
  });
}

/** 估算单条 ModelInputItem 的 token（转发 token-estimator，供外部诊断用）。 */
export function estimateGovernorItemTokens(item: ModelInputItem): number {
  return estimateModelItemTokens(item);
}
