import process from 'node:process';

import { describe, expect, it } from 'vitest';

import { CommandExecutor } from './command-executor.js';
import { SessionActor } from './session-actor.js';
import { NodePtySpawner } from '../shell/pty-adapter.js';
import { ShellLocator } from '../shell/shell-locator.js';

const bashExecutable = new ShellLocator()
  .list()
  .find((shell) => shell.kind === 'bash' && shell.available)?.executable;

describe('CommandExecutor with a real Git Bash PTY', () => {
  it.skipIf(bashExecutable === undefined)(
    'sends the original command literally and filters the completion frame',
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
      const ptyInputs: string[] = [];
      const originalWrite = pty.write.bind(pty);
      pty.write = (data: string) => {
        ptyInputs.push(data);
        originalWrite(data);
      };
      const actor = new SessionActor('integration-session', pty, {
        title: 'Git Bash',
        terminalType: 'Git Bash',
        columns: 120,
        rows: 40,
      });
      const executor = new CommandExecutor(actor, { observationWindowMs: 1_000 });

      try {
        await actor.markPtyRunning();
        await actor.verifyEnvironment('posix', 'unix');
        const command = "printf 'literal-audit-ok\\n'";
        const initial = await executor.execute(command);
        const completed =
          initial.status === 'running'
            ? await executor.wait({ transactionId: initial.transaction.id, timeoutMs: 10_000 })
            : initial;

        expect(completed.status).toBe('completed');
        expect(completed.transaction.exitCode).toBe(0);
        expect(completed.transaction.command).toBe(command);
        expect(completed.output.text).toContain('literal-audit-ok');
        expect(completed.output.text).not.toContain('\u001b]777;TA;');
        expect(completed.output.text).not.toContain("printf '\\033]777;TA;");

        const dispatch = ptyInputs.find((input) => input.includes(command));
        expect(dispatch).toBeDefined();
        expect(dispatch!.startsWith(`${command}\r`)).toBe(true);
        expect(dispatch).not.toContain('__synapse_command');
        expect(dispatch).not.toContain('eval');
        expect(dispatch).not.toContain('base64');

        const failed = await executor.execute('false');
        const failedCompleted =
          failed.status === 'running'
            ? await executor.wait({ transactionId: failed.transaction.id, timeoutMs: 10_000 })
            : failed;
        expect(failedCompleted).toMatchObject({
          status: 'completed',
          transaction: { exitCode: 1, command: 'false' },
        });
      } finally {
        actor.dispose();
        pty.terminate();
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
    30_000,
  );
});
