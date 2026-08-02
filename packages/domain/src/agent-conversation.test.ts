import { describe, expect, it } from 'vitest';

import {
  createAgentConversation,
  createConversationCompaction,
  createAgentTurn,
  createModelItem,
  createToolCallRecord,
  resetAgentConversation,
  setConversationPermissionMode,
  transitionAgentTurn,
  transitionToolCall,
} from './agent-conversation.js';

describe('agent conversation domain', () => {
  it('binds one active conversation to a session and supports explicit reset', () => {
    const conversation = createAgentConversation({ id: 'conversation-1', sessionId: 'session-1' });

    expect(conversation).toEqual({
      id: 'conversation-1',
      sessionId: 'session-1',
      status: 'active',
      permissionMode: 'auto',
      revision: 0,
    });
    expect(resetAgentConversation(conversation)).toEqual({
      ...conversation,
      status: 'reset',
      revision: 1,
    });
  });

  it('changes permission mode without changing prior turns', () => {
    const conversation = createAgentConversation({ id: 'conversation-1', sessionId: 'session-1' });

    expect(setConversationPermissionMode(conversation, 'manual')).toEqual({
      ...conversation,
      permissionMode: 'manual',
      revision: 1,
    });
  });

  it('models a user turn independently from the conversation lifecycle', () => {
    const turn = createAgentTurn({
      id: 'turn-1',
      conversationId: 'conversation-1',
      sessionId: 'session-1',
      modelConfigurationId: 'model-1',
      modelConfigurationRevision: 7,
      modelConfigurationName: 'GPT-5.1',
      providerProfileId: 'provider-1',
      providerProfileRevision: 4,
      providerProfileName: 'OpenAI',
      protocol: 'openai_responses',
      modelId: 'gpt-5.1',
      capabilities: { responses: true, streaming: true, toolCalls: true },
      contextWindowTokens: 128_000,
      maxOutputTokens: 8_192,
      autoCompact: true,
      compactThresholdPercent: 80,
      supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
      defaultReasoningEffort: 'medium',
      reasoningEffort: 'high',
      permissionMode: 'manual',
      userMessage: '检查磁盘',
    });

    expect(turn).toMatchObject({
      status: 'queued',
      revision: 0,
      modelConfigurationId: 'model-1',
      modelConfigurationRevision: 7,
      providerProfileRevision: 4,
      modelId: 'gpt-5.1',
      reasoningEffort: 'high',
      permissionMode: 'manual',
    });
    const running = transitionAgentTurn(turn, 'running');
    expect(running).toMatchObject({ ok: true, value: { status: 'running', revision: 1 } });
    if (!running.ok) throw new Error('expected turn to start');
    expect(transitionAgentTurn(running.value, 'completed')).toMatchObject({
      ok: true,
      value: { status: 'completed' },
    });
  });

  it('defaults new turns to low reasoning effort', () => {
    const turn = createAgentTurn({
      id: 'turn-default-reasoning',
      conversationId: 'conversation-1',
      sessionId: 'session-1',
      modelConfigurationId: 'model-1',
      modelConfigurationRevision: 1,
      modelConfigurationName: 'Model 1',
      providerProfileId: 'provider-1',
      providerProfileRevision: 1,
      providerProfileName: 'Provider 1',
      protocol: 'openai_responses',
      modelId: 'model-1',
      capabilities: { responses: true, streaming: true, toolCalls: true, reasoning: true },
      contextWindowTokens: 128_000,
      maxOutputTokens: 8_192,
      autoCompact: true,
      compactThresholdPercent: 80,
      supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'] as never,
      defaultReasoningEffort: 'low',
      permissionMode: 'auto',
      userMessage: '检查服务',
    });

    expect(turn.reasoningEffort).toBe('low');
  });

  it('records the exact history range represented by a compaction', () => {
    expect(
      createConversationCompaction({
        id: 'compaction-1',
        conversationId: 'conversation-1',
        throughSequence: 18,
        summary: '用户要求排查服务；已确认磁盘正常。',
        sourceItemCount: 18,
        estimatedTokensBefore: 20_000,
        createdAt: '2026-07-28T00:00:00.000Z',
      }),
    ).toEqual({
      id: 'compaction-1',
      conversationId: 'conversation-1',
      throughSequence: 18,
      summary: '用户要求排查服务；已确认磁盘正常。',
      sourceItemCount: 18,
      estimatedTokensBefore: 20_000,
      createdAt: '2026-07-28T00:00:00.000Z',
    });
  });

  it('keeps assistant tool calls and tool results as structured model items', () => {
    expect(
      createModelItem({
        id: 'item-1',
        conversationId: 'conversation-1',
        turnId: 'turn-1',
        sequence: 2,
        type: 'assistant_tool_call',
        toolCallId: 'call-1',
        name: 'terminal_observe',
        argumentsJson: '{}',
      }),
    ).toMatchObject({ type: 'assistant_tool_call', toolCallId: 'call-1' });

    expect(
      createModelItem({
        id: 'item-2',
        conversationId: 'conversation-1',
        turnId: 'turn-1',
        sequence: 3,
        type: 'tool_result',
        toolCallId: 'call-1',
        content: '{"status":"observed"}',
        isError: false,
      }),
    ).toMatchObject({ type: 'tool_result', toolCallId: 'call-1', isError: false });
  });

  it('tracks recoverable and fatal tool outcomes separately', () => {
    const call = createToolCallRecord({
      id: 'call-1',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      name: 'local_read_file',
      argumentsJson: '{"path":"project/readme.md"}',
    });
    const validating = transitionToolCall(call, 'validating');
    expect(validating).toMatchObject({ ok: true, value: { status: 'validating' } });
    if (!validating.ok) throw new Error('expected tool call to validate');
    expect(transitionToolCall(validating.value, 'recoverable_error')).toMatchObject({
      ok: true,
      value: { status: 'recoverable_error' },
    });
  });
});
