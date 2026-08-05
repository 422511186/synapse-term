import { describe, expect, it } from 'vitest';

import type { AuditEvent } from '@synapse-term/infrastructure';

import { AuditRequestHandler } from './audit-handler.js';

function event(
  id: string,
  type: string,
  occurredAt: string,
  payload: Record<string, unknown>,
  extra: Partial<AuditEvent> = {},
): AuditEvent {
  return {
    id,
    actor: { kind: 'system' },
    type,
    occurredAt,
    payload,
    ...extra,
  };
}

describe('AuditRequestHandler', () => {
  it('returns recent aggregated traces with filters and a bounded cursor', () => {
    const auditEvents = [
      event('old', 'session.created', '2026-07-20T00:00:00.000Z', {}),
      event(
        'task-start',
        'task.started',
        '2026-08-04T10:00:00.000Z',
        { status: 'started' },
        {
          sessionId: 'session-1',
          taskId: 'task-1',
        },
      ),
      event(
        'task-end',
        'task.completed',
        '2026-08-04T10:01:00.000Z',
        { status: 'completed' },
        {
          sessionId: 'session-1',
          taskId: 'task-1',
        },
      ),
      event(
        'rejected',
        'external.denied',
        '2026-08-04T10:02:00.000Z',
        { reason: 'approval_mode_denied' },
        {
          sessionId: 'session-2',
        },
      ),
    ];
    const listEvents = (filter: { from?: string; to?: string; limit?: number }) => {
      expect(filter.from).toBe('2026-07-29T00:00:00.000Z');
      expect(filter.limit).toBeLessThanOrEqual(500);
      return { items: auditEvents.filter((item) => item.occurredAt >= filter.from!) };
    };
    const handler = new AuditRequestHandler({
      audit: { query: () => [], listEvents },
      now: () => new Date('2026-08-05T00:00:00.000Z'),
    });

    const result = handler.listAudit({ outcome: 'success', sessionId: 'session-1', limit: 10 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ traceId: 'task:task-1', outcome: 'success' });
    expect(result.items[0]).not.toHaveProperty('payload');
  });

  it('returns transaction details in chronological order without raw payload', () => {
    const auditEvents = [
      event(
        'wait',
        'external.wait',
        '2026-08-04T10:02:00.000Z',
        {
          transactionId: 'tx-1',
          status: 'completed',
          commandHash: 'sha256:tx',
        },
        { sessionId: 'session-1' },
      ),
      event(
        'command',
        'external.command',
        '2026-08-04T10:01:00.000Z',
        {
          transactionId: 'tx-1',
          status: 'running',
          commandPreview: 'printf ok',
        },
        { sessionId: 'session-1' },
      ),
    ];
    const handler = new AuditRequestHandler({
      audit: {
        query: () => [],
        listEvents: () => ({ items: auditEvents }),
      },
      now: () => new Date('2026-08-05T00:00:00.000Z'),
    });

    const detail = handler.getAuditTrace('transaction:tx-1');

    expect(detail?.events.map((item) => item.id)).toEqual(['command', 'wait']);
    expect(detail?.events[0]).toMatchObject({
      type: 'external.command',
      commandPreview: 'printf ok',
    });
    expect(detail?.events[0]).not.toHaveProperty('payload');
  });

  it('returns a trace cursor for the next bounded page', () => {
    const auditEvents = [
      event('first', 'session.created', '2026-08-04T10:00:00.000Z', {}),
      event('second', 'session.created', '2026-08-04T10:01:00.000Z', {}),
    ];
    const handler = new AuditRequestHandler({
      audit: {
        query: () => [],
        listEvents: () => ({ items: auditEvents }),
      },
      now: () => new Date('2026-08-05T00:00:00.000Z'),
    });

    const first = handler.listAudit({ limit: 1 });
    const second = handler.listAudit(
      first.nextCursor === undefined ? { limit: 1 } : { limit: 1, cursor: first.nextCursor },
    );

    expect(first.items.map((item) => item.traceId)).toEqual(['event:second']);
    expect(first.nextCursor).toBeDefined();
    expect(second.items.map((item) => item.traceId)).toEqual(['event:first']);
    expect(second.nextCursor).toBeUndefined();
  });

  it('walks bounded event pages before projecting traces so the newest trace is not lost', () => {
    const auditEvents = Array.from({ length: 501 }, (_, index) =>
      event(
        `event-${String(index).padStart(3, '0')}`,
        'session.created',
        `2026-08-04T10:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
        {},
      ),
    );
    const pageCalls: Array<{ limit?: number; cursor?: string }> = [];
    const listEvents = (filter: { limit?: number; cursor?: string }) => {
      pageCalls.push(filter);
      const offset = filter.cursor === undefined ? 0 : Number(filter.cursor);
      const limit = filter.limit ?? 0;
      const items = auditEvents.slice(offset, offset + limit);
      return {
        items,
        ...(offset + items.length < auditEvents.length
          ? { nextCursor: String(offset + items.length) }
          : {}),
      };
    };
    const handler = new AuditRequestHandler({
      audit: { query: () => [], listEvents },
      now: () => new Date('2026-08-05T00:00:00.000Z'),
    });

    const result = handler.listAudit({ limit: 1 });

    expect(result.items[0]?.traceId).toBe('event:event-500');
    expect(pageCalls.length).toBeGreaterThan(1);
    expect(pageCalls.every((call) => call.limit === 500)).toBe(true);
  });

  it('walks every bounded page when loading a transaction detail', () => {
    const padding = Array.from({ length: 500 }, (_, index) =>
      event(
        `padding-${String(index).padStart(3, '0')}`,
        'session.created',
        `2026-08-04T09:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
        {},
      ),
    );
    const transactionEvents = [
      event('transaction-command', 'external.command', '2026-08-04T20:00:00.000Z', {
        transactionId: 'tx-long',
        status: 'running',
      }),
      event('transaction-wait', 'external.wait', '2026-08-04T20:01:00.000Z', {
        transactionId: 'tx-long',
        status: 'completed',
      }),
    ];
    const auditEvents = [...padding, ...transactionEvents];
    const listEvents = (filter: { limit?: number; cursor?: string }) => {
      const offset = filter.cursor === undefined ? 0 : Number(filter.cursor);
      const limit = filter.limit ?? 0;
      const items = auditEvents.slice(offset, offset + limit);
      return {
        items,
        ...(offset + items.length < auditEvents.length
          ? { nextCursor: String(offset + items.length) }
          : {}),
      };
    };
    const handler = new AuditRequestHandler({
      audit: { query: () => [], listEvents },
      now: () => new Date('2026-08-05T00:00:00.000Z'),
    });

    expect(handler.getAuditTrace('transaction:tx-long')?.events.map((item) => item.id)).toEqual([
      'transaction-command',
      'transaction-wait',
    ]);
  });

  it('caps oversized trace details to the newest bounded event window', () => {
    const auditEvents = Array.from({ length: 501 }, (_, index) =>
      event(
        `task-event-${String(index).padStart(3, '0')}`,
        'command.completed',
        `2026-08-04T${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:00.000Z`,
        { status: 'completed' },
        { taskId: 'task-oversized' },
      ),
    );
    const handler = new AuditRequestHandler({
      audit: {
        query: () => [],
        listEvents: () => ({ items: auditEvents }),
      },
      now: () => new Date('2026-08-05T00:00:00.000Z'),
    });

    const detail = handler.getAuditTrace('task:task-oversized');

    expect(detail?.eventCount).toBe(501);
    expect(detail?.events).toHaveLength(500);
    expect(detail?.events[0]?.id).toBe('task-event-001');
    expect(detail?.events.at(-1)?.id).toBe('task-event-500');
    expect(detail?.events.map((item) => item.occurredAt)).toEqual(
      [...(detail?.events ?? [])].map((item) => item.occurredAt).sort(),
    );
  });
});
