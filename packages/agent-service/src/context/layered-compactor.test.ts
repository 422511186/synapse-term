import { describe, expect, it } from 'vitest';

import type { TierClassification } from '@synapse-term/domain';
import type { ModelInputItem } from '@synapse-term/model-providers';

import {
  LayeredCompactor,
  type LayeredCompactInput,
  type LayeredSummaryProducer,
} from './layered-compactor.js';

// =============================================================================
// LayeredCompactor TDD（Ch37 分层压缩 + Decision 1 cache-stable 投影）
// -----------------------------------------------------------------------------
// 覆盖 task 2.7 四条断言：
//  1. 距离分层正确（Tier3 ≤8 / Tier2 9-19 / Tier1 ≥20）
//  2. Tier2 floor 保护内容工具（local_read_file/local_search_files/local_list_files
//     永不降级到 Tier2 摘要，始终 Tier3 全量）
//  3. 每 pass 语义尝试上限 2 退化为确定性截断（attempt 硬上限，全失败走 head+tail 截断）
//  4. tool_use_id 配对（Tier1 保留 tool_use 只桩化 result；Tier2 摘要整块替换不产生孤儿；
//     Tier2 截断保留 tool_use 只截断 result）
//
// 距离定义：distance = currentTurn − originTurn（toolCallTurns 提供 originTurn）。
// =============================================================================

/** 构造一条 role 消息。 */
function msg(role: 'system' | 'user' | 'assistant', content: string): ModelInputItem {
  return { role, content };
}

/** 构造一条 assistant_tool_call（默认 terminal_observe，非 floor 保护）。 */
function call(toolCallId: string, name = 'terminal_observe'): ModelInputItem {
  return { type: 'assistant_tool_call', toolCallId, name, argumentsJson: '{}' };
}

/** 构造一条 tool_result。 */
function result(toolCallId: string, content = 'ok', isError = false): ModelInputItem {
  return { type: 'tool_result', toolCallId, content, isError };
}

