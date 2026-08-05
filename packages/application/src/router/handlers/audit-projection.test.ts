import { describe, expect, it } from 'vitest';

import type { AuditEvent } from '@synapse-term/infrastructure';

import { projectAuditEvents, projectAuditTrace } from './audit-projection.js';

const at = (
  id: string,
  type: string,
  payload: Record<string, unknown>,
  occurredAt: string,
): AuditEvent => ({
  id,
  actor: { kind: 'system' },
  type,
  occurredAt,
  payload,
});

describe('audit projection', () => {
  it('correlates built-in Agent events by task id', () => {
    const traces = projectAuditEvents([
      at('task-start', 'task.started', { status: 'started' }, '2026-08-04T10:00:00.000Z'),
      {
        ...at(
          'task-command',
          'command.completed',
          { status: 'completed', exitCode: 0 },
          '2026-08-04T10:01:00.000Z',
        ),
        taskId: 'task-1',
        sessionId: 'session-1',
      },
      {
        ...at('task-end', 'task.completed', { status: 'completed' }, '2026-08-04T10:02:00.000Z'),
        taskId: 'task-1',
        sessionId: 'session-1',
      },
    ]);

    expect(traces).toHaveLength(2);
    expect(traces.find((trace) => trace.traceId === 'task:task-1')).toMatchObject({
      subject: 'agent_task',
      taskId: 'task-1',
      sessionId: 'session-1',
      eventCount: 2,
      outcome: 'success',
    });
  });

  it('correlates external command lifecycle events by transaction id without a task id', () => {
    const traces = projectAuditEvents([
      {
        ...at(
          'command',
          'external.command',
          { transactionId: 'tx-1', status: 'running' },
          '2026-08-04T10:00:00.000Z',
        ),
        sessionId: 'session-2',
      },
      {
        ...at(
          'wait',
          'external.wait',
          { transactionId: 'tx-1', status: 'completed' },
          '2026-08-04T10:01:00.000Z',
        ),
        sessionId: 'session-2',
      },
    ]);

    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      traceId: 'transaction:tx-1',
      subject: 'external_transaction',
      transactionId: 'tx-1',
      outcome: 'success',
      eventCount: 2,
    });
    expect(traces[0]).not.toHaveProperty('taskId');
  });

  it('keeps events without an existing correlation id standalone', () => {
    const traces = projectAuditEvents([
      at('provider-1', 'provider.saved', { status: 'completed' }, '2026-08-04T10:00:00.000Z'),
      at('provider-2', 'provider.saved', { status: 'completed' }, '2026-08-04T10:01:00.000Z'),
    ]);

    expect(traces.map((trace) => trace.traceId)).toEqual(['event:provider-2', 'event:provider-1']);
  });

  it('hides successful observations by default but keeps failed observations visible', () => {
    const events = [
      at('observe-ok', 'external.observe', { status: 'observed' }, '2026-08-04T10:00:00.000Z'),
      at(
        'observe-failed',
        'session.probe',
        { status: 'failed', reason: 'probe_timeout' },
        '2026-08-04T10:01:00.000Z',
      ),
    ];

    expect(projectAuditEvents(events).map((trace) => trace.traceId)).toEqual([
      'event:observe-failed',
    ]);
    expect(projectAuditEvents(events, { includeObservations: true })).toHaveLength(2);
  });

  it('hides manual PTY input noise from the default execution-diagnosis list', () => {
    const events = [
      at('input', 'session.input', { bytes: 24 }, '2026-08-04T10:00:00.000Z'),
      at('provider', 'provider.updated', { status: 'completed' }, '2026-08-04T10:01:00.000Z'),
    ];

    expect(projectAuditEvents(events).map((trace) => trace.traceId)).toEqual(['event:provider']);
    expect(projectAuditEvents(events, { includeObservations: true })).toHaveLength(2);
  });

  it('uses observation outcomes and resource event types to keep failures visible', () => {
    const events = [
      at('probe-ready', 'session.probe', { outcome: 'ready' }, '2026-08-04T10:00:00.000Z'),
      at(
        'probe-failed',
        'session.probe',
        { outcome: 'failed', reason: 'probe_timeout' },
        '2026-08-04T10:01:00.000Z',
      ),
      at(
        'resources-ready',
        'session.resources_refreshed',
        { status: 'complete' },
        '2026-08-04T10:02:00.000Z',
      ),
      at(
        'resources-failed',
        'session.resources_failed',
        { error: 'collection_failed' },
        '2026-08-04T10:03:00.000Z',
      ),
    ];

    expect(projectAuditEvents(events).map((trace) => trace.traceId)).toEqual([
      'event:resources-failed',
      'event:probe-failed',
    ]);
    expect(projectAuditEvents(events).map((trace) => trace.outcome)).toEqual([
      'failure',
      'failure',
    ]);
    expect(projectAuditEvents(events, { includeObservations: true })).toHaveLength(4);
  });

  it('does not expose legacy absolute paths or sensitive path names in a projection', () => {
    const detail = projectAuditTrace(
      [
        at(
          'legacy-path',
          'external.file.read.completed',
          { path: '/Users/huangzy/private-token.txt', status: 'completed' },
          '2026-08-04T10:00:00.000Z',
        ),
      ],
      'event:legacy-path',
      { includeObservations: true },
    );

    expect(detail?.events[0]?.pathPreview).toBeDefined();
    expect(detail?.events[0]?.pathPreview).not.toContain('/Users/huangzy');
    expect(detail?.events[0]?.pathPreview).not.toContain('private-token.txt');
    expect(detail?.events[0]?.summary).not.toContain('private-token.txt');
  });

  it('projects policy and approval fields used by command audit events', () => {
    const detail = projectAuditTrace(
      [
        at(
          'approval-fields',
          'external.command',
          {
            transactionId: 'tx-approval',
            status: 'completed',
            permissionMode: 'manual',
            approvalMode: 'approved_once',
            approvalId: 'approval-1',
            approvalGrantId: 'grant-1',
          },
          '2026-08-04T10:00:00.000Z',
        ),
      ],
      'transaction:tx-approval',
      { includeObservations: true },
    );

    expect(detail?.events[0]).toMatchObject({
      policy: expect.stringContaining('manual'),
      approval: expect.stringContaining('approval-1'),
    });
    expect(detail?.events[0]?.approval).toContain('grant-1');
  });

  it('normalizes rejected, interrupted, and legacy informational outcomes', () => {
    const traces = projectAuditEvents([
      at(
        'rejected',
        'external.denied',
        { reason: 'approval_mode_denied' },
        '2026-08-04T10:00:00.000Z',
      ),
      at(
        'interrupted',
        'command.interrupted',
        { status: 'interrupted' },
        '2026-08-04T10:01:00.000Z',
      ),
      at('legacy', 'provider.saved', {}, '2026-08-04T10:02:00.000Z'),
    ]);

    expect(traces.map((trace) => trace.outcome)).toEqual([
      'information',
      'interrupted',
      'rejected',
    ]);
  });

  it('keeps the latest event summary when selecting the trace category', () => {
    const traces = projectAuditEvents([
      {
        ...at(
          'approval-requested',
          'approval.requested',
          { status: 'pending' },
          '2026-08-04T10:00:00.000Z',
        ),
        taskId: 'task-summary',
      },
      {
        ...at(
          'command-completed',
          'command.completed',
          { status: 'completed' },
          '2026-08-04T10:01:00.000Z',
        ),
        taskId: 'task-summary',
      },
    ]);

    expect(traces[0]).toMatchObject({
      category: 'command',
      summary: 'completed',
      lastActivityAt: '2026-08-04T10:01:00.000Z',
    });
  });

  it('promotes command evidence over a task lifecycle status in the trace summary', () => {
    const traces = projectAuditEvents([
      {
        ...at('task-start', 'task.started', { status: 'started' }, '2026-08-04T10:00:00.000Z'),
        taskId: 'task-command-summary',
        sessionId: 'session-1',
      },
      {
        ...at(
          'command-completed',
          'command.completed',
          {
            commandPreview: 'df -h && systemctl --failed --no-pager',
            status: 'completed',
            exitCode: 0,
          },
          '2026-08-04T10:01:00.000Z',
        ),
        taskId: 'task-command-summary',
        sessionId: 'session-1',
      },
      {
        ...at('task-end', 'task.completed', { status: 'completed' }, '2026-08-04T10:02:00.000Z'),
        taskId: 'task-command-summary',
        sessionId: 'session-1',
      },
    ]);

    expect(traces.find((trace) => trace.traceId === 'task:task-command-summary')).toMatchObject({
      summary: '命令：df -h && systemctl --failed --no-pager',
    });
  });

  it('normalizes legacy command lifecycle types when their payload has no status', () => {
    const detail = projectAuditTrace(
      [
        {
          ...at(
            'legacy-command',
            'command.completed',
            {
              commandPreview: 'systemctl restart api',
              exitCode: 0,
            },
            '2026-08-04T10:00:00.000Z',
          ),
          taskId: 'task-legacy-command',
          sessionId: 'session-1',
        },
      ],
      'task:task-legacy-command',
    );

    expect(detail?.outcome).toBe('success');
    expect(detail?.events[0]).toMatchObject({
      type: 'command.completed',
      outcome: 'success',
      commandPreview: 'systemctl restart api',
      exitCode: 0,
    });
  });

  it('projects safe operation fields so an audit detail explains what changed', () => {
    const detail = projectAuditTrace(
      [
        at(
          'model-update',
          'model.updated',
          {
            modelConfigurationId: 'model-1',
            providerProfileId: 'provider-1',
            status: 'completed',
          },
          '2026-08-04T10:00:00.000Z',
        ),
      ],
      'event:model-update',
      { includeObservations: true },
    );

    expect(detail?.events[0]?.details).toEqual([
      { label: '模型配置', value: 'model-1' },
      { label: 'Provider', value: 'provider-1' },
      { label: '执行状态', value: 'completed' },
    ]);
  });

  it('redacts legacy status text and exposes an error as the failure reason', () => {
    const detail = projectAuditTrace(
      [
        at(
          'legacy-error',
          'legacy.command',
          { status: 'token=legacy-secret', error: 'token=legacy-secret' },
          '2026-08-04T10:00:00.000Z',
        ),
      ],
      'event:legacy-error',
      { includeObservations: true },
    );

    expect(detail?.events[0]).toMatchObject({
      outcome: 'failure',
      summary: 'token=[REDACTED]',
      reason: 'token=[REDACTED]',
    });
    expect(JSON.stringify(detail)).not.toContain('legacy-secret');
  });

  it('bounds redacted text to the stable protocol DTO limit', () => {
    const detail = projectAuditTrace(
      [
        at(
          'long-command',
          'external.command',
          {
            transactionId: 'tx-long-command',
            commandPreview: 'echo ' + 'x'.repeat(5_000),
            status: 'completed',
          },
          '2026-08-04T10:00:00.000Z',
        ),
      ],
      'transaction:tx-long-command',
      { includeObservations: true },
    );

    expect(detail?.events[0]?.commandPreview).toHaveLength(4_096);
    expect(detail?.events[0]?.commandPreview?.endsWith('…')).toBe(true);
    expect(detail?.events[0]?.summary).toHaveLength(4_096);
  });
});
