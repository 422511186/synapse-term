import type { Socket } from 'node:net';
import { describe, expect, it } from 'vitest';

import { FakeClock, withTemporaryDirectory } from '@terminal-agent/test-kit';

import { CoreLifecycle, type CorePipeServer } from './core-lifecycle.js';

class FakePipeServer implements CorePipeServer {
  listenCalls: string[] = [];
  handler: ((socket: Socket) => void) | undefined;
  closeCalls = 0;

  async listen(pipeName: string, handler?: (socket: Socket) => void): Promise<void> {
    this.listenCalls.push(pipeName);
    this.handler = handler;
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
  }
}

class FailingPipeServer implements CorePipeServer {
  async listen(): Promise<void> {
    throw new Error('pipe-bind-failed');
  }

  async close(): Promise<void> {}
}

describe('CoreLifecycle', () => {
  it('keeps the Core in the background or terminates it explicitly', async () => {
    await withTemporaryDirectory(async (dataDirectory) => {
      const pipe = new FakePipeServer();
      let terminatedSessions = 0;
      const core = new CoreLifecycle({
        appId: 'terminal-agent',
        username: 'current-user',
        dataDirectory,
        instanceId: 'core-1',
        pipeServer: pipe,
        terminateSessions: async () => {
          terminatedSessions += 1;
        },
      });

      await expect(core.start()).resolves.toMatchObject({ ok: true, state: 'running' });
      core.setActivity({ sessions: 1, agentTasks: 1 });
      expect(core.activity).toEqual({ sessions: 1, agentTasks: 1 });
      await expect(core.requestShutdown('keep_background')).resolves.toEqual({
        ok: true,
        action: 'kept_background',
        state: 'running',
      });
      expect(pipe.closeCalls).toBe(0);

      await expect(core.requestShutdown('terminate_all')).resolves.toEqual({
        ok: true,
        action: 'terminated',
        state: 'closed',
      });
      expect(terminatedSessions).toBe(1);
      expect(pipe.closeCalls).toBe(1);
      expect(core.state).toBe('closed');
    });
  });

  it('passes the connection handler to the Pipe server', async () => {
    await withTemporaryDirectory(async (dataDirectory) => {
      const pipe = new FakePipeServer();
      const handler = (): void => undefined;
      const core = new CoreLifecycle({
        appId: 'terminal-agent',
        username: 'current-user',
        dataDirectory,
        instanceId: 'core-1',
        pipeServer: pipe,
        handleConnection: handler,
      });

      await core.start();
      expect(pipe.handler).toBe(handler);
      await core.close();
    });
  });

  it('keeps waitForClose pending until a running Core actually closes', async () => {
    await withTemporaryDirectory(async (dataDirectory) => {
      const core = new CoreLifecycle({
        appId: 'terminal-agent',
        username: 'current-user',
        dataDirectory,
        instanceId: 'core-1',
        pipeServer: new FakePipeServer(),
      });
      await core.start();
      let resolved = false;
      const waiting = core.waitForClose().then(() => {
        resolved = true;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(resolved).toBe(false);

      await core.close();
      await waiting;
      expect(resolved).toBe(true);
    });
  });

  it('does not leave a lock behind when Pipe startup fails', async () => {
    await withTemporaryDirectory(async (dataDirectory) => {
      const failed = new CoreLifecycle({
        appId: 'terminal-agent',
        username: 'current-user',
        dataDirectory,
        instanceId: 'core-failed',
        pipeServer: new FailingPipeServer(),
      });
      await expect(failed.start()).rejects.toThrow('pipe-bind-failed');

      const recovered = new CoreLifecycle({
        appId: 'terminal-agent',
        username: 'current-user',
        dataDirectory,
        instanceId: 'core-recovered',
        pipeServer: new FakePipeServer(),
      });
      await expect(recovered.start()).resolves.toMatchObject({ state: 'running' });
      await recovered.close();
    });
  });

  it('rejects a second Core instance in the same user scope', async () => {
    await withTemporaryDirectory(async (dataDirectory) => {
      const first = new CoreLifecycle({
        appId: 'terminal-agent',
        username: 'current-user',
        dataDirectory,
        instanceId: 'core-1',
        pipeServer: new FakePipeServer(),
      });
      const second = new CoreLifecycle({
        appId: 'terminal-agent',
        username: 'current-user',
        dataDirectory,
        instanceId: 'core-2',
        pipeServer: new FakePipeServer(),
      });

      await first.start();
      await expect(second.start()).rejects.toThrow();
      await first.close();
    });
  });

  it('closes the transport even when session termination reports an error', async () => {
    await withTemporaryDirectory(async (dataDirectory) => {
      const pipe = new FakePipeServer();
      const core = new CoreLifecycle({
        appId: 'terminal-agent',
        username: 'current-user',
        dataDirectory,
        instanceId: 'core-1',
        pipeServer: pipe,
        terminateSessions: async () => {
          throw new Error('session-termination-failed');
        },
      });
      await core.start();

      await expect(core.requestShutdown('terminate_all')).rejects.toThrow(
        'session-termination-failed',
      );
      expect(pipe.closeCalls).toBe(1);
      expect(core.state).toBe('closed');
    });
  });

  it('delays idle shutdown and cancels it when activity returns', async () => {
    await withTemporaryDirectory(async (dataDirectory) => {
      const clock = new FakeClock(0);
      const pipe = new FakePipeServer();
      const core = new CoreLifecycle({
        appId: 'terminal-agent',
        username: 'current-user',
        dataDirectory,
        instanceId: 'core-1',
        pipeServer: pipe,
        idleExitDelayMs: 100,
        timer: clock,
      });
      await core.start();
      core.setActivity({ sessions: 1, agentTasks: 0 });
      core.setActivity({ sessions: 0, agentTasks: 0 });
      clock.advanceBy(99);
      await Promise.resolve();
      expect(core.state).toBe('running');
      core.setActivity({ sessions: 1, agentTasks: 0 });
      clock.advanceBy(1_000);
      await Promise.resolve();
      expect(core.state).toBe('running');
      core.setActivity({ sessions: 0, agentTasks: 0 });
      clock.advanceBy(100);
      await core.waitForClose();
      expect(core.state).toBe('closed');
    });
  });

  it('keeps the Core available while a desktop client remains connected', async () => {
    await withTemporaryDirectory(async (dataDirectory) => {
      const clock = new FakeClock(0);
      const pipe = new FakePipeServer();
      const core = new CoreLifecycle({
        appId: 'terminal-agent',
        username: 'current-user',
        dataDirectory,
        instanceId: 'core-client-activity',
        pipeServer: pipe,
        idleExitDelayMs: 100,
        timer: clock,
      });

      await core.start();
      core.setClientConnections(1);
      clock.advanceBy(1_000);
      await Promise.resolve();

      expect(core.state).toBe('running');
      expect(pipe.closeCalls).toBe(0);

      core.setClientConnections(0);
      clock.advanceBy(100);
      await core.waitForClose();
      expect(core.state).toBe('closed');
    });
  });

  it('schedules delayed shutdown when the Core starts already idle', async () => {
    await withTemporaryDirectory(async (dataDirectory) => {
      const clock = new FakeClock(0);
      const pipe = new FakePipeServer();
      const core = new CoreLifecycle({
        appId: 'terminal-agent',
        username: 'current-user',
        dataDirectory,
        instanceId: 'core-idle',
        pipeServer: pipe,
        idleExitDelayMs: 100,
        timer: clock,
      });

      await core.start();
      clock.advanceBy(100);
      await core.waitForClose();
      const idleState = core.state;
      const idleCloseCalls = pipe.closeCalls;
      await core.close();

      expect(idleState).toBe('closed');
      expect(idleCloseCalls).toBe(1);
    });
  });
});
