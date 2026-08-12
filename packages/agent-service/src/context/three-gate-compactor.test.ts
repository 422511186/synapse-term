import { describe, expect, it } from 'vitest';

import type { ConversationCompaction } from '@synapse-term/domain';
import type { ModelInputItem } from '@synapse-term/model-providers';

import type { ContextBudget } from './context-budget.js';
import {
  ThreeGateCompactor,
  type SummaryProducer,
  type ThreeGateCompactInput,
  type ThreeGateThresholds,
} from './three-gate-compactor.js';

// =============================================================================
// ThreeGateCompactor TDD（Ch35 三道闸门 + Decision 1 cache-stable 投影）
// -----------------------------------------------------------------------------
// 覆盖 task 2.6 六条断言：
//  1. 0.90 Proactive 闸门触发（估算 > proactiveTokens → 压缩）
//  2. 0.95 Preflight 闸门触发（估算 > preflightTokens → 更激进压缩，recent 收到 floor）
//  3. Reactive 恢复超窗错误（外部触发 → never-reset 标志）
//  4. 重试仅一次（reactiveRetryAvailable → markReactiveRetryUsed → 不再可用）
//  5. 边界修复 tool_use/tool_result 对（recent-tail 不产生孤儿 tool_call/tool_result）
//  6. recent floor 3 对（至少保留 3 个 tool_call/tool_result 配对）
//
// cache-stable 投影核心（Decision 1）：opening + summary-segment + recent-tail，
// 前缀稳定点只随压缩事件变，不随每轮变。
// =============================================================================

/** 构造一条 role 消息。 */
function msg(role: 'system' | 'user' | 'assistant', content: string): ModelInputItem {
  return { role, content };
}

/** 构造一条 assistant_tool_call。 */
function call(toolCallId: string, name = 'terminal_observe'): ModelInputItem {
  return { type: 'assistant_tool_call', toolCallId, name, argumentsJson: '{}' };
}

/** 构造一条 tool_result。 */
function result(toolCallId: string, content = 'ok'): ModelInputItem {
  return { type: 'tool_result', toolCallId, content, isError: false };
}

/** 构造一个典型 ReAct 对话：system + user + N 个 tool_call/tool_result 对。 */
function reactConversation(pairs: number): ModelInputItem[] {
  const items: ModelInputItem[] = [msg('system', 'sys'), msg('user', 'goal')];
  for (let i = 1; i <= pairs; i += 1) {
    items.push(call(`c${i}`), result(`c${i}`));
  }
  return items;
}

/** 构造三闸门阈值（inputTokens 派生 0.90 / 0.95）。 */
function thresholds(inputTokens: number): ThreeGateThresholds {
  return {
    proactiveTokens: Math.floor(inputTokens * 0.9),
    preflightTokens: Math.floor(inputTokens * 0.95),
    reactiveOnOverflow: true,
  };
}

