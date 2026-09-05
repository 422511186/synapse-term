import process from 'node:process';

import { describe, expect, it, vi } from 'vitest';

import { InteractiveCommandExecutor } from './interactive-command-executor.js';
import { SessionActor } from './session-actor.js';
import { NodePtySpawner } from '../shell/pty-adapter.js';
import { ShellLocator } from '../shell/shell-locator.js';
import { ShellProbe } from '../shell/shell-probe.js';

const bashExecutable = new ShellLocator()
  .list()
  .find((shell) => shell.kind === 'bash' && shell.available)?.executable;

describe('InteractiveCommandExecutor with a real Bash PTY', () => {
  it.skipIf(bashExecutable === undefined)(
    'keeps the startup write probe-free and sends completion only during finish',
    async () => {
      const environment = Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      );
      const pty = new NodePtySpawner().spawn({
        executable: bashExecutable!,
        args: ['--login', '-i'],
        cwd: process.cwd(),
        env: { ...environment, TERM: 'xterm-256color' },
        columns: 120,
        rows: 40,
      });
      const writes: string[] = [];
      const originalWrite = pty.write.bind(pty);
      pty.write = (data: string) => {
        writes.push(data);
        originalWrite(data);
      };
      const actor = new SessionActor('interactive-bash-integration', pty, {
        title: 'Interactive Bash integration',
        terminalType: 'Git Bash',
        columns: 120,
        rows: 40,
      });
      const probe = new ShellProbe(actor, { timeoutMs: 10_000 });
      const outputs: string[] = [];
      const removeListener = actor.onEvent((event) => {
        if (event.type === 'pty_output') outputs.push(event.data);
      });
      const executor = new InteractiveCommandExecutor(actor, {
        finishTimeoutMs: 10_000,
        completionDrainMs: 0,
        completionEchoGraceMs: 0,
        idleTimeoutMs: 30_000,
      });

      try {
        await actor.markPtyRunning();
        await expect(probe.run({ environmentEpoch: 0 })).resolves.toMatchObject({
          mode: 'structured',
          dialect: 'posix',
        });
        const expectedContextId = actor.snapshot.executionContextId;
        const command = `read -r value; printf 'value=%s\\n' "$value"`;
        const started = await executor.start({
          command,
          expectedContextId,
          inputGrantMode: 'one_shot',
          callerId: 'integration-client',
        });
        const startupWrite = writes.find((write) => write.includes(command));
        expect(startupWrite).toBe(`${command}\r`);
        expect(startupWrite).not.toContain('777;TA;');
        await vi.waitFor(() => expect(outputs.join('')).toContain(command), {
          timeout: 10_000,
        });

        const inputResult = await executor.input({
          transactionId: started.transaction.id,
          inputGrantId: started.inputGrantId!,
          inputRequestId: 'read-value',
          payload: {
            data: 'hello\r',
            normalizedText: 'hello\r',
            textLength: 6,
            keys: [],
            payloadBytes: 6,
          },
          callerId: 'integration-client',
        });
        expect(inputResult.sent).toEqual({ textLength: 6, keys: [], payloadBytes: 6 });
        await vi.waitFor(() => expect(outputs.join('')).toContain('value=hello'), {
          timeout: 10_000,
        });

        const finishing = executor.finish({
          transactionId: started.transaction.id,
          observedCursor: '0',
          callerId: 'integration-client',
        });
        await vi.waitFor(() =>
          expect(writes.some((write) => write.includes('777;TA;'))).toBe(true),
        );
        const finishWrite = writes.find((write) => write.includes('777;TA;'))!;
        expect(finishWrite).not.toContain(command);
        await expect(finishing).resolves.toMatchObject({
          status: 'completed',
          transaction: { command, exitCode: 0 },
          output: { text: expect.stringContaining('value=hello') },
        });
      } finally {
        removeListener();
        probe.dispose();
        await executor.clear();
        actor.dispose();
        pty.terminate();
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
    30_000,
  );
});
