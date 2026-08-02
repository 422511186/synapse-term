import { describe, expect, it } from 'vitest';

import { createModelItem } from '@terminal-agent/domain';

import { ConversationCompactor } from './conversation-compactor.js';

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
});
