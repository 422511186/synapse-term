import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { withTemporaryDirectory } from '@terminal-agent/test-kit';

import { AuditService } from './audit-service.js';
import { CORE_MIGRATIONS } from './core-schema.js';
import { CoreRepositories } from './repositories.js';
import type { AuditEvent } from './repositories.js';
import { SqliteStore } from './sqlite-store.js';

describe('AuditService', () => {
  it('records structured command outcomes without persisting command plaintext', async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = new SqliteStore(join(directory, 'core.sqlite'), CORE_MIGRATIONS);
      await store.open();
      const repositories = new CoreRepositories(store);
      const audit = new AuditService(repositories, {
        now: () => new Date('2026-07-27T00:00:00.000Z'),
      });

      audit.recordCommand({
        id: 'audit-1',
        actor: { kind: 'agent', taskId: 'task-1' },
        sessionId: 'session-1',
        taskId: 'task-1',
        command: 'curl -H "Authorization: Bearer secret-token" https://example.test',
        risk: 'unknown',
        grantId: 'grant-1',
        status: 'completed',
        exitCode: 0,
      });

      const [event] = repositories.listAuditEvents();
      expect(event).toMatchObject({ type: 'command.completed', sessionId: 'session-1' });
      expect(JSON.stringify(event?.payload)).not.toContain('secret-token');
      expect(event?.payload).toMatchObject({ risk: 'unknown', grantId: 'grant-1', exitCode: 0 });
      await store.close();
    });
  });

  it('queries audit events by session and task', async () => {
    const events: AuditEvent[] = [];
    const repositories = {
      appendAuditEvent: (event: AuditEvent) => events.push(event),
      listAuditEvents: () => events,
    };
    const audit = new AuditService(repositories);
    audit.record({
      id: 'a1',
      actor: { kind: 'system' },
      type: 'session.created',
      sessionId: 's1',
      payload: {},
    });
    audit.record({
      id: 'a2',
      actor: { kind: 'system' },
      type: 'task.created',
      sessionId: 's2',
      taskId: 't2',
      payload: {},
    });

    expect(audit.query({ sessionId: 's1' }).map((event) => event.id)).toEqual(['a1']);
    expect(audit.query({ taskId: 't2' }).map((event) => event.id)).toEqual(['a2']);
  });
});
