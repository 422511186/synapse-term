import { describe, expect, it } from 'vitest';

import type { ContextGovernanceState } from '@synapse-term/domain';
import type { ModelInputItem } from '@synapse-term/model-providers';

import type { ContextBudget } from './context-budget.js';
import { ContextGovernor, type GovernanceProjectInput } from './context-governor.js';
import { ToolResultSpiller, type SpillInput, type SpillOutput } from './tool-result-spiller.js';

// =============================================================================
// ContextGovernor TDD（Ch35/36/37 + Decision 1/3：cache-stable 投影 + 增量状态）
// -----------------------------------------------------------------------------
// 覆盖 task 1.14 四条断言：
//  1. 前缀跨非压缩轮稳定（cache-stable：无压缩事件时前缀不漂移，只随压缩事件变）
//  2. #items append-only 不被改（投影操作 clone，源 #items 不变；ADR-0018 原件保留精神）
//  3. 投影增量不每轮全量重算（#spillStates Map 命中 → 不重新 spill 判定）
//  4. ContextGovernanceState 持久化（upsert 快照 + 防抖回调）+ 崩溃恢复不重分类
//     + 持久化失败 fail closed/下轮重建
//
// 注：Reactive 闸门、LayeredCompactor 分层、ThreeGateCompactor 在阶段 2 落地，
//     此处只验阶段 1 的 cache-stable 投影 + 增量状态 + 持久化契约。
// =============================================================================

/** 构造含一条 tool_result（及配对 assistant_tool_call）的 #items。 */
function itemsWithToolResult(
  toolCallId: string,
  toolName: string,
  content: string,
): ModelInputItem[] {
  return [
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: '请执行' },
    { type: 'assistant_tool_call', toolCallId, name: toolName, argumentsJson: '{}' },
    { type: 'tool_result', toolCallId, content, isError: false },
  ];
}

/** 构造大预算 ContextBudget（小项不触发 proactive 闸门，隔离压缩路径便于专测投影）。 */
function makeBudget(inputTokens: number): ContextBudget {
  return {
    inputTokens,
    compactAtTokens: Math.floor(inputTokens * 0.95),
    compactTargetTokens: Math.floor(inputTokens * 0.6),
    reservedOutputTokens: Math.max(1, Math.floor(inputTokens * 0.1)),
    reservedToolTokens: 1024,
    proactiveTokens: Math.floor(inputTokens * 0.9),
    preflightTokens: Math.floor(inputTokens * 0.95),
    reactiveOnOverflow: true,
  };
}