/** 构造 compact 输入。 */
function makeInput(
  items: ModelInputItem[],
  overrides: Partial<ThreeGateCompactInput> = {},
): ThreeGateCompactInput {
  return {
    conversationId: 'conv-1',
    items,
    thresholds: thresholds(1_000),
    currentTurn: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** 假摘要生产者：返回固定摘要记录，记录 gate 与 middle 项数。 */
function fakeSummaryProducer(): SummaryProducer & { calls: SummaryProducerInputRecord[] } {
  const calls: SummaryProducerInputRecord[] = [];
  const producer: SummaryProducer = async (input) => {
    calls.push({
      gate: input.gate,
      itemCount: input.items.length,
      conversationId: input.conversationId,
    });
    const compaction: ConversationCompaction = {
      id: 'sum-1',
      conversationId: input.conversationId,
      throughSequence: input.throughSequence ?? input.items.length,
      summary: 'fake summary of middle segment',
      sourceItemCount: input.items.length,
      estimatedTokensBefore: 100,
      createdAt: input.createdAt,
      summaryMethod: 'provider',
      gate: input.gate,
      schemaVersion: 1,
    };
    return compaction;
  };
  return Object.assign(producer, { calls });
}

interface SummaryProducerInputRecord {
  gate: string;
  itemCount: number;
  conversationId: string;
}

/** 计数估算器：每条 item 固定 token 数，便于精确控制闸门触发。 */
function perItemEstimator(tokensPerItem: number): (items: readonly ModelInputItem[]) => number {
  return (items) => items.length * tokensPerItem;
}

describe('ThreeGateCompactor', () => {
  describe('闸门触发（0.90 Proactive / 0.95 Preflight / Reactive）', () => {
    it('低于 Proactive 阈值：不压缩，原样返回（cache-stable：无压缩事件前缀不变）', async () => {
      // inputTokens=1100 → proactive=990, preflight=1045
      // 9 items × 100 = 900 < 990 → 无闸门触发
      const compactor = new ThreeGateCompactor({
        summaryProducer: fakeSummaryProducer(),
        estimateTokens: perItemEstimator(100),
      });
      const items = reactConversation(4); // 2 + 8 = 10... 用更少
      const small = items.slice(0, 9);
      const r = await compactor.compact(
        makeInput(small, { thresholds: thresholds(1_100) }),
      );

      expect(r.compacted).toBe(false);
      expect(r.gate).toBeUndefined();
      expect(r.items).toEqual(small);
      expect(r.reactiveFired).toBe(false);
    });

    it('超过 0.90 Proactive 但未达 0.95 Preflight：触发 Proactive 压缩', async () => {
      // inputTokens=1100 → proactive=990, preflight=1045
      // reactConversation(4) = 2 + 8 = 10 items × 100 = 1000
      // 1000 > 990 (proactive) 且 1000 ≤ 1045 (未达 preflight)
      // proactiveRecentPairs 收到 3（≤ 4 对，确保 middle 非空可压缩）
      const producer = fakeSummaryProducer();
      const compactor = new ThreeGateCompactor({
        summaryProducer: producer,
        estimateTokens: perItemEstimator(100),
        proactiveRecentPairs: 3,
      });
      const items = reactConversation(4); // 10 items → 1000 tokens
      const r = await compactor.compact(
        makeInput(items, { thresholds: thresholds(1_100) }),
      );

      expect(r.compacted).toBe(true);
      expect(r.gate).toBe('proactive');
      expect(r.reactiveFired).toBe(false);
      // 摘要生产者被调用，gate 标为 proactive
      expect(producer.calls).toHaveLength(1);
      expect(producer.calls[0]!.gate).toBe('proactive');
    });

    it('超过 0.95 Preflight：触发 Preflight 压缩（比 Proactive 更激进）', async () => {
      // inputTokens=1000 → proactive=900, preflight=950
      // 10 items × 100 = 1000 > 950 → preflight
      const producer = fakeSummaryProducer();
      const compactor = new ThreeGateCompactor({
        summaryProducer: producer,
        estimateTokens: perItemEstimator(100),
      });
      const items = reactConversation(8);
      const r = await compactor.compact(makeInput(items));

      expect(r.compacted).toBe(true);
      expect(r.gate).toBe('preflight');
      expect(producer.calls[0]!.gate).toBe('preflight');
    });

    it('Reactive 外部触发：压缩并置 never-reset 标志（后续轮即使 token 低也走 reactive）', async () => {
      const producer = fakeSummaryProducer();
      const compactor = new ThreeGateCompactor({
        summaryProducer: producer,
        estimateTokens: perItemEstimator(10), // 低估算，单独不会触发
      });
      expect(compactor.reactiveTriggered).toBe(false);

      const items = reactConversation(8);
      // 首轮：外部触发 reactive
      const r1 = await compactor.compact(makeInput(items, { reactiveTriggered: true }));
      expect(r1.gate).toBe('reactive');
      expect(r1.reactiveFired).toBe(true);
      expect(compactor.reactiveTriggered).toBe(true);

      // 第二轮：无外部触发，但 never-reset 标志已置 → 仍走 reactive
      const r2 = await compactor.compact(makeInput(items));
      expect(r2.gate).toBe('reactive');
      expect(r2.reactiveFired).toBe(true);
    });
  });

  describe('Reactive 单次重试预算（never-reset + retry-once）', () => {
    it('reactiveRetryAvailable：触发后可用，markReactiveRetryUsed 后不再可用', () => {
      const compactor = new ThreeGateCompactor({
        summaryProducer: fakeSummaryProducer(),
        estimateTokens: perItemEstimator(10),
      });
      // 未触发 reactive 时不可用
      expect(compactor.reactiveRetryAvailable).toBe(false);

      // 模拟触发
      compactor.compact(makeInput(reactConversation(4), { reactiveTriggered: true }));
      expect(compactor.reactiveTriggered).toBe(true);
      expect(compactor.reactiveRetryUsed).toBe(false);
      expect(compactor.reactiveRetryAvailable).toBe(true);

      // 标记重试已用（#run() 重试后调用）
      compactor.markReactiveRetryUsed();
      expect(compactor.reactiveRetryUsed).toBe(true);
      expect(compactor.reactiveRetryAvailable).toBe(false);
    });

    it('restoreReactive：崩溃恢复重建 never-reset 标志（不重置已用重试）', () => {
      const compactor = new ThreeGateCompactor({
        summaryProducer: fakeSummaryProducer(),
        estimateTokens: perItemEstimator(10),
      });
      // 模拟崩溃恢复：持久化状态显示 reactive 已触发 + 重试已用
      compactor.restoreReactive(true, true);
      expect(compactor.reactiveTriggered).toBe(true);
      expect(compactor.reactiveRetryUsed).toBe(true);
      expect(compactor.reactiveRetryAvailable).toBe(false);
    });
  });

  describe('三段保留（opening / summary / recent，floor 3 对）', () => {
    it('opening（system + 首条 user）始终保留，不被压缩进摘要', async () => {
      const compactor = new ThreeGateCompactor({
        summaryProducer: fakeSummaryProducer(),
        estimateTokens: perItemEstimator(10),
      });
      const items = reactConversation(8);
      const r = await compactor.compact(makeInput(items, { reactiveTriggered: true }));

      expect(r.compacted).toBe(true);
      // opening = [system, user] 保留在投影头部
      const opening0 = r.items[0];
      expect(opening0).toEqual(msg('system', 'sys'));
      const opening1 = r.items[1];
      expect(opening1).toEqual(msg('user', 'goal'));
    });

    it('recent floor 3 对：至少保留 3 个 tool_call/tool_result 配对（Preflight/Reactive 收 floor）', async () => {
      const compactor = new ThreeGateCompactor({
        summaryProducer: fakeSummaryProducer(),
        estimateTokens: perItemEstimator(10),
        recentFloorPairs: 3,
      });
      const items = reactConversation(8); // 8 对
      const r = await compactor.compact(makeInput(items, { reactiveTriggered: true }));

      expect(r.compacted).toBe(true);
      // recent-tail 至少 3 对 = 6 条 tool 项（3 call + 3 result）
      const recentTail = r.items.slice(2); // 跳过 opening 2 条 + 摘要 1 条 = 跳过 3
      // 实际跳过 opening(2) + summary(1) = 3
      const toolItems = recentTail.filter(
        (i): i is Extract<ModelInputItem, { type: 'tool_result' | 'assistant_tool_call' }> =>
          !('role' in i),
      );
      const callsInRecent = toolItems.filter((i) => i.type === 'assistant_tool_call');
      const resultsInRecent = toolItems.filter((i) => i.type === 'tool_result');
      expect(callsInRecent.length).toBe(3);
      expect(resultsInRecent.length).toBe(3);
    });

    it('Proactive 闸门保留更多 recent（proactiveRecentPairs > floor）', async () => {
      // inputTokens=170 → proactive=153, preflight=161
      // reactConversation(7) = 2 + 14 = 16 items × 10 = 160
      // 160 > 153 (proactive) 且 160 ≤ 161 (未达 preflight)
      // proactiveRecentPairs=6 → recent=6 对，middle=1 对（非空可压缩）
      const compactor = new ThreeGateCompactor({
        summaryProducer: fakeSummaryProducer(),
        estimateTokens: perItemEstimator(10),
        recentFloorPairs: 3,
        proactiveRecentPairs: 6,
      });
      const items = reactConversation(7); // 7 对 = 16 items
      const r = await compactor.compact(makeInput(items, { thresholds: thresholds(170) }));

      expect(r.gate).toBe('proactive');
      // proactive 保留 6 对 recent（6 个 call + 6 个 result）
      const toolItems = r.items.filter(
        (i): i is Extract<ModelInputItem, { type: 'tool_result' | 'assistant_tool_call' }> =>
          !('role' in i),
      );
      const callsInRecent = toolItems.filter((i) => i.type === 'assistant_tool_call');
      expect(callsInRecent.length).toBe(6);
    });

    it('摘要段替换老段：投影 = opening + summary-segment + recent-tail（cache-stable）', async () => {
      const compactor = new ThreeGateCompactor({
        summaryProducer: fakeSummaryProducer(),
        estimateTokens: perItemEstimator(10),
        recentFloorPairs: 3,
      });
      const items = reactConversation(8);
      const r = await compactor.compact(makeInput(items, { reactiveTriggered: true }));

      // 投影结构：[system, user, summary-system, ...recent(3 pairs=6 items)]
      expect(r.items.length).toBe(2 + 1 + 6);
      // 第三条是摘要 system 消息
      const summaryItem = r.items[2];
      if (summaryItem !== undefined && 'role' in summaryItem) {
        expect(summaryItem.role).toBe('system');
        expect(summaryItem.content).toContain('对话摘要');
        expect(summaryItem.content).toContain('fake summary of middle segment');
      } else {
        expect.fail('summary item should be a system message');
      }
    });
  });

  describe('tool_use/tool_result 对边界修复（无孤儿）', () => {
    it('recent-tail 不拆散 batched tool_calls：同批 c1,c2 + r1,r2 整组保留或整组进摘要', async () => {
      // 结构：[sys, user, c1, c2, r1, r2, c3, r3, c4, r4, c5, r5]
      // batch [c1,c2,r1,r2] 是一个原子单元；floor 3 对 → recent 从尾取 3 对
      const compactor = new ThreeGateCompactor({
        summaryProducer: fakeSummaryProducer(),
        estimateTokens: perItemEstimator(10),
        recentFloorPairs: 3,
      });
      const items: ModelInputItem[] = [
        msg('system', 'sys'),
        msg('user', 'goal'),
        call('c1'),
        call('c2'),
        result('c1'),
        result('c2'),
        call('c3'),
        result('c3'),
        call('c4'),
        result('c4'),
        call('c5'),
        result('c5'),
      ];
      const r = await compactor.compact(makeInput(items, { reactiveTriggered: true }));

      expect(r.compacted).toBe(true);
      // recent-tail 中的每个 tool_call 都必须有对应的 tool_result，反之亦然
      const recentTail = r.items.slice(3); // 跳过 opening(2) + summary(1)
      const recentCalls = recentTail.filter(
        (i): i is Extract<ModelInputItem, { type: 'assistant_tool_call' }> =>
          !('role' in i) && i.type === 'assistant_tool_call',
      );
      const recentResults = recentTail.filter(
        (i): i is Extract<ModelInputItem, { type: 'tool_result' }> =>
          !('role' in i) && i.type === 'tool_result',
      );
      const callIds = new Set(recentCalls.map((c) => c.toolCallId));
      const resultIds = new Set(recentResults.map((r) => r.toolCallId));
      // 每个 call 都有对应 result
      for (const id of callIds) expect(resultIds.has(id)).toBe(true);
      // 每个 result 都有对应 call
      for (const id of resultIds) expect(callIds.has(id)).toBe(true);
      // batch [c1,c2,r1,r2] 要么全在 recent，要么全不在（不拆散）
      const c1InRecent = callIds.has('c1');
      const c2InRecent = callIds.has('c2');
      expect(c1InRecent).toBe(c2InRecent); // 同批同进退
    });

    it('items 不足 floor 时不压缩（middle 为空则原样返回）', async () => {
      const compactor = new ThreeGateCompactor({
        summaryProducer: fakeSummaryProducer(),
        estimateTokens: perItemEstimator(10),
        recentFloorPairs: 3,
      });
      // 只有 2 对 + opening = 6 items，floor 3 对 → recent 需 3 对但只有 2 对
      const items: ModelInputItem[] = [
        msg('system', 'sys'),
        msg('user', 'goal'),
        call('c1'),
        result('c1'),
        call('c2'),
        result('c2'),
      ];
      const r = await compactor.compact(makeInput(items, { reactiveTriggered: true }));

      // 不足 floor → middle 为空 → 不压缩，原样返回
      expect(r.compacted).toBe(false);
      expect(r.items).toEqual(items);
    });
  });

  describe('摘要生产失败降级', () => {
    it('summaryProducer 抛错：返回未压缩投影（不破坏投影，Reactive 由 #run() 决定 fail closed）', async () => {
      const compactor = new ThreeGateCompactor({
        summaryProducer: async () => {
          throw new Error('summary unavailable');
        },
        estimateTokens: perItemEstimator(10),
      });
      const items = reactConversation(8);
      const r = await compactor.compact(makeInput(items, { reactiveTriggered: true }));

      expect(r.compacted).toBe(false);
      expect(r.items).toEqual(items);
      // reactive 仍 fired（never-reset 标志已置）
      expect(r.reactiveFired).toBe(true);
      expect(compactor.reactiveTriggered).toBe(true);
    });

    it('summaryProducer 返回 undefined：返回未压缩投影', async () => {
      const compactor = new ThreeGateCompactor({
        summaryProducer: async () => undefined,
        estimateTokens: perItemEstimator(10),
      });
      const items = reactConversation(8);
      const r = await compactor.compact(makeInput(items, { reactiveTriggered: true }));

      expect(r.compacted).toBe(false);
      expect(r.items).toEqual(items);
    });

    it('未注入 summaryProducer：用确定性兜底产摘要（不抛错）', async () => {
      const compactor = new ThreeGateCompactor({
        estimateTokens: perItemEstimator(10),
      });
      const items = reactConversation(8);
      const r = await compactor.compact(makeInput(items, { reactiveTriggered: true }));

      expect(r.compacted).toBe(true);
      expect(r.compaction).toBeDefined();
      expect(r.compaction?.summaryMethod).toBe('deterministic');
    });
  });
});
