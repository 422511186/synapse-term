import type {
  ConversationCompaction,
  ConversationCompactionGate,
  ModelItem,
} from '@synapse-term/domain';

import { SecretRedactor } from '@synapse-term/infrastructure';
import type { ModelContentPart, ModelInputItem } from '@synapse-term/model-providers';
import { estimateModelItemsTokens } from './token-estimator.js';

// =============================================================================
// ThreeGateCompactor（Ch35 三道闸门 + Decision 1 cache-stable 投影）
// -----------------------------------------------------------------------------
// 现状缺口：ContextBudget 只有单阈值（compactAtTokens），超阈值即压缩。无 Preflight
// 闸门（发送前最后检查）也无 Reactive 闸门（命中 context_length_exceeded 后恢复）。
// 超窗任务在 Reactive 闸门前直接死。
//
// 三道闸门（Ch35）：
//   - Proactive（0.90）：估算达 inputTokens × 0.90 触发压缩。给模型留余量、不让
//     上下文逼近上限导致输出被截。保留更多 recent（proactiveRecentPairs）。
//   - Preflight（0.95）：发送前达 inputTokens × 0.95 触发更激进压缩。recent 收到
//     floor（recentFloorPairs）——已经接近上限，必须激进压缩给模型留输出空间。
//   - Reactive：命中 context_length_exceeded 后触发（never-reset 标志，单次重试）。
//     never-reset：一旦触发过 reactive，后续每轮都走 reactive（已超窗过，保守）。
//
// cache-stable 投影（Decision 1）：三段保留——opening（system + 首条 user）+
// summary-segment（中间老段替换为摘要）+ recent-tail（append-only）。前缀稳定点
// 只随压缩事件变，不随每轮变。
//
// never-reset 标志 + retry-once（task 2.3）：Reactive 触发后 #run() 把模型调用包成
// 可重试结构——首次 context_length_exceeded → 触发 Reactive 压缩 → 重试一次。
// 重试后仍超窗 → fail closed。reactiveRetryUsed 标志确保只重试一次。
// =============================================================================

/** 三闸门阈值配置（Ch35；由 deriveThreeGateThresholds 从 ContextBudget 派生）。 */
export interface ThreeGateThresholds {
  /** Proactive 闸门：估算达 inputTokens × 0.90 触发压缩。 */
  proactiveTokens: number;
  /** Preflight 闸门：发送前达 inputTokens × 0.95 触发压缩。 */
  preflightTokens: number;
  /** Reactive 闸门：命中 context_length_exceeded 后触发（never-reset 标志）。 */
  reactiveOnOverflow: boolean;
}

/** 摘要生产者：把中间老段产成 ConversationCompaction（Governor/Compactor 注入）。 */
export type SummaryProducer = (input: SummaryProducerInput) => Promise<ConversationCompaction | undefined>;

/** 摘要生产输入。 */
export interface SummaryProducerInput {
  conversationId: string;
  /** 中间待摘要段（已脱敏，ThreeGate 只读不改源）。 */
  items: readonly ModelInputItem[];
  /** 压缩来源闸门（落 ConversationCompaction.gate）。 */
  gate: ConversationCompactionGate;
  /** throughSequence 估算。 */
  throughSequence?: number;
  createdAt: string;
}

/** ThreeGateCompactor.compact 输入。 */
export interface ThreeGateCompactInput {
  conversationId: string;
  /** 待压缩投影（已脱敏，compactor 只读不改源 #items）。 */
  items: readonly ModelInputItem[];
  /** 三闸门阈值。 */
  thresholds: ThreeGateThresholds;
  /** 当前 turn 序号。 */
  currentTurn: number;
  /** ISO 时间戳（落 ConversationCompaction.createdAt）。 */
  createdAt: string;
  /** 既有摘要（首轮 undefined；后续作为 previousSummary 上下文）。 */
  existingCompaction?: ConversationCompaction;
  /** 外部触发 Reactive（由 #run() 命中 context_length_exceeded 后传入）。 */
  reactiveTriggered?: boolean;
  /** 取消信号（透传给 summaryProducer）。 */
  signal?: AbortSignal;
}

/** ThreeGateCompactor.compact 输出。 */
export interface ThreeGateCompactResult {
  /** 压缩后的投影（opening + summary-segment + recent-tail，cache-stable）。 */
  items: ModelInputItem[];
  /** 是否触发了压缩。 */
  compacted: boolean;
  /** 触发的闸门（proactive / preflight / reactive；未压缩时 undefined）。 */
  gate?: ConversationCompactionGate;
  /** 本轮产出的摘要记录（若有，经 onCompaction 落盘）。 */
  compaction?: ConversationCompaction;
  /** 本轮是否触发了 Reactive 闸门（#run() 据此决定是否重试）。 */
  reactiveFired: boolean;
}

