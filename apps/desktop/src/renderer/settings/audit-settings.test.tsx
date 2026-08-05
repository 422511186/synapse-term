import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { createMockDesktopApi } from '../mock-api.js';
import type {
  AuditRetentionResponse,
  AuditTraceDetailView,
  AuditTraceView,
} from '../../preload/preload-api.js';
import {
  AuditFilterDialog,
  AuditRetentionDialog,
  AuditSettings,
  AuditTraceTable,
  AuditTraceEvidence,
  AuditRequestTracker,
  buildAuditListRequest,
  buildCleanupDescription,
  createDefaultAuditFilters,
} from './audit-settings.js';

describe('AuditSettings', () => {
  const trace: AuditTraceView = {
    traceId: 'event:event-1',
    subject: 'event',
    sessionId: 'session-1',
    actor: { kind: 'user' },
    category: 'command',
    startedAt: '2026-08-05T10:00:00.000Z',
    lastActivityAt: '2026-08-05T10:00:01.000Z',
    outcome: 'failure',
    risk: 'mutating',
    summary: '命令：systemctl restart api',
    eventCount: 1,
    containsObservations: false,
  };

  it('shows executable command evidence instead of only trace metadata', () => {
    const detail: AuditTraceDetailView = {
      traceId: 'transaction:tx-1',
      subject: 'external_transaction',
      sessionId: 'session-1',
      transactionId: 'tx-1',
      actor: { kind: 'agent', taskId: 'task-1' },
      category: 'command',
      startedAt: '2026-08-05T10:00:00.000Z',
      lastActivityAt: '2026-08-05T10:00:01.000Z',
      outcome: 'failure',
      risk: 'mutating',
      summary: 'systemctl restart api',
      eventCount: 1,
      containsObservations: false,
      events: [
        {
          id: 'event-1',
          type: 'command.completed',
          occurredAt: '2026-08-05T10:00:01.000Z',
          sessionId: 'session-1',
          taskId: 'task-1',
          transactionId: 'tx-1',
          actor: { kind: 'agent', taskId: 'task-1' },
          category: 'command',
          outcome: 'failure',
          risk: 'mutating',
          summary: 'systemctl restart api',
          commandPreview: 'systemctl restart api',
          commandHash: 'sha256:command-1',
          exitCode: 1,
          reason: 'service failed',
          details: [{ label: '执行状态', value: 'failed' }],
        },
      ],
    };

    const markup = renderToStaticMarkup(
      <AuditTraceEvidence detail={detail} error={undefined} loading={false} />,
    );

    expect(markup).toContain('审计记录详情');
    expect(markup).toContain('命令：已完成');
    expect(markup).toContain('执行命令');
    expect(markup).toContain('systemctl restart api');
    expect(markup).toContain('退出码');
    expect(markup).toContain('service failed');
    expect(markup).toContain('执行状态');
  });

  it('ignores a stale audit list response after a newer query starts', () => {
    const tracker = new AuditRequestTracker();
    const firstRequest = tracker.begin();
    const secondRequest = tracker.begin();

    expect(tracker.isCurrent(firstRequest)).toBe(false);
    expect(tracker.isCurrent(secondRequest)).toBe(true);
  });

  it('defaults to all sessions and a bounded seven-day window', () => {
    const now = new Date('2026-08-05T12:34:56.000Z');
    const filters = createDefaultAuditFilters(now);

    expect(filters.sessionId).toBe('');
    expect(filters.includeObservations).toBe(false);
    expect(buildAuditListRequest(filters, now)).toEqual({
      from: '2026-07-29T00:00:00.000Z',
      to: '2026-08-05T23:59:59.999Z',
      includeObservations: false,
      limit: 25,
    });
  });

  it('combines filters into one bounded query without exposing raw event payload fields', () => {
    const filters = {
      from: '2026-08-01',
      to: '2026-08-05',
      sessionId: 'session-1',
      actor: 'caller-1',
      category: 'external' as const,
      outcome: 'rejected' as const,
      risk: 'destructive' as const,
      search: '  redacted preview  ',
      includeObservations: true,
    };

    expect(
      buildAuditListRequest(filters, new Date('2026-08-05T00:00:00.000Z'), 'cursor-1'),
    ).toEqual({
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-05T23:59:59.999Z',
      sessionId: 'session-1',
      actor: 'caller-1',
      category: 'external',
      outcome: 'rejected',
      risk: 'destructive',
      search: 'redacted preview',
      includeObservations: true,
      limit: 25,
      cursor: 'cursor-1',
    });
  });

  it('renders investigation controls, retention policy, and no destructive export surface', () => {
    const markup = renderToStaticMarkup(<AuditSettings api={createMockDesktopApi()} />);

    expect(markup).toContain('审计日志');
    expect(markup).toContain('命令、对象、Session、原因');
    expect(markup).toContain('高级筛选');
    expect(markup).toContain('最近 7 天');
    expect(markup).toContain('保留策略');
    expect(markup).not.toContain('查询筛选');
    expect(markup).not.toContain('结构化审计');
    expect(markup).not.toContain('原始终端日志');
    expect(markup).not.toContain('清理过期数据');
    expect(markup).not.toContain('清空全部');
    expect(markup).not.toContain('导出');
    expect(markup).not.toContain('Protected Input');
    expect(markup).not.toContain('完整终端输出');
    expect(markup).not.toContain('终端录像');
  });

  it('uses generated utility classes for search and select adornments', () => {
    const markup = renderToStaticMarkup(<AuditSettings api={createMockDesktopApi()} />);
    const filterMarkup = renderToStaticMarkup(
      <AuditFilterDialog
        filters={createDefaultAuditFilters(new Date('2026-08-05T12:00:00.000Z'))}
        onApply={() => undefined}
        onClose={() => undefined}
        open
        sessions={[]}
      />,
    );

    expect(markup).toContain('absolute left-2 top-1/2 -translate-y-1/2');
    expect(markup).toContain('py-2.5 pl-8 pr-3');
    expect(filterMarkup).toContain('absolute right-2 top-1/2 -translate-y-1/2');
    expect(markup).not.toContain('absolute left-3 top-2.5');
    expect(markup).not.toContain('py-2.5 pl-9');
    expect(filterMarkup).not.toContain('absolute right-2 top-2.5');
  });

  it('keeps audit evidence and query layouts on utilities present in the renderer stylesheet', () => {
    const markup = renderToStaticMarkup(
      <AuditTraceEvidence
        detail={{
          ...trace,
          events: [
            {
              id: 'event-1',
              type: 'command.completed',
              occurredAt: '2026-08-05T10:00:01.000Z',
              sessionId: 'session-1',
              actor: { kind: 'user' },
              category: 'command',
              outcome: 'failure',
              risk: 'mutating',
              summary: 'systemctl restart api',
              commandPreview: 'systemctl restart api',
              reason: 'service failed',
            },
          ],
        }}
        error={undefined}
        loading={false}
      />,
    );
    const settingsMarkup = renderToStaticMarkup(<AuditSettings api={createMockDesktopApi()} />);

    expect(markup).toContain('style="grid-column:1 / -1"');
    expect(markup).toContain('grid grid-cols-1 gap-3 sm:grid-cols-2');
    expect(markup).not.toContain('sm:col-span-2');
    expect(markup).not.toContain('sm:grid-cols-4');
    expect(markup).not.toContain('gap-x-5 gap-y-3');
    expect(settingsMarkup).toContain('flex flex-wrap items-center');
    expect(settingsMarkup).not.toContain('xl:flex-row xl:items-center');
  });

  it('renders audit traces as a paginated table without technical trace keys in the main columns', () => {
    const markup = renderToStaticMarkup(
      <AuditTraceTable
        hasNextPage
        hasPreviousPage
        items={[trace]}
        onNextPage={() => undefined}
        onPreviousPage={() => undefined}
        onSelect={() => undefined}
        page={2}
      />,
    );

    expect(markup).toContain('<table');
    expect(markup).toContain('时间');
    expect(markup).toContain('操作');
    expect(markup).toContain('对象 / 命令');
    expect(markup).toContain('Session');
    expect(markup).toContain('发起者');
    expect(markup).toContain('结果');
    expect(markup).toContain('风险');
    expect(markup).toContain('systemctl restart api');
    expect(markup).not.toContain('event:event-1');
    expect(markup).toContain('上一页');
    expect(markup).toContain('下一页');
    expect(markup).toContain('第 2 页');
  });

  it('opens audit detail in a standalone dialog instead of rendering it below the selected row', () => {
    const detail: AuditTraceDetailView = {
      ...trace,
      events: [
        {
          id: 'event-1',
          type: 'command.completed',
          occurredAt: '2026-08-05T10:00:01.000Z',
          sessionId: 'session-1',
          actor: { kind: 'user' },
          category: 'command',
          outcome: 'failure',
          risk: 'mutating',
          summary: 'systemctl restart api',
          commandPreview: 'systemctl restart api',
          exitCode: 1,
          reason: 'service failed',
        },
      ],
    };

    const markup = renderToStaticMarkup(
      <AuditTraceTable
        hasNextPage={false}
        hasPreviousPage={false}
        items={[trace]}
        onNextPage={() => undefined}
        onPreviousPage={() => undefined}
        onSelect={() => undefined}
        page={1}
      />,
    );
    const dialogMarkup = renderToStaticMarkup(
      <AuditTraceEvidence detail={detail} error={undefined} loading={false} />,
    );

    expect(markup).not.toContain('事件证据');
    expect(dialogMarkup).toContain('role="dialog"');
    expect(dialogMarkup).toContain('审计记录详情');
    expect(dialogMarkup).toContain('systemctl restart api');
    expect(dialogMarkup).toContain('退出码');
  });

  it('keeps advanced filters and retention cleanup behind separate dialogs', () => {
    const filters = createDefaultAuditFilters(new Date('2026-08-05T12:00:00.000Z'));
    const retention: AuditRetentionResponse = {
      auditRetentionDays: 30,
      rawLogRetentionHours: 24,
    };

    const filterMarkup = renderToStaticMarkup(
      <AuditFilterDialog
        filters={filters}
        onApply={() => undefined}
        onClose={() => undefined}
        open
        sessions={[]}
      />,
    );
    const retentionMarkup = renderToStaticMarkup(
      <AuditRetentionDialog
        cleanupError={undefined}
        cleanupResult={undefined}
        onCleanup={() => undefined}
        onClose={() => undefined}
        open
        retention={retention}
        retentionError={undefined}
        retentionLoading={false}
      />,
    );

    expect(filterMarkup).toContain('role="dialog"');
    expect(filterMarkup).toContain('高级筛选');
    expect(filterMarkup).toContain('包含成功观察');
    expect(retentionMarkup).toContain('role="dialog"');
    expect(retentionMarkup).toContain('审计保留策略');
    expect(retentionMarkup).toContain('清理已过期数据');
    expect(retentionMarkup).toContain('结构化审计');
    expect(retentionMarkup).toContain('原始终端日志');
    expect(buildCleanupDescription(retention, new Date('2026-08-05T12:00:00.000Z'))).toContain(
      '清理范围',
    );
  });
});
