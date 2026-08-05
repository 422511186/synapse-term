import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { CoreServiceEvent } from '@synapse-term/protocol';
import { withTemporaryDirectory } from '@synapse-term/test-kit';

import { CORE_MIGRATIONS } from '@synapse-term/infrastructure';
import { CoreRepositories } from '@synapse-term/infrastructure';
import { CoreRequestRouter } from './core-request-router.js';
import { OutputJournal } from '@synapse-term/terminal-service';
import { SessionManager } from '@synapse-term/terminal-service';
import { SqliteStore } from '@synapse-term/infrastructure';
import type { PtySpawner } from '@synapse-term/terminal-service';

class EmptySpawner implements PtySpawner {
  spawn(): never {
    throw new Error('not used');
  }
}

describe('CoreRequestRouter agent and governance methods', () => {
  it('forwards agent controls and returns structured audit/core results', async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = new SqliteStore(join(directory, 'core.sqlite'), CORE_MIGRATIONS);
      await store.open();
      try {
        const repositories = new CoreRepositories(store);
        const calls: string[] = [];
        const events: CoreServiceEvent[] = [];
        const snapshot = {
          dialect: 'posix' as const,
          collectedAt: '2026-07-28T00:00:00.000Z',
          status: 'partial' as const,
          host: { status: 'available' as const, value: { name: 'example-host' } },
          os: { status: 'available' as const, value: { name: 'Linux' } },
          uptime: { status: 'available' as const, value: { seconds: 100 } },
          cpu: { status: 'available' as const, value: { logicalProcessors: 4 } },
          memory: {
            status: 'available' as const,
            value: { totalBytes: 1_000, usedBytes: 400, availableBytes: 600 },
          },
          swap: { status: 'available' as const, value: { totalBytes: 0, usedBytes: 0 } },
          disks: { status: 'available' as const, value: [] },
          network: {
            status: 'unavailable' as const,
            reason: 'command_unavailable' as const,
            message: '目标环境不支持该指标的只读采集命令',
          },
        };
        const router = new CoreRequestRouter({
          sessions: new SessionManager(new EmptySpawner()),
          journal: new OutputJournal(),
          repositories,
          emitTerminalOutput: () => undefined,
          emitEvent: (event) => events.push(event),
          agents: {
            start: async () => {
              calls.push('start');
              return {
                taskId: 'task-1',
                conversationId: 'conversation-1',
                turnId: 'turn-1',
              };
            },
            cancel: async () => {
              calls.push('cancel');
            },
            history: async () => {
              calls.push('history');
              return { sessionId: 'session-1', turns: [], items: [] };
            },
            resetConversation: async () => {
              calls.push('reset');
            },
            interrupt: async () => {
              calls.push('interrupt');
            },
            approve: async () => {
              calls.push('approve');
            },
            takeover: async () => {
              calls.push('takeover');
            },
          },
          audit: {
            query: () => [],
            listEvents: () => ({
              items: [
                {
                  id: 'audit-router',
                  actor: { kind: 'agent', taskId: 'task-router' },
                  sessionId: 'session-router',
                  taskId: 'task-router',
                  type: 'task.completed',
                  occurredAt: '2026-08-04T00:00:00.000Z',
                  payload: { status: 'completed' },
                },
              ],
            }),
          },
          resources: {
            get: () => undefined,
            refresh: async () => ({ ok: true, snapshot }),
          },
          getStatus: () => ({ connected: true, version: '0.1.0' }),
          cleanup: async () => ({ rawLogs: 1, auditEvents: 2 }),
          shutdown: async () => ({ ok: true, state: 'closed' }),
        });

        await router.handle(
          'agent.start',
          { sessionId: 'session-1', goal: 'inspect' },
          'connection-1',
        );
        await router.handle(
          'agent.cancel',
          { sessionId: 'session-1', turnId: 'turn-1' },
          'connection-1',
        );
        await expect(
          router.handle('agent.history', { sessionId: 'session-1' }, 'connection-1'),
        ).resolves.toMatchObject({ sessionId: 'session-1' });
        await router.handle(
          'agent.resetConversation',
          { sessionId: 'session-1', expectedConversationId: 'conversation-1' },
          'connection-1',
        );
        await router.handle(
          'agent.interrupt',
          { sessionId: 'session-1', transactionId: 'transaction-1' },
          'connection-1',
        );
        await router.handle(
          'agent.approve',
          { sessionId: 'session-1', approvalId: 'approval-1', confirmedDestructive: false },
          'connection-1',
        );
        await router.handle('agent.takeover', { sessionId: 'session-1' }, 'connection-1');
        expect(calls).toEqual([
          'start',
          'cancel',
          'history',
          'reset',
          'interrupt',
          'approve',
          'takeover',
        ]);
        await expect(
          router.handle('audit.list', { limit: 10 }, 'connection-1'),
        ).resolves.toMatchObject({
          items: [expect.objectContaining({ traceId: 'task:task-router', outcome: 'success' })],
        });
        await expect(
          router.handle('audit.detail', { traceId: 'task:task-router' }, 'connection-1'),
        ).resolves.toMatchObject({
          traceId: 'task:task-router',
          events: [expect.objectContaining({ id: 'audit-router' })],
        });
        await expect(router.handle('audit.retention', {}, 'connection-1')).resolves.toEqual({
          auditRetentionDays: 30,
          rawLogRetentionHours: 24,
        });
        await expect(
          router.handle('resources.get', { sessionId: 'session-1' }, 'connection-1'),
        ).resolves.toBeUndefined();
        await expect(
          router.handle('resources.refresh', { sessionId: 'session-1' }, 'connection-1'),
        ).resolves.toMatchObject({ ok: true, snapshot: { dialect: 'posix' } });
        expect(events).toContainEqual({
          type: 'session.resources',
          streamId: 'resources:session-1',
          payload: { sessionId: 'session-1', snapshot },
        });
        await expect(router.handle('audit.cleanup', {}, 'connection-1')).resolves.toEqual({
          rawLogs: 1,
          auditEvents: 2,
        });
        await expect(router.handle('core.status', {}, 'connection-1')).resolves.toMatchObject({
          connected: true,
          version: '0.1.0',
        });
        await expect(
          router.handle('core.shutdown', { mode: 'terminate_all' }, 'connection-1'),
        ).resolves.toMatchObject({ ok: true, state: 'closed' });
      } finally {
        await store.close();
      }
    });
  });
});
