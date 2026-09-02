import process from 'node:process';

import { describe, expect, it } from 'vitest';

import { CommandExecutor } from './command-executor.js';
import { SessionActor } from './session-actor.js';
import { NodePtySpawner } from '../shell/pty-adapter.js';
import { ShellLocator } from '../shell/shell-locator.js';
import { ShellProbe } from '../shell/shell-probe.js';

const zshExecutable = new ShellLocator()
  .list()
  .find((shell) => shell.kind === 'zsh' && shell.available)?.executable;

describe('CommandExecutor with a real zsh PTY', () => {
  it.skipIf(process.platform !== 'darwin' || zshExecutable === undefined)(
    'does not expose the completion Probe prefix in command output',
    async () => {
      const environment = Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      );
      const pty = new NodePtySpawner().spawn({
        executable: zshExecutable!,
        args: ['--no-rcs', '-i'],
        cwd: process.cwd(),
        env: { ...environment, TERM: 'xterm-256color' },
        columns: 80,
        rows: 40,
      });
      const actor = new SessionActor('zsh-integration-session', pty, {
        title: 'zsh',
        terminalType: 'zsh',
        columns: 80,
        rows: 40,
      });
      const terminalOutput: string[] = [];
      actor.onEvent((event) => {
        if (event.type === 'terminal_output') terminalOutput.push(event.data);
      });
      const executor = new CommandExecutor(actor, {
        observationWindowMs: 1_000,
        nonceFactory: () => '6f270772-b002-449c-87c8-f8a98c55b05d',
      });

      try {
        await actor.markPtyRunning();
        await actor.verifyEnvironment('posix', 'unix');
        const initial = await executor.execute('vm_stat; sysctl -n hw.memsize');
        const completed =
          initial.status === 'running'
            ? await executor.wait({ transactionId: initial.transaction.id, timeoutMs: 10_000 })
            : initial;

        expect(completed.status).toBe('completed');
        expect(completed.output.text).toContain('Pages free');
        expect(completed.output.text).not.toMatch(/([^\r\n]+% )\r\n\1/);
        expect(completed.output.text).not.toMatch(/% p(?:\r|\n)/);
        expect(completed.output.text).not.toContain('printf');
        expect(terminalOutput.join('')).not.toMatch(/% p(?:\r|\n)/);
        expect(terminalOutput.join('')).not.toContain('printf');
        expect(terminalOutput.join('')).not.toContain('p\x08');
      } finally {
        actor.dispose();
        pty.terminate();
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
    30_000,
  );

  it.skipIf(process.platform !== 'darwin' || zshExecutable === undefined)(
    'does not expose an environment Probe prefix in the first command output',
    async () => {
      const environment = Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      );
      const pty = new NodePtySpawner().spawn({
        executable: zshExecutable!,
        args: ['--no-rcs', '-i'],
        cwd: process.cwd(),
        env: { ...environment, TERM: 'xterm-256color' },
        columns: 120,
        rows: 40,
      });
      const actor = new SessionActor('zsh-environment-probe-session', pty, {
        title: 'zsh',
        terminalType: 'zsh',
        columns: 120,
        rows: 40,
      });
      const historyOutput: string[] = [];
      actor.onEvent((event) => {
        if (event.type === 'pty_output') historyOutput.push(event.historyData ?? event.data);
      });
      const probe = new ShellProbe(actor, { timeoutMs: 10_000 });
      const executor = new CommandExecutor(actor, { observationWindowMs: 1_000 });

      try {
        await actor.markPtyRunning();
        await expect(probe.run({ environmentEpoch: 0 })).resolves.toMatchObject({
          mode: 'structured',
          dialect: 'posix',
          platform: 'unix',
        });
        const initial = await executor.execute('echo MCP_ZSH_PROBED_OK');
        const completed =
          initial.status === 'running'
            ? await executor.wait({ transactionId: initial.transaction.id, timeoutMs: 10_000 })
            : initial;

        expect(completed.status).toBe('completed');
        expect(completed.output.text).toContain('MCP_ZSH_PROBED_OK');
        expect(completed.output.text).not.toMatch(/(?:^|\r\n)e%/);
        expect(completed.output.text).not.toContain('__SYNAPSE_DIALECT_');
        expect(historyOutput.join('')).not.toMatch(/(?:^|\r\n)e%/);
        expect(historyOutput.join('')).not.toContain('__SYNAPSE_DIALECT_');
      } finally {
        probe.dispose();
        actor.dispose();
        pty.terminate();
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
    30_000,
  );
});
