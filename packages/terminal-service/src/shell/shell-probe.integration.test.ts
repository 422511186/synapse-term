import process from 'node:process';

import { describe, expect, it } from 'vitest';

import { ShellProbe } from './shell-probe.js';
import { ShellLocator } from './shell-locator.js';
import { NodePtySpawner } from './pty-adapter.js';
import { SessionActor } from '../session/session-actor.js';

const bashExecutable = new ShellLocator()
  .list()
  .find((shell) => shell.kind === 'bash' && shell.available)?.executable;

describe('ShellProbe with a real PTY', () => {
  it.skipIf(bashExecutable === undefined)(
    'identifies the current POSIX PTY even when the launch hint is PowerShell',
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
      const actor = new SessionActor('probe-integration-session', pty, {
        title: 'Probe integration',
        terminalType: 'PowerShell',
        columns: 120,
        rows: 40,
      });
      const probe = new ShellProbe(actor, { timeoutMs: 10_000 });

      try {
        await actor.markPtyRunning();
        await expect(probe.run({ environmentEpoch: 0 })).resolves.toMatchObject({
          mode: 'structured',
          dialect: 'posix',
          platform: 'unix',
        });
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
