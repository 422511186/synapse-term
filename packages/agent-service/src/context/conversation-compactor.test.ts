import { describe, expect, it } from 'vitest';

import { createModelItem } from '@synapse-term/domain';

import { ConversationCompactor } from './conversation-compactor.js';
import { estimateModelItemsTokens } from './token-estimator.js';

describe('ConversationCompactor', () => {
  it('produces a durable summary record without compacting projected items', async () => {
    // 角色收窄后：Compactor 只产摘要记录，不装配 history、不判阈值。
    // 输入是已投影的 ModelInputItem[]；压缩范围由 Governor 三闸门决定。
    const items = [
      { role: 'user' as const, content: '旧问题'.repeat(80) },
      { role: 'assistant' as const, content: '旧结论'.repeat(80) },
      {
        type: 'assistant_tool_call' as const,
        toolCallId: 'call-1',
        name: 'terminal_observe',
        argumentsJson: '{}',
      },
      {
        type: 'tool_result' as const,
        toolCallId: 'call-1',
        content: '{"status":"observed","output":"ok"}',
        isError: false,
      },
    ];
    const result = await new ConversationCompactor({
      idFactory: () => 'compaction-1',
    }).produceSummary({
      conversationId: 'conversation-1',
      items,
      summaryBudgetTokens: 80,
      maxOutputTokens: 80,
      gate: 'proactive',
      throughSequence: 4,
      createdAt: '2026-07-28T00:00:00.000Z',
    });

    expect(result.compaction).toMatchObject({
      id: 'compaction-1',
      throughSequence: 4,
      summary: expect.stringContaining('用户'),
      summaryMethod: 'deterministic',
      gate: 'proactive',
      schemaVersion: 1,
    });
    // 角色收窄：不再返回 history，投影交给 Governor。
    expect((result as { history?: unknown }).history).toBeUndefined();
  });

  it('uses a bounded asynchronous Provider summary over redacted structured evidence', async () => {
    const items = [
      {
        role: 'user' as const,
        content: '用户最终目标是部署服务，password=supersecret '.repeat(80),
      },
      {
        type: 'assistant_tool_call' as const,
        toolCallId: 'call-summary',
        name: 'terminal_execute',
        argumentsJson: '{"command":"deploy"}',
      },
      {
        type: 'tool_result' as const,
        toolCallId: 'call-summary',
        content: 'Bearer abcdefghijklmnop\n部署已完成 '.repeat(80),
        isError: false,
      },
    ];
    let callbackInput: string | undefined;
    const result = await new ConversationCompactor({
      idFactory: () => 'compaction-provider',
    }).produceSummary({
      conversationId: 'conversation-1',
      items,
      summaryBudgetTokens: 70,
      maxOutputTokens: 70,
      createdAt: '2026-07-28T00:00:00.000Z',
      summarize: async ({ items: summaryItems }) => {
        callbackInput = JSON.stringify(summaryItems);
        return '用户最终目标是部署服务；terminal_execute 已完成部署。';
      },
    });

    // 透传给 provider 回调的 items 必须脱敏（SecretRedactor）。
    expect(callbackInput).toContain('[REDACTED]');
    expect(callbackInput).not.toContain('supersecret');
    expect(callbackInput).not.toContain('abcdefghijklmnop');
    expect(result.compaction).toMatchObject({
      id: 'compaction-provider',
      summaryMethod: 'provider',
      summary: expect.stringContaining('最终目标'),
    });
    // 摘要本身也必须脱敏——不得回灌密钥到持久化记录。
    expect(result.compaction?.summary).not.toContain('supersecret');
  });

  it.each([
    [
      'throws',
      async () => {
        throw new Error('provider unavailable');
      },
    ],
    ['empty', async () => ''],
    ['tool-call', async () => ({ text: 'should not persist', hasToolCall: true })],
    ['oversized', async () => 'provider output '.repeat(2_000)],
  ])('falls back deterministically when Provider summary is %s', async (_reason, summarize) => {
    const items = [
      { role: 'user' as const, content: '目标是检查部署状态 '.repeat(80) },
      {
        type: 'tool_result' as const,
        toolCallId: 'call-fallback',
        content: 'failed: deployment is incomplete '.repeat(80),
        isError: true,
      },
    ];
    const result = await new ConversationCompactor({
      idFactory: () => 'compaction-fallback',
    }).produceSummary({
      conversationId: 'conversation-1',
      items,
      summaryBudgetTokens: 50,
      maxOutputTokens: 50,
      createdAt: '2026-07-28T00:00:00.000Z',
      summarize,
    });

    expect(result.compaction?.summaryMethod).toBe('deterministic');
    expect(result.compaction?.summary).toContain('用户');
    // provider 失败/空/tool-call/超预算时其输出不得持久化。
    expect(result.compaction?.summary).not.toContain('should not persist');
    // deterministic 摘要也要受 summaryBudgetTokens 约束（fitSummary 裁剪）。
    expect(estimateSummaryTokens(result.compaction?.summary ?? '')).toBeLessThanOrEqual(50);
  });

  it('fits the produced summary within the budget', async () => {
    const result = await new ConversationCompactor({
      idFactory: () => 'compaction-fit',
    }).produceSummary({
      conversationId: 'conversation-1',
      items: [{ role: 'user', content: 'x'.repeat(2_000) }],
      summaryBudgetTokens: 30,
      maxOutputTokens: 30,
      createdAt: '2026-07-28T00:00:00.000Z',
    });

    expect(estimateSummaryTokens(result.compaction?.summary ?? '')).toBeLessThanOrEqual(30);
  });

  it('re-fits an existing oversized summary when re-summarizing incrementally', async () => {
    const existing = {
      id: 'compaction-old',
      conversationId: 'conversation-1',
      throughSequence: 10,
      summary: '旧摘要'.repeat(1_000),
      sourceItemCount: 10,
      estimatedTokensBefore: 10_000,
      createdAt: '2026-07-27T00:00:00.000Z',
    };
    const result = await new ConversationCompactor().produceSummary({
      conversationId: 'conversation-1',
      items: [{ role: 'user', content: '继续' }],
      existing,
      summaryBudgetTokens: 40,
      maxOutputTokens: 40,
      createdAt: '2026-07-28T00:00:00.000Z',
    });

    // 增量摘要把既有摘要作 previousSummary，fitSummary 裁到预算内。
    expect(estimateSummaryTokens(result.compaction?.summary ?? '')).toBeLessThanOrEqual(40);
    expect(result.compaction?.sourceItemCount).toBeGreaterThan(existing.sourceItemCount);
  });

  it('loads existing compaction as a prefix summary without compressing', () => {
    // loadHistory：无压缩纯加载，为 Governor/Runtime 提供初始摘要上下文。
    const items = [
      createModelItem({
        id: 'item-1',
        conversationId: 'conversation-1',
        turnId: 'turn-old',
        sequence: 0,
        type: 'user_text',
        content: '旧问题',
      }),
      createModelItem({
        id: 'item-2',
        conversationId: 'conversation-1',
        turnId: 'turn-new',
        sequence: 2,
        type: 'user_text',
        content: '继续',
      }),
    ];
    const history = new ConversationCompactor().loadHistory({
      items,
      existing: {
        id: 'compaction-old',
        conversationId: 'conversation-1',
        throughSequence: 1,
        summary: '旧摘要',
        sourceItemCount: 2,
        estimatedTokensBefore: 500,
        createdAt: '2026-07-27T00:00:00.000Z',
      },
    });

    // 既有摘要作前缀 system 消息；throughSequence 之后的增量项原样保留。
    expect(history[0]).toEqual({ role: 'system', content: '对话摘要：\n旧摘要' });
    expect(history).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'user', content: '继续' })]),
    );
    // throughSequence=1 之前的旧项不回灌（sequence=0 的"旧问题"被排除）。
    expect(JSON.stringify(history)).not.toContain('旧问题');
  });

  it('loads history without a prefix summary when no existing compaction exists', () => {
    const items = [
      createModelItem({
        id: 'item-1',
        conversationId: 'conversation-1',
        turnId: 'turn-1',
        sequence: 0,
        type: 'user_text',
        content: '首轮问题',
      }),
    ];
    const history = new ConversationCompactor().loadHistory({ items });

    // 无既有摘要：不插前缀 system 消息，原样转 ModelInputItem。
    expect(history[0]).toMatchObject({ role: 'user', content: '首轮问题' });
    expect(history).toHaveLength(1);
  });
});

function estimateSummaryTokens(summary: string): number {
  return estimateModelItemsTokens([{ role: 'system', content: `对话摘要：\n${summary}` }]);
}