/** 构造 compact 输入。 */
function makeInput(
  items: ModelInputItem[],
  overrides: Partial<LayeredCompactInput> = {},
): LayeredCompactInput {
  return {
    conversationId: 'conv-1',
    items,
    currentTurn: 30,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** 计数估算器：每条 item 固定 token 数，便于精确控制 Tier2 阈值触发。 */
function perItemEstimator(tokensPerItem: number): (items: readonly ModelInputItem[]) => number {
  return (items) => items.length * tokensPerItem;
}

/** 判断投影中某 toolCallId 是否有配对的 tool_call + tool_result（无孤儿）。 */
function hasPair(items: ModelInputItem[], toolCallId: string): boolean {
  const hasCall = items.some(
    (i) => !('role' in i) && i.type === 'assistant_tool_call' && i.toolCallId === toolCallId,
  );
  const hasResult = items.some(
    (i) => !('role' in i) && i.type === 'tool_result' && i.toolCallId === toolCallId,
  );
  return hasCall && hasResult;
}

/** 取投影中某 toolCallId 的 tool_result 内容（无则 undefined）。 */
function resultContentOf(items: ModelInputItem[], toolCallId: string): string | undefined {
  for (const i of items) {
    if (!('role' in i) && i.type === 'tool_result' && i.toolCallId === toolCallId) return i.content;
  }
  return undefined;
}

/** 记录调用次数的假摘要生产者。 */
function fakeSummaryProducer(
  responses: (string | undefined)[] = ['fake tier2 summary'],
): LayeredSummaryProducer & { calls: number } {
  let calls = 0;
  const producer: LayeredSummaryProducer = async () => {
    const idx = calls;
    calls += 1;
    // 超出数组的尝试返回 undefined（表示该次摘要失败），不回退到最后一个响应——
    // 否则显式 undefined（本意"失败"）会被 ?? 替换成成功值，掩盖 attempt 序列语义。
    return responses[idx];
  };
  // 注意：必须用 defineProperty 装活 getter——Object.assign 会把 getter 求值一次后
  // 拷贝为静态值 0，导致计数器永远读不到调用次数。
  Object.defineProperty(producer, 'calls', { get: () => calls });
  return producer as LayeredSummaryProducer & { calls: number };
}

describe('LayeredCompactor', () => {
  describe('距离分层正确（Tier3 ≤8 / Tier2 9-19 / Tier1 ≥20）', () => {
    it('按距离分类：dist≥20→tier1 桩化 / dist 9-19→tier2 / dist≤8→tier3 全量', async () => {
      // currentTurn=30；t1@turn5(dist25→tier1) / t2@turn15(dist15→tier2) / t3@turn25(dist5→tier3)
      // perItem(10)：单对 20 tokens 远低于 2000 阈值 → Tier2 保留全量（不摘要）
      const compactor = new LayeredCompactor({
        estimateTokens: perItemEstimator(10),
      });
      const items: ModelInputItem[] = [
        msg('system', 'sys'),
        msg('user', 'goal'),
        call('t1'),
        result('t1', 'old result tier1'),
        call('t2'),
        result('t2', 'mid result tier2'),
        call('t3'),
        result('t3', 'new result tier3'),
      ];
      const turns = new Map([
        ['t1', 5],
        ['t2', 15],
        ['t3', 25],
      ]);
      const r = await compactor.compact(makeInput(items, { toolCallTurns: turns }));

      expect(r.compacted).toBe(true);
      // 首次分类 3 条
      expect(r.newClassifications).toHaveLength(3);
      const byId = new Map(r.newClassifications.map((c) => [c.toolCallId, c.tier]));
      expect(byId.get('t1')).toBe('tier1');
      expect(byId.get('t2')).toBe('tier2');
      expect(byId.get('t3')).toBe('tier3');

      // Tier1 result 桩化（元数据单行）
      const t1Content = resultContentOf(r.items, 't1');
      expect(t1Content).toContain('[archived:t1');
      expect(t1Content).toContain('tool=terminal_observe');
      expect(t1Content).toContain('error=false');
      // Tier2 未超阈值 → 保留全量
      expect(resultContentOf(r.items, 't2')).toBe('mid result tier2');
      // Tier3 → 保留全量
      expect(resultContentOf(r.items, 't3')).toBe('new result tier3');
    });

    it('Tier1 桩保留 error 状态（isError=true 时桩标记 error=true）', async () => {
      const compactor = new LayeredCompactor({ estimateTokens: perItemEstimator(10) });
      const items: ModelInputItem[] = [
        msg('system', 'sys'),
        msg('user', 'goal'),
        call('e1'),
        result('e1', 'boom', true),
      ];
      const turns = new Map([['e1', 5]]); // dist 25 → tier1
      const r = await compactor.compact(makeInput(items, { toolCallTurns: turns }));

      const content = resultContentOf(r.items, 'e1');
      expect(content).toContain('error=true');
    });

    it('toolCallTurns 缺失的 toolCallId 视为 distance=0（保守不降级→tier3 全量）', async () => {
      const compactor = new LayeredCompactor({ estimateTokens: perItemEstimator(10) });
      const items: ModelInputItem[] = [
        msg('system', 'sys'),
        msg('user', 'goal'),
        call('u1'),
        result('u1', 'unknown origin'),
      ];
      // 不提供 toolCallTurns → distance=0 → tier3
      const r = await compactor.compact(makeInput(items));

      const cls = r.newClassifications.find((c) => c.toolCallId === 'u1');
      expect(cls?.tier).toBe('tier3');
      expect(resultContentOf(r.items, 'u1')).toBe('unknown origin');
    });

    it('Tier2 组未超阈值：保留全量，不产 tier2Compaction', async () => {
      const producer = fakeSummaryProducer();
      const compactor = new LayeredCompactor({
        summaryProducer: producer,
        estimateTokens: perItemEstimator(10), // 单对 20 tokens < 2000
      });
      const items: ModelInputItem[] = [
        msg('system', 'sys'),
        msg('user', 'goal'),
        call('m1'),
        result('m1', 'mid'),
      ];
      const turns = new Map([['m1', 15]]); // tier2
      const r = await compactor.compact(makeInput(items, { toolCallTurns: turns }));

      expect(r.tier2Compaction).toBeUndefined();
      expect(producer.calls).toBe(0); // 未超阈值不调摘要器
      expect(resultContentOf(r.items, 'm1')).toBe('mid'); // 全量保留
    });
  });

  describe('Tier2 floor 保护内容工具', () => {
    it('local_read_file 即使距离 tier2 区间也分类为 tier3（ground truth 不摘要）', async () => {
      const compactor = new LayeredCompactor({ estimateTokens: perItemEstimator(10) });
      const items: ModelInputItem[] = [
        msg('system', 'sys'),
        msg('user', 'goal'),
        call('f1', 'local_read_file'),
        result('f1', 'FILE CONTENT line1\nline2\nline3'),
      ];
      const turns = new Map([['f1', 15]]); // dist 15 本应 tier2，但 floor 保护 → tier3
      const r = await compactor.compact(makeInput(items, { toolCallTurns: turns }));

      const cls = r.newClassifications.find((c) => c.toolCallId === 'f1');
      expect(cls?.tier).toBe('tier3');
      expect(resultContentOf(r.items, 'f1')).toBe('FILE CONTENT line1\nline2\nline3');
    });

    it('local_search_files / local_list_files 同受 floor 保护', async () => {
      const compactor = new LayeredCompactor({ estimateTokens: perItemEstimator(10) });
      const items: ModelInputItem[] = [
        msg('system', 'sys'),
        msg('user', 'goal'),
        call('s1', 'local_search_files'),
        result('s1', 'search hits'),
        call('l1', 'local_list_files'),
        result('l1', 'file list'),
      ];
      const turns = new Map([
        ['s1', 15],
        ['l1', 15],
      ]); // 均本应 tier2
      const r = await compactor.compact(makeInput(items, { toolCallTurns: turns }));

      const cls = r.newClassifications;
      expect(cls.find((c) => c.toolCallId === 's1')?.tier).toBe('tier3');
      expect(cls.find((c) => c.toolCallId === 'l1')?.tier).toBe('tier3');
      expect(resultContentOf(r.items, 's1')).toBe('search hits');
      expect(resultContentOf(r.items, 'l1')).toBe('file list');
    });

    it('floor 保护工具在 tier1 距离（≥20）仍保持 tier3（永不降级）', async () => {
      const compactor = new LayeredCompactor({ estimateTokens: perItemEstimator(10) });
      const items: ModelInputItem[] = [
        msg('system', 'sys'),
        msg('user', 'goal'),
        call('old', 'local_read_file'),
        result('old', 'old file content'),
      ];
      const turns = new Map([['old', 1]]); // dist 29 本应 tier1，但 floor 保护 → tier3
      const r = await compactor.compact(makeInput(items, { toolCallTurns: turns }));

      const cls = r.newClassifications.find((c) => c.toolCallId === 'old');
      expect(cls?.tier).toBe('tier3');
      expect(resultContentOf(r.items, 'old')).toBe('old file content'); // 未桩化
    });
  });

  describe('每 pass 语义尝试上限 2 退化为确定性截断', () => {
    it('摘要器全失败：调用恰好 2 次后退化为 per-item 确定性截断（head+tail ≤cap）', async () => {
      const producer = fakeSummaryProducer([undefined, undefined]); // 两次都失败
      const compactor = new LayeredCompactor({
        summaryProducer: producer,
        estimateTokens: perItemEstimator(1_500), // 单对 2×1500=3000 > 2000 → 触发摘要
        tier2SummaryCap: 20,
        maxSemanticAttempts: 2,
      });
      const longContent = 'A'.repeat(100);
      const items: ModelInputItem[] = [
        msg('system', 'sys'),
        msg('user', 'goal'),
        call('m1'),
        result('m1', longContent),
      ];
      const turns = new Map([['m1', 15]]); // tier2
      const r = await compactor.compact(makeInput(items, { toolCallTurns: turns }));

      expect(producer.calls).toBe(2); // 恰好 2 次（attempt 硬上限）
      expect(r.tier2Compaction).toBeUndefined(); // 摘要失败 → 无 compaction 记录
      // 退化为确定性截断：result ≤20 chars 且含截断标记
      const content = resultContentOf(r.items, 'm1');
      expect(content).toBeDefined();
      expect(content!.length).toBeLessThanOrEqual(20);
      expect(content).toContain('…');
    });

    it('摘要器首次失败、二次成功：第 2 次采纳，产 tier2Compaction（gate=layered tier=tier2）', async () => {
      const producer = fakeSummaryProducer([undefined, 'valid tier2 summary text']);
      const compactor = new LayeredCompactor({
        summaryProducer: producer,
        estimateTokens: perItemEstimator(1_500),
        maxSemanticAttempts: 2,
      });
      const items: ModelInputItem[] = [
        msg('system', 'sys'),
        msg('user', 'goal'),
        call('m1'),
        result('m1', 'mid content'),
      ];
      const turns = new Map([['m1', 15]]);
      const r = await compactor.compact(makeInput(items, { toolCallTurns: turns }));

      expect(producer.calls).toBe(2);
      expect(r.tier2Compaction).toBeDefined();
      expect(r.tier2Compaction?.gate).toBe('layered');
      expect(r.tier2Compaction?.tier).toBe('tier2');
      expect(r.tier2Compaction?.summaryMethod).toBe('provider');
      expect(r.tier2Compaction?.summary).toContain('valid tier2 summary text');
    });

    it('摘要器抛异常：不传播，继续重试至上限后退化为截断', async () => {
      let calls = 0;
      const producer: LayeredSummaryProducer = async () => {
        calls += 1;
        throw new Error('summary service down');
      };
      const compactor = new LayeredCompactor({
        summaryProducer: producer,
        estimateTokens: perItemEstimator(1_500),
        tier2SummaryCap: 15,
        maxSemanticAttempts: 2,
      });
      const items: ModelInputItem[] = [
        msg('system', 'sys'),
        msg('user', 'goal'),
        call('m1'),
        result('m1', 'X'.repeat(80)),
      ];
      const turns = new Map([['m1', 15]]);
      const r = await compactor.compact(makeInput(items, { toolCallTurns: turns }));

      expect(calls).toBe(2);
      expect(r.tier2Compaction).toBeUndefined();
      const content = resultContentOf(r.items, 'm1');
      expect(content!.length).toBeLessThanOrEqual(15);
    });

    it('未注入 summaryProducer：Tier2 超阈值直接走确定性截断（不抛错）', async () => {
      const compactor = new LayeredCompactor({
        estimateTokens: perItemEstimator(1_500),
        tier2SummaryCap: 20,
      });
      const items: ModelInputItem[] = [
        msg('system', 'sys'),
        msg('user', 'goal'),
        call('m1'),
        result('m1', 'Y'.repeat(100)),
      ];
      const turns = new Map([['m1', 15]]);
      const r = await compactor.compact(makeInput(items, { toolCallTurns: turns }));

      expect(r.tier2Compaction).toBeUndefined();
      const content = resultContentOf(r.items, 'm1');
      expect(content!.length).toBeLessThanOrEqual(20);
      expect(content).toContain('…');
    });
  });

  describe('tool_use_id 配对（不产生孤儿）', () => {
    it('Tier1：保留 assistant_tool_call，只桩化 tool_result（配对完整）', async () => {
      const compactor = new LayeredCompactor({ estimateTokens: perItemEstimator(10) });
      const items: ModelInputItem[] = [
        msg('system', 'sys'),
        msg('user', 'goal'),
        call('t1'),
        result('t1', 'old'),
      ];
      const turns = new Map([['t1', 5]]); // tier1
      const r = await compactor.compact(makeInput(items, { toolCallTurns: turns }));

      expect(hasPair(r.items, 't1')).toBe(true); // tool_use + tool_result 都在
      // result 已桩化（不再是原文 'old'）
      expect(resultContentOf(r.items, 't1')).not.toBe('old');
    });

    it('Tier2 摘要成功：整块（tool_use + result）替换为单个摘要段，无孤儿', async () => {
      const producer = fakeSummaryProducer(['consolidated tier2 summary']);
      const compactor = new LayeredCompactor({
        summaryProducer: producer,
        estimateTokens: perItemEstimator(1_500), // 超阈值触发摘要
      });
      // 两个 Tier2 对（m1, m2）应被合并为单个摘要段
      const items: ModelInputItem[] = [
        msg('system', 'sys'),
        msg('user', 'goal'),
        call('m1'),
        result('m1', 'mid1 content'),
        call('m2'),
        result('m2', 'mid2 content'),
      ];
      const turns = new Map([
        ['m1', 15],
        ['m2', 16],
      ]);
      const r = await compactor.compact(makeInput(items, { toolCallTurns: turns }));

      expect(r.tier2Compaction).toBeDefined();
      // m1/m2 的 tool_use 与 tool_result 都不应出现在投影中（整块替换）
      const m1CallExists = r.items.some(
        (i) => !('role' in i) && i.type === 'assistant_tool_call' && i.toolCallId === 'm1',
      );
      const m1ResultExists = r.items.some(
        (i) => !('role' in i) && i.type === 'tool_result' && i.toolCallId === 'm1',
      );
      const m2CallExists = r.items.some(
        (i) => !('role' in i) && i.type === 'assistant_tool_call' && i.toolCallId === 'm2',
      );
      expect(m1CallExists).toBe(false);
      expect(m1ResultExists).toBe(false);
      expect(m2CallExists).toBe(false);
      // 单个摘要段（system 消息，含 Tier2 摘要前缀，区别于开头 system 消息）
      const summarySegments = r.items.filter(
        (i): i is Extract<ModelInputItem, { role: string }> =>
          'role' in i && i.role === 'system' && String(i.content).includes('历史工具摘要'),
      );
      expect(summarySegments).toHaveLength(1);
      expect(String(summarySegments[0]!.content)).toContain('consolidated tier2 summary');
    });

    it('Tier2 截断退化：保留 tool_use，只截断 result（配对完整）', async () => {
      const compactor = new LayeredCompactor({
        estimateTokens: perItemEstimator(1_500),
        tier2SummaryCap: 20,
        maxSemanticAttempts: 2,
      }); // 无 producer → 截断
      const items: ModelInputItem[] = [
        msg('system', 'sys'),
        msg('user', 'goal'),
        call('m1'),
        result('m1', 'Z'.repeat(100)),
      ];
      const turns = new Map([['m1', 15]]);
      const r = await compactor.compact(makeInput(items, { toolCallTurns: turns }));

      // tool_use + tool_result 都在（配对完整）
      expect(hasPair(r.items, 'm1')).toBe(true);
      // result 被截断（不再是 100 个 Z）
      const content = resultContentOf(r.items, 'm1');
      expect(content!.length).toBeLessThanOrEqual(20);
    });

    it('混合三层：Tier1 桩 + Tier2 段 + Tier3 全量，全部配对完整无孤儿', async () => {
      const producer = fakeSummaryProducer(['mixed tier2 summary']);
      const compactor = new LayeredCompactor({
        summaryProducer: producer,
        estimateTokens: perItemEstimator(1_500), // Tier2 超阈值触发摘要
      });
      // t1(tier1, dist25) / m1(tier2, dist15) / n1(tier3, dist5)
      const items: ModelInputItem[] = [
        msg('system', 'sys'),
        msg('user', 'goal'),
        call('t1'),
        result('t1', 'old tier1'),
        call('m1'),
        result('m1', 'mid tier2 content'),
        call('n1'),
        result('n1', 'new tier3'),
      ];
      const turns = new Map([
        ['t1', 5],
        ['m1', 15],
        ['n1', 25],
      ]);
      const r = await compactor.compact(makeInput(items, { toolCallTurns: turns }));

      expect(r.compacted).toBe(true);
      // Tier1：tool_use 保留 + result 桩化（配对完整）
      expect(hasPair(r.items, 't1')).toBe(true);
      expect(resultContentOf(r.items, 't1')).toContain('[archived:t1');
      // Tier2：整块替换（无 tool_use/result 残留）
      expect(hasPair(r.items, 'm1')).toBe(false);
      // Tier3：全量保留（配对完整 + 原文）
      expect(hasPair(r.items, 'n1')).toBe(true);
      expect(resultContentOf(r.items, 'n1')).toBe('new tier3');
      // 全局无孤儿：每个出现的 tool_call 都有对应 tool_result，反之亦然
      const calls = r.items.filter(
        (i): i is Extract<ModelInputItem, { type: 'assistant_tool_call' }> =>
          !('role' in i) && i.type === 'assistant_tool_call',
      );
      const results = r.items.filter(
        (i): i is Extract<ModelInputItem, { type: 'tool_result' }> =>
          !('role' in i) && i.type === 'tool_result',
      );
      const callIds = new Set(calls.map((c) => c.toolCallId));
      const resultIds = new Set(results.map((rr) => rr.toolCallId));
      for (const id of callIds) expect(resultIds.has(id)).toBe(true);
      for (const id of resultIds) expect(callIds.has(id)).toBe(true);
    });
  });

  describe('first-touch 分类（持久化 + 崩溃恢复不重分类）', () => {
    it('第二次 compact 同一 toolCallId 不重复分类（newClassifications 为空）', async () => {
      const compactor = new LayeredCompactor({ estimateTokens: perItemEstimator(10) });
      const items: ModelInputItem[] = [
        msg('system', 'sys'),
        msg('user', 'goal'),
        call('t1'),
        result('t1', 'old'),
      ];
      const turns = new Map([['t1', 5]]);
      const r1 = await compactor.compact(makeInput(items, { toolCallTurns: turns }));
      expect(r1.newClassifications).toHaveLength(1);

      // 第二次：同 toolCallId，即使距离变了也不重分类（first-touch 锁定）
      const r2 = await compactor.compact(
        makeInput(items, { toolCallTurns: turns, currentTurn: 100 }),
      );
      expect(r2.newClassifications).toHaveLength(0); // 不重分类
      expect(r2.governanceDirty).toBe(false);
      // 层级仍是首次分类的 tier1（不是按新距离 95 重新算）
      expect(compactor.getClassification('t1')?.tier).toBe('tier1');
    });

    it('restoreClassifications：崩溃恢复后载入既有分类，不重新分类', async () => {
      const compactor = new LayeredCompactor({ estimateTokens: perItemEstimator(10) });
      // 模拟崩溃恢复：持久化的分类记录
      const persisted: TierClassification[] = [
        { toolCallId: 't1', tier: 'tier1', classifiedAtTurn: 30 },
        { toolCallId: 'm1', tier: 'tier2', classifiedAtTurn: 30 },
      ];
      compactor.restoreClassifications(persisted);

      const items: ModelInputItem[] = [
        msg('system', 'sys'),
        msg('user', 'goal'),
        call('t1'),
        result('t1', 'old'),
        call('m1'),
        result('m1', 'mid'),
      ];
      const turns = new Map([
        ['t1', 5],
        ['m1', 15],
      ]);
      const r = await compactor.compact(makeInput(items, { toolCallTurns: turns }));

      // 既有分类已载入 → 不产生新分类
      expect(r.newClassifications).toHaveLength(0);
      expect(r.governanceDirty).toBe(false);
      // 但投影仍按既有分类应用（t1 桩化、m2 视阈值保留/摘要）
      expect(resultContentOf(r.items, 't1')).toContain('[archived:t1');
    });

    it('#items append-only：源数组不被修改（投影是新数组）', async () => {
      const compactor = new LayeredCompactor({ estimateTokens: perItemEstimator(10) });
      const items: ModelInputItem[] = [
        msg('system', 'sys'),
        msg('user', 'goal'),
        call('t1'),
        result('t1', 'original'),
      ];
      const turns = new Map([['t1', 5]]);
      const snapshot = JSON.stringify(items);
      await compactor.compact(makeInput(items, { toolCallTurns: turns }));

      expect(JSON.stringify(items)).toBe(snapshot); // 源未变
    });
  });
});
