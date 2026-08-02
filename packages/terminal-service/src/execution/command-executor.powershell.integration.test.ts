import process from 'node:process';

import { describe, expect, it } from 'vitest';

import { withTemporaryDirectory } from '@synapse-term/test-kit';

import { ShellLocator } from '../shell/shell-locator.js';
import { CommandExecutor, type ExecuteCommandInput } from './command-executor.js';
import { NodePtySpawner } from '../shell/pty-adapter.js';
import { SessionActor } from '../session/session-actor.js';
import { ShellProbe } from '../shell/shell-probe.js';

const powerShellExecutable = new ShellLocator()
  .list()
  .find((shell) => shell.kind === 'powershell' && shell.available)?.executable;

describe('CommandExecutor with PowerShell and ConPTY', () => {
  it.skipIf(process.platform !== 'win32' || powerShellExecutable === undefined)(
    'preserves state, reports exits, streams output, and interrupts commands',
    async () => {
      await withTemporaryDirectory(async (directory) => {
        const env = Object.fromEntries(
          Object.entries(process.env).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
          ),
        );
        const pty = new NodePtySpawner().spawn({
          executable: powerShellExecutable!,
          args: ['-NoLogo', '-NoProfile'],
          cwd: process.cwd(),
          env: { ...env, TERM: 'xterm-256color' },
          columns: 120,
          rows: 40,
        });
        const actor = new SessionActor('powershell-integration-session', pty, {
          columns: 120,
          rows: 40,
          executionDialect: 'powershell',
        });
        const probe = new ShellProbe(actor, { timeoutMs: 15_000 });
        const trace: Array<{ type: string; value: string }> = [];
        actor.onEvent((event) => {
          if (event.type === 'pty_output') trace.push({ type: event.type, value: event.data });
          if (event.type === 'osc_777') trace.push({ type: event.type, value: event.payload });
        });

        try {
          await actor.markPtyRunning();
          const lease = await actor.grantAgentLease('powershell-integration-task', 0);
          if (!lease.ok) throw new Error('expected agent lease');
          await expect(
            probe.run({
              taskId: 'powershell-integration-task',
              leaseEpoch: lease.value.lease.epoch,
            }),
          ).resolves.toMatchObject({ mode: 'structured' });

          const executor = new CommandExecutor(actor, {
            observationWindowMs: 50,
            hardDeadlineMs: 10_000,
          });
          await expect(
            executeToCompletion(executor, {
              taskId: 'powershell-integration-task',
              leaseEpoch: lease.value.lease.epoch,
              command: `$global:TerminalAgentState = 'persisted'; Set-Location ${powerShellQuote(directory)}`,
              risk: 'read_only',
              observationWindowMs: 5_000,
            }),
          ).resolves.toMatchObject({ status: 'completed', transaction: { exitCode: 0 } });

          const stateResult = await executeToCompletion(executor, {
            taskId: 'powershell-integration-task',
            leaseEpoch: lease.value.lease.epoch,
            command: "Write-Output ($global:TerminalAgentState + '|' + (Get-Location).Path)",
            risk: 'read_only',
            observationWindowMs: 5_000,
          });
          expect(stateResult.status, JSON.stringify(trace)).toBe('completed');
          expect(stateResult.output.text, JSON.stringify(trace)).toContain(
            `persisted|${directory}`,
          );

          const objectOutput = await executeToCompletion(executor, {
            taskId: 'powershell-integration-task',
            leaseEpoch: lease.value.lease.epoch,
            command: 'Get-Location',
            risk: 'read_only',
            observationWindowMs: 5_000,
          });
          expect(objectOutput.status, JSON.stringify(trace)).toBe('completed');
          expect(objectOutput.output.text, JSON.stringify(trace)).toContain(directory);

          const exitResult = await executeToCompletion(executor, {
            taskId: 'powershell-integration-task',
            leaseEpoch: lease.value.lease.epoch,
            command: '& $env:ComSpec /d /c "exit 7"',
            risk: 'read_only',
            observationWindowMs: 5_000,
          });
          expect(exitResult, JSON.stringify(trace)).toMatchObject({
            status: 'completed',
            transaction: { exitCode: 7 },
          });

          const streaming = await executor.execute({
            taskId: 'powershell-integration-task',
            leaseEpoch: lease.value.lease.epoch,
            command:
              '1..3 | ForEach-Object { Write-Output ("tick" + $_); Start-Sleep -Milliseconds 150 }',
            risk: 'read_only',
          });
          expect(streaming.status).toBe('running');
          await expect(
            executor.wait({ transactionId: streaming.transaction.id, timeoutMs: 5_000 }),
          ).resolves.toMatchObject({
            status: 'completed',
            output: { text: expect.stringContaining('tick3') },
          });

          const sleeping = await executor.execute({
            taskId: 'powershell-integration-task',
            leaseEpoch: lease.value.lease.epoch,
            command: 'Start-Sleep -Seconds 30',
            risk: 'read_only',
          });
          expect(sleeping.status).toBe('running');
          await expect(executor.interrupt(sleeping.transaction.id)).resolves.toBe(true);
          await expect(
            executor.wait({ transactionId: sleeping.transaction.id }),
          ).resolves.toMatchObject({
            status: 'interrupted',
          });
        } finally {
          probe.dispose();
          await actor.terminate();
          await actor.waitForExit(2_000);
          actor.dispose();
        }
      });
    },
    60_000,
  );
});

function powerShellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function executeToCompletion(executor: CommandExecutor, input: ExecuteCommandInput) {
  const initial = await executor.execute(input);
  return initial.status === 'running'
    ? executor.wait({ transactionId: initial.transaction.id, timeoutMs: 15_000 })
    : initial;
}
