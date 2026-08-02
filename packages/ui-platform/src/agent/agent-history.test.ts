import { describe, expect, it } from 'vitest';

import { historyToTimeline } from './agent-history.js';

describe('historyToTimeline', () => {
  it('hydrates a tool call and its result as one collapsed timeline item', () => {
    expect(
      historyToTimeline({
        sessionId: 'session-1',
        turns: [
          {
            id: 'turn-1',
            conversationId: 'conversation-1',
            sessionId: 'session-1',
            driver: 'builtin',
            model: {
              modelConfigurationId: 'model-1',
              modelConfigurationRevision: 3,
              modelConfigurationName: '运维模型',
              providerProfileId: 'provider-1',
              providerProfileRevision: 2,
              providerProfileName: 'OpenAI',
              protocol: 'openai_responses',
              modelId: 'ops-model',
              capabilities: { responses: true, streaming: true, toolCalls: true },
              contextWindowTokens: 128_000,
              maxOutputTokens: 8_192,
              autoCompact: true,
              compactThresholdPercent: 80,
              supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
              defaultReasoningEffort: 'medium',
            },
            reasoningEffort: 'medium',
            permissionMode: 'manual',
            userMessage: '检查磁盘',
            status: 'completed',
            revision: 2,
          },
        ],
        items: [
          {
            id: 'assistant-1',
            conversationId: 'conversation-1',
            turnId: 'turn-1',
            sequence: 3,
            type: 'assistant_text',
            content: '磁盘正常',
          },
          {
            id: 'user-1',
            conversationId: 'conversation-1',
            turnId: 'turn-1',
            sequence: 1,
            type: 'user_text',
            content: '检查磁盘',
          },
          {
            id: 'call-1',
            conversationId: 'conversation-1',
            turnId: 'turn-1',
            sequence: 2,
            type: 'assistant_tool_call',
            toolCallId: 'tool-call-1',
            name: 'terminal_execute',
            argumentsJson: '{"command":"df -h"}',
          },
          {
            id: 'result-1',
            conversationId: 'conversation-1',
            turnId: 'turn-1',
            sequence: 4,
            type: 'tool_result',
            toolCallId: 'tool-call-1',
            content: '已完成',
            isError: false,
          },
        ],
      }),
    ).toMatchObject([
      { id: 'history-user-1', kind: 'user', text: '检查磁盘' },
      {
        id: 'tool-call-tool-call-1',
        kind: 'tool',
        text: 'terminal_execute\n{"command":"df -h"}',
        command: 'df -h',
        toolResult: '已完成',
        status: 'completed',
      },
      { id: 'history-assistant-1', kind: 'assistant', text: '磁盘正常' },
    ]);
  });

  it('does not expose system prompts from persisted model history', () => {
    expect(
      historyToTimeline({
        sessionId: 'session-1',
        turns: [],
        items: [
          {
            id: 'system-1',
            conversationId: 'conversation-1',
            turnId: 'turn-1',
            sequence: 0,
            type: 'system_text',
            content: 'internal instructions',
          },
        ],
      }),
    ).toEqual([]);
  });

  it('keeps a persisted tool call running until its result is present', () => {
    expect(
      historyToTimeline({
        sessionId: 'session-1',
        turns: [],
        items: [
          {
            id: 'call-1',
            conversationId: 'conversation-1',
            turnId: 'turn-1',
            sequence: 1,
            type: 'assistant_tool_call',
            toolCallId: 'tool-call-1',
            name: 'terminal_execute',
            argumentsJson: '{"command":"sleep 30"}',
          },
        ],
      }),
    ).toMatchObject([
      {
        kind: 'tool',
        toolRole: 'call',
        toolCallId: 'tool-call-1',
        status: 'running',
      },
    ]);
  });
});
