import process from 'node:process';

import { describe, expect, it } from 'vitest';

import { CommandExecutor } from './command-executor.js';
import { SessionActor } from './session-actor.js';
import { NodePtySpawner } from '../shell/pty-adapter.js';
import { ShellLocator } from '../shell/shell-locator.js';

const powerShellExecutable = new ShellLocator()
  .list()
  .find((shell) => shell.kind === 'powershell' && shell.available)?.executable;

describe('CommandExecutor with a real PowerShell PTY', () => {
  it.skipIf(process.platform !== 'win32' || powerShellExecutable === undefined)(
    'sends PowerShell commands literally and reports native exit codes',
    async () => {
      const environment = Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      );
      const pty = new NodePtySpawner().spawn({
        executable: powerShellExecutable!,
        args: ['-NoLogo'],
        cwd: process.cwd(),
        env: { ...environment, TERM: 'xterm-256color' },
        columns: 120,
        rows: 40,
      });
      const ptyInputs: string[] = [];
      const rawPtyOutput: string[] = [];
      const originalWrite = pty.write.bind(pty);
      pty.write = (data: string) => {
        ptyInputs.push(data);
        originalWrite(data);
      };
      pty.onData((data) => rawPtyOutput.push(data));
      const actor = new SessionActor('powershell-integration-session', pty, {
        title: 'PowerShell',
        terminalType: 'PowerShell',
        columns: 120,
        rows: 40,
      });
      const executor = new CommandExecutor(actor, { observationWindowMs: 1_000 });

      try {
        await actor.markPtyRunning();
        await actor.verifyEnvironment('powershell', 'windows');
        const command = "Write-Output 'literal-powershell-ok'";
        const initial = await executor.execute(command);
        const completed =
          initial.status === 'running'
            ? await executor.wait({ transactionId: initial.transaction.id, timeoutMs: 10_000 })
            : initial;

        expect(completed).toMatchObject({
          status: 'completed',
          transaction: { command, exitCode: 0 },
        });
        expect(completed.output.text).toContain('literal-powershell-ok');
        expect(completed.output.text).not.toContain('\u001b]777;TA;');
        expect(
          completed.output.text,
          JSON.stringify({
            rawPtyOutput,
            dispatch: ptyInputs.find((input) => input.includes(command)),
          }),
        ).not.toContain('[Console]::Write(([char]27+');

        const dispatch = ptyInputs.find((input) => input.includes(command));
        expect(dispatch).toBeDefined();
        expect(dispatch!.startsWith(`${command}\r`)).toBe(true);
        expect(dispatch).not.toContain('EncodedCommand');
        expect(dispatch).not.toContain('. {');
        expect(dispatch).not.toContain('& {');

        const failed = await executor.execute('& $env:ComSpec /d /c "exit 7"');
        const failedCompleted =
          failed.status === 'running'
            ? await executor.wait({ transactionId: failed.transaction.id, timeoutMs: 10_000 })
            : failed;
        expect(failedCompleted).toMatchObject({
          status: 'completed',
          transaction: { exitCode: 7 },
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
