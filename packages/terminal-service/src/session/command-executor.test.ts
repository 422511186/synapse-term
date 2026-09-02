import { describe, expect, it, vi } from 'vitest';

import { createFakeTerminalBackend } from '@synapse-term/test-kit';

import { PosixShellDriver } from '../shell/shell-driver.js';
import { CommandExecutor, CommandExecutorError } from './command-executor.js';
import { SessionActor } from './session-actor.js';

async function createActor(terminalType = 'bash', verifyEnvironment = true) {
  const backend = createFakeTerminalBackend();
  const actor = new SessionActor('session-1', backend, {
    title: 'test',
    terminalType,
  });
  await actor.markPtyRunning();
  if (verifyEnvironment) {
    await actor.verifyEnvironment(
      /powershell|pwsh/i.test(terminalType) ? 'powershell' : 'posix',
      /powershell|pwsh/i.test(terminalType) ? 'windows' : 'unix',
    );
  }
  return { actor, backend };
}

function completion(nonce: string, exitCode = 0): string {
  return `\x1b]777;TA;${nonce};${exitCode}\x07`;
}

async function flushActorQueue(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('CommandExecutor', () => {
  it('writes the user command literally before an independent POSIX completion probe', async () => {
    const { actor, backend } = await createActor();
    const executor = new CommandExecutor(actor, {
      idFactory: () => 'transaction-quoted-command',
      nonceFactory: () => 'nonce-quoted-command',
      observationWindowMs: 20,
    });

    const command = "printf '%s' '}'";
    void executor.execute(command);
    await vi.waitFor(() => expect(backend.writes.join('')).toContain(command));

    const written = backend.writes.join('');
    expect(written.startsWith(`${command}\r`)).toBe(true);
    expect(written.slice(command.length + 1)).toContain('printf');
    expect(written).not.toContain('__synapse_command');
    expect(written).not.toContain('eval');
    expect(written).not.toContain('base64');
  });

  it('writes a PowerShell command literally without dot-sourcing a wrapper', async () => {
    const backend = createFakeTerminalBackend();
    const actor = new SessionActor('session-1', backend, {
      title: 'test',
      terminalType: 'PowerShell',
    });
    await actor.markPtyRunning();
    await actor.verifyEnvironment('powershell', 'windows');
    const executor = new CommandExecutor(actor, { observationWindowMs: 20 });
    const command = "Write-Output 'literal'";

    void executor.execute(command);
    await vi.waitFor(() => expect(backend.writes.join('')).toContain(command));

    const written = backend.writes.join('');
    expect(written.startsWith(`${command}\r`)).toBe(true);
    expect(written).not.toContain('EncodedCommand');
    expect(written).not.toContain('. {');
    expect(written).not.toContain('& {');
  });

  it('rejects commands that cannot be audited before writing to the PTY', async () => {
    const { actor, backend } = await createActor();

    await expect(new CommandExecutor(actor).execute('printf \u0000')).rejects.toThrow(
      /^COMMAND_NOT_AUDITABLE:/,
    );
    expect(backend.writes).toEqual([]);
  });

  it('rejects structured execution until the current PTY environment is verified', async () => {
    const { actor, backend } = await createActor('bash', false);
    const executor = new CommandExecutor(actor);

    await expect(executor.execute('printf ok')).rejects.toThrow(/EXECUTION_ENVIRONMENT_UNVERIFIED/);
    expect(backend.writes).toEqual([]);
    actor.dispose();
  });

  it('selects the verified current dialect instead of the launch Shell hint', async () => {
    const { actor, backend } = await createActor('PowerShell', false);
    await actor.verifyEnvironment('posix', 'unix');
    const executor = new CommandExecutor(actor, {
      idFactory: () => 'transaction-current-dialect',
      nonceFactory: () => 'nonce-current-dialect',
      observationWindowMs: 20,
    });
    const command = "printf '%s\\n' current";

    const resultPromise = executor.execute(command);
    await vi.waitFor(() => expect(backend.writes.join('')).toContain(command));
    expect(backend.writes.join('')).toContain("printf '\\033]777;TA;");
    expect(backend.writes.join('')).not.toContain('[Console]::Write');
    backend.emitData(completion('nonce-current-dialect'));

    const initial = await resultPromise;
    const completed =
      initial.status === 'running'
        ? await executor.wait({ transactionId: initial.transaction.id })
        : initial;
    expect(completed).toMatchObject({
      status: 'completed',
      transaction: { command },
    });
    actor.dispose();
  });

  it('opens a transaction, captures output, and converges on a matching frame', async () => {
    const { actor, backend } = await createActor();
    const actorEvents: unknown[] = [];
    const outputEvents: unknown[] = [];
    actor.onEvent((event) => {
      actorEvents.push(event);
      if (event.type === 'pty_output') outputEvents.push(event);
    });
    const executor = new CommandExecutor(actor, {
      idFactory: () => 'transaction-1',
      nonceFactory: () => 'nonce-1',
      observationWindowMs: 10,
    });
    const initialPromise = executor.execute('printf done');
    await vi.waitFor(() => expect(backend.writes.join('')).toContain('printf done'));
    backend.emitData('hello');
    await flushActorQueue();
    expect(outputEvents.length).toBe(1);
    backend.emitData(completion('nonce-1', 7));
    await flushActorQueue();
    expect(JSON.stringify(actorEvents)).toContain('nonce-1');

    const initial = await initialPromise;
    expect(initial.status).toBe('running');
    const final = await executor.wait({ transactionId: 'transaction-1' });
    expect(final.status).toBe('completed');
    expect(final.transaction).toMatchObject({
      id: 'transaction-1',
      sessionId: 'session-1',
      exitCode: 7,
    });
    expect(final.output.text).toBe('hello');
    expect(executor.get('transaction-1')?.status).toBe('completed');
  });

  it('captures stdout that arrives immediately after the completion frame', async () => {
    const { actor, backend } = await createActor();
    const executor = new CommandExecutor(actor, {
      idFactory: () => 'transaction-late-output',
      nonceFactory: () => 'nonce-late-output',
      observationWindowMs: 1_000,
    });
    const resultPromise = executor.execute('uname -s');

    await vi.waitFor(() => expect(backend.writes.join('')).toContain('uname -s'));
    backend.emitData(`uname -s\r\n${completion('nonce-late-output')}`);
    await Promise.resolve();
    backend.emitData('Darwin\r\n');

    await expect(resultPromise).resolves.toMatchObject({
      status: 'completed',
      output: { text: expect.stringContaining('Darwin') },
    });
    actor.dispose();
  });

  it('keeps the completion Probe suppressed after the drain while retaining delayed stdout', async () => {
    vi.useFakeTimers();
    try {
      const { actor, backend } = await createActor();
      const terminalOutput: string[] = [];
      actor.onEvent((event) => {
        if (event.type === 'terminal_output') terminalOutput.push(event.data);
      });
      const executor = new CommandExecutor(actor, {
        idFactory: () => 'transaction-delayed-probe-echo',
        nonceFactory: () => 'nonce-delayed-probe-echo',
        observationWindowMs: 1_000,
        completionDrainMs: 10,
        completionEchoGraceMs: 100,
      });
      const dispatch = new PosixShellDriver().buildDispatch('uname -s', 'nonce-delayed-probe-echo');
      const resultPromise = executor.execute('uname -s');

      await flushActorQueue();
      expect(backend.writes.join('')).toContain('uname -s');
      backend.emitData(completion('nonce-delayed-probe-echo'));
      await flushActorQueue();
      await vi.advanceTimersByTimeAsync(10);
      await flushActorQueue();
      await vi.advanceTimersByTimeAsync(25);
      backend.emitData(
        `${dispatch.echoPattern.start}${dispatch.echoPattern.end}\r\nlate stdout\r\n`,
      );
      await flushActorQueue();
      await vi.advanceTimersByTimeAsync(100);

      const result = await resultPromise;
      expect(result).toMatchObject({
        status: 'completed',
        transaction: { exitCode: 0 },
        output: { text: expect.stringContaining('late stdout') },
      });
      expect(terminalOutput.join('')).toContain('late stdout');
      expect(terminalOutput.join('')).not.toContain('nonce-delayed-probe-echo');
      actor.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps PTY writes, protocol output, and completion results stable across a UI visibility change', async () => {
    const { actor, backend } = await createActor();
    const terminalOutput: string[] = [];
    const protocolOutput: string[] = [];
    actor.onEvent((event) => {
      if (event.type === 'terminal_output') terminalOutput.push(event.data);
      if (event.type === 'pty_output') protocolOutput.push(event.data);
    });
    const executor = new CommandExecutor(actor, {
      idFactory: () => 'transaction-visibility-switch',
      nonceFactory: () => 'nonce-visibility-switch',
      observationWindowMs: 1_000,
      completionDrainMs: 0,
      completionEchoGraceMs: 0,
    });
    const dispatch = new PosixShellDriver().buildDispatch('printf ok', 'nonce-visibility-switch');
    const resultPromise = executor.execute('printf ok');

    await vi.waitFor(() => expect(backend.writes.join('')).toContain('printf ok'));
    backend.emitData(`printf ok\r\n${dispatch.echoPattern.start.slice(0, 12)}`);
    await flushActorQueue();
    await actor.setProbeEchoVisibility(false);
    backend.emitData(
      `${dispatch.echoPattern.start.slice(12)}${dispatch.echoPattern.end}\r\n${completion(
        'nonce-visibility-switch',
      )}`,
    );

    const result = await resultPromise;
    expect(result).toMatchObject({
      status: 'completed',
      transaction: { command: 'printf ok', exitCode: 0 },
    });
    expect(backend.writes).toEqual([dispatch.payload]);
    expect(protocolOutput.join('')).toContain('printf ok');
    expect(protocolOutput.join('')).not.toContain('nonce-visibility-switch');
    expect(terminalOutput.join('')).toContain('printf ok');
    expect(terminalOutput.join('')).toContain(dispatch.echoPattern.start.slice(12));
    expect(terminalOutput.join('')).toContain('nonce-visibility-switch');
    actor.dispose();
  });

  it('uses the verified POSIX environment and preserves macOS stdout after a remote SSH hop', async () => {
    const { actor, backend } = await createActor('PowerShell', false);
    await actor.verifyEnvironment('posix', 'unix');
    const executor = new CommandExecutor(actor, {
      idFactory: () => 'transaction-macos-ssh',
      nonceFactory: () => 'nonce-macos-ssh',
      observationWindowMs: 1_000,
      completionDrainMs: 10,
    });

    const command = 'uname -s';
    const resultPromise = executor.execute(command);
    await vi.waitFor(() => expect(backend.writes.join('')).toContain(command));
    backend.emitData(`uname -s\r\n${completion('nonce-macos-ssh')}`);
    await flushActorQueue();
    backend.emitData('Darwin\r\n');

    await expect(resultPromise).resolves.toMatchObject({
      status: 'completed',
      transaction: { command, exitCode: 0 },
      output: { text: expect.stringContaining('Darwin') },
    });
    const result = await resultPromise;
    expect(result.output.text).toContain('uname -s');
    expect(result.output.text).not.toContain('__SYNAPSE_DIALECT_');
    expect(result.output.text).not.toContain('\u001b]777;TA;');
    actor.dispose();
  });

  it('does not mix the next transaction into a completed transaction drain window', async () => {
    const { actor, backend } = await createActor();
    const executor = new CommandExecutor(actor, {
      idFactory: (() => {
        let sequence = 0;
        return () => `transaction-drain-${++sequence}`;
      })(),
      nonceFactory: (() => {
        let sequence = 0;
        return () => `nonce-drain-${++sequence}`;
      })(),
      observationWindowMs: 1_000,
      completionDrainMs: 10,
    });

    const firstPromise = executor.execute('uname -s');
    await vi.waitFor(() => expect(backend.writes.join('')).toContain('uname -s'));
    backend.emitData(`uname -s\r\n${completion('nonce-drain-1')}`);
    backend.emitData('Darwin\r\n');
    const first = await firstPromise;

    const secondPromise = executor.execute('sw_vers');
    await vi.waitFor(() => expect(backend.writes.join('')).toContain('sw_vers'));
    backend.emitData(`sw_vers\r\nProductName: macOS\r\n${completion('nonce-drain-2')}`);
    const second = await secondPromise;

    expect(first.output.text).toContain('Darwin');
    expect(first.output.text).not.toContain('ProductName: macOS');
    expect(second.output.text).toContain('ProductName: macOS');
    actor.dispose();
  });

  it('returns an initial running snapshot after the observation window and waits later', async () => {
    vi.useFakeTimers();
    try {
      const { actor, backend } = await createActor();
      const executor = new CommandExecutor(actor, {
        idFactory: () => 'transaction-running',
        nonceFactory: () => 'nonce-running',
        observationWindowMs: 10,
        completionDrainMs: 0,
        completionEchoGraceMs: 0,
      });
      const initialPromise = executor.execute('sleep 100');
      await vi.advanceTimersByTimeAsync(10);
      const initial = await initialPromise;
      expect(initial.status).toBe('running');

      const waitPromise = executor.wait({ transactionId: 'transaction-running' });
      await Promise.resolve();
      backend.emitData(completion('nonce-running'));
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
      await expect(waitPromise).resolves.toMatchObject({ status: 'completed' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects concurrent transactions with SESSION_BUSY and invalid sessions with SESSION_NOT_READY', async () => {
    const { actor, backend } = await createActor();
    const executor = new CommandExecutor(actor);
    void executor.execute('sleep 100');

    await expect(executor.execute('another')).rejects.toThrow(/SESSION_BUSY/);
    await expect(executor.execute('')).rejects.toThrow(CommandExecutorError);
    backend.terminate();
  });

  it('interrupts the active transaction through the PTY interrupt channel', async () => {
    const { actor, backend } = await createActor();
    const executor = new CommandExecutor(actor, {
      idFactory: () => 'transaction-interrupt',
      nonceFactory: () => 'nonce-interrupt',
      observationWindowMs: 20,
    });
    const initialPromise = executor.execute('sleep 100');
    const initial = await initialPromise;
    expect(initial.status).toBe('running');
    await expect(executor.interrupt('transaction-interrupt')).resolves.toBe(true);
    await flushActorQueue();

    const final = await executor.wait({ transactionId: 'transaction-interrupt' });
    expect(final).toMatchObject({
      status: 'interrupted',
      transaction: { status: 'interrupted' },
    });
    expect(backend.interrupted).toBe(1);
    await expect(executor.execute('next')).resolves.toBeDefined();
  });

  it('marks shell lost when the PTY exits before completion', async () => {
    const { actor, backend } = await createActor();
    const executor = new CommandExecutor(actor, {
      idFactory: () => 'transaction-exit',
      nonceFactory: () => 'nonce-exit',
      observationWindowMs: 10_000,
    });
    const initialPromise = executor.execute('sleep 100');
    await vi.waitFor(() => expect(backend.writes.join('')).toContain('sleep 100'));
    backend.emitExit(3);
    await flushActorQueue();

    await expect(initialPromise).resolves.toMatchObject({
      status: 'shell_lost',
      transaction: { reason: 'PTY exited before completion frame' },
    });
  });
});
