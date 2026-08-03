import type { AgentAttachmentMetadata, AgentHistoryView, AgentTimelineItem } from '../contracts.js';

export function historyToTimeline(history: AgentHistoryView): AgentTimelineItem[] {
  const turns = new Map(history.turns.map((turn) => [turn.id, turn]));
  const timeline: AgentTimelineItem[] = [];
  const toolCallIndexes = new Map<string, number>();
  for (const item of [...history.items].sort((left, right) => left.sequence - right.sequence)) {
    const conversationId = stringValue(item.conversationId);
    const turnId = stringValue(item.turnId);
    const toolCallId = stringValue(item.toolCallId);
    const base = {
      id: `history-${item.id}`,
      sessionId: history.sessionId,
      ...(conversationId === undefined ? {} : { conversationId }),
      ...(turnId === undefined ? {} : { turnId }),
      occurredAt: new Date(item.sequence).toISOString(),
    };
    const turn = turns.get(turnId ?? '');
    switch (item.type) {
      case 'user_text':
        timeline.push({
          ...base,
          kind: 'user',
          text: stringValue(item.content) ?? '',
          ...timelineAttachmentMetadata(item.attachments),
        });
        break;
      case 'assistant_text':
        timeline.push({
          ...base,
          kind: 'assistant',
          text: stringValue(item.content) ?? '',
          ...(turn?.status === undefined ? {} : { status: turn.status }),
        });
        break;
      case 'assistant_tool_call': {
        const name = stringValue(item.name) ?? 'tool';
        const argumentsJson = stringValue(item.argumentsJson) ?? '{}';
        timeline.push({
          ...base,
          id: toolTimelineId('call', toolCallId, item.id),
          kind: 'tool',
          toolRole: 'call',
          text: `${name}\n${argumentsJson}`,
          ...(toolCallId === undefined ? {} : { toolCallId }),
          ...(commandFromToolCall(name, argumentsJson) === undefined
            ? {}
            : { command: commandFromToolCall(name, argumentsJson)! }),
          status:
            toolCallId !== undefined &&
            history.items.some(
              (candidate) =>
                candidate.type === 'tool_result' && candidate.toolCallId === toolCallId,
            )
              ? 'completed'
              : 'running',
        });
        if (toolCallId !== undefined) toolCallIndexes.set(toolCallId, timeline.length - 1);
        break;
      }
      case 'tool_result': {
        const toolResult = stringValue(item.content) ?? '';
        const index = toolCallId === undefined ? undefined : toolCallIndexes.get(toolCallId);
        if (index === undefined) {
          timeline.push({
            ...base,
            id: toolTimelineId('result', toolCallId, item.id),
            kind: 'tool',
            toolRole: 'result',
            text: toolResult,
            ...(toolCallId === undefined ? {} : { toolCallId }),
            status: item.isError === true ? 'failed' : 'completed',
          });
          break;
        }
        timeline[index] = {
          ...timeline[index]!,
          toolResult,
          status: item.isError === true ? 'failed' : 'completed',
        };
        break;
      }
      default:
        break;
    }
  }
  return timeline;
}

function toolTimelineId(kind: 'call' | 'result', toolCallId: unknown, itemId: string): string {
  return typeof toolCallId === 'string' && toolCallId.length > 0
    ? `tool-${kind}-${toolCallId}`
    : `history-${itemId}`;
}

function commandFromToolCall(name: string, argumentsJson: string): string | undefined {
  if (name !== 'terminal_execute') return undefined;
  try {
    const value: unknown = JSON.parse(argumentsJson);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
    const command = (value as Record<string, unknown>).command;
    return typeof command === 'string' ? command : undefined;
  } catch {
    return undefined;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function timelineAttachmentMetadata(
  value: unknown,
): { attachments: AgentAttachmentMetadata[] } | Record<string, never> {
  if (!Array.isArray(value) || value.length === 0) return {};
  const attachments: AgentAttachmentMetadata[] = [];
  for (const candidate of value) {
    if (typeof candidate !== 'object' || candidate === null) continue;
    const attachment = candidate as Record<string, unknown>;
    const id = stringValue(attachment.id);
    const name = stringValue(attachment.name);
    const mimeType = stringValue(attachment.mimeType);
    const sizeBytes = attachment.sizeBytes;
    const kind = stringValue(attachment.kind);
    const relativePath = stringValue(attachment.relativePath);
    if (
      id === undefined ||
      name === undefined ||
      mimeType === undefined ||
      typeof sizeBytes !== 'number' ||
      Number.isNaN(sizeBytes) ||
      (kind !== 'image' && kind !== 'file')
    ) {
      continue;
    }
    attachments.push({
      id,
      name,
      mimeType,
      sizeBytes,
      kind,
      ...(relativePath === undefined ? {} : { relativePath }),
    });
  }
  return attachments.length === 0 ? {} : { attachments };
}
