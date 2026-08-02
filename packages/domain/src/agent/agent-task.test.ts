import { describe, expect, it } from 'vitest';

import { createAgentTask, transitionAgentTask } from './agent-task.js';

describe('agent task state', () => {
  it('starts queued and bound to one session and provider profile', () => {
    const task = createAgentTask({
      id: 'task-1',
      sessionId: 'session-1',
      providerProfileId: 'provider-1',
      goal: 'Check disk usage',
    });

    expect(task).toEqual({
      id: 'task-1',
      sessionId: 'session-1',
      providerProfileId: 'provider-1',
      goal: 'Check disk usage',
      status: 'queued',
      revision: 0,
    });
  });

  it('creates external driver tasks without a provider profile', () => {
    const task = createAgentTask({
      id: 'task-acp',
      sessionId: 'session-1',
      goal: 'Check disk usage',
    });

    expect(task.providerProfileId).toBeUndefined();
    expect(task).toMatchObject({
      id: 'task-acp',
      sessionId: 'session-1',
      goal: 'Check disk usage',
      status: 'queued',
      revision: 0,
    });
  });

  it('preserves bindings when a queued task starts running', () => {
    const task = createAgentTask({
      id: 'task-1',
      sessionId: 'session-1',
      providerProfileId: 'provider-1',
      goal: 'Check disk usage',
    });

    expect(transitionAgentTask(task, 'running')).toEqual({
      ok: true,
      value: {
        ...task,
        status: 'running',
        revision: 1,
      },
    });
  });

  it('supports approval, takeover, suspension, and terminal outcomes', () => {
    const queued = createAgentTask({
      id: 'task-1',
      sessionId: 'session-1',
      providerProfileId: 'provider-1',
      goal: 'Check disk usage',
    });
    const started = transitionAgentTask(queued, 'running');
    if (!started.ok) throw new Error('expected task to start');

    for (const status of [
      'waiting_approval',
      'waiting_user',
      'suspended',
      'completed',
      'failed',
      'cancelled',
    ] as const) {
      expect(transitionAgentTask(started.value, status)).toMatchObject({
        ok: true,
        value: { status },
      });
    }

    for (const status of ['waiting_approval', 'waiting_user', 'suspended'] as const) {
      const paused = transitionAgentTask(started.value, status);
      if (!paused.ok) throw new Error(`expected task to enter ${status}`);
      expect(transitionAgentTask(paused.value, 'running')).toMatchObject({
        ok: true,
        value: { status: 'running' },
      });
    }
  });

  it('allows cancellation before execution and while paused', () => {
    const queued = createAgentTask({
      id: 'task-1',
      sessionId: 'session-1',
      providerProfileId: 'provider-1',
      goal: 'Check disk usage',
    });

    expect(transitionAgentTask(queued, 'cancelled')).toMatchObject({
      ok: true,
      value: { status: 'cancelled' },
    });

    const started = transitionAgentTask(queued, 'running');
    if (!started.ok) throw new Error('expected task to start');
    for (const status of ['waiting_approval', 'waiting_user', 'suspended'] as const) {
      const paused = transitionAgentTask(started.value, status);
      if (!paused.ok) throw new Error(`expected task to enter ${status}`);
      expect(transitionAgentTask(paused.value, 'cancelled')).toMatchObject({
        ok: true,
        value: { status: 'cancelled' },
      });
    }
  });
});
