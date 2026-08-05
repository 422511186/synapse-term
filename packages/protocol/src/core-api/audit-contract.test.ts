import { describe, expect, expectTypeOf, it } from 'vitest';

import * as coreApi from './core-api.js';
import type {
  AuditCleanupResponse,
  AuditDetailResponse,
  AuditEventView,
  AuditListResponse,
  AuditRetentionResponse,
  AuditTraceDetailView,
  AuditTraceEventView,
  AuditTraceView,
} from './core-api.js';

const auditListQuery = {
  from: '2026-07-29T00:00:00.000Z',
  to: '2026-08-05T00:00:00.000Z',
  sessionId: 'session-1',
  taskId: 'task-1',
  actor: 'mcp-client',
  category: 'external',
  outcome: 'failure',
  risk: 'destructive',
  search: 'redacted command',
  includeObservations: true,
  limit: 100,
  cursor: 'cursor-1',
} as const;

function getSchema(name: string): { parse(value: unknown): unknown } {
  const schema = (coreApi as unknown as Record<string, unknown>)[name];
  expect(schema, `${name} must be exported`).toBeDefined();
  return schema as { parse(value: unknown): unknown };
}

describe('audit Core API contract', () => {
  it('accepts the complete bounded audit.list query', () => {
    expect(coreApi.parseCoreRequest('audit.list', auditListQuery)).toEqual({
      method: 'audit.list',
      payload: auditListQuery,
    });
  });

  it('rejects unknown audit.list fields and out-of-range limits', () => {
    expect(() =>
      coreApi.parseCoreRequest('audit.list', { ...auditListQuery, unexpected: true }),
    ).toThrow();
    expect(() => coreApi.parseCoreRequest('audit.list', { ...auditListQuery, limit: 0 })).toThrow();
    expect(() =>
      coreApi.parseCoreRequest('audit.list', { ...auditListQuery, limit: 101 }),
    ).toThrow();
  });

  it('accepts detail, retention, and cleanup requests with their exact payloads', () => {
    expect(coreApi.parseCoreRequest('audit.detail', { traceId: 'task:task-1' })).toEqual({
      method: 'audit.detail',
      payload: { traceId: 'task:task-1' },
    });
    expect(coreApi.parseCoreRequest('audit.retention', {})).toEqual({
      method: 'audit.retention',
      payload: {},
    });
    expect(coreApi.parseCoreRequest('audit.cleanup', {})).toEqual({
      method: 'audit.cleanup',
      payload: {},
    });
    expect(() => coreApi.parseCoreRequest('audit.retention', { extra: true })).toThrow();
  });

  it('exports stable audit DTO schemas', () => {
    for (const name of [
      'auditOutcomeSchema',
      'auditRiskSchema',
      'auditCategorySchema',
      'auditActorViewSchema',
      'auditTraceViewSchema',
      'auditTraceEventViewSchema',
      'auditTraceDetailViewSchema',
      'auditListResponseSchema',
      'auditDetailResponseSchema',
      'auditRetentionResponseSchema',
      'auditCleanupResponseSchema',
    ]) {
      getSchema(name);
    }
  });

  it('keeps audit response DTOs strict and free of arbitrary payloads', () => {
    const actor = { kind: 'external', callerKind: 'mcp', callerId: 'mcp-client' } as const;
    const event = {
      id: 'event-1',
      type: 'external.command',
      occurredAt: '2026-08-05T00:00:00.000Z',
      sessionId: 'session-1',
      transactionId: 'transaction-1',
      actor,
      category: 'command',
      outcome: 'success',
      risk: 'read_only',
      summary: 'ls',
      commandPreview: 'ls',
      commandHash: 'a'.repeat(64),
      details: [{ label: '执行状态', value: 'completed' }],
    } as const;
    const trace = {
      traceId: 'transaction:transaction-1',
      subject: 'external_transaction',
      sessionId: 'session-1',
      transactionId: 'transaction-1',
      actor,
      category: 'command',
      startedAt: event.occurredAt,
      lastActivityAt: event.occurredAt,
      outcome: 'success',
      risk: 'read_only',
      summary: 'ls',
      eventCount: 1,
      containsObservations: false,
    } as const;

    expect(getSchema('auditTraceEventViewSchema').parse(event)).toEqual(event);
    expect(getSchema('auditTraceViewSchema').parse(trace)).toEqual(trace);
    expect(getSchema('auditTraceDetailViewSchema').parse({ ...trace, events: [event] })).toEqual({
      ...trace,
      events: [event],
    });
    expect(() =>
      getSchema('auditTraceEventViewSchema').parse({ ...event, payload: { secret: 'nope' } }),
    ).toThrow();
    expect(
      getSchema('auditListResponseSchema').parse({
        items: [trace],
        nextCursor: 'cursor-2',
      }),
    ).toEqual({ items: [trace], nextCursor: 'cursor-2' });
    expect(
      getSchema('auditRetentionResponseSchema').parse({
        auditRetentionDays: 30,
        rawLogRetentionHours: 24,
      }),
    ).toEqual({ auditRetentionDays: 30, rawLogRetentionHours: 24 });
    expect(getSchema('auditCleanupResponseSchema').parse({ rawLogs: 2, auditEvents: 3 })).toEqual({
      rawLogs: 2,
      auditEvents: 3,
    });
  });

  it('exposes stable audit response types for downstream clients', () => {
    expectTypeOf<AuditEventView>().toEqualTypeOf<AuditTraceView>();
    expectTypeOf<AuditListResponse['items'][number]>().toEqualTypeOf<AuditTraceView>();
    expectTypeOf<AuditDetailResponse>().toEqualTypeOf<AuditTraceDetailView>();
    expectTypeOf<AuditTraceDetailView['events'][number]>().toEqualTypeOf<AuditTraceEventView>();
    expectTypeOf<AuditRetentionResponse>().toEqualTypeOf<{
      auditRetentionDays: number;
      rawLogRetentionHours: number;
    }>();
    expectTypeOf<AuditCleanupResponse>().toEqualTypeOf<{
      rawLogs: number;
      auditEvents: number;
    }>();
  });
});
