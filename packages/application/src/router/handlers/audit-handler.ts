/**
 * Audit 查询用例：把追加式事件投影为安全、可筛选的 Audit Trace。
 * Renderer 只接收这里定义的稳定字段，不接收基础设施 payload。
 */
import type { AuditEvent } from '@synapse-term/infrastructure';

import type { AuditListFilter, AuditQueryLike } from '../contracts.js';
import {
  projectAuditEvents,
  projectAuditTrace,
  type AuditTraceDetailView,
  type AuditTraceView,
} from './audit-projection.js';

const DEFAULT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1_000;
const EVENT_PAGE_SIZE = 500;
const MAX_TRACE_PAGE = 100;
const MAX_DETAIL_EVENTS = 500;

export interface AuditTracePage {
  items: AuditTraceView[];
  nextCursor?: string;
}

export interface AuditRetentionView {
  auditRetentionDays: number;
  rawLogRetentionHours: number;
}

export interface AuditRequestHandlerOptions {
  audit?: AuditQueryLike | undefined;
  cleanup?: (() => Promise<{ rawLogs: number; auditEvents: number }>) | undefined;
  now?: (() => Date) | undefined;
  retention?: AuditRetentionView | undefined;
}

export class AuditRequestHandler {
  readonly #audit: AuditQueryLike | undefined;
  readonly #cleanup: (() => Promise<{ rawLogs: number; auditEvents: number }>) | undefined;
  readonly #now: () => Date;
  readonly #retention: AuditRetentionView;

  constructor(options: AuditRequestHandlerOptions) {
    this.#audit = options.audit;
    this.#cleanup = options.cleanup;
    this.#now = options.now ?? (() => new Date());
    this.#retention = options.retention ?? {
      auditRetentionDays: 30,
      rawLogRetentionHours: 24,
    };
  }

  listAudit(filter: AuditListFilter = {}): AuditTracePage {
    const now = this.#now();
    const from = filter.from ?? new Date(now.getTime() - DEFAULT_LOOKBACK_MS).toISOString();
    const to = filter.to ?? now.toISOString();
    const events = this.#loadEvents({
      from,
      to,
      ...(filter.sessionId === undefined ? {} : { sessionId: filter.sessionId }),
      ...(filter.taskId === undefined ? {} : { taskId: filter.taskId }),
    });
    const traces = projectAuditEvents(events, {
      includeObservations: filter.includeObservations,
    }).filter((trace) => this.#matchesTrace(trace, events, filter));
    const after = decodeTraceCursor(filter.cursor);
    const filtered =
      after === undefined
        ? traces
        : traces.filter(
            (trace) =>
              trace.lastActivityAt < after.lastActivityAt ||
              (trace.lastActivityAt === after.lastActivityAt && trace.traceId < after.traceId),
          );
    const limit = normalizeTraceLimit(filter.limit);
    const items = filtered.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      ...(filtered.length > limit && last !== undefined
        ? { nextCursor: encodeTraceCursor(last) }
        : {}),
    };
  }

  getAuditTrace(traceId: string): AuditTraceDetailView | undefined {
    const taskId = traceId.startsWith('task:') ? traceId.slice('task:'.length) : undefined;
    const now = this.#now();
    const events = this.#loadEvents({
      from: new Date(
        now.getTime() - this.#retention.auditRetentionDays * 24 * 60 * 60 * 1_000,
      ).toISOString(),
      ...(taskId === undefined ? {} : { taskId }),
    });
    const detail = projectAuditTrace(events, traceId, { includeObservations: true });
    if (detail === undefined || detail.events.length <= MAX_DETAIL_EVENTS) return detail;
    return {
      ...detail,
      events: detail.events.slice(-MAX_DETAIL_EVENTS),
    };
  }

  retention(): AuditRetentionView {
    return { ...this.#retention };
  }

  async cleanup(): Promise<{ rawLogs: number; auditEvents: number }> {
    if (this.#cleanup === undefined) return { rawLogs: 0, auditEvents: 0 };
    return this.#cleanup();
  }

  #loadEvents(filter: {
    from?: string;
    to?: string;
    sessionId?: string;
    taskId?: string;
  }): AuditEvent[] {
    if (this.#audit === undefined) return [];
    if (this.#audit.listEvents !== undefined) {
      const events: AuditEvent[] = [];
      const seenCursors = new Set<string>();
      let cursor: string | undefined;
      while (true) {
        const page = this.#audit.listEvents({
          ...filter,
          limit: EVENT_PAGE_SIZE,
          ...(cursor === undefined ? {} : { cursor }),
        });
        events.push(...page.items);
        if (page.nextCursor === undefined || page.items.length === 0) return events;
        if (seenCursors.has(page.nextCursor)) {
          throw new RangeError('audit event cursor did not advance');
        }
        seenCursors.add(page.nextCursor);
        cursor = page.nextCursor;
      }
    }
    return this.#audit.query(filter);
  }

  #matchesTrace(
    trace: AuditTraceView,
    events: readonly AuditEvent[],
    filter: AuditListFilter,
  ): boolean {
    if (filter.sessionId !== undefined && trace.sessionId !== filter.sessionId) return false;
    if (filter.taskId !== undefined && trace.taskId !== filter.taskId) return false;
    if (filter.actor !== undefined) {
      const actor = trace.actor;
      const actorText = [actor.kind, actor.taskId, actor.callerKind, actor.callerId]
        .filter((value): value is string => value !== undefined)
        .join(' ');
      if (!actorText.includes(filter.actor)) return false;
    }
    if (filter.category !== undefined && trace.category !== filter.category) return false;
    if (filter.outcome !== undefined && trace.outcome !== filter.outcome) return false;
    if (filter.risk !== undefined && trace.risk !== filter.risk) return false;
    if (filter.search !== undefined && filter.search.trim().length > 0) {
      const detail = projectAuditTrace(events, trace.traceId, {
        includeObservations: filter.includeObservations,
      });
      if (detail === undefined || !searchTrace(detail, filter.search)) return false;
    }
    return true;
  }
}

function searchTrace(detail: AuditTraceDetailView, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  const values = [
    detail.traceId,
    detail.sessionId,
    detail.taskId,
    detail.transactionId,
    detail.summary,
    ...detail.events.flatMap((event) => [
      event.summary,
      event.reason,
      event.commandPreview,
      event.pathPreview,
      event.commandHash,
      event.sessionId,
      event.taskId,
      event.transactionId,
      event.actor.callerId,
      ...(event.details?.flatMap((detail) => [detail.label, detail.value]) ?? []),
    ]),
  ];
  return values.some((value) => value?.toLocaleLowerCase().includes(needle));
}

function normalizeTraceLimit(value: number | undefined): number {
  if (value === undefined) return 50;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TRACE_PAGE) {
    throw new RangeError(`audit trace limit must be between 1 and ${MAX_TRACE_PAGE}`);
  }
  return value;
}

function encodeTraceCursor(trace: AuditTraceView): string {
  return Buffer.from(
    JSON.stringify({ lastActivityAt: trace.lastActivityAt, traceId: trace.traceId }),
    'utf8',
  ).toString('base64url');
}

function decodeTraceCursor(
  value: string | undefined,
): { lastActivityAt: string; traceId: string } | undefined {
  if (value === undefined) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      lastActivityAt?: unknown;
      traceId?: unknown;
    };
    if (typeof parsed.lastActivityAt !== 'string' || typeof parsed.traceId !== 'string')
      throw new Error();
    return { lastActivityAt: parsed.lastActivityAt, traceId: parsed.traceId };
  } catch {
    throw new RangeError('invalid audit trace cursor');
  }
}