/** 构造 project 输入（budget 默认大预算，小项不触发压缩）。 */
function makeInput(
  conversationId: string,
  items: ModelInputItem[],
  overrides: Partial<GovernanceProjectInput> = {},
): GovernanceProjectInput {
  return {
    conversationId,
    items,
    budget: makeBudget(10_000),
    currentTurn: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** 计数 Spiller：记录 spill() 调用入参，用于断言增量不重算（#spillStates Map 命中）。 */
class CountingSpiller extends ToolResultSpiller {
  readonly #calls: SpillInput[] = [];
  override spill(input: SpillInput): SpillOutput {
    this.#calls.push(input);
    return super.spill(input);
  }
  get calls(): readonly SpillInput[] {
    return this.#calls;
  }
}

describe('ContextGovernor', () => {
  describe('前缀跨非压缩轮稳定（cache-stable 投影）', () => {
    it('无压缩事件时，追加新项后前轮投影仍是前轮投影的前缀（前缀不随每轮漂移）', async () => {
      // cache-stable 核心契约：前缀稳定点只随【压缩事件】变，不随每轮 append 变。
      // 前删路径每轮删最老项 → 前缀每轮漂移 → prompt cache 每轮 miss；
      // Governor 用"保留前缀 + append recent-tail"替换前删，前缀在无压缩时稳定。
      const governor = new ContextGovernor();
      const items1 = itemsWithToolResult('call-1', 'terminal_observe', 'small result');
      const r1 = await governor.project(makeInput('conv-1', items1));

      // 第二轮：追加新项（模拟下一轮 turn），不触发压缩
      const items2: ModelInputItem[] = [...items1, { role: 'assistant', content: 'done' }];
      const r2 = await governor.project(makeInput('conv-1', items2, { currentTurn: 2 }));

      expect(r1.compacted).toBe(false);
      expect(r2.compacted).toBe(false);
      // 第一轮投影是第二轮投影的前缀（前缀稳定点未变，只在尾部 append）
      expect(r2.items.slice(0, r1.items.length)).toEqual(r1.items);
    });

    it('已外溢 tool_result 的替换文本在两轮间稳定（增量命中，不重新外溢产生漂移）', async () => {
      // 已外溢的 toolCallId 第二轮走 buildSpillReplacementFromRecord（从持久化 preview 头尾重建），
      // 不重新调 spiller.spill → 替换文本两轮一致，不因重新外溢产生前缀漂移。
      const governor = new ContextGovernor();
      const large = 'x'.repeat(10_000); // > 8KB 触发外溢
      const items = itemsWithToolResult('call-spill', 'terminal_observe', large);
      const r1 = await governor.project(makeInput('conv-1', items, { currentTurn: 1 }));
      const r2 = await governor.project(makeInput('conv-1', items, { currentTurn: 2 }));

      // 两轮替换文本一致（同一 toolCallId 增量命中）
      expect(r1.items[3]).toEqual(r2.items[3]);
      const replaced = r1.items[3];
      if (replaced !== undefined && 'type' in replaced && replaced.type === 'tool_result') {
        // 替换文本含指针，不含全量原件（防全量回灌）
        expect(replaced.content).toContain('[spilled:call-spill, re-issuable]');
        expect(replaced.content).not.toContain(large);
      }
    });
  });

  describe('#items append-only 不被改（ADR-0018 原件保留精神）', () => {
    it('project 操作 clone，源 #items 内容不被 mutate', async () => {
      // Governor 投影只读 #items：role/未外溢项原样 push 同一引用（只读不改），
      // 外溢项 push 新对象（replacement 副本）。源 #items 的任何元素都不被改写。
      const governor = new ContextGovernor();
      const large = 'y'.repeat(10_000);
      const items = itemsWithToolResult('call-readonly', 'terminal_execute', large);
      const snapshot = items.map((i) => ({ ...i }));

      await governor.project(makeInput('conv-1', items));

      // 源 #items 仍是原始内容（投影路径只读不改源）
      expect(items).toEqual(snapshot);
    });

    it('已外溢的 tool_result 原始内容仍完整保留在 #items（投影只替换副本）', async () => {
      // 外溢只在投影路径用 preview+指针替换；原始全量内容仍完整留在 append-only #items，
      // context_recall 可凭指针从 #items 取回所需片段——信息不销毁（ADR-0018 精神）。
      const governor = new ContextGovernor();
      const large = 'z'.repeat(10_000);
      const items = itemsWithToolResult('call-preserve', 'terminal_observe', large);

      await governor.project(makeInput('conv-1', items));

      const toolResult = items[3];
      if (toolResult !== undefined && 'type' in toolResult && toolResult.type === 'tool_result') {
        // 原始 tool_result 内容未被截断/替换
        expect(toolResult.content).toBe(large);
      }
    });
  });

  describe('投影增量不每轮全量重算（#spillStates Map 命中）', () => {
    it('已外溢的 toolCallId 第二轮不再调用 spiller.spill（增量命中）', async () => {
      // 增量核心：首次 spill 判定后写入 #spillStates（keyed by toolCallId，非 item index），
      // 后续轮次命中 Map → 走 buildSpillReplacementFromRecord，不重付 Spiller 判定。
      const spiller = new CountingSpiller();
      const governor = new ContextGovernor({ spiller });
      const large = 'a'.repeat(10_000);
      const items = itemsWithToolResult('call-once', 'terminal_observe', large);

      await governor.project(makeInput('conv-1', items, { currentTurn: 1 }));
      expect(spiller.calls).toHaveLength(1);

      await governor.project(makeInput('conv-1', items, { currentTurn: 2 }));
      // 第二轮同一 toolCallId 已在 #spillStates → 不重新 spill
      expect(spiller.calls).toHaveLength(1);
    });

    it('未外溢（达阈值以下）的 toolCallId 第二轮也不再重新判定（增量命中）', async () => {
      // 未外溢项首次判定后写入 placeholder（spilled:false）进 #spillStates，
      // 第二轮命中 Map → 直接保留原内容，不重新调 spiller.spill 判定。
      // （placeholder 防止 #items append 导致每轮重新扫描全量未外溢项。）
      const spiller = new CountingSpiller();
      const governor = new ContextGovernor({ spiller });
      const small = 'small result'; // < 8KB 不外溢
      const items = itemsWithToolResult('call-nospill', 'terminal_observe', small);

      await governor.project(makeInput('conv-1', items, { currentTurn: 1 }));
      expect(spiller.calls).toHaveLength(1);

      await governor.project(makeInput('conv-1', items, { currentTurn: 2 }));
      // 第二轮已分类（placeholder）→ 增量命中，不重新判定
      expect(spiller.calls).toHaveLength(1);
    });

    it('新 toolCallId 才触发首次 spill 判定（增量边界正确）', async () => {
      // 增量边界：已分类的 toolCallId 不重判，未分类的新 toolCallId 才首次判定。
      const spiller = new CountingSpiller();
      const governor = new ContextGovernor({ spiller });
      const large = 'b'.repeat(10_000);

      await governor.project(
        makeInput('conv-1', itemsWithToolResult('call-a', 'terminal_observe', large), {
          currentTurn: 1,
        }),
      );
      expect(spiller.calls).toHaveLength(1);

      // 第二轮追加新 tool_result（新 toolCallId call-b）
      const items2: ModelInputItem[] = [
        ...itemsWithToolResult('call-a', 'terminal_observe', large),
        {
          type: 'assistant_tool_call',
          toolCallId: 'call-b',
          name: 'terminal_observe',
          argumentsJson: '{}',
        },
        { type: 'tool_result', toolCallId: 'call-b', content: large, isError: false },
      ];
      await governor.project(makeInput('conv-1', items2, { currentTurn: 2 }));
      // call-a 增量命中不重判，call-b 首次判定 → 累计 2 次
      expect(spiller.calls).toHaveLength(2);
      expect(spiller.calls[1]!.toolCallId).toBe('call-b');
    });
  });

  describe('ContextGovernanceState 持久化 + 崩溃恢复 + fail closed', () => {
    it('产新 spill 时经 onGovernanceState 发出 upsert 快照（schemaVersion=1）', async () => {
      // 持久化契约：新 spill/tier 分类时标 governanceDirty → 经 onGovernanceState
      // 发出按 conversationId 整体 upsert 的快照（coordinator 防抖约 2s 落盘）。
      const captured: ContextGovernanceState[] = [];
      const governor = new ContextGovernor({
        onGovernanceState: (state) => captured.push(state),
      });
      const large = 'c'.repeat(10_000);

      await governor.project(
        makeInput('conv-gov', itemsWithToolResult('call-spill', 'terminal_observe', large)),
      );

      expect(captured).toHaveLength(1);
      expect(captured[0]!.conversationId).toBe('conv-gov');
      expect(captured[0]!.schemaVersion).toBe(1);
      // spillRecords 只含已外溢的（防抖 upsert 整体替换，非增量 append）
      expect(captured[0]!.spillRecords).toHaveLength(1);
      expect(captured[0]!.spillRecords[0]!.toolCallId).toBe('call-spill');
      expect(captured[0]!.seenToolCallIds).toContain('call-spill');
    });

    it('snapshot 只持久化已外溢记录（placeholder 不进 spillRecords / seen）', async () => {
      // 持久化只存已外溢记录的元数据 + 小 preview；未外溢的 placeholder 不持久化
      // （崩溃恢复后未外溢项会被重新扫描，但 idempotent —— shouldSpill 仍 false）。
      const governor = new ContextGovernor();
      const items: ModelInputItem[] = [
        { role: 'system', content: 'sys' },
        {
          type: 'assistant_tool_call',
          toolCallId: 'call-small',
          name: 'terminal_observe',
          argumentsJson: '{}',
        },
        { type: 'tool_result', toolCallId: 'call-small', content: 'small', isError: false },
        {
          type: 'assistant_tool_call',
          toolCallId: 'call-large',
          name: 'terminal_observe',
          argumentsJson: '{}',
        },
        {
          type: 'tool_result',
          toolCallId: 'call-large',
          content: 'L'.repeat(10_000),
          isError: false,
        },
      ];
      await governor.project(makeInput('conv-mix', items));

      const snapshot = governor.snapshotState('conv-mix');
      // 只持久化已外溢的 call-large，未外溢的 call-small 不进 spillRecords
      expect(snapshot.spillRecords).toHaveLength(1);
      expect(snapshot.spillRecords[0]!.toolCallId).toBe('call-large');
      expect(snapshot.seenToolCallIds).toContain('call-large');
      // 未外溢项不进 seen（防全量回灌只针对已外溢的）
      expect(snapshot.seenToolCallIds).not.toContain('call-small');
    });

    it('无新 spill/tier 分类时不触发 onGovernanceState（非 dirty 不落盘）', async () => {
      // governanceDirty 只在新 spill/tier 分类时置真；未外溢项的 placeholder 不标 dirty，
      // 第二轮增量命中（无新分类）也不落盘——避免每轮无变化都写盘。
      const captured: ContextGovernanceState[] = [];
      const governor = new ContextGovernor({
        onGovernanceState: (state) => captured.push(state),
      });
      const large = 'm'.repeat(10_000);
      const items = itemsWithToolResult('call-2', 'terminal_observe', large);

      await governor.project(makeInput('conv-1', items, { currentTurn: 1 }));
      expect(captured).toHaveLength(1); // 首轮外溢 → 落盘一次

      await governor.project(makeInput('conv-1', items, { currentTurn: 2 }));
      // 第二轮增量命中（无新 spill）→ 不落盘
      expect(captured).toHaveLength(1);

      // 未外溢项不标 dirty：单独验证
      const captured2: ContextGovernanceState[] = [];
      const governor2 = new ContextGovernor({
        onGovernanceState: (state) => captured2.push(state),
      });
      await governor2.project(
        makeInput('conv-2', itemsWithToolResult('call-small', 'terminal_observe', 'small')),
      );
      expect(captured2).toHaveLength(0);
    });

    it('崩溃恢复：rebuild 从持久化状态重建，不重新外溢（不调 spiller.spill）', async () => {
      // 崩溃恢复契约：Governor 从持久化 ContextGovernanceState 重建 spill/tier/Seen，
      // 不重新分类、不重新外溢（分类可能调过摘要器，重付不可接受）。
      // rebuild 只加载已外溢记录 → project 时走 buildSpillReplacementFromRecord。
      const spiller1 = new CountingSpiller();
      const governor1 = new ContextGovernor({ spiller: spiller1 });
      const large = 'd'.repeat(10_000);
      const items = itemsWithToolResult('call-recover', 'terminal_observe', large);
      await governor1.project(makeInput('conv-recover', items));
      const snapshot = governor1.snapshotState('conv-recover');
      expect(spiller1.calls).toHaveLength(1);

      // 模拟崩溃后新进程：新 Governor 实例从快照 rebuild
      const spiller2 = new CountingSpiller();
      const governor2 = new ContextGovernor({ spiller: spiller2 });
      governor2.rebuild(snapshot);

      // rebuild 后投影：已外溢 toolCallId 走 buildSpillReplacementFromRecord，不重新 spill
      const r = await governor2.project(makeInput('conv-recover', items));
      expect(spiller2.calls).toHaveLength(0); // 不重新外溢（崩溃恢复不重分类）
      // 投影仍含指针替换（从持久化 preview 头尾重建，稳定一致）
      const replaced = r.items[3];
      if (replaced !== undefined && 'type' in replaced && replaced.type === 'tool_result') {
        expect(replaced.content).toContain('[spilled:call-recover, re-issuable]');
        expect(replaced.content).not.toContain(large);
      }
    });

    it('崩溃恢复后 Seen set 重建：未外溢项被重新扫描（idempotent，仍不外溢）', async () => {
      // 未外溢项的 placeholder 不持久化 → 崩溃恢复后 #spillStates 无该项 →
      // project 时重新 spill 判定，但 idempotent（shouldSpill 仍 false）。
      // 这保证未持久化的 placeholder 不致恢复后误外溢。
      const spiller1 = new CountingSpiller();
      const governor1 = new ContextGovernor({ spiller: spiller1 });
      const items = itemsWithToolResult('call-small', 'terminal_observe', 'small');
      await governor1.project(makeInput('conv-recover2', items));
      const snapshot = governor1.snapshotState('conv-recover2');
      // 未外溢 → snapshot 无 spillRecords
      expect(snapshot.spillRecords).toHaveLength(0);

      // 崩溃恢复：新 Governor rebuild（空 spillRecords）后重新扫描
      const spiller2 = new CountingSpiller();
      const governor2 = new ContextGovernor({ spiller: spiller2 });
      governor2.rebuild(snapshot);
      await governor2.project(makeInput('conv-recover2', items));

      // 重新判定一次（idempotent：shouldSpill 仍 false，不外溢）
      expect(spiller2.calls).toHaveLength(1);
      const r = await governor2.project(makeInput('conv-recover2', items, { currentTurn: 2 }));
      // 第二轮又命中 placeholder → 不重判
      expect(spiller2.calls).toHaveLength(1);
      const toolResult = r.items[3];
      if (toolResult !== undefined && 'type' in toolResult && toolResult.type === 'tool_result') {
        expect(toolResult.content).toBe('small'); // 未外溢，原样保留
      }
    });

    it('持久化失败 fail closed：project 抛错但内存分类已落（下轮不重分类）', async () => {
      // fail closed / 下轮重建契约：持久化回调（onGovernanceState）抛错时 project fail closed
      // （抛错，不静默继续）；但步骤 1 的外溢分类已在步骤 3 抛错前落进内存 #spillStates，
      // 下轮重建不重分类（内存态权威，MUST NOT 内存/持久化静默不一致）。
      const spiller = new CountingSpiller();
      const governor = new ContextGovernor({
        spiller,
        onGovernanceState: () => {
          throw new Error('persist unavailable');
        },
      });
      const large = 'e'.repeat(10_000);
      const items = itemsWithToolResult('call-fail', 'terminal_observe', large);

      // 持久化回调抛错 → fail closed（project 抛错，不静默吞）
      await expect(governor.project(makeInput('conv-fail', items))).rejects.toThrow(
        'persist unavailable',
      );
      // 但步骤 1 的外溢分类已在抛错前落进内存 → 下轮重建不重分类
      expect(spiller.calls).toHaveLength(1);

      // 下轮：同一 Governor，内存 #spillStates 仍有分类 → 增量命中不重判，
      // 且无新 dirty（增量命中）→ 不再触发抛错的持久化回调 → project 正常返回
      const r2 = await governor.project(makeInput('conv-fail', items, { currentTurn: 2 }));
      expect(spiller.calls).toHaveLength(1);
      expect(r2.governanceDirty).toBe(false);
    });
  });
});
