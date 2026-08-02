import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';

import { withTemporaryDirectory } from '@synapse-term/test-kit';

import { ShellLocator } from '../shell/shell-locator.js';
import { NodePtySpawner } from '../shell/pty-adapter.js';
import { SessionActor } from '../session/session-actor.js';
import {
  SessionResourceService,
  TerminalSessionResourceCollector,
} from './session-resource-service.js';

const posixShell = new ShellLocator()
  .list()
  .find((shell) => shell.executionDialect === 'posix' && shell.available);

describe('SessionResourceService with a macOS POSIX PTY', () => {
  it.skipIf(process.platform !== 'darwin' || posixShell?.executable === undefined)(
    'refreshes resources after direct user input invalidates shell capability',
    async () => {
      await withTemporaryDirectory(async (directory) => {
        const env = Object.fromEntries(
          Object.entries(process.env).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
          ),
        );
        const pty = new NodePtySpawner().spawn({
          executable: posixShell!.executable!,
          args: posixShell!.args,
          cwd: directory,
          env: { ...env, TERM: 'xterm-256color' },
          columns: 120,
          rows: 40,
        });
        const actor = new SessionActor('resource-posix-session', pty, {
          columns: 120,
          rows: 40,
          executionDialect: 'posix',
        });
        let output = '';
        actor.onEvent((event) => {
          if (event.type === 'pty_output') output += event.data;
        });

        try {
          await actor.markPtyRunning();
          await actor.writeUser("printf 'TERMINAL_AGENT_RESOURCE_READY\\n'\r");
          await waitForOutput(() => output, 'TERMINAL_AGENT_RESOURCE_READY');

          const service = new SessionResourceService({
            sessions: { get: () => actor },
            collector: new TerminalSessionResourceCollector({ timeoutMs: 15_000 }),
          });
          const result = await service.refresh(actor.snapshot.id);

          expect(result, JSON.stringify({ result, output: output.slice(-8_000) })).toMatchObject({
            ok: true,
          });
        } finally {
          await actor.terminate();
          await actor.waitForExit(2_000);
          actor.dispose();
        }
      });
    },
    25_000,
  );
});

async function waitForOutput(read: () => string, expected: string): Promise<void> {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    if (read().includes(expected)) return;
    await delay(10);
  }
  throw new Error(`POSIX terminal output timed out: ${read()}`);
}
