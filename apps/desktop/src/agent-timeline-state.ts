import type { AgentHistoryView, AgentTimelineItem } from './preload-api.js';
import { historyToTimeline } from './agent-history.js';

const LIVE_TIMELINE_LIMIT = 50;

export type ApprovalActionState =
  'completed' | 'cancelled' | 'expired' | 'environment_invalidated' | undefined;

const TERMINAL_TIMELINE_STATUSES = new Set([
  'completed',
  'succeeded',
  'success',
  'done',
  'failed',
  'fatal_error',
  'recoverable_error',
  'cancelled',
  'interrupted',
  'shell_lost',
  'protocol_error',
]);

export type AgentTimelineGroup =
  | {
      kind: 'tool';
      toolCallId: string;
      call?: AgentTimelineItem;
      command?: AgentTimelineItem;
      result?: AgentTimelineItem;
    }
  | { kind: 'event'; event: AgentTimelineItem };

/** Replace events by stable id so streaming and terminal states cannot coexist as duplicates. */
export function upsertTimelineEvent(
  items: readonly AgentTimelineItem[],
  event: AgentTimelineItem,
  limit = LIVE_TIMELINE_LIMIT,
): AgentTimelineItem[] {
  const byId = items.findIndex((item) => item.id === event.id);
  const byToolCallId =
    event.kind === 'tool' && event.toolCallId !== undefined
      ? items.findIndex((item) => item.kind === 'tool' && item.toolCallId === event.toolCallId)
      : -1;
  const index = byId >= 0 ? byId : byToolCallId;
  if (index < 0) return [...items.slice(-(Math.max(1, limit) - 1)), event];
  const next = [...items];
  next[index] = mergeTimelineEvent(next[index]!, event);
  return next;
}

function mergeTimelineEvent(
  existing: AgentTimelineItem,
  event: AgentTimelineItem,
): AgentTimelineItem {
  if (event.kind === 'command') {
    return {
      ...existing,
      command: event.text,
      ...(event.status === undefined ? {} : { status: event.status }),
    };
  }
  if (isToolResultEvent(event)) {
    return {
      ...existing,
      toolResult: event.text,
      ...(event.status === undefined ? {} : { status: event.status }),
    };
  }
  if (isToolResultEvent(existing)) {
    return {
      ...event,
      ...(existing.toolResult === undefined ? {} : { toolResult: existing.toolResult }),
      ...(event.status === 'running' && existing.status !== undefined
        ? { status: existing.status }
        : {}),
    };
  }
  return {
    ...existing,
    ...event,
    ...(event.command === undefined && existing.command !== undefined
      ? { command: existing.command }
      : {}),
    ...(event.toolResult === undefined && existing.toolResult !== undefined
      ? { toolResult: existing.toolResult }
      : {}),
  };
}

function isToolResultEvent(item: AgentTimelineItem): boolean {
  return item.kind === 'tool' && item.id.startsWith('tool-result-');
}

/** Collapse the protocol's tool, command, and result events into one renderable card. */
export function groupAgentTimelineItems(items: readonly AgentTimelineItem[]): AgentTimelineGroup[] {
  const groups: AgentTimelineGroup[] = [];
  const toolGroups = new Map<string, Extract<AgentTimelineGroup, { kind: 'tool' }>>();
  const legacyToolGroups: Extract<AgentTimelineGroup, { kind: 'tool' }>[] = [];

  for (const [index, item] of items.entries()) {
    if (item.kind === 'tool') {
      const group =
        item.toolCallId === undefined
          ? getLegacyToolGroup(groups, legacyToolGroups, item, index)
          : getToolGroup(groups, toolGroups, item.toolCallId);
      if (toolEventRole(item, group) === 'call') {
        group.call = item;
        if (item.toolResult !== undefined && group.result === undefined) {
          group.result = {
            ...item,
            id:
              item.toolCallId === undefined
                ? `${item.id}-result`
                : `tool-result-${item.toolCallId}`,
            toolRole: 'result',
            text: item.toolResult,
          };
        }
      } else group.result = item;
      continue;
    }

    if (item.kind === 'command') {
      const group =
        item.toolCallId === undefined
          ? findLegacyCommandGroup(groups, item.text)
          : getToolGroup(groups, toolGroups, item.toolCallId);
      if (group !== undefined) {
        group.command = item;
        continue;
      }
    }

    if (item.kind === 'approval' && !isApprovalActionable(item.status, undefined)) continue;

    groups.push({ kind: 'event', event: item });
  }

  return groups;
}

