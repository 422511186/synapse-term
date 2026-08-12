import type { ToolReissuabilityGrade, ToolResultSpillRecord } from '@synapse-term/domain';

// =============================================================================
// ToolResultSpiller（Ch36：超大 tool_result 外溢为 Preview+Pointer）
// -----------------------------------------------------------------------------
// 现状缺口：fitModelItems 的前删/截断路径会把超大 tool_result 头尾截断，
// 造成信息销毁——模型只能重跑命令付第二次代价。本模块按工具可重发性分级
// 外溢：把超大 tool_result 在【投影路径】替换为「头尾 preview + 指针」，
// 原始内容仍完整保留在 append-only #items（ADR-0018 原件保留精神不变），
// 模型可凭指针经 context_recall 工具显式召回所需片段。
//
// Seen set 语义（"防全量回灌"）：
//   投影路径不回灌被外溢 tool_result 的全量内容（只给 preview+指针），
//   但不阻止模型通过 context_recall 显式召回受限片段——召回走的是 #items
//   原始源，不经投影路径，Seen set 不拦截。
// =============================================================================

/** 单条 tool_result 的外溢阈值（字节）；超过才外溢。默认 8KB，低于 context_recall 默认上限 16KB，保证一次召回能取回有意义切片。 */
const DEFAULT_SPILL_THRESHOLD_BYTES = 8_192;
/** preview 头/尾各 ≤512 字节（Ch36 Preview+Pointer；与 ToolResultSpillRecord.previewHead/Tail 的 zod 上限对齐）。 */
const PREVIEW_MAX_BYTES = 512;

/**
 * 工具可重发性分级表（Ch36 + Decision 2）。
 * - `re-issuable`：可重发更窄查询取最新结果（如 local_read_file 带 startLine/endLine）。
 *   外溢策略激进——模型优先重发拿最新，context_recall 仅作备选。
 * - `not-replayable`：有副作用不可重放（terminal_execute 有副作用 / terminal_wait /
 *   terminal_interrupt / local_write_file / local_edit_file）。外溢策略保守，
 *   context_recall 是唯一取回途径。
 *
 * 兜底条款：上表未列出的任何未来工具默认 `not-replayable` + 保守 preview，
 * 直至显式分级（见 classifyReissuability 的 fallback）。
 */
const REISSUABILITY_TABLE: Readonly<Record<string, ToolReissuabilityGrade>> = {
  local_read_file: 're-issuable',
  local_search_files: 're-issuable',
  local_list_files: 're-issuable',
  terminal_observe: 're-issuable',
  // terminal_execute 按可重发性分两档（只读 ✅ / 有副作用 ⚠️），但投影时无法可靠判定
  // 命令是否无副作用（无风险分类上下文），故保守取 not-replayable。
  // Governor（task 1.6）持有风险分类时可经 SpillInput.grade 显式覆盖为 re-issuable。
  terminal_execute: 'not-replayable',
  terminal_wait: 'not-replayable',
  terminal_interrupt: 'not-replayable',
  local_write_file: 'not-replayable',
  local_edit_file: 'not-replayable',
  // context_recall 自身返回的是受限片段（≤maxBytes），属自 bounded 工具，不外溢。
  context_recall: 're-issuable',
};

/**
 * self-bounded 豁免集合：这些工具的结果不进外溢路径。
 * - `local_read_file`：工具自带 startLine/endLine/maxBytes，结果已自 bounded；
 *   模型可重发更窄区间拿最新，且 LayeredCompactor 的 Tier2 floor 会保护其内容
 *   不被语义摘要吞掉（Ch37）。故 Spiller 信任其 bound，不外溢。
 * - `context_recall`：返回的即是受限召回片段（≤16KB），外溢会造成「召回→外溢→再召回」
 *   的无意义递归；且片段是模型显式请求的，应原样留在投影中。
 */
const SELF_BOUNDED_EXEMPT: ReadonlySet<string> = new Set(['local_read_file', 'context_recall']);

/** 外溢判定输入。 */
export interface SpillInput {
  /** 被判定的 tool_result 的 toolCallId（召回键）。 */
  toolCallId: string;
  /** 产出该 tool_result 的工具名。 */
  toolName: string;
  /** tool_result 内容（投影前已脱敏）。 */
  content: string;
  /**
   * 可重发性分级覆盖。Governor 持有风险分类上下文时可显式传入
   * （例如判定某条 terminal_execute 为只读 → re-issuable）；
   * 未传则按 toolName 查分级表。
   */
  grade?: ToolReissuabilityGrade;
}

/** 外溢判定输出。 */
export interface SpillOutput {
  /** 是否外溢。false 时 record/replacement 均无意义，投影保留原内容。 */
  shouldSpill: boolean;
  /** 外溢记录（持久化进 ContextGovernanceState.spillRecords）。 */
  record?: ToolResultSpillRecord;
  /** 替换原内容的投影文本（指针 + 头尾 preview）。 */
  replacement?: string;
}

export interface ToolResultSpillerOptions {
  /** 外溢阈值（字节），默认 8KB。 */
  spillThresholdBytes?: number;
  /** preview 头/尾上限（字节），默认 512。 */
  previewMaxBytes?: number;
  /** 覆盖默认可重发性分级表（一般用于测试）。 */
  reissuabilityTable?: Readonly<Record<string, ToolReissuabilityGrade>>;
  /** 覆盖 self-bounded 豁免集合（一般用于测试）。 */
  exemptTools?: ReadonlySet<string>;
}

