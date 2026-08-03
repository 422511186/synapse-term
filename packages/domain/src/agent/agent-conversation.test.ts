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
import type { AgentModelSelection } from '../provider/model-configuration.js';

const modelSelection: AgentModelSelection = {
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
};

describe('agent conversation domain', () => {
  it('binds one active conversation to a session and supports explicit reset', () => {
    const conversation = createAgentConversation({ id: 'conversation-1', sessionId: 'session-1' });

    expect(conversation).toEqual({
      id: 'conversation-1',
      sessionId: 'session-1',
      driver: 'builtin',
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

  it('creates conversations with an explicit external driver', () => {
    const conversation = createAgentConversation({
      id: 'conversation-acp',
      sessionId: 'session-1',
      driver: 'acp',
    });

    expect(conversation.driver).toBe('acp');
  });

  it('models a user turn independently from the conversation lifecycle', () => {
    const turn = createAgentTurn({
      id: 'turn-1',
      conversationId: 'conversation-1',
      sessionId: 'session-1',
      model: modelSelection,
      reasoningEffort: 'high',
      permissionMode: 'manual',
      userMessage: '检查磁盘',
    });

    expect(turn).toMatchObject({
      driver: 'builtin',
      status: 'queued',
      revision: 0,
      model: modelSelection,
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

  it('defaults new turns to the model default reasoning effort', () => {
    const turn = createAgentTurn({
      id: 'turn-default-reasoning',
      conversationId: 'conversation-1',
      sessionId: 'session-1',
      model: modelSelection,
      permissionMode: 'auto',
      userMessage: '检查服务',
    });

    expect(turn.reasoningEffort).toBe(modelSelection.defaultReasoningEffort);
  });

  it('creates external driver turns without a model selection or reasoning effort', () => {
    const turn = createAgentTurn({
      id: 'turn-acp',
      conversationId: 'conversation-acp',
      sessionId: 'session-1',
      driver: 'acp',
      permissionMode: 'manual',
      userMessage: '检查磁盘',
    });

    expect(turn).toMatchObject({
      driver: 'acp',
      status: 'queued',
      revision: 0,
      permissionMode: 'manual',
    });
    expect(turn.model).toBeUndefined();
    expect(turn.reasoningEffort).toBeUndefined();
  });

  it('requires a model selection for builtin driver turns', () => {
    expect(() =>
      createAgentTurn({
        id: 'turn-builtin-without-model',
        conversationId: 'conversation-1',
        sessionId: 'session-1',
        userMessage: '检查磁盘',
      }),
    ).toThrow(/model/i);
  });

  it('copies the model snapshot instead of sharing mutable state', () => {
    const turn = createAgentTurn({
      id: 'turn-snapshot',
      conversationId: 'conversation-1',
      sessionId: 'session-1',
      model: modelSelection,
      userMessage: '检查磁盘',
    });

    expect(turn.model).toEqual(modelSelection);
    expect(turn.model).not.toBe(modelSelection);
    expect(turn.model?.capabilities).not.toBe(modelSelection.capabilities);
    expect(turn.model?.supportedReasoningEfforts).not.toBe(
      modelSelection.supportedReasoningEfforts,
    );
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

  it('keeps attachment metadata on user text model items', () => {
    const attachments = [
      {
        id: 'attachment-1',
        name: '截图.png',
        mimeType: 'image/png',
        sizeBytes: 1_024,
        kind: 'image' as const,
        relativePath: '0-截图.png',
      },
      {
        id: 'attachment-2',
        name: 'notes.txt',
        mimeType: 'text/plain',
        sizeBytes: 256,
        kind: 'file' as const,
        relativePath: '1-notes.txt',
      },
    ];
    const item = createModelItem({
      id: 'item-user-attachments',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      sequence: 1,
      type: 'user_text',
      content: '请分析附件',
      attachments,
    });

    expect(item).toMatchObject({
      type: 'user_text',
      content: '请分析附件',
      attachments: expect.arrayContaining([
        expect.objectContaining({ id: 'attachment-1', kind: 'image' }),
        expect.objectContaining({ id: 'attachment-2', kind: 'file' }),
      ]),
    });
    if (item.type !== 'user_text') throw new Error('expected a user_text model item');
    expect(item.attachments).not.toBe(attachments);
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