export function resolveTimelineStatus(
  ...items: Array<AgentTimelineItem | undefined>
): string | undefined {
  const statuses = items
    .map(timelineItemStatus)
    .filter((status): status is string => status !== undefined);
  return statuses.find(isTerminalTimelineStatus) ?? statuses[0];
}

export function isTerminalTimelineStatus(status: string | undefined): boolean {
  return status !== undefined && TERMINAL_TIMELINE_STATUSES.has(status);
}

function getToolGroup(
  groups: AgentTimelineGroup[],
  toolGroups: Map<string, Extract<AgentTimelineGroup, { kind: 'tool' }>>,
  toolCallId: string,
): Extract<AgentTimelineGroup, { kind: 'tool' }> {
  const existing = toolGroups.get(toolCallId);
  if (existing !== undefined) return existing;
  const created: Extract<AgentTimelineGroup, { kind: 'tool' }> = {
    kind: 'tool',
    toolCallId,
  };
  toolGroups.set(toolCallId, created);
  groups.push(created);
  return created;
}

function getLegacyToolGroup(
  groups: AgentTimelineGroup[],
  legacyToolGroups: Extract<AgentTimelineGroup, { kind: 'tool' }>[],
  item: AgentTimelineItem,
  index: number,
): Extract<AgentTimelineGroup, { kind: 'tool' }> {
  const role = legacyToolEventRole(item);
  const existing = [...legacyToolGroups]
    .reverse()
    .find((group) =>
      role === 'call'
        ? group.call === undefined
        : group.call !== undefined && group.result === undefined,
    );
  if (existing !== undefined) return existing;

  const created: Extract<AgentTimelineGroup, { kind: 'tool' }> = {
    kind: 'tool',
    toolCallId: `legacy-tool-${index}`,
  };
  legacyToolGroups.push(created);
  groups.push(created);
  return created;
}

function toolEventRole(
  item: AgentTimelineItem,
  group: Extract<AgentTimelineGroup, { kind: 'tool' }>,
): 'call' | 'result' {
  if (item.toolRole !== undefined) return item.toolRole;
  if (item.id.startsWith('tool-call-')) return 'call';
  if (item.id.startsWith('tool-result-')) return 'result';
  return group.call === undefined ? 'call' : 'result';
}

function legacyToolEventRole(item: AgentTimelineItem): 'call' | 'result' {
  if (item.toolRole !== undefined) return item.toolRole;
  if (item.id.startsWith('tool-call-')) return 'call';
  if (item.id.startsWith('tool-result-')) return 'result';
  return extractToolCommand(item.text) === undefined ? 'result' : 'call';
}

function findLegacyCommandGroup(
  groups: readonly AgentTimelineGroup[],
  command: string,
): Extract<AgentTimelineGroup, { kind: 'tool' }> | undefined {
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (
      group?.kind === 'tool' &&
      group.command === undefined &&
      group.call !== undefined &&
      extractToolCommand(group.call.text) === command
    ) {
      return group;
    }
  }
  return undefined;
}

function extractToolCommand(text: string): string | undefined {
  const newline = text.indexOf('\n');
  if (newline < 0) return undefined;
  try {
    const argumentsValue: unknown = JSON.parse(text.slice(newline + 1));
    if (typeof argumentsValue !== 'object' || argumentsValue === null) return undefined;
    const command = (argumentsValue as { command?: unknown }).command;
    return typeof command === 'string' ? command : undefined;
  } catch {
    return undefined;
  }
}

