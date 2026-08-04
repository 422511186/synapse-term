import { describe, expect, it } from 'vitest';

import type { AgentTextDelta, AgentTimelineItem } from '../contracts.js';
import {
  applyAgentTextDelta,
  applyAgentTimelineEvent,
  createAgentTimelineState,
  groupAgentTimelineItems,
  hydrateAgentTimelineState,
  isApprovalActionable,
  mergeHydratedActiveTurnId,
  mergeHydratedTimeline,
  resolveApprovalStatus,
  resolveTimelineStatus,
  upsertTimelineEvent,
} from './agent-timeline-state.js';

function item(overrides: Partial<AgentTimelineItem> = {}): AgentTimelineItem {
  return {
    id: 'item-1',
    sessionId: 'session-1',
    kind: 'tool',
    text: 'tool output',
    status: 'completed',
    occurredAt: '2026-07-29T00:00:00.000Z',
    ...overrides,
  };
}

function delta(overrides: Partial<AgentTextDelta> = {}): AgentTextDelta {
  return {
    id: 'assistant-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    operation: 'append',
    delta: 'a',
    sequence: 0,
    occurredAt: '2026-07-29T00:00:00.000Z',
    ...overrides,
  };
}

describe('agent timeline state', () => {
  it('keeps one progress timeline item and ignores stale revisions', () => {
    const progress = (revision: number, phase: 'planning' | 'executing' | 'completed') =>
      item({
        id: 'agent-progress-turn-1',
        kind: 'system',
        text: `progress-${phase}`,
        status: phase,
        progress: {
          phase,
          revision,
          steps: [
            {
              id: 'progress-step-call-1',
              label: 'terminal_execute',
              status: phase === 'completed' ? 'completed' : 'running',
              toolCallId: 'call-1',
            },
          ],
        },
      });

    const planning = progress(1, 'planning');
    const executing = progress(2, 'executing');
    const stale = progress(1, 'planning');
    const completed = progress(3, 'completed');

    let timeline = upsertTimelineEvent([], planning);
    timeline = upsertTimelineEvent(timeline, executing);
    timeline = upsertTimelineEvent(timeline, stale);

    expect(timeline).toEqual([executing]);

    timeline = upsertTimelineEvent(timeline, completed);
    expect(timeline).toEqual([completed]);
  });

  it('aggregates ordered assistant append deltas into one timeline item', () => {
    let state = createAgentTimelineState();
    state = applyAgentTextDelta(state, delta({ delta: 'a', sequence: 0 }));
    state = applyAgentTextDelta(state, delta({ delta: 'bc', sequence: 1 }));

    expect(state.items).toEqual([
      expect.objectContaining({
        id: 'assistant-1',
        kind: 'assistant',
        text: 'abc',
        status: 'streaming',
      }),
    ]);
    expect(state.historyRefreshSessions).toEqual([]);
  });

  it('applies replace deltas by clearing the live assistant accumulator', () => {
    let state = createAgentTimelineState();
    state = applyAgentTextDelta(state, delta({ delta: 'candidate', sequence: 0 }));
    state = applyAgentTextDelta(
      state,
      delta({ operation: 'replace', delta: 'final', sequence: 1 }),
    );

    expect(state.items).toEqual([expect.objectContaining({ id: 'assistant-1', text: 'final' })]);
  });

  it('places a replaced final assistant response after the tool events it follows', () => {
    let state = createAgentTimelineState();
    state = applyAgentTextDelta(
      state,
      delta({ delta: '先检查主机。', sequence: 0, occurredAt: '2026-08-04T00:00:01.000Z' }),
    );
    state = applyAgentTimelineEvent(
      state,
      item({
        id: 'tool-call-call-1',
        kind: 'tool',
        toolRole: 'call',
        toolCallId: 'call-1',
        text: 'terminal_execute\n{"command":"vm_stat"}',
        status: 'running',
        turnId: 'turn-1',
        occurredAt: '2026-08-04T00:00:02.000Z',
      }),
    );
    state = applyAgentTimelineEvent(
      state,
      item({
        id: 'command-1',
        kind: 'command',
        toolCallId: 'call-1',
        text: 'vm_stat',
        status: 'completed',
        turnId: 'turn-1',
        occurredAt: '2026-08-04T00:00:03.000Z',
      }),
    );
    state = applyAgentTimelineEvent(
      state,
      item({
        id: 'tool-result-call-1',
        kind: 'tool',
        toolRole: 'result',
        toolCallId: 'call-1',
        text: '{"ok":true}',
        status: 'completed',
        turnId: 'turn-1',
        occurredAt: '2026-08-04T00:00:04.000Z',
      }),
    );
    state = applyAgentTextDelta(
      state,
      delta({
        operation: 'replace',
        delta: '结论：检查已完成。',
        sequence: 1,
        occurredAt: '2026-08-04T00:00:05.000Z',
      }),
    );
    state = applyAgentTimelineEvent(
      state,
      item({
        id: 'assistant-1',
        kind: 'assistant',
        text: '结论：检查已完成。',
        status: 'completed',
        turnId: 'turn-1',
        occurredAt: '2026-08-04T00:00:06.000Z',
      }),
    );

    expect(
      groupAgentTimelineItems(state.items).map((group) =>
        group.kind === 'tool'
          ? `tool:${group.toolCallId}`
          : `${group.event.kind}:${group.event.text}`,
      ),
    ).toEqual(['tool:call-1', 'assistant:结论：检查已完成。']);
  });

  it('rejects a sequence gap and requests Session history refresh', () => {
    let state = createAgentTimelineState();
    state = applyAgentTextDelta(state, delta({ delta: 'a', sequence: 0 }));
    state = applyAgentTextDelta(state, delta({ delta: 'c', sequence: 2 }));
    state = applyAgentTextDelta(state, delta({ delta: 'b', sequence: 1 }));

    expect(state.items).toEqual([expect.objectContaining({ id: 'assistant-1', text: 'a' })]);
    expect(state.historyRefreshSessions).toEqual(['session-1']);
  });

  it('ignores stale deltas after the stream cursor has advanced', () => {
    let state = createAgentTimelineState();
    state = applyAgentTextDelta(state, delta({ delta: 'a', sequence: 0 }));
    state = applyAgentTextDelta(state, delta({ delta: 'b', sequence: 1 }));
    state = applyAgentTextDelta(state, delta({ delta: 'old', sequence: 0 }));

    expect(state.items).toEqual([expect.objectContaining({ id: 'assistant-1', text: 'ab' })]);
    expect(state.historyRefreshSessions).toEqual([]);
  });

  it('hydrates a complete history item and closes the live stream', () => {
    let state = createAgentTimelineState();
    state = applyAgentTextDelta(state, delta({ delta: 'partial', sequence: 0 }));
    state = hydrateAgentTimelineState(state, [
      item({
        id: 'assistant-1',
        sessionId: 'session-1',
        kind: 'assistant',
        text: 'complete answer',
        status: 'completed',
        turnId: 'turn-1',
      }),
    ]);
    state = applyAgentTextDelta(state, delta({ delta: 'late', sequence: 1 }));

    expect(state.items).toEqual([
      expect.objectContaining({ id: 'assistant-1', text: 'complete answer', status: 'completed' }),
    ]);
  });

  it('merges timeline events without dropping a live delta accumulator', () => {
    let state = createAgentTimelineState();
    state = applyAgentTextDelta(state, delta({ delta: 'partial', sequence: 0 }));
    state = applyAgentTimelineEvent(
      state,
      item({
        id: 'tool-call-call-1',
        kind: 'tool',
        toolCallId: 'call-1',
        text: 'terminal_observe\n{}',
        status: 'running',
      }),
    );

    expect(state.items).toEqual([
      expect.objectContaining({ id: 'assistant-1', text: 'partial' }),
      expect.objectContaining({ id: 'tool-call-call-1', kind: 'tool' }),
    ]);
  });

  it('replaces a live item with the terminal event using its stable id', () => {
    const live = item({ status: 'waiting_approval' });
    const completed = item({ status: 'completed', text: 'approved' });

    expect(upsertTimelineEvent([live], completed)).toEqual([completed]);
  });

  it('keeps an approval card separate from a tool card sharing its tool call id', () => {
    const tool = item({
      id: 'tool-call-call-approval',
      kind: 'tool',
      toolCallId: 'call-approval',
      status: 'running',
      text: 'terminal_execute\n{"command":"free -h"}',
    });
    const waitingApproval = item({
      id: 'approval-1',
      kind: 'approval',
      toolCallId: 'call-approval',
      status: 'waiting_approval',
      text: 'free -h',
    });
    const completedApproval = { ...waitingApproval, status: 'completed' as const };

    let timeline = upsertTimelineEvent([], tool);
    timeline = upsertTimelineEvent(timeline, waitingApproval);
    expect(timeline.map((entry) => entry.id)).toEqual(['tool-call-call-approval', 'approval-1']);

    timeline = upsertTimelineEvent(timeline, completedApproval);
    expect(timeline).toContainEqual(tool);
    expect(timeline).toContainEqual(completedApproval);
    expect(groupAgentTimelineItems([tool, waitingApproval])).toEqual([
      { kind: 'tool', toolCallId: 'call-approval', call: tool },
      { kind: 'event', event: waitingApproval },
    ]);
    expect(groupAgentTimelineItems([tool, completedApproval])).toEqual([
      { kind: 'tool', toolCallId: 'call-approval', call: tool },
    ]);
  });

  it('retains the command event id when live updates are grouped for interruption', () => {
    const tool = item({
      id: 'tool-call-call-running',
      kind: 'tool',
      toolCallId: 'call-running',
      toolRole: 'call',
      status: 'running',
      text: 'terminal_execute\n{"command":"sleep 30"}',
    });
    const command = item({
      id: 'transaction-running',
      kind: 'command',
      toolCallId: 'call-running',
      status: 'running',
      text: 'sleep 30',
    });

    let timeline = upsertTimelineEvent([], tool);
    timeline = upsertTimelineEvent(timeline, command);

    expect(timeline.map((entry) => entry.id)).toEqual([
      'tool-call-call-running',
      'transaction-running',
    ]);
    expect(groupAgentTimelineItems(timeline)).toEqual([
      { kind: 'tool', toolCallId: 'call-running', call: tool, command },
    ]);
  });

  it('groups a terminal tool call, command, and result into one timeline item', () => {
    const toolCall = item({
      id: 'tool-call-call-1',
      kind: 'tool',
      toolCallId: 'call-1',
      text: 'terminal_execute\n{"command":"df -h"}',
      status: 'running',
    });
    const command = item({
      id: 'command-1',
      kind: 'command',
      toolCallId: 'call-1',
      text: 'df -h',
      status: 'completed',
    });
    const result = item({
      id: 'tool-result-call-1',
      kind: 'tool',
      toolCallId: 'call-1',
      text: '{"ok":true,"result":{"status":"completed"}}',
      status: 'completed',
    });

    const merged = [toolCall, command, result].reduce(
      (timeline, event) => upsertTimelineEvent(timeline, event),
      [] as AgentTimelineItem[],
    );

    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({
      id: 'tool-call-call-1',
      kind: 'tool',
      toolCallId: 'call-1',
      text: 'terminal_execute\n{"command":"df -h"}',
      toolResult: '{"ok":true,"result":{"status":"completed"}}',
      status: 'completed',
    });
    expect(merged[1]).toEqual(command);
    const groups = groupAgentTimelineItems(merged);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      kind: 'tool',
      toolCallId: 'call-1',
      call: merged[0],
      command,
      result: {
        id: 'tool-result-call-1',
        text: result.text,
        toolResult: result.text,
      },
    });
  });

  it('replaces hydrated tool items without duplicating live tool results', () => {
    const liveTool = item({ id: 'tool-result-call-1', text: 'live result' });
    const liveApproval = item({
      id: 'approval-1',
      kind: 'approval',
      text: 'dangerous command',
      status: 'completed',
    });
    const hydratedTool = item({ id: 'tool-result-call-1', text: 'history result' });

    const merged = mergeHydratedTimeline([liveTool, liveApproval], 'session-1', [hydratedTool]);

    expect(merged.filter((entry) => entry.id === 'tool-result-call-1')).toHaveLength(1);
    expect(merged).toContainEqual(liveApproval);
    expect(merged).toContainEqual(hydratedTool);
  });

  it('preserves attachment metadata when hydrated history replaces a live user item', () => {
    const liveUser: AgentTimelineItem = {
      id: 'live-user-1',
      sessionId: 'session-1',
      kind: 'user',
      text: '看这张图',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      occurredAt: '2026-07-29T00:00:00.000Z',
    };
    const history = {
      sessionId: 'session-1',
      turns: [],
      items: [
        {
          id: 'user-1',
          conversationId: 'conversation-1',
          turnId: 'turn-1',
          sequence: 1,
          type: 'user_text',
          content: '看这张图',
          attachments: [
            {
              id: 'attachment-1',
              name: '截图.png',
              mimeType: 'image/png',
              sizeBytes: 4096,
              kind: 'image',
            },
          ],
        },
      ],
    };

    const merged = mergeHydratedTimeline([liveUser], 'session-1', history);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: 'history-user-1',
      kind: 'user',
      attachments: [
        {
          id: 'attachment-1',
          name: '截图.png',
          mimeType: 'image/png',
          sizeBytes: 4096,
          kind: 'image',
        },
      ],
    });
  });

  it('preserves a live streaming item that is not persisted yet', () => {
    const streaming = item({ id: 'assistant-live', kind: 'assistant', status: 'streaming' });
    const merged = mergeHydratedTimeline([streaming], 'session-1', []);

    expect(merged).toContainEqual(streaming);
  });

  it('keeps a newer streamed assistant update when history only contains its prefix', () => {
    const streaming = item({
      id: 'assistant-live',
      kind: 'assistant',
      status: 'streaming',
      text: '先检查主机。发现缺少网络证据。',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
    });
    const persistedPrefix = item({
      id: 'history-assistant-1',
      kind: 'assistant',
      status: 'running',
      text: '先检查主机。',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
    });

    expect(mergeHydratedTimeline([streaming], 'session-1', [persistedPrefix])).toEqual([streaming]);
  });

  it('does not let a stale hydrated running tool call replace a live terminal state', () => {
    const live = item({
      id: 'tool-call-call-live',
      kind: 'tool',
      toolRole: 'call',
      toolCallId: 'call-live',
      status: 'completed',
      text: 'terminal_execute\n{"command":"tasklist.exe"}',
      toolResult: '{"ok":true,"result":{"status":"completed"}}',
    });
    const staleHistory = item({
      id: 'history-call-live',
      kind: 'tool',
      toolRole: 'call',
      toolCallId: 'call-live',
      status: 'running',
      text: live.text,
    });

    expect(mergeHydratedTimeline([live], 'session-1', [staleHistory])).toEqual([live]);
  });

  it('preserves an interrupted command while history catches up', () => {
    const interrupted = item({
      id: 'transaction-1',
      kind: 'command',
      text: 'sleep 30',
      status: 'interrupted',
      toolCallId: 'call-1',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
    });
    const hydratedCall = item({
      id: 'history-call-1',
      text: 'terminal_execute\n{"command":"sleep 30"}',
      status: 'running',
      toolRole: 'call',
      toolCallId: 'call-1',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
    });

    expect(mergeHydratedTimeline([interrupted], 'session-1', [hydratedCall])).toEqual([
      hydratedCall,
      interrupted,
    ]);
  });

  it('restores persisted order when hydration finds a live assistant before its tool call', () => {
    const liveAssistant = item({
      id: 'assistant-1',
      kind: 'assistant',
      text: '结论：检查已完成。',
      status: 'completed',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      occurredAt: '2026-08-04T00:00:06.000Z',
    });
    const liveCall = item({
      id: 'tool-call-call-1',
      kind: 'tool',
      toolRole: 'call',
      toolCallId: 'call-1',
      text: 'terminal_execute\n{"command":"vm_stat"}',
      status: 'completed',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      occurredAt: '2026-08-04T00:00:02.000Z',
    });
    const liveCommand = item({
      id: 'command-1',
      kind: 'command',
      toolCallId: 'call-1',
      text: 'vm_stat',
      status: 'completed',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      occurredAt: '2026-08-04T00:00:03.000Z',
    });
    const hydratedCall = { ...liveCall, id: 'history-call-1' };
    const hydratedAssistant = { ...liveAssistant, id: 'history-assistant-1' };

    const merged = mergeHydratedTimeline([liveAssistant, liveCall, liveCommand], 'session-1', [
      hydratedCall,
      hydratedAssistant,
    ]);

    expect(
      groupAgentTimelineItems(merged).map((group) =>
        group.kind === 'tool'
          ? `tool:${group.toolCallId}`
          : `${group.event.kind}:${group.event.text}`,
      ),
    ).toEqual(['tool:call-1', 'assistant:结论：检查已完成。']);
  });

  it('keeps each live failure directly below the user turn it belongs to', () => {
    const liveUserOne = item({
      id: 'live-user-1',
      kind: 'user',
      text: '查一下内存',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
    });
    const failureOne = item({
      id: 'failure-1',
      kind: 'system',
      text: 'Agent 执行失败：provider_stream_error: 424',
      status: 'failed',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
    });
    const liveUserTwo = item({
      id: 'live-user-2',
      kind: 'user',
      text: '查一下内存',
      conversationId: 'conversation-1',
      turnId: 'turn-2',
    });
    const failureTwo = item({
      id: 'failure-2',
      kind: 'system',
      text: 'Agent 执行失败：provider_stream_error: 424',
      status: 'failed',
      conversationId: 'conversation-1',
      turnId: 'turn-2',
    });
    const hydratedUserOne = item({
      id: 'history-user-1',
      kind: 'user',
      text: '查一下内存',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
    });
    const hydratedUserTwo = item({
      id: 'history-user-2',
      kind: 'user',
      text: '查一下内存',
      conversationId: 'conversation-1',
      turnId: 'turn-2',
    });

    const merged = mergeHydratedTimeline(
      [liveUserOne, failureOne, liveUserTwo, failureTwo],
      'session-1',
      [hydratedUserOne, hydratedUserTwo],
    );

    expect(merged.map((entry) => entry.id)).toEqual([
      'history-user-1',
      'failure-1',
      'history-user-2',
      'failure-2',
    ]);
  });

  it('preserves a live cancellation event that is not persisted in history', () => {
    const cancelled = item({
      id: 'cancelled-1',
      kind: 'system',
      text: 'Agent 任务已取消',
      status: 'cancelled',
    });

    expect(mergeHydratedTimeline([cancelled], 'session-1', [])).toContainEqual(cancelled);
  });

  it('replaces a streaming assistant item when the same turn has been persisted', () => {
    const streaming = item({
      id: 'assistant-live',
      kind: 'assistant',
      status: 'streaming',
      text: '正在生成',
      turnId: 'turn-1',
    });
    const persisted = item({
      id: 'history-assistant-1',
      kind: 'assistant',
      status: 'completed',
      text: '最终答案',
      turnId: 'turn-1',
    });

    expect(mergeHydratedTimeline([streaming], 'session-1', [persisted])).toEqual([persisted]);
  });

  it('hides approval controls as soon as an action is accepted', () => {
    expect(isApprovalActionable('waiting_approval', undefined)).toBe(true);
    expect(isApprovalActionable('waiting_approval', 'completed')).toBe(false);
    expect(resolveApprovalStatus('waiting_approval', 'cancelled')).toBe('cancelled');
    expect(isApprovalActionable('waiting_approval', 'expired')).toBe(false);
    expect(isApprovalActionable('waiting_approval', 'environment_invalidated')).toBe(false);
    expect(resolveApprovalStatus('completed', undefined)).toBe('completed');
  });

  it('does not let an older history response clear a newly started turn', () => {
    expect(mergeHydratedActiveTurnId('turn-new', undefined)).toBe('turn-new');
    expect(mergeHydratedActiveTurnId('turn-new', 'turn-old')).toBe('turn-new');
    expect(mergeHydratedActiveTurnId(undefined, 'turn-restored')).toBe('turn-restored');
    expect(mergeHydratedActiveTurnId(undefined, undefined)).toBeUndefined();
  });

  it('groups a tool call, its command transaction, and its result into one timeline card', () => {
    const call = item({
      id: 'tool-call-call-1',
      text: 'terminal_execute\n{"command":"free -h"}',
      status: 'running',
      toolCallId: 'call-1',
    });
    const command = item({
      id: 'transaction-1',
      kind: 'command',
      text: 'free -h',
      status: 'completed',
      toolCallId: 'call-1',
    });
    const result = item({
      id: 'tool-result-call-1',
      text: '{"ok":true,"result":{"status":"completed"}}',
      status: 'completed',
      toolCallId: 'call-1',
    });

    expect(groupAgentTimelineItems([call, command, result])).toEqual([
      {
        kind: 'tool',
        toolCallId: 'call-1',
        call,
        command,
        result,
      },
    ]);
  });

  it('associates a legacy command event with a tool call by command text', () => {
    const call = item({
      id: 'tool-call-call-2',
      text: 'terminal_execute\n{"command":"cat /proc/meminfo"}',
      status: 'running',
      toolCallId: 'call-2',
    });
    const command = item({
      id: 'transaction-2',
      kind: 'command',
      text: 'cat /proc/meminfo',
      status: 'completed',
    });
    const result = item({
      id: 'tool-result-call-2',
      text: 'done',
      status: 'completed',
      toolCallId: 'call-2',
    });

    expect(groupAgentTimelineItems([call, command, result])).toEqual([
      {
        kind: 'tool',
        toolCallId: 'call-2',
        call,
        command,
        result,
      },
    ]);
  });

  it('groups legacy tool calls and results even when the event stream has no toolCallId', () => {
    const call = item({
      id: 'legacy-tool-call',
      text: 'terminal_execute\n{"command":"vm_stat"}',
      status: 'running',
      toolRole: 'call',
    });
    const command = item({
      id: 'legacy-command',
      kind: 'command',
      text: 'vm_stat',
      status: 'completed',
    });
    const result = item({
      id: 'legacy-tool-result',
      text: '{"ok":true,"result":{"status":"completed"}}',
      status: 'completed',
      toolRole: 'result',
    });

    const groups = groupAgentTimelineItems([call, command, result]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: 'tool', call, command, result });
  });

  it('prefers a completed transaction event over a stale running result event', () => {
    const call = item({ status: 'running', toolCallId: 'call-3' });
    const command = item({
      id: 'transaction-3',
      kind: 'command',
      text: 'vm_stat',
      status: 'completed',
      toolCallId: 'call-3',
    });
    const result = item({
      id: 'tool-result-call-3',
      text: '{"ok":true,"result":{"status":"completed"}}',
      status: 'running',
      toolCallId: 'call-3',
    });

    expect(resolveTimelineStatus(result, command, call)).toBe('completed');
  });
});
