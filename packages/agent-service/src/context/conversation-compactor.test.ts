import { describe, expect, it } from 'vitest';

import { createModelItem } from '@synapse-term/domain';

import { ConversationCompactor } from './conversation-compactor.js';
import { estimateModelItemsTokens } from './token-estimator.js';

describe('ConversationCompactor', () => {
  it('compacts old complete turns and keeps recent exact tool relationships', () => {
    const items = [
      createModelItem({
        id: 'item-1',
        conversationId: 'conversation-1',
        turnId: 'turn-old',
        sequence: 0,
        type: 'user_text',
        content: '旧问题'.repeat(80),
      }),
      createModelItem({
        id: 'item-2',
        conversationId: 'conversation-1',
        turnId: 'turn-old',
        sequence: 1,
        type: 'assistant_text',
        content: '旧结论'.repeat(80),
      }),
      createModelItem({
        id: 'item-3',
        conversationId: 'conversation-1',
        turnId: 'turn-new',
        sequence: 2,
        type: 'user_text',
        content: '继续检查',
      }),
      createModelItem({
        id: 'item-4',
        conversationId: 'conversation-1',
        turnId: 'turn-new',
        sequence: 3,
        type: 'assistant_tool_call',
        toolCallId: 'call-1',
        name: 'terminal_observe',
        argumentsJson: '{}',
      }),
      createModelItem({
        id: 'item-5',
        conversationId: 'conversation-1',
        turnId: 'turn-new',
        sequence: 4,
        type: 'tool_result',
        toolCallId: 'call-1',
        content: '{"status":"observed","output":"ok"}',
        isError: false,
      }),
    ];
    const result = new ConversationCompactor({ idFactory: () => 'compaction-1' }).compact({
      conversationId: 'conversation-1',
      items,
      thresholdTokens: 120,
      targetTokens: 80,
      createdAt: '2026-07-28T00:00:00.000Z',
    });

    expect(result.compaction).toMatchObject({
      id: 'compaction-1',
      throughSequence: 1,
      sourceItemCount: 2,
      summary: expect.stringContaining('旧问题'),
    });
    expect(result.history[0]).toMatchObject({
      role: 'system',
      content: expect.stringContaining('对话摘要'),
    });
    expect(result.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'assistant_tool_call', toolCallId: 'call-1' }),
        expect.objectContaining({ type: 'tool_result', toolCallId: 'call-1' }),
      ]),
    );
  });

  it('reuses an existing compaction when remaining history is below the threshold', () => {
    const result = new ConversationCompactor().compact({
      conversationId: 'conversation-1',
      items: [
        createModelItem({
          id: 'item-2',
          conversationId: 'conversation-1',
          turnId: 'turn-2',
          sequence: 2,
          type: 'user_text',
          content: '继续',
        }),
      ],
      existing: {
        id: 'compaction-old',
        conversationId: 'conversation-1',
        throughSequence: 1,
        summary: '旧摘要',
        sourceItemCount: 2,
        estimatedTokensBefore: 500,
        createdAt: '2026-07-27T00:00:00.000Z',
      },
      thresholdTokens: 500,
      targetTokens: 300,
      createdAt: '2026-07-28T00:00:00.000Z',
    });

    expect(result.compaction).toBeUndefined();
    expect(result.history[0]).toEqual({ role: 'system', content: '对话摘要：\n旧摘要' });
  });

  it('uses a bounded asynchronous Provider summary over redacted structured evidence', async () => {
    const items = [
      createModelItem({
        id: 'summary-user',
        conversationId: 'conversation-1',
        turnId: 'turn-old',
        sequence: 0,
        type: 'user_text',
        content: '用户最终目标是部署服务，password=supersecret '.repeat(80),
      }),
      createModelItem({
        id: 'summary-tool',
        conversationId: 'conversation-1',
        turnId: 'turn-old',
        sequence: 1,
        type: 'assistant_tool_call',
        toolCallId: 'call-summary',
        name: 'terminal_execute',
        argumentsJson: '{"command":"deploy"}',
      }),
      createModelItem({
        id: 'summary-result',
        conversationId: 'conversation-1',
        turnId: 'turn-old',
        sequence: 2,
        type: 'tool_result',
        toolCallId: 'call-summary',
        content: 'Bearer abcdefghijklmnop\n部署已完成 '.repeat(80),
        isError: false,
      }),
      createModelItem({
        id: 'summary-recent',
        conversationId: 'conversation-1',
        turnId: 'turn-new',
        sequence: 3,
        type: 'user_text',
        content: '继续验证',
      }),
    ];
    let callbackInput: string | undefined;
    const result = await new ConversationCompactor({
      idFactory: () => 'compaction-provider',
    }).compactAsync({
      conversationId: 'conversation-1',
      items,
      thresholdTokens: 100,
      targetTokens: 70,
      createdAt: '2026-07-28T00:00:00.000Z',
      summarize: async ({ items: summaryItems }) => {
        callbackInput = JSON.stringify(summaryItems);
        return '用户最终目标是部署服务；terminal_execute 已完成部署。';
      },
    });

    expect(callbackInput).toContain('[REDACTED]');
    expect(callbackInput).not.toContain('supersecret');
    expect(callbackInput).not.toContain('abcdefghijklmnop');
    expect(result.compaction).toMatchObject({
      id: 'compaction-provider',
      summaryMethod: 'provider',
      summary: expect.stringContaining('最终目标'),
    });
    expect(estimateModelItemsTokens(result.history)).toBeLessThanOrEqual(100);
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
    const result = await new ConversationCompactor({
      idFactory: () => 'compaction-fallback',
    }).compactAsync({
      conversationId: 'conversation-1',
      items: [
        createModelItem({
          id: 'fallback-user',
          conversationId: 'conversation-1',
          turnId: 'turn-old',
          sequence: 0,
          type: 'user_text',
          content: '目标是检查部署状态 '.repeat(80),
        }),
        createModelItem({
          id: 'fallback-result',
          conversationId: 'conversation-1',
          turnId: 'turn-old',
          sequence: 1,
          type: 'tool_result',
          toolCallId: 'call-fallback',
          content: 'failed: deployment is incomplete '.repeat(80),
          isError: true,
        }),
        createModelItem({
          id: 'fallback-recent',
          conversationId: 'conversation-1',
          turnId: 'turn-new',
          sequence: 2,
          type: 'user_text',
          content: '继续',
        }),
      ],
      thresholdTokens: 80,
      targetTokens: 50,
      createdAt: '2026-07-28T00:00:00.000Z',
      summarize,
    });

    expect(result.compaction?.summaryMethod).toBe('deterministic');
    expect(result.compaction?.summary).toContain('用户');
    expect(result.compaction?.summary).not.toContain('should not persist');
    expect(estimateModelItemsTokens(result.history)).toBeLessThanOrEqual(80);
  });

  it('re-fits an existing oversized summary before returning history', () => {
    const result = new ConversationCompactor().compact({
      conversationId: 'conversation-1',
      items: [],
      existing: {
        id: 'compaction-old',
        conversationId: 'conversation-1',
        throughSequence: 10,
        summary: '旧摘要'.repeat(1_000),
        sourceItemCount: 10,
        estimatedTokensBefore: 10_000,
        createdAt: '2026-07-27T00:00:00.000Z',
      },
      thresholdTokens: 40,
      targetTokens: 30,
      createdAt: '2026-07-28T00:00:00.000Z',
    });

    expect(estimateModelItemsTokens(result.history)).toBeLessThanOrEqual(40);
  });
});