function timelineItemStatus(item: AgentTimelineItem | undefined): string | undefined {
  if (item === undefined) return undefined;
  if (isTerminalTimelineStatus(item.status)) return item.status;
  const payloadStatus = item.kind === 'tool' ? extractResultStatus(item.text) : undefined;
  return isTerminalTimelineStatus(payloadStatus) ? payloadStatus : (item.status ?? payloadStatus);
}

function extractResultStatus(text: string): string | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null) return undefined;
    const directStatus = (value as { status?: unknown }).status;
    if (typeof directStatus === 'string') return directStatus;
    const result = (value as { result?: unknown }).result;
    if (typeof result !== 'object' || result === null) return undefined;
    const resultStatus = (result as { status?: unknown }).status;
    return typeof resultStatus === 'string' ? resultStatus : undefined;
  } catch {
    return undefined;
  }
}

/** Hydrate persisted history while retaining only live events that are not persisted yet. */
export function mergeHydratedTimeline(
  items: readonly AgentTimelineItem[],
  sessionId: string,
  history: AgentHistoryView | readonly AgentTimelineItem[],
): AgentTimelineItem[] {
  const hydrated = Array.isArray(history)
    ? [...history]
    : historyToTimeline(history as AgentHistoryView);
  const hydratedToolResultIds = new Set(
    hydrated
      .filter(
        (
          item,
        ): item is AgentTimelineItem & { kind: 'tool'; toolRole: 'result'; toolCallId: string } =>
          item.kind === 'tool' && item.toolRole === 'result' && item.toolCallId !== undefined,
      )
      .map((item) => item.toolCallId),
  );

  const currentSessionItems = items.filter((item) => item.sessionId === sessionId);
  const mergedSessionItems = mergeSessionTimeline(
    currentSessionItems,
    hydrated,
    hydratedToolResultIds,
  );
  const firstSessionIndex = items.findIndex((item) => item.sessionId === sessionId);
  if (firstSessionIndex < 0) return [...items, ...mergedSessionItems];

  const merged: AgentTimelineItem[] = [];
  let inserted = false;
  for (const item of items) {
    if (item.sessionId !== sessionId) {
      merged.push(item);
      continue;
    }
    if (!inserted) {
      merged.push(...mergedSessionItems);
      inserted = true;
    }
  }
  return merged;
}

interface TimelineMergeEntry {
  item: AgentTimelineItem;
  hydratedIndex?: number;
}

function mergeSessionTimeline(
  items: readonly AgentTimelineItem[],
  hydrated: readonly AgentTimelineItem[],
  hydratedToolResultIds: ReadonlySet<string>,
): AgentTimelineItem[] {
  const hydratedIndexById = new Map(hydrated.map((item, index) => [item.id, index]));
  const hydratedIndexByLogicalKey = new Map<string, number>();
  hydrated.forEach((item, index) => {
    const key = timelineLogicalKey(item);
    if (key !== undefined) hydratedIndexByLogicalKey.set(key, index);
  });

  const entries: TimelineMergeEntry[] = [];
  const emittedHydratedIds = new Set<string>();
  for (const item of items) {
    const hydratedIndex = findHydratedIndex(item, hydratedIndexById, hydratedIndexByLogicalKey);
    if (hydratedIndex !== undefined) {
      const replacement = hydrated[hydratedIndex];
      if (replacement !== undefined && !emittedHydratedIds.has(replacement.id)) {
        entries.push({ item: replacement, hydratedIndex });
        emittedHydratedIds.add(replacement.id);
      }
      continue;
    }
    if (shouldRetainLiveItem(item, hydratedToolResultIds)) entries.push({ item });
  }

  hydrated.forEach((item, hydratedIndex) => {
    if (emittedHydratedIds.has(item.id)) return;
    insertHydratedEntry(entries, { item, hydratedIndex });
    emittedHydratedIds.add(item.id);
  });

  return entries.map(({ item }) => item);
}

