import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';

import { withTemporaryDirectory } from '@synapse-term/test-kit';

import { ShellLocator } from '../shell/shell-locator.js';
import { NodePtySpawner } from '../shell/pty-adapter.js';
import { SessionActor } from '../session/session-actor.js';
import { SessionResourceService } from './session-resource-service.js';

const powerShell = new ShellLocator()
  .list()
  .find((shell) => shell.kind === 'powershell' && shell.available);

describe('SessionResourceService with PowerShell and ConPTY', () => {
  it.skipIf(process.platform !== 'win32' || powerShell?.executable === undefined)(
    'refreshes resources after direct user input invalidates shell capability',
    async () => {
      await withTemporaryDirectory(async (directory) => {
        const env = Object.fromEntries(
          Object.entries(process.env).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
          ),
        );
        const pty = new NodePtySpawner().spawn({
          executable: powerShell!.executable!,
          args: powerShell!.args,
          cwd: directory,
          env: { ...env, TERM: 'xterm-256color' },
          columns: 120,
          rows: 40,
        });
        const actor = new SessionActor('resource-powershell-session', pty, {
          columns: 120,
          rows: 40,
          executionDialect: 'powershell',
        });
        let output = '';
        actor.onEvent((event) => {
          if (event.type === 'pty_output') output += event.data;
        });

        try {
          await actor.markPtyRunning();
          await actor.writeUser("Write-Output 'TERMINAL_AGENT_RESOURCE_READY'\r");
          await waitForOutput(() => output, 'TERMINAL_AGENT_RESOURCE_READY');

          const service = new SessionResourceService({ sessions: { get: () => actor } });
          const result = await service.refresh(actor.snapshot.id);

          expect(result, output).toMatchObject({ ok: true });
        } finally {
          await actor.terminate();
          await actor.waitForExit(2_000);
          actor.dispose();
        }
      });
    },
    60_000,
  );
});

async function waitForOutput(read: () => string, expected: string): Promise<void> {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    if (read().includes(expected)) return;
    await delay(10);
  }
  throw new Error(`PowerShell output timed out: ${read()}`);
}
