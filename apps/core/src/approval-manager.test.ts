import { describe, expect, it } from 'vitest';

import { ApprovalManager, hashCommand } from './approval-manager.js';

describe('ApprovalManager', () => {
  it('creates exact command grants with stable hashes', () => {
    const manager = new ApprovalManager({ now: () => new Date('2026-07-27T00:00:00.000Z') });
    const grant = manager.createGrant({
      id: 'grant-1',
      sessionId: 'session-1',
      taskId: 'task-1',
      commands: [
        { command: 'systemctl restart api', level: 'mutating', reasons: ['service change'] },
      ],
    });

    expect(grant.commands[0]).toMatchObject({
      sequence: 0,
      commandHash: hashCommand('systemctl restart api'),
    });
    expect(
      manager.validate(grant, {
        sessionId: 'session-1',
        taskId: 'task-1',
        commands: grant.commands,
      }),
    ).toEqual({ ok: true });
  });

  it('invalidates edited, reordered, retargeted, or expired grants', () => {
    let now = new Date('2026-07-27T00:00:00.000Z');
    const manager = new ApprovalManager({ now: () => now });
    const grant = manager.createGrant({
      id: 'grant-1',
      sessionId: 'session-1',
      taskId: 'task-1',
      expiresAt: '2026-07-27T00:01:00.000Z',
      commands: [
        { command: 'rm file', level: 'mutating', reasons: ['file change'] },
        { command: 'ls', level: 'read_only', reasons: ['inspect'] },
      ],
    });
    const candidate = { sessionId: 'session-1', taskId: 'task-1', commands: grant.commands };

    expect(
      manager.validate(grant, { ...candidate, commands: [...grant.commands].reverse() }),
    ).toEqual({
      ok: false,
      error: 'approval_invalid',
    });
    expect(manager.validate(grant, { ...candidate, sessionId: 'session-2' })).toMatchObject({
      ok: false,
    });
    expect(
      manager.validate(grant, {
        ...candidate,
        commands: [{ ...grant.commands[0]!, command: 'rm other' }, grant.commands[1]!],
      }),
    ).toMatchObject({ ok: false });
    now = new Date('2026-07-27T00:02:00.000Z');
    expect(manager.validate(grant, candidate)).toEqual({ ok: false, error: 'approval_expired' });
  });

  it('requires a single second confirmation for destructive commands', () => {
    const manager = new ApprovalManager();
    expect(() =>
      manager.createGrant({
        id: 'grant-2',
        sessionId: 'session-1',
        taskId: 'task-1',
        commands: [
          { command: 'rm -rf /tmp/a', level: 'destructive', reasons: ['delete'] },
          { command: 'rm -rf /tmp/b', level: 'destructive', reasons: ['delete'] },
        ],
      }),
    ).toThrow(/destructive/);
  });

  it('creates and validates a grant scoped to one model tool call', () => {
    const manager = new ApprovalManager();
    const scope = {
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      toolCallId: 'call-1',
    };
    const grant = manager.createGrant({
      sessionId: 'session-1',
      taskId: 'task-1',
      scope,
      commands: [{ command: 'touch note.txt', level: 'mutating', reasons: ['file change'] }],
    });

    expect(grant.scope).toEqual(scope);
    expect(
      manager.validate(grant, {
        sessionId: 'session-1',
        taskId: 'task-1',
        scope,
        commands: grant.commands,
      }),
    ).toEqual({ ok: true });
    expect(
      manager.validate(grant, {
        sessionId: 'session-1',
        taskId: 'task-1',
        scope: { ...scope, toolCallId: 'call-2' },
        commands: grant.commands,
      }),
    ).toMatchObject({ ok: false, error: 'approval_invalid' });
  });

  it('rejects a grant after the terminal environment capability epoch changes', () => {
    const manager = new ApprovalManager();
    const grant = manager.createGrant({
      sessionId: 'session-1',
      taskId: 'task-1',
      environmentEpoch: 3,
      commands: [{ command: 'touch note.txt', level: 'mutating', reasons: ['file change'] }],
    });

    expect(
      manager.validate(grant, {
        sessionId: 'session-1',
        taskId: 'task-1',
        environmentEpoch: 4,
        commands: grant.commands,
      }),
    ).toEqual({ ok: false, error: 'approval_invalid' });
  });
});
