/** ACP 历史到时间线的投影合成（自 app.tsx 拆分，供 Agent 面板复用） */
import type { AcpHistoryView, AgentTimelineItem } from '../../preload/preload-api.js';

export function acpHistoryToTimeline(
  sessionId: string,
  history: AcpHistoryView,
): AgentTimelineItem[] {
  const items: AgentTimelineItem[] = [];
  for (const turn of history.turns) {
    items.push({
      id: `acp-history-user-${turn.id}`,
      sessionId,
      driver: 'acp',
      kind: 'user',
      text: turn.userMessage,
      status: turn.status,
      conversationId: turn.conversationId,
      turnId: turn.id,
      occurredAt: turn.occurredAt,
    });
  }
  for (const toolCall of history.projection.toolCalls) {
    items.push({
      id: `acp-history-tool-${toolCall.toolCallId}`,
      sessionId,
      driver: 'acp',
      kind: 'tool',
      text: toolCall.title,
      ...(toolCall.command === undefined ? {} : { command: toolCall.command }),
      ...(toolCall.status === undefined ? {} : { status: toolCall.status }),
      toolCallId: toolCall.toolCallId,
      occurredAt: toolCall.occurredAt,
    });
  }
  history.projection.assistantText.forEach((text, index) => {
    items.push({
      id: `acp-history-assistant-${index}`,
      sessionId,
      driver: 'acp',
      kind: 'assistant',
      text,
      occurredAt: history.turns.at(-1)?.occurredAt ?? new Date(0).toISOString(),
    });
  });
  return items;
}
export function mergeAcpHistoryIntoTimeline(
  items: readonly AgentTimelineItem[],
  sessionId: string,
  history: AcpHistoryView,
): AgentTimelineItem[] {
  const live = items.filter(
    (item) => item.sessionId !== sessionId || !item.id.startsWith('acp-history-'),
  );
  const synthesized = acpHistoryToTimeline(sessionId, history).filter((candidate) => {
    if (candidate.kind === 'tool') {
      return !live.some(
        (item) =>
          item.kind === 'tool' &&
          item.toolCallId !== undefined &&
          item.toolCallId === candidate.toolCallId,
      );
    }
    return !live.some((item) => item.kind === candidate.kind && item.text === candidate.text);
  });
  return [...live, ...synthesized];
}
