import { describe, expect, it } from 'vitest';

import { AgentTaskScheduler } from './agent-task-scheduler.js';

describe('AgentTaskScheduler', () => {
  it('allows one active task per Session and four running tasks globally', () => {
    const scheduler = new AgentTaskScheduler({ maxRunningTasks: 4 });
    for (let index = 1; index <= 4; index += 1) {
      scheduler.create({
        id: `task-${index}`,
        sessionId: `session-${index}`,
        providerProfileId: 'provider-1',
        goal: 'inspect server',
      });
      expect(scheduler.start(`task-${index}`)).toMatchObject({ status: 'running' });
    }

    scheduler.create({
      id: 'task-5',
      sessionId: 'session-5',
      providerProfileId: 'provider-1',
      goal: 'inspect another server',
    });
    expect(() => scheduler.start('task-5')).toThrow(/limit/);
    expect(() =>
      scheduler.create({
        id: 'task-conflict',
        sessionId: 'session-1',
        providerProfileId: 'provider-1',
        goal: 'conflict',
      }),
    ).toThrow(/Session/);
  });

  it('releases limits after terminal task states', () => {
    const scheduler = new AgentTaskScheduler({ maxRunningTasks: 1 });
    scheduler.create({
      id: 'task-1',
      sessionId: 'session-1',
      providerProfileId: 'provider-1',
      goal: 'inspect',
    });
    scheduler.start('task-1');
    scheduler.transition('task-1', 'completed');

    scheduler.create({
      id: 'task-2',
      sessionId: 'session-1',
      providerProfileId: 'provider-1',
      goal: 'inspect again',
    });
    expect(scheduler.start('task-2')).toMatchObject({ status: 'running' });
  });

  it('allows a new turn after a waiting-user task has been handed back', () => {
    const scheduler = new AgentTaskScheduler();
    scheduler.create({
      id: 'task-interactive',
      sessionId: 'session-1',
      providerProfileId: 'provider-1',
      goal: 'inspect',
    });
    scheduler.start('task-interactive');
    scheduler.transition('task-interactive', 'waiting_user');

    expect(() =>
      scheduler.create({
        id: 'task-after-interaction',
        sessionId: 'session-1',
        providerProfileId: 'provider-1',
        goal: 'continue',
      }),
    ).not.toThrow();
  });
});
