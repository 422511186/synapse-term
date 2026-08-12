import type { ModelInputItem } from '@synapse-term/model-providers';

// =============================================================================
// context_recall 工具核心逻辑（Ch36 召回 API + Decision 2）
// -----------------------------------------------------------------------------
// 现状缺口：超大 tool_result 被 Spiller 外溢为 preview+指针后，对 `not-replayable`
// 工具（有副作用、不可重放）模型无法取回被外溢的原始片段——纯 Pointer 下只能
// "请求用户确认"，信息不可达。context_recall 让模型凭指针（toolCallId）主动召回
// 被外溢原始结果的指定片段，是 not-replayable 场景的核心增量。
//
// 执行路径短路（Decision 2）：#items 是 Runtime 私有，外部 RuntimeToolGateway
// 无法访问。context_recall MUST 在 #executeCalls 内部短路——直接从 Runtime #items
// 按 toolCallId 查原始 tool_result 切片返回，MUST NOT 经 RuntimeToolGateway。
//
// 召回片段仍是 tool_result（新 toolCallId），经 #emitItem/#redactItem 脱敏路径
// 进 #items 与模型面；崩溃恢复后 #items 从已脱敏项重建，召回返回的也是已脱敏片段。
// =============================================================================

/** context_recall 工具的调用参数（与 TERMINAL_MODEL_TOOLS 中的 schema 对齐）。 */
export interface ContextRecallArgs {
  /** 被外溢的原始 tool_result 的 toolCallId（必填，召回键）。 */
  toolCallId: string;
  /** 起始行（1-based，含）。未传则从首行开始。 */
  startLine?: number;
  /** 结束行（1-based，含）。未传则到末行。 */
  endLine?: number;
  /** 本次召回的最大字节。未传或超大时用默认上限 16KB。 */
  maxBytes?: number;
}

export type ContextRecallResult =
  | {
      ok: true;
      /** 召回的片段内容（已按 startLine/endLine/maxBytes 切片）。 */
      content: string;
      /** 是否因 maxBytes 截断。 */
      truncated: boolean;
      /** 原始 tool_result 的总字节数（诊断用）。 */
      originalBytes: number;
    }
  | { ok: false; error: string; message: string };

export interface ContextRecallServiceOptions {
  /**
   * 单次召回默认字节上限（maxBytes 未传或超大时用此值）。
   * 默认 16KB——MUST NOT 超过单条外溢预算（过大击穿 Seen set 防全量回灌、
   * 过小使召回失效）。
   */
  defaultMaxBytes?: number;
  /**
   * 同一 toolCallId 累计召回字节上限（K2 分片滥用兜底）。
   * 模型可对同一 toolCallId 连续召回相邻切片（startLine/endLine 不同 →
   * result 签名不同 → LoopDetector 的 ConsecutiveDuplicate 含 result 比对
   * 不命中），累积等价全量回灌。此上限击穿后该 toolCallId 不再允许召回。
   * 默认 = defaultMaxBytes × 4 = 64KB。
   */
  perToolCallIdMaxBytes?: number;
  /**
   * 同一 toolCallId 累计召回次数上限（K2 兜底）。默认 8 次。
   */
  perToolCallIdMaxCount?: number;
}

const DEFAULT_MAX_BYTES = 16_384; // 16KB

/**
 * context_recall 召回服务。
 *
 * 持有 per-toolCallId 累计召回预算（K2 分片滥用兜底），在 #executeCalls 短路路径
 * 上被 Runtime 调用。预算状态为会话内内存态——崩溃恢复后重置（可接受：模型需
 * 重新发起召回才能再次滥用，且 Seen set 仍在投影路径防全量回灌）。
 */
export class ContextRecallService {
  readonly #defaultMaxBytes: number;
  readonly #perToolCallIdMaxBytes: number;
  readonly #perToolCallIdMaxCount: number;
  /** per-toolCallId 累计召回字节（K2 兜底）。 */
  readonly #recallBytes = new Map<string, number>();
  /** per-toolCallId 累计召回次数（K2 兜底）。 */
  readonly #recallCount = new Map<string, number>();

  constructor(options: ContextRecallServiceOptions = {}) {
    this.#defaultMaxBytes = options.defaultMaxBytes ?? DEFAULT_MAX_BYTES;
    this.#perToolCallIdMaxBytes = options.perToolCallIdMaxBytes ?? this.#defaultMaxBytes * 4;
    this.#perToolCallIdMaxCount = options.perToolCallIdMaxCount ?? 8;
  }

  /** 默认单次召回字节上限（供 Governor 初始化与诊断用）。 */
  get defaultMaxBytes(): number {
    return this.#defaultMaxBytes;
  }