export class ToolResultSpiller {
  readonly #spillThresholdBytes: number;
  readonly #previewMaxBytes: number;
  readonly #reissuabilityTable: Readonly<Record<string, ToolReissuabilityGrade>>;
  readonly #exemptTools: ReadonlySet<string>;

  constructor(options: ToolResultSpillerOptions = {}) {
    this.#spillThresholdBytes = options.spillThresholdBytes ?? DEFAULT_SPILL_THRESHOLD_BYTES;
    this.#previewMaxBytes = options.previewMaxBytes ?? PREVIEW_MAX_BYTES;
    this.#reissuabilityTable = options.reissuabilityTable ?? REISSUABILITY_TABLE;
    this.#exemptTools = options.exemptTools ?? SELF_BOUNDED_EXEMPT;
  }

  /**
   * 按工具名查可重发性分级。未登记的工具走兜底条款默认 not-replayable
   * （保守 preview，副作用安全优先）。
   */
  classifyReissuability(toolName: string): ToolReissuabilityGrade {
    return this.#reissuabilityTable[toolName] ?? 'not-replayable';
  }

  /**
   * 判定一条 tool_result 是否需要外溢，并产出外溢记录 + 投影替换文本。
   *
   * 外溢条件（全部满足）：
   * 1. 工具不在 self-bounded 豁免集合内；
   * 2. 原始字节数 > 外溢阈值；
   * 3. 外溢后确有空间收益（原始字节 > 头尾 preview + 指针开销）——
   *    否则外溢反而变大，无意义。
   */
  spill(input: SpillInput): SpillOutput {
    // self-bounded 工具豁免：不外溢，投影保留原内容
    if (this.#exemptTools.has(input.toolName)) {
      return { shouldSpill: false };
    }

    const originalBytes = byteLength(input.content);
    // 未达阈值不外溢
    if (originalBytes <= this.#spillThresholdBytes) {
      return { shouldSpill: false };
    }

    const grade = input.grade ?? this.classifyReissuability(input.toolName);
    const previewHead = takeFromStart(input.content, this.#previewMaxBytes);
    const previewTail = takeFromEnd(input.content, this.#previewMaxBytes);
    const pointer = buildPointer(input.toolCallId, grade);
    const replacement = buildReplacement(pointer, previewHead, previewTail);

    // 外溢后若无空间收益则不外溢（preview+指针已超过原始字节）
    if (byteLength(replacement) >= originalBytes) {
      return { shouldSpill: false };
    }

    const record: ToolResultSpillRecord = {
      toolCallId: input.toolCallId,
      reissuability: grade,
      previewHead,
      previewTail,
      originalBytes,
    };

    return { shouldSpill: true, record, replacement };
  }
}

/**
 * 构造指针 token：`[spilled:toolCallId, re-issuable|not-replayable]`。
 * 模型与 context_recall 据此识别被外溢的 toolCallId 与可重发性，决定召回策略。
 */
export function buildPointer(toolCallId: string, grade: ToolReissuabilityGrade): string {
  return `[spilled:${toolCallId}, ${grade}]`;
}

/**
 * 构造投影替换文本：指针 + 头部 preview + 外溢标记 + 尾部 preview。
 * 头尾保留让模型看到结果首尾，中间用指针标注可召回。
 *
 * 导出供 ContextGovernor.rebuild() 从持久化 ToolResultSpillRecord 重建稳定替换文本
 * （崩溃恢复不重新外溢，直接用持久化的 preview 头尾重构替换）。
 */
export function buildReplacement(
  pointer: string,
  previewHead: string,
  previewTail: string,
): string {
  return `${pointer}\n${previewHead}\n…[外溢片段：使用 context_recall 召回]…\n${previewTail}`;
}

/**
 * 从持久化的 ToolResultSpillRecord 重建投影替换文本。
 * 崩溃恢复时 Governor 不重新判定外溢（不访问原始内容、不重付 Spiller 判定），
 * 直接用记录中的 previewHead/previewTail/reissuability/toolCallId 重构稳定替换。
 */
export function buildSpillReplacementFromRecord(record: ToolResultSpillRecord): string {
  return buildReplacement(
    buildPointer(record.toolCallId, record.reissuability),
    record.previewHead,
    record.previewTail,
  );
}

/** UTF-8 字节长度。 */
export function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/**
 * 字节安全的头部切片：按字符迭代，累加 UTF-8 字节，超 maxBytes 即停。
 * 复用 command-output-collector.ts 的 proven 模式（避免截断多字节字符边界）。
 */
export function takeFromStart(value: string, maxBytes: number): string {
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

/**
 * 字节安全的尾部切片：反向迭代取尾部字符，再正序拼回。
 * 与 takeFromStart 对称，保证不截断多字节字符。
 */
export function takeFromEnd(value: string, maxBytes: number): string {
  let bytes = 0;
  let result = '';
  for (const character of [...value].reverse()) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (bytes + characterBytes > maxBytes) break;
    result = character + result;
    bytes += characterBytes;
  }
  return result;
}
