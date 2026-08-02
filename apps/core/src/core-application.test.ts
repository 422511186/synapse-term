import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FakeClock, FakePty, withTemporaryDirectory } from '@synapse-term/test-kit';

import { CoreApplication } from './core-application.js';
import { PolicyEngine } from '@synapse-term/platform-kernel';
import type { PtySpawner } from '@synapse-term/terminal-service';
import type { CorePipeServer } from '@synapse-term/infrastructure';

class FakePipe implements CorePipeServer {
  handler: ((socket: Socket) => void) | undefined;
  listening = false;

  async listen(_pipeName: string, handler?: (socket: Socket) => void): Promise<void> {
    this.handler = handler;
    this.listening = true;
  }

  async close(): Promise<void> {
    this.listening = false;
  }
}

class FakeSpawner implements PtySpawner {
  readonly pty = new FakePty(1);

  spawn(): FakePty {
    return this.pty;
  }
}

describe('CoreApplication', () => {
  it('composes the independent Core runtime and persists its authentication token', async () => {
    await withTemporaryDirectory(async (directory) => {
      const pipe = new FakePipe();
      const app = await CoreApplication.create({
        dataDirectory: join(directory, 'data'),
        appId: 'terminal-agent-test',
        username: 'current-user',
        instanceId: 'core-test-1',
        version: '0.1.0-test',
        pipeServer: pipe,
        spawner: new FakeSpawner(),
        policy: new PolicyEngine({
          async parse() {
            return { hasError: false, tree: 'program' };
          },
        }),
        applyAcl: async () => undefined,
        homeResolver: { resolve: async () => directory },
      });

      try {
        await expect(app.start()).resolves.toMatchObject({ ok: true, state: 'running' });
        expect(pipe.listening).toBe(true);
        await expect(
          readFile(join(directory, 'data', 'upgrade-state.ini'), 'utf8'),
        ).resolves.toContain('running=1');
        const session = (await app.request('session.create', {
          title: 'test shell',
          terminalType: 'Bash',
          executable: 'bash.exe',
          args: ['-i'],
          cwd: 'C:/work',
          env: {},
          columns: 80,
          rows: 24,
        })) as { id: string; title: string; pty: string };
        expect(session).toMatchObject({ title: 'test shell', pty: 'running' });
        await expect(
          app.request('resources.get', { sessionId: session.id }),
        ).resolves.toBeUndefined();
        await expect(
          app.request('resources.refresh', { sessionId: session.id }),
        ).resolves.toMatchObject({
          ok: false,
          error: { code: 'execution_dialect_unsupported' },
        });
        await expect(app.request('audit.list', { sessionId: session.id })).resolves.toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: 'session.resources_failed', sessionId: session.id }),
          ]),
        );
        await expectUpgradeState(join(directory, 'data', 'upgrade-state.ini'), 'sessions=1');
        expect(app.token.length).toBeGreaterThanOrEqual(32);
        await app.close();
        expect(pipe.listening).toBe(false);
        await expect(
          readFile(join(directory, 'data', 'upgrade-state.ini'), 'utf8'),
        ).resolves.toContain('running=0');
      } finally {
        await app.close();
      }
    });
  });

  it('wires idle exit scheduling into the composed Core lifecycle', async () => {
    await withTemporaryDirectory(async (directory) => {
      const pipe = new FakePipe();
      const clock = new FakeClock(0);
      const app = await CoreApplication.create({
        dataDirectory: join(directory, 'data'),
        appId: 'terminal-agent-idle-test',
        username: 'current-user',
        instanceId: 'core-idle-test',
        pipeServer: pipe,
        spawner: new FakeSpawner(),
        policy: new PolicyEngine({
          async parse() {
            return { hasError: false, tree: 'program' };
          },
        }),
        applyAcl: async () => undefined,
        homeResolver: { resolve: async () => directory },
        idleExitDelayMs: 100,
        timer: clock,
      });

      await app.start();
      clock.advanceBy(100);
      await Promise.resolve();
      const stoppedWhileIdle = !pipe.listening;
      await app.close();

      expect(stoppedWhileIdle).toBe(true);
    });
  });

  it('keeps the Core listener available while a desktop IPC client is attached', async () => {
    await withTemporaryDirectory(async (directory) => {
      const clock = new FakeClock(0);
      const app = await CoreApplication.create({
        dataDirectory: join(directory, 'data'),
        appId: `terminal-agent-client-idle-${randomUUID()}`,
        username: 'current-user',
        instanceId: 'core-client-idle-test',
        spawner: new FakeSpawner(),
        policy: new PolicyEngine({
          async parse() {
            return { hasError: false, tree: 'program' };
          },
        }),
        applyAcl: async () => undefined,
        homeResolver: { resolve: async () => directory },
        idleExitDelayMs: 100,
        timer: clock,
      });
      let socket: ReturnType<typeof createConnection> | undefined;

      try {
        await app.start();
        socket = createConnection(app.pipeName);
        await once(socket, 'connect');
        await new Promise<void>((resolve) => setImmediate(resolve));

        clock.advanceBy(100);
        await Promise.resolve();
        expect(existsSync(app.pipeName)).toBe(true);
      } finally {
        socket?.destroy();
        await app.close();
      }
    });
  });
});

async function expectUpgradeState(path: string, expected: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const value = await readFile(path, 'utf8');
    if (value.includes(expected)) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  expect(await readFile(path, 'utf8')).toContain(expected);
}