export interface ThreeGateCompactorOptions {
  /** 摘要生产者（未注入时用确定性兜底 summarizeMiddle）。 */
  summaryProducer?: SummaryProducer;
  /** token 估算函数（默认用 token-estimator）。 */
  estimateTokens?: (items: readonly ModelInputItem[]) => number;
  /** recent-tail 最少保留配对数（Preflight/Reactive 收到此值；默认 3）。 */
  recentFloorPairs?: number;
  /** Proactive 闸门保留的 recent 配对数（> floor；默认 6）。 */
  proactiveRecentPairs?: number;
  /** id 工厂（落 ConversationCompaction.id；默认 crypto.randomUUID）。 */
  idFactory?: () => string;
  /** 脱敏器（确定性兜底用；默认 new SecretRedactor）。 */
  redactor?: SecretRedactor;
}

const SUMMARY_PREFIX = '对话摘要：\n';
const SUMMARY_TRUNCATION_MARKER = '\n…摘要已截断…\n';

/**
 * ThreeGateCompactor：Ch35 三道闸门 + Decision 1 cache-stable 投影。
 *
 * 压缩策略：三段保留——opening（system + 首条 user）+ summary-segment（中间老段
 * 替换为摘要 system 消息）+ recent-tail（保留最近 N 个 tool_call/tool_result 配对）。
 *
 * 闸门选择：
 *   - reactiveTriggered=true 或 reactiveTriggered 标志已置 → reactive（最高优先级）
 *   - 估算 > preflightTokens → preflight
 *   - 估算 > proactiveTokens → proactive
 *   - 否则不压缩
 *
 * recent 配对数：reactive/preflight 收到 floor（保守，已逼近上限）；proactive 保留
 * 更多（proactiveRecentPairs）。原子单元不拆散：同批 batched tool_calls 整组保留
 * 或整组进摘要，避免孤儿 tool_call/tool_result。
 */
export class ThreeGateCompactor {
  readonly #summaryProducer: SummaryProducer;
  readonly #estimateTokens: (items: readonly ModelInputItem[]) => number;
  readonly #recentFloorPairs: number;
  readonly #proactiveRecentPairs: number;
  readonly #idFactory: () => string;
  readonly #redactor: SecretRedactor;

  /**
   * never-reset 标志：一旦触发过 Reactive，后续每轮都走 reactive（已超窗过，保守）。
   * 崩溃恢复经 restoreReactive 重建（持久化在 ContextGovernanceState 或 #run() 状态）。
   */
  #reactiveTriggered = false;
  /** Reactive 单次重试预算：markReactiveRetryUsed 后不再可用（#run() 重试后调用）。 */
  #reactiveRetryUsed = false;

  constructor(options: ThreeGateCompactorOptions = {}) {
    this.#summaryProducer = options.summaryProducer ?? this.#deterministicSummary.bind(this);
    this.#estimateTokens = options.estimateTokens ?? estimateModelItemsTokens;
    this.#recentFloorPairs = options.recentFloorPairs ?? 3;
    this.#proactiveRecentPairs = options.proactiveRecentPairs ?? 6;
    this.#idFactory = options.idFactory ?? (() => crypto.randomUUID());
    this.#redactor = options.redactor ?? new SecretRedactor();
  }

  /** Reactive 是否已触发（never-reset 标志）。 */
  get reactiveTriggered(): boolean {
    return this.#reactiveTriggered;
  }

  /** Reactive 重试是否已用（单次重试预算）。 */
  get reactiveRetryUsed(): boolean {
    return this.#reactiveRetryUsed;
  }

  /** Reactive 重试是否可用（已触发 + 未用过重试）。 */
  get reactiveRetryAvailable(): boolean {
    return this.#reactiveTriggered && !this.#reactiveRetryUsed;
  }

  /** 标记 Reactive 重试已用（#run() 重试后调用，确保只重试一次）。 */
  markReactiveRetryUsed(): void {
    this.#reactiveRetryUsed = true;
  }

  /**
   * 崩溃恢复重建 Reactive 状态（never-reset 标志 + 重试预算）。
   * 持久化在 #run() 的可重试结构状态里；恢复后不重置已用重试。
   */
  restoreReactive(triggered: boolean, retryUsed: boolean): void {
    this.#reactiveTriggered = triggered;
    this.#reactiveRetryUsed = retryUsed;
  }