function findHydratedIndex(
  item: AgentTimelineItem,
  hydratedIndexById: ReadonlyMap<string, number>,
  hydratedIndexByLogicalKey: ReadonlyMap<string, number>,
): number | undefined {
  const byId = hydratedIndexById.get(item.id);
  if (byId !== undefined) return byId;
  const logicalKey = timelineLogicalKey(item);
  return logicalKey === undefined ? undefined : hydratedIndexByLogicalKey.get(logicalKey);
}

function shouldRetainLiveItem(
  item: AgentTimelineItem,
  hydratedToolResultIds: ReadonlySet<string>,
): boolean {
  if (
    item.kind === 'command' &&
    (item.toolCallId === undefined || !hydratedToolResultIds.has(item.toolCallId))
  ) {
    return true;
  }
  if (item.kind === 'system' || item.kind === 'approval' || item.kind === 'file') return true;
  if (item.kind === 'user' || item.kind === 'assistant' || item.kind === 'tool') return true;
  return (
    item.status === 'running' ||
    item.status === 'streaming' ||
    item.status === 'waiting_user' ||
    item.status === 'waiting_approval'
  );
}

function insertHydratedEntry(entries: TimelineMergeEntry[], entry: TimelineMergeEntry): void {
  const hydratedIndex = entry.hydratedIndex;
  if (hydratedIndex === undefined) {
    entries.push(entry);
    return;
  }

  const nextHydratedPosition = entries.findIndex(
    (candidate) => candidate.hydratedIndex !== undefined && candidate.hydratedIndex > hydratedIndex,
  );
  let insertionPosition = nextHydratedPosition < 0 ? entries.length : nextHydratedPosition;

  for (let index = 0; index < insertionPosition; index += 1) {
    const candidate = entries[index];
    if (
      candidate !== undefined &&
      candidate.hydratedIndex === undefined &&
      shouldHydratedItemPrecedeLiveItem(entry.item, candidate.item)
    ) {
      insertionPosition = index;
      break;
    }
  }

  entries.splice(insertionPosition, 0, entry);
}

function shouldHydratedItemPrecedeLiveItem(
  hydrated: AgentTimelineItem,
  live: AgentTimelineItem,
): boolean {
  if (hydrated.turnId === undefined || hydrated.turnId !== live.turnId) return false;
  if (hydrated.kind === 'user') return true;
  if (hydrated.kind !== 'tool' || hydrated.toolRole !== 'call') return false;
  return live.kind === 'command' || live.kind === 'approval' || live.kind === 'system';
}

function timelineLogicalKey(item: AgentTimelineItem): string | undefined {
  if (item.kind === 'user' && item.turnId !== undefined) {
    return `user:${item.turnId}`;
  }
  if (item.kind === 'assistant' && item.turnId !== undefined) {
    return `assistant:${item.turnId}`;
  }
  if (item.kind === 'tool' && item.toolCallId !== undefined) {
    return `tool:${item.toolCallId}:${item.toolRole ?? 'unknown'}`;
  }
  return undefined;
}

export function resolveApprovalStatus(
  itemStatus: string | undefined,
  actionState: ApprovalActionState,
): string | undefined {
  return actionState ?? itemStatus;
}

export function isApprovalActionable(
  itemStatus: string | undefined,
  actionState: ApprovalActionState,
): boolean {
  return resolveApprovalStatus(itemStatus, actionState) === 'waiting_approval';
}

export function mergeHydratedActiveTurnId(
  currentTurnId: string | undefined,
  hydratedTurnId: string | undefined,
): string | undefined {
  return currentTurnId ?? hydratedTurnId;
}
