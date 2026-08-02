import process from 'node:process';

import { describe, expect, it } from 'vitest';

import { CommandExecutor } from './command-executor.js';
import { NodePtySpawner } from './pty-adapter.js';
import { SessionActor } from './session-actor.js';
import { ShellProbe } from './shell-probe.js';
import { ShellLocator } from '../../desktop/src/shell-locator.js';

const bashExecutable =
  process.env.TERMINAL_AGENT_BASH ??
  new ShellLocator().list().find((shell) => shell.kind === 'bash' && shell.available)?.executable;

describe('CommandExecutor with Git Bash and ConPTY', () => {
  it.skipIf(bashExecutable === undefined)(
    'probes and executes a UTF-8 command through an already connected PTY',
    async () => {
      const env = Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      );
      const pty = new NodePtySpawner().spawn({
        executable: bashExecutable!,
        args: ['--noprofile', '--norc', '-i'],
        cwd: process.cwd(),
        env: { ...env, TERM: 'xterm-256color', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' },
        columns: 80,
        rows: 40,
      });
      const actor = new SessionActor('integration-session', pty, {
        columns: 80,
        rows: 40,
        executionDialect: 'posix',
      });
      const probe = new ShellProbe(actor, { timeoutMs: 15_000 });
      const observed: string[] = [];
      const controls: string[] = [];
      actor.onEvent((event) => {
        if (event.type === 'pty_output') observed.push(event.data);
        if (event.type === 'osc_777') controls.push(event.payload);
      });

      try {
        await actor.markPtyRunning();
        const lease = await actor.grantAgentLease('integration-task', 0);
        if (!lease.ok) throw new Error('expected agent lease');
        const probeResult = await probe.run({
          taskId: 'integration-task',
          leaseEpoch: lease.value.lease.epoch,
        });
        if (probeResult.mode !== 'structured') {
          throw new Error(
            `probe failed: ${JSON.stringify(probeResult)} output=${JSON.stringify(observed)} controls=${JSON.stringify(controls)}`,
          );
        }

        const executor = new CommandExecutor(actor, {
          observationWindowMs: 1_000,
          hardDeadlineMs: 10_000,
        });
        const initial = await executor.execute({
          transactionId: 'integration-transaction',
          taskId: 'integration-task',
          leaseEpoch: lease.value.lease.epoch,
          command: "printf 'utf8:中文🙂\\n'",
          risk: 'read_only',
          observationWindowMs: 10_000,
        });
        const completed =
          initial.status === 'running'
            ? await executor.wait({ transactionId: initial.transaction.id, timeoutMs: 15_000 })
            : initial;
        expect(completed).toMatchObject({
          status: 'completed',
          transaction: { exitCode: 0 },
        });
        expect(completed.output.text, JSON.stringify({ observed, controls })).toContain(
          'utf8:中文',
        );

        const marker = await executor.execute({
          transactionId: 'integration-marker-transaction',
          taskId: 'integration-task',
          leaseEpoch: lease.value.lease.epoch,
          command: "printf 'GIT_BASH_AGENT_READY\\n'",
          risk: 'read_only',
          observationWindowMs: 10_000,
        });
        const markerCompleted =
          marker.status === 'running'
            ? await executor.wait({ transactionId: marker.transaction.id, timeoutMs: 15_000 })
            : marker;
        expect(markerCompleted, JSON.stringify({ observed, controls })).toMatchObject({
          status: 'completed',
          transaction: { exitCode: 0 },
        });
        expect(markerCompleted.output.text).toContain('GIT_BASH_AGENT_READY');
      } finally {
        probe.dispose();
        actor.dispose();
        pty.terminate();
      }
    },
    40_000,
  );
});