  /**
   * 三闸门压缩：按 reactive > preflight > proactive 优先级判定，三段保留产出 cache-stable 投影。
   *
   * #items append-only 不被改：投影操作的是新数组，源 #items 不变（ADR-0018 精神）。
   * 摘要生产失败降级：返回未压缩投影（Reactive 由 #run() 决定 fail closed）。
   */
  async compact(input: ThreeGateCompactInput): Promise<ThreeGateCompactResult> {
    // 外部触发 Reactive → 置 never-reset 标志（后续每轮都走 reactive）
    if (input.reactiveTriggered === true) this.#reactiveTriggered = true;

    const estimated = this.#estimateTokens(input.items);
    // 闸门优先级：reactive（已触发）> preflight > proactive > 无压缩
    const gate = this.#selectGate(estimated, input.thresholds, input.reactiveTriggered === true);
    if (gate === undefined) {
      return {
        items: [...input.items],
        compacted: false,
        reactiveFired: this.#reactiveTriggered && input.reactiveTriggered === true,
      };
    }

    // recent 配对数：reactive/preflight 收 floor（保守），proactive 保留更多
    const recentPairs = gate === 'proactive' ? this.#proactiveRecentPairs : this.#recentFloorPairs;
    // 三段切分：opening + middle（待摘要）+ recent-tail（保留）
    const segments = this.#segment(input.items, recentPairs);
    if (segments === undefined) {
      // middle 为空（items 不足 floor）→ 不压缩，原样返回
      return {
        items: [...input.items],
        compacted: false,
        reactiveFired: this.#reactiveTriggered && input.reactiveTriggered === true,
      };
    }

    // 产摘要段（失败降级：返回未压缩投影，不破坏投影）
    let compaction: ConversationCompaction | undefined;
    try {
      compaction = await this.#summaryProducer({
        conversationId: input.conversationId,
        items: segments.middle,
        gate,
        throughSequence: this.#estimateThroughSequence(input.items),
        createdAt: input.createdAt,
      });
    } catch {
      compaction = undefined;
    }
    if (compaction === undefined) {
      return {
        items: [...input.items],
        compacted: false,
        reactiveFired: this.#reactiveTriggered && input.reactiveTriggered === true,
      };
    }

    // 装配 cache-stable 投影：opening + summary-segment + recent-tail
    const summaryItem: ModelInputItem = {
      role: 'system',
      content: `${SUMMARY_PREFIX}${compaction.summary}`,
    };
    const projected = [...segments.opening, summaryItem, ...segments.recent];
    return {
      items: projected,
      compacted: true,
      gate,
      compaction,
      reactiveFired: gate === 'reactive',
    };
  }

  /** 闸门优先级选择：reactive（已触发）> preflight > proactive > undefined。 */
  #selectGate(
    estimated: number,
    thresholds: ThreeGateThresholds,
    externalReactive: boolean,
  ): ConversationCompactionGate | undefined {
    // Reactive 最高优先级：外部触发 或 never-reset 标志已置
    if (externalReactive || this.#reactiveTriggered) return 'reactive';
    // Preflight：发送前达 0.95（比 proactive 更激进，recent 收 floor）
    if (estimated > thresholds.preflightTokens) return 'preflight';
    // Proactive：估算达 0.90
    if (estimated > thresholds.proactiveTokens) return 'proactive';
    return undefined;
  }

  /**
   * 三段切分：opening + middle + recent-tail。
   * - opening：system 消息 + 首条 user 消息（始终保留，给模型目标上下文）。
   * - recent-tail：最后 N 个原子配对单元（不拆散 batched tool_calls）。
   * - middle：opening 与 recent 之间的所有项（待摘要）。
   *
   * 原子单元不拆散：同批 batched tool_calls 整组保留或整组进摘要，避免孤儿。
   * middle 为空（items 不足 floor）→ 返回 undefined（不压缩）。
   */
  #segment(
    items: readonly ModelInputItem[],
    recentPairs: number,
  ): { opening: ModelInputItem[]; middle: ModelInputItem[]; recent: ModelInputItem[] } | undefined {
    if (recentPairs <= 0) {
      return {
        opening: [],
        middle: [...items],
        recent: [],
      };
    }
    // opening = 前导 role 消息（system + 首条 user），到第一个 tool_call 或 assistant_tool_call 为止
    const opening: ModelInputItem[] = [];
    let index = 0;
    while (index < items.length) {
      const item = items[index]!;
      if (!('role' in item)) break;
      opening.push(item);
      index += 1;
    }
    // 原子单元化 opening 之后的内容（每个 assistant_tool_call + 对应 tool_result 为一个单元）
    const units = this.#atomicUnits(items, index);
    if (units.length < recentPairs) {
      // 不足 floor → middle 为空，不压缩
      return undefined;
    }
    const recentUnitCount = Math.min(units.length, recentPairs);
    const middleUnitCount = units.length - recentUnitCount;
    const middle = units.slice(0, middleUnitCount).flat();
    const recent = units.slice(middleUnitCount).flat();
    return { opening, middle, recent };
  }

  /**
   * 从 startIndex 起把 items 切成原子单元（每个 assistant_tool_call + 紧随的 tool_result 为一组）。
   * 同批 batched tool_calls（连续多个 assistant_tool_call 后跟对应 tool_result）整组为一个单元，
   * 不拆散——避免压缩时拆散批次产生孤儿 tool_call/tool_result。
   */
  #atomicUnits(items: readonly ModelInputItem[], startIndex: number): ModelInputItem[][] {
    const units: ModelInputItem[][] = [];
    let index = startIndex;
    while (index < items.length) {
      const item = items[index]!;
      if ('role' in item) {
        // role 消息（assistant text 等）单独成一个单元
        units.push([item]);
        index += 1;
        continue;
      }
      if (item.type !== 'assistant_tool_call') {
        // 孤儿 tool_result（无配对 call）单独成单元（理论上不该出现，防御性处理）
        units.push([item]);
        index += 1;
        continue;
      }
      // 收集连续的 assistant_tool_call（同批 batched）
      const batch: ModelInputItem[] = [item];
      const callIds = new Set<string>([item.toolCallId]);
      index += 1;
      while (index < items.length) {
        const candidate = items[index]!;
        if ('role' in candidate || candidate.type !== 'assistant_tool_call') break;
        batch.push(candidate);
        callIds.add(candidate.toolCallId);
        index += 1;
      }
      // 收集对应的 tool_result（按 callId 配对）
      while (index < items.length) {
        const candidate = items[index]!;
        if ('role' in candidate || candidate.type !== 'tool_result' || !callIds.has(candidate.toolCallId)) {
          break;
        }
        batch.push(candidate);
        index += 1;
      }
      units.push(batch);
    }
    return units;
  }

  /** 估算 throughSequence（用 item 数近似；阶段 2 接 ModelItem.sequence）。 */
  #estimateThroughSequence(items: readonly ModelInputItem[]): number {
    return items.length;
  }

  /**
   * 确定性兜底摘要（未注入 summaryProducer 或 provider 失败时用）。
   * 每条内容经 SecretRedactor 脱敏后取 ≤240 字 bounded 片段，拼成证据行。
   */
  async #deterministicSummary(input: SummaryProducerInput): Promise<ConversationCompaction> {
    const lines = input.items.map((item) => {
      if ('role' in item) {
        const label = item.role === 'user' ? '用户' : item.role === 'assistant' ? 'Agent' : '系统';
        return `${label}：${bounded(contentText(redactContent(item.content, this.#redactor)))}`;
      }
      if (item.type === 'assistant_tool_call') {
        return `工具调用：${item.name} ${bounded(this.#redactor.redact(item.argumentsJson).text)}`;
      }
      return `工具结果${item.isError ? '（错误）' : ''}：${bounded(this.#redactor.redact(item.content).text)}`;
    });
    const summary = lines.join('\n').trim();
    return {
      id: this.#idFactory(),
      conversationId: input.conversationId,
      throughSequence: input.throughSequence ?? input.items.length,
      summary,
      sourceItemCount: input.items.length,
      estimatedTokensBefore: this.#estimateTokens(input.items),
      createdAt: input.createdAt,
      summaryMethod: 'deterministic',
      gate: input.gate,
      schemaVersion: 1,
    };
  }
}

/** 从持久化 ModelItem[] 派生 ModelInputItem[]（与 context-governor/compactor 一致）。 */
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

function bounded(value: string): string {
  return value.replaceAll(/\s+/g, ' ').trim().slice(0, 240);
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

/**
 * 检测 provider_error 是否为上下文超窗（Reactive 闸门触发条件，task 2.3）。
 *
 * Reactive 判定兼容多 Provider 变体（MUST NOT 仅匹配单一字面量导致某 Provider 下
 * Reactive 闸门永不触发）：
 * - OpenAI 系：`context_length_exceeded`
 * - Anthropic 系：`prompt_too_long`
 * - 通用兜底：`context length` / `maximum context` / `tokens exceeded` 等子串
 */
export function isContextOverflowError(code: string, message: string): boolean {
  const text = `${code} ${message}`.toLowerCase();
  if (text.includes('context_length_exceeded')) return true;
  if (text.includes('prompt_too_long')) return true;
  // 通用兜底：覆盖其他 Provider 的超窗错误变体
  if (
    text.includes('context length') ||
    text.includes('maximum context') ||
    text.includes('context window') ||
    text.includes('tokens exceeded') ||
    text.includes('input too long')
  ) {
    return true;
  }
  return false;
}