  /**
   * 从 append-only #items 按 toolCallId 查原始 tool_result 并切片返回。
   *
   * 切片顺序：先按 startLine/endLine 行切片，再按 maxBytes 字节切片。
   * 行切片以 \n 为分隔（保留换行），1-based 含首尾。
   *
   * @param items Runtime #items（append-only 源，崩溃恢复后为已脱敏项）
   * @param args 召回参数
   */
  recall(items: readonly ModelInputItem[], args: ContextRecallArgs): ContextRecallResult {
    if (!args.toolCallId || typeof args.toolCallId !== 'string') {
      return { ok: false, error: 'invalid_arguments', message: 'toolCallId is required' };
    }

    // K2 兜底：先校验 per-toolCallId 累计预算
    const cumulativeBytes = this.#recallBytes.get(args.toolCallId) ?? 0;
    const cumulativeCount = this.#recallCount.get(args.toolCallId) ?? 0;
    if (cumulativeCount >= this.#perToolCallIdMaxCount) {
      return {
        ok: false,
        error: 'recall_budget_exceeded',
        message: `recall count limit reached for toolCallId ${args.toolCallId}`,
      };
    }

    // 查原始 tool_result（#items 中 toolCallId 匹配的 tool_result 项）
    const original = findToolResult(items, args.toolCallId);
    if (original === undefined) {
      return {
        ok: false,
        error: 'tool_result_not_found',
        message: `no tool_result found for toolCallId ${args.toolCallId}`,
      };
    }

    const originalBytes = byteLength(original);

    // 解析 maxBytes：未传或超过默认上限时用默认上限
    const requestedMaxBytes =
      typeof args.maxBytes === 'number' && args.maxBytes > 0
        ? Math.min(args.maxBytes, this.#defaultMaxBytes)
        : this.#defaultMaxBytes;

    // K2 兜底：本次召回后累计字节不得超过 perToolCallIdMaxBytes
    const remainingBudget = this.#perToolCallIdMaxBytes - cumulativeBytes;
    if (remainingBudget <= 0) {
      return {
        ok: false,
        error: 'recall_budget_exceeded',
        message: `recall byte budget exhausted for toolCallId ${args.toolCallId}`,
      };
    }
    const effectiveMaxBytes = Math.min(requestedMaxBytes, remainingBudget);

    // 行切片（startLine/endLine，1-based 含首尾）
    let sliced = sliceByLines(original, args.startLine, args.endLine);

    // 字节切片（effectiveMaxBytes）
    const beforeByteSlice = byteLength(sliced);
    let truncated = false;
    if (beforeByteSlice > effectiveMaxBytes) {
      sliced = takeFromStart(sliced, effectiveMaxBytes);
      truncated = true;
    }

    // 更新 per-toolCallId 累计预算（K2）
    const recalledBytes = byteLength(sliced);
    this.#recallBytes.set(args.toolCallId, cumulativeBytes + recalledBytes);
    this.#recallCount.set(args.toolCallId, cumulativeCount + 1);

    return {
      ok: true,
      content: sliced,
      truncated,
      originalBytes,
    };
  }

  /**
   * 重置某 toolCallId 的召回预算（一般用于测试或会话重置）。
   */
  resetBudget(toolCallId: string): void {
    this.#recallBytes.delete(toolCallId);
    this.#recallCount.delete(toolCallId);
  }
}

/** 从 #items 中按 toolCallId 查 tool_result 的原始 content。 */
function findToolResult(items: readonly ModelInputItem[], toolCallId: string): string | undefined {
  for (const item of items) {
    // ModelMessage 无 type 字段，需先用 'role' in item 排除
    if ('role' in item) continue;
    if (item.type === 'tool_result' && item.toolCallId === toolCallId) {
      return item.content;
    }
  }
  return undefined;
}

/**
 * 按行切片（1-based，含首尾）。
 * - startLine 未传或 < 1 → 从首行开始。
 * - endLine 未传 → 到末行。
 * - 行以 \n 分隔，保留行内换行语义。
 */
function sliceByLines(content: string, startLine?: number, endLine?: number): string {
  const start = typeof startLine === 'number' && startLine > 0 ? startLine : 1;
  if (start === 1 && endLine === undefined) return content;

  // 用 split 保留行结构；lines[i] 对应第 (i+1) 行
  const lines = content.split('\n');
  const end =
    typeof endLine === 'number' && endLine > 0 ? Math.min(endLine, lines.length) : lines.length;
  if (start > lines.length) return '';
  const slice = lines.slice(start - 1, end);
  return slice.join('\n');
}

/** UTF-8 字节长度。 */
function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/**
 * 字节安全的头部切片：按字符迭代，累加 UTF-8 字节，超 maxBytes 即停。
 * 复用 command-output-collector.ts 的 proven 模式（避免截断多字节字符边界）。
 */
function takeFromStart(value: string, maxBytes: number): string {
  let bytes = 0;
  let result = '';
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (bytes + characterBytes > maxBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}
