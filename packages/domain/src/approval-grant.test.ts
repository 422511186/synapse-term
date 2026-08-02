import { describe, expect, it } from 'vitest';

import { createApprovalGrant, matchesApprovalGrant } from './approval-grant.js';

describe('approval grant', () => {
  it('matches the exact approved command sequence', () => {
    const commands = [
      {
        sequence: 0,
        command: 'systemctl restart api',
        commandHash: 'sha256:command-1',
        risk: { level: 'mutating' as const, reasons: ['restarts a service'] },
      },
      {
        sequence: 1,
        command: 'systemctl status api',
        commandHash: 'sha256:command-2',
        risk: { level: 'read_only' as const, reasons: ['reads service status'] },
      },
    ];
    const grant = createApprovalGrant({
      id: 'grant-1',
      sessionId: 'session-1',
      taskId: 'task-1',
      commands,
      grantedAt: '2026-07-27T15:00:00.000Z',
    });

    expect(
      matchesApprovalGrant(grant, {
        sessionId: 'session-1',
        taskId: 'task-1',
        commands,
      }),
    ).toBe(true);
  });

  it('invalidates session, task, order, text, hash, or risk changes', () => {
    const commands = [
      {
        sequence: 0,
        command: 'systemctl restart api',
        commandHash: 'sha256:command-1',
        risk: { level: 'mutating' as const, reasons: ['restarts a service'] },
      },
      {
        sequence: 1,
        command: 'systemctl status api',
        commandHash: 'sha256:command-2',
        risk: { level: 'read_only' as const, reasons: ['reads service status'] },
      },
    ];
    const grant = createApprovalGrant({
      id: 'grant-1',
      sessionId: 'session-1',
      taskId: 'task-1',
      commands,
      grantedAt: '2026-07-27T15:00:00.000Z',
    });
    const candidate = { sessionId: 'session-1', taskId: 'task-1', commands };

    expect(matchesApprovalGrant(grant, { ...candidate, sessionId: 'session-2' })).toBe(false);
    expect(matchesApprovalGrant(grant, { ...candidate, taskId: 'task-2' })).toBe(false);
    expect(matchesApprovalGrant(grant, { ...candidate, commands: [...commands].reverse() })).toBe(
      false,
    );
    expect(
      matchesApprovalGrant(grant, {
        ...candidate,
        commands: [{ ...commands[0]!, command: 'systemctl restart web' }, commands[1]!],
      }),
    ).toBe(false);
    expect(
      matchesApprovalGrant(grant, {
        ...candidate,
        commands: [{ ...commands[0]!, commandHash: 'sha256:changed' }, commands[1]!],
      }),
    ).toBe(false);
    expect(
      matchesApprovalGrant(grant, {
        ...candidate,
        commands: [
          {
            ...commands[0]!,
            risk: { ...commands[0]!.risk, reasons: ['different impact'] },
          },
          commands[1]!,
        ],
      }),
    ).toBe(false);
  });

  it('binds a grant to the exact conversation, turn, and tool call', () => {
    const commands = [
      {
        sequence: 0,
        command: 'local_edit_file:{"path":"note.txt"}',
        commandHash: 'sha256:edit',
        risk: { level: 'mutating' as const, reasons: ['file change'] },
      },
    ];
    const scope = {
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      toolCallId: 'call-1',
    };
    const grant = createApprovalGrant({
      id: 'grant-scoped',
      sessionId: 'session-1',
      taskId: 'task-1',
      scope,
      commands,
      grantedAt: '2026-07-27T15:00:00.000Z',
    });
    const candidate = { sessionId: 'session-1', taskId: 'task-1', scope, commands };

    expect(matchesApprovalGrant(grant, candidate)).toBe(true);
    expect(
      matchesApprovalGrant(grant, {
        ...candidate,
        scope: { ...scope, toolCallId: 'call-2' },
      }),
    ).toBe(false);
    expect(
      matchesApprovalGrant(grant, {
        ...candidate,
        scope: { ...scope, turnId: 'turn-2' },
      }),
    ).toBe(false);
    expect(matchesApprovalGrant(grant, { ...candidate, scope: undefined })).toBe(false);
  });

  it('binds a grant to the current environment capability epoch', () => {
    const commands = [
      {
        sequence: 0,
        command: 'touch note.txt',
        commandHash: 'sha256:edit',
        risk: { level: 'mutating' as const, reasons: ['file change'] },
      },
    ];
    const grant = createApprovalGrant({
      id: 'grant-environment',
      sessionId: 'session-1',
      taskId: 'task-1',
      environmentEpoch: 7,
      commands,
      grantedAt: '2026-07-27T15:00:00.000Z',
    });

    expect(
      matchesApprovalGrant(grant, {
        sessionId: 'session-1',
        taskId: 'task-1',
        environmentEpoch: 7,
        commands,
      }),
    ).toBe(true);
    expect(
      matchesApprovalGrant(grant, {
        sessionId: 'session-1',
        taskId: 'task-1',
        environmentEpoch: 8,
        commands,
      }),
    ).toBe(false);
  });
});
