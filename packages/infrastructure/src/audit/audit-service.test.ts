import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { withTemporaryDirectory } from '@synapse-term/test-kit';

import { AuditService } from './audit-service.js';
import { CORE_MIGRATIONS } from '../store/core-schema.js';
import { CoreRepositories } from '../store/repositories.js';
import type { AuditEvent } from '../store/repositories.js';
import { SecretRedactor } from '../security/secret-protection.js';
import { SqliteStore } from '../store/sqlite-store.js';

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
        output: 'full terminal output must not be retained',
      });

      const [event] = repositories.listAuditEvents();
      expect(event).toMatchObject({ type: 'command.completed', sessionId: 'session-1' });
      expect(JSON.stringify(event?.payload)).not.toContain('secret-token');
      expect(event?.payload).toMatchObject({
        risk: 'unknown',
        grantId: 'grant-1',
        status: 'completed',
        exitCode: 0,
        commandPreview: 'curl -H "Authorization: Bearer [REDACTED]" https://example.test',
      });
      expect(event?.payload).not.toHaveProperty('output');
      await store.close();
    });
  });

  it('fails closed for command previews when a redactor detector throws', async () => {
    const events: AuditEvent[] = [];
    const audit = new AuditService(
      {
        appendAuditEvent: (event) => events.push(event),
        listAuditEvents: () => events,
      },
      {
        redactor: new SecretRedactor({
          detectors: [
            {
              name: 'broken',
              detect: () => {
                throw new Error('detector failed');
              },
            },
          ],
        }),
      },
    );

    audit.recordCommand({
      actor: { kind: 'agent', taskId: 'task-safe' },
      sessionId: 'session-safe',
      taskId: 'task-safe',
      command: 'echo do-not-store',
      risk: 'read_only',
      status: 'completed',
    });

    expect(events[0]?.payload).toMatchObject({ commandPreview: '[REDACTED:detector-error]' });
    expect(JSON.stringify(events[0]?.payload)).not.toContain('do-not-store');
  });

  it('stores a non-identifying path summary instead of an absolute or sensitive path', () => {
    const events: AuditEvent[] = [];
    const audit = new AuditService({
      appendAuditEvent: (event) => events.push(event),
      listAuditEvents: () => events,
    });

    audit.record({
      actor: { kind: 'external', callerKind: 'acp', callerId: 'client-1' },
      sessionId: 'session-1',
      type: 'external.file.read.completed',
      payload: { path: '/Users/huangzy/private-token.txt', status: 'completed' },
    });

    const storedPath = events[0]?.payload.path;
    expect(storedPath).toBeTypeOf('string');
    expect(storedPath).not.toContain('/Users/huangzy');
    expect(storedPath).not.toContain('private-token.txt');
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
