import { describe, expect, it, vi } from 'vitest';

import { createFakeTerminalBackend } from '@synapse-term/test-kit';

import { PosixShellDriver } from '../shell/shell-driver.js';
import { ShellProbe } from '../shell/shell-probe.js';
import { SessionActor } from './session-actor.js';

describe('SessionActor', () => {
  it('serializes pty output into ordered events', async () => {
    const backend = createFakeTerminalBackend();
    const actor = new SessionActor('s1', backend, {
      title: '终端 1',
      terminalType: 'Zsh',
    });
    const events: Array<{ sequence: number; data: string }> = [];
    actor.onEvent((event) => {
      if (event.type === 'pty_output') events.push({ sequence: event.sequence, data: event.data });
    });
    await actor.markPtyRunning();
    backend.emitData('hello');
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual([{ sequence: 1, data: 'hello' }]);
    actor.dispose();
  });

  it('separates complete and split OSC 777 control frames from visible output', async () => {
    const backend = createFakeTerminalBackend();
    const actor = new SessionActor('s1', backend, {
      title: '终端 1',
      terminalType: 'Git Bash',
    });
    const output: string[] = [];
    const controls: string[] = [];
    actor.onEvent((event) => {
      if (event.type === 'pty_output') output.push(event.data);
      if ('payload' in event) controls.push(event.payload);
    });
    await actor.markPtyRunning();

    backend.emitData('before\u001b]777;TA;nonce-1');
    backend.emitData(';7\u0007after');
    await vi.waitFor(() => expect(controls).toEqual(['TA;nonce-1;7']));

    expect(output.join('')).toBe('beforeafter');
    expect(controls).toEqual(['TA;nonce-1;7']);
    actor.dispose();
  });

  it('suppresses a split and redrawn protocol input echo without hiding user output', async () => {
    const backend = createFakeTerminalBackend();
    const actor = new SessionActor('s1', backend, {
      title: '终端 1',
      terminalType: 'PowerShell',
    });
    const output: string[] = [];
    actor.onEvent((event) => {
      if (event.type === 'pty_output') output.push(event.data);
    });
    await actor.markPtyRunning();
    actor.suppressInputEcho({ start: '[probe:', end: ':end]' });

    backend.emitData('before [pro');
    backend.emitData('be:noise > [probe:noise:end]after');
    await vi.waitFor(() => expect(output.join('')).toBe('before after'));

    await actor.releaseInputEcho({ start: '[probe:', end: ':end]' });
    actor.dispose();
  });

  it('can show probe echo to the terminal UI without exposing it to protocol consumers', async () => {
    const backend = createFakeTerminalBackend();
    const actor = new SessionActor('s1', backend, { title: '终端 1', terminalType: 'PowerShell' });
    const protocolOutput: string[] = [];
    const terminalOutput: string[] = [];
    actor.onEvent((event) => {
      if (event.type === 'pty_output') protocolOutput.push(event.data);
      if (event.type === 'terminal_output') terminalOutput.push(event.data);
    });
    await actor.markPtyRunning();
    await actor.setProbeEchoVisibility(false);
    const pattern = { start: '[probe:', end: ':end]' };
    actor.suppressInputEcho(pattern);

    backend.emitData('before [probe:diagnostic:end]after');
    await vi.waitFor(() =>
      expect(terminalOutput.join('')).toBe('before [probe:diagnostic:end]after'),
    );

    expect(protocolOutput.join('')).toBe('before after');
    actor.dispose();
  });

  it('hides the environment Probe command and result from the local UI while preserving protocol data', async () => {
    const backend = createFakeTerminalBackend();
    const actor = new SessionActor('s1', backend, {
      title: '终端 1',
      terminalType: 'PowerShell',
      hideCompletionProbeEcho: true,
    });
    const protocolOutput: string[] = [];
    const terminalOutput: string[] = [];
    actor.onEvent((event) => {
      if (event.type === 'pty_output') protocolOutput.push(event.data);
      if (event.type === 'terminal_output') terminalOutput.push(event.data);
    });
    await actor.markPtyRunning();
    const probe = new ShellProbe(actor, {
      nonceFactory: () => 'probe-ui-hidden',
      timeoutMs: 100,
    });

    const resultPromise = probe.run({ environmentEpoch: 0 });
    await vi.waitFor(() =>
      expect(backend.writes.join('')).toContain('echo __SYNAPSE_DIALECT_probe-ui-hidden__:$?\r'),
    );
    backend.emitData('ec\u001b[?25l');
    backend.emitData('ho __SYNAPSE_DIALECT_probe-ui-hidden__:$?\r\n');
    backend.emitData('__SYNAPSE_DIALECT_probe-ui-hidden__:');
    backend.emitData('0\r\n');

    await expect(resultPromise).resolves.toMatchObject({
      mode: 'structured',
      dialect: 'posix',
      platform: 'unix',
    });
    expect(protocolOutput.join('')).toContain('__SYNAPSE_DIALECT_probe-ui-hidden__');
    expect(protocolOutput.join('')).toContain('__SYNAPSE_DIALECT_probe-ui-hidden__:0');
    expect(terminalOutput.join('')).not.toContain('SYNAPSE_DIALECT_probe-ui-hidden');
    probe.dispose();
    actor.dispose();
  });

  it('hides a wrapped and redrawn environment Probe across PTY chunks while retaining nearby output', async () => {
    const backend = createFakeTerminalBackend();
    const actor = new SessionActor('s1', backend, {
      title: '终端 1',
      terminalType: 'PowerShell',
      hideCompletionProbeEcho: true,
    });
    const protocolOutput: string[] = [];
    const terminalOutput: string[] = [];
    actor.onEvent((event) => {
      if (event.type === 'pty_output') protocolOutput.push(event.data);
      if (event.type === 'terminal_output') terminalOutput.push(event.data);
    });
    await actor.markPtyRunning();
    const probe = new ShellProbe(actor, {
      nonceFactory: () => 'probe-ui-wrapped',
      timeoutMs: 100,
    });

    const resultPromise = probe.run({ environmentEpoch: 0 });
    await vi.waitFor(() => expect(backend.writes.join('')).toContain('probe-ui-wrapped'));
    backend.emitData('prompt> ');
    backend.emitData('echo __SYNAPSE_DIALECT_probe-ui-wrapped');
    backend.emitData('\u001b[');
    backend.emitData('2K__:$?\r');
    backend.emitData('\n');
    backend.emitData('__SYNAPSE_DIALECT_probe-ui-wr');
    backend.emitData('\u001b[');
    backend.emitData('1Gapped__:');
    backend.emitData('0\r\n');
    backend.emitData('prompt> ordinary-after\r\n');

    await expect(resultPromise).resolves.toMatchObject({
      mode: 'structured',
      dialect: 'posix',
      platform: 'unix',
    });
    expect(protocolOutput.join('')).toContain('__SYNAPSE_DIALECT_probe-ui-wrapped');
    expect(terminalOutput.join('')).toContain('prompt> ');
    expect(terminalOutput.join('')).toContain('ordinary-after');
    expect(terminalOutput.join('')).not.toContain('probe-ui-wrapped');
    probe.dispose();
    actor.dispose();
  });

  it('shows the environment Probe for diagnostics when automatic Probe hiding is disabled', async () => {
    const backend = createFakeTerminalBackend();
    const actor = new SessionActor('s1', backend, {
      title: '终端 1',
      terminalType: 'PowerShell',
      hideCompletionProbeEcho: false,
    });
    const terminalOutput: string[] = [];
    actor.onEvent((event) => {
      if (event.type === 'terminal_output') terminalOutput.push(event.data);
    });
    await actor.markPtyRunning();
    const probe = new ShellProbe(actor, {
      nonceFactory: () => 'probe-ui-visible',
      timeoutMs: 100,
    });

    const resultPromise = probe.run({ environmentEpoch: 0 });
    await vi.waitFor(() => expect(backend.writes.join('')).toContain('probe-ui-visible'));
    backend.emitData(
      'echo __SYNAPSE_DIALECT_probe-ui-visible__:$?\r\n' +
        '__SYNAPSE_DIALECT_probe-ui-visible__:0\r\n',
    );

    await expect(resultPromise).resolves.toMatchObject({ mode: 'structured' });
    expect(terminalOutput.join('')).toContain('echo __SYNAPSE_DIALECT_probe-ui-visible__:$?');
    expect(terminalOutput.join('')).toContain('__SYNAPSE_DIALECT_probe-ui-visible__:0');
    probe.dispose();
    actor.dispose();
  });

  it.each([true, false])(
    'keeps the MCP history path independent from local Probe echo visibility (%s)',
    async (hideCompletionProbeEcho) => {
      const backend = createFakeTerminalBackend();
      const actor = new SessionActor('s1', backend, {
        title: '终端 1',
        terminalType: 'PowerShell',
        hideCompletionProbeEcho,
      });
      const protocolOutput: string[] = [];
      const historyOutput: string[] = [];
      const terminalOutput: string[] = [];
      actor.onEvent((event) => {
        if (event.type !== 'pty_output') return;
        protocolOutput.push(event.data);
        historyOutput.push(event.historyData ?? event.data);
      });
      actor.onEvent((event) => {
        if (event.type === 'terminal_output') terminalOutput.push(event.data);
      });
      await actor.markPtyRunning();
      const probe = new ShellProbe(actor, {
        nonceFactory: () => `probe-history-${hideCompletionProbeEcho}`,
        timeoutMs: 100,
      });

      const resultPromise = probe.run({ environmentEpoch: 0 });
      await vi.waitFor(() => expect(backend.writes.join('')).toContain('probe-history-'));
      backend.emitData(
        `echo __SYNAPSE_DIALECT_probe-history-${hideCompletionProbeEcho}__:$?\r\n` +
          `__SYNAPSE_DIALECT_probe-history-${hideCompletionProbeEcho}__:0\r\n` +
          'ordinary output\r\n',
      );
      await expect(resultPromise).resolves.toMatchObject({ mode: 'structured' });

      expect(protocolOutput.join('')).toContain('SYNAPSE_DIALECT_probe-history-');
      expect(historyOutput.join('')).not.toContain('SYNAPSE_DIALECT_probe-history-');
      expect(historyOutput.join('')).toContain('ordinary output');
      expect(terminalOutput.join('')).toContain('ordinary output');
      expect(terminalOutput.join('').includes('probe-history-')).toBe(!hideCompletionProbeEcho);
      probe.dispose();
      actor.dispose();
    },
  );

  it('applies a visibility change only to future Probe UI output', async () => {
    const backend = createFakeTerminalBackend();
    const actor = new SessionActor('s1', backend, {
      title: '终端 1',
      terminalType: 'zsh',
      hideCompletionProbeEcho: true,
    });
    const protocolOutput: string[] = [];
    const terminalOutput: string[] = [];
    actor.onEvent((event) => {
      if (event.type === 'pty_output') protocolOutput.push(event.data);
      if (event.type === 'terminal_output') terminalOutput.push(event.data);
    });
    await actor.markPtyRunning();
    const pattern = { start: '[probe:', end: ':end]' };
    actor.suppressInputEcho(pattern);

    backend.emitData('before [pro');
    await vi.waitFor(() => expect(terminalOutput.join('')).toBe('before '));
    await actor.setProbeEchoVisibility(false);
    backend.emitData('be:diagnostic:end] after');
    await vi.waitFor(() => expect(terminalOutput.join('')).toContain('be:diagnostic:end] after'));

    expect(terminalOutput.join('')).toBe('before be:diagnostic:end] after');
    expect(protocolOutput.join('')).toBe('before  after');
    actor.dispose();
  });

  it('applies a visibility change from diagnostic mode without rewriting delivered UI output', async () => {
    const backend = createFakeTerminalBackend();
    const actor = new SessionActor('s1', backend, {
      title: '终端 1',
      terminalType: 'zsh',
      hideCompletionProbeEcho: false,
    });
    const protocolOutput: string[] = [];
    const terminalOutput: string[] = [];
    actor.onEvent((event) => {
      if (event.type === 'pty_output') protocolOutput.push(event.data);
      if (event.type === 'terminal_output') terminalOutput.push(event.data);
    });
    await actor.markPtyRunning();
    const pattern = { start: '[probe:', end: ':end]' };
    actor.suppressInputEcho(pattern);

    backend.emitData('before [pro');
    await vi.waitFor(() => expect(terminalOutput.join('')).toBe('before [pro'));
    await actor.setProbeEchoVisibility(true);
    backend.emitData('be:diagnostic:end] after');
    await vi.waitFor(() => expect(terminalOutput.join('')).toContain('after'));

    expect(terminalOutput.join('')).toBe('before [pro after');
    expect(protocolOutput.join('')).toBe('before  after');
    actor.dispose();
  });

  it('continues hiding a command completion Probe while showing the user command', async () => {
    const backend = createFakeTerminalBackend();
    const actor = new SessionActor('s1', backend, {
      title: '终端 1',
      terminalType: 'zsh',
      hideCompletionProbeEcho: true,
    });
    const terminalOutput: string[] = [];
    actor.onEvent((event) => {
      if (event.type === 'terminal_output') terminalOutput.push(event.data);
    });
    await actor.markPtyRunning();
    const dispatch = new PosixShellDriver().buildDispatch('uname -s', 'completion-ui-hidden');
    actor.suppressInputEcho(dispatch.echoPattern);

    backend.emitData(`uname -s\r\n${dispatch.echoPattern.start}${dispatch.echoPattern.end}\r\n`);
    backend.emitData('\u001b]777;TA;completion-ui-hidden;0\x07');
    await vi.waitFor(() => expect(terminalOutput.join('')).toContain('uname -s'));

    expect(terminalOutput.join('')).not.toContain('printf');
    expect(terminalOutput.join('')).not.toContain('completion-ui-hidden');
    actor.dispose();
  });

  it('hides a wrapped and redrawn command completion Probe while retaining the user command and prompt', async () => {
    const backend = createFakeTerminalBackend();
    const actor = new SessionActor('s1', backend, {
      title: '终端 1',
      terminalType: 'zsh',
      hideCompletionProbeEcho: true,
    });
    const terminalOutput: string[] = [];
    actor.onEvent((event) => {
      if (event.type === 'terminal_output') terminalOutput.push(event.data);
    });
    await actor.markPtyRunning();
    const dispatch = new PosixShellDriver().buildDispatch('uname -s', 'completion-ui-wrapped');
    actor.suppressInputEcho(dispatch.echoPattern);

    const midpoint = Math.floor(dispatch.echoPattern.start.length / 2);
    backend.emitData(`prompt$ uname -s\r\n${dispatch.echoPattern.start.slice(0, midpoint)}`);
    backend.emitData('\u001b[');
    backend.emitData(`2K${dispatch.echoPattern.start.slice(midpoint)}\r\n`);
    backend.emitData(dispatch.echoPattern.end.slice(0, 2));
    backend.emitData('\u001b[');
    backend.emitData(`1G${dispatch.echoPattern.end.slice(2)}\r\n`);
    backend.emitData('prompt$ ');
    backend.emitData('\u001b]777;TA;completion-ui-wrapped;0');
    backend.emitData('\u0007');

    await vi.waitFor(() => expect(terminalOutput.join('')).toContain('prompt$ uname -s'));
    expect(terminalOutput.join('')).toContain('prompt$ ');
    expect(terminalOutput.join('')).not.toContain('printf');
    expect(terminalOutput.join('')).not.toContain('completion-ui-wrapped');
    actor.dispose();
  });

  it('restores an unfinished completion Probe when the bounded echo window expires', async () => {
    vi.useFakeTimers();
    try {
      const backend = createFakeTerminalBackend();
      const actor = new SessionActor('s1', backend, {
        title: '终端 1',
        terminalType: 'zsh',
        hideCompletionProbeEcho: true,
      });
      const protocolOutput: string[] = [];
      const terminalOutput: string[] = [];
      actor.onEvent((event) => {
        if (event.type === 'pty_output') protocolOutput.push(event.data);
        if (event.type === 'terminal_output') terminalOutput.push(event.data);
      });
      await actor.markPtyRunning();
      const pattern = { start: '[probe:', end: ':end]' };
      actor.suppressInputEcho(pattern);
      backend.emitData('before [probe:unfinished');

      const release = actor.releaseInputEcho(pattern, { graceMs: 10 });
      await vi.advanceTimersByTimeAsync(10);
      await expect(release).resolves.toBeUndefined();
      expect(protocolOutput.join('')).toBe('before [probe:unfinished');
      expect(terminalOutput.join('')).toBe('before [probe:unfinished');

      backend.emitData(' after');
      await vi.waitFor(() => expect(terminalOutput.join('')).toContain(' after'));
      actor.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores a pending Probe before replacing it with a new Probe matcher', async () => {
    const backend = createFakeTerminalBackend();
    const actor = new SessionActor('s1', backend, {
      title: '终端 1',
      terminalType: 'zsh',
      hideCompletionProbeEcho: true,
    });
    const protocolOutput: string[] = [];
    const terminalOutput: string[] = [];
    actor.onEvent((event) => {
      if (event.type === 'pty_output') protocolOutput.push(event.data);
      if (event.type === 'terminal_output') terminalOutput.push(event.data);
    });
    await actor.markPtyRunning();
    const pattern = { start: '[probe:', end: ':end]' };
    actor.suppressInputEcho(pattern);
    backend.emitData('old [probe:pending');
    await vi.waitFor(() => expect(terminalOutput.join('')).toBe('old '));

    actor.suppressInputEcho(pattern);
    backend.emitData('[probe:new:end] after');
    await vi.waitFor(() => expect(terminalOutput.join('')).toContain(' after'));

    expect(protocolOutput.join('')).toBe('old [probe:pending after');
    expect(terminalOutput.join('')).toBe('old [probe:pending after');
    actor.dispose();
  });

  it('resolves Probe release waiters when the Session is disposed', async () => {
    const backend = createFakeTerminalBackend();
    const actor = new SessionActor('s1', backend, {
      title: '终端 1',
      terminalType: 'zsh',
      hideCompletionProbeEcho: true,
    });
    await actor.markPtyRunning();
    const pattern = { start: '[probe:', end: ':end]' };
    actor.suppressInputEcho(pattern);
    backend.emitData('[probe:pending');
    const release = actor.releaseInputEcho(pattern, { graceMs: 100 });
    await Promise.resolve();
    await Promise.resolve();
    actor.dispose();

    await expect(release).resolves.toBeUndefined();
  });

  it('restores an unfinished environment Probe when the Probe times out', async () => {
    vi.useFakeTimers();
    try {
      const backend = createFakeTerminalBackend();
      const actor = new SessionActor('s1', backend, {
        title: '终端 1',
        terminalType: 'PowerShell',
        hideCompletionProbeEcho: true,
      });
      const protocolOutput: string[] = [];
      const terminalOutput: string[] = [];
      actor.onEvent((event) => {
        if (event.type === 'pty_output') protocolOutput.push(event.data);
        if (event.type === 'terminal_output') terminalOutput.push(event.data);
      });
      await actor.markPtyRunning();
      const probe = new ShellProbe(actor, {
        nonceFactory: () => 'probe-timeout-partial',
        timeoutMs: 10,
      });
      const resultPromise = probe.run({ environmentEpoch: 0 });
      await Promise.resolve();
      await Promise.resolve();
      expect(backend.writes.join('')).toContain('probe-timeout-partial');

      backend.emitData('before echo __SYNAPSE_DIALECT_probe-timeout-partial');
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(10);

      await expect(resultPromise).resolves.toMatchObject({
        mode: 'observation_only',
        reason: 'timeout',
      });
      expect(protocolOutput.join('')).toBe('before echo __SYNAPSE_DIALECT_probe-timeout-partial');
      expect(terminalOutput.join('')).toBe('before echo __SYNAPSE_DIALECT_probe-timeout-partial');
      probe.dispose();
      actor.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('forwards user input and resize to the backend', async () => {
    const backend = createFakeTerminalBackend();
    const actor = new SessionActor('s1', backend, {
      title: 't',
      terminalType: 'Zsh',
      columns: 80,
      rows: 24,
    });
    await actor.markPtyRunning();
    await actor.writeUser('ls\r');
    await actor.resize(120, 40);
    expect(backend.writes).toEqual(['ls\r']);
    expect(backend.resizes).toEqual([{ columns: 120, rows: 40 }]);
    expect(actor.snapshot).toMatchObject({ columns: 120, rows: 40 });
    actor.dispose();
  });

  it('rotates the execution context for user input but not for an external Probe', async () => {
    const backend = createFakeTerminalBackend();
    const actor = new SessionActor('s1', backend, { title: 't', terminalType: 'Zsh' });
    await actor.markPtyRunning();
    await actor.verifyEnvironment('posix', 'unix');

    const before = actor.snapshot.executionContextId;
    const epoch = actor.snapshot.environment.capabilityEpoch;
    await actor.writeProbe('echo probe\r');
    expect(actor.snapshot.executionContextId).toBe(before);

    await actor.writeUser('ls\r');
    expect(actor.snapshot.executionContextId).not.toBe(before);
    expect(actor.snapshot.environment.capabilityEpoch).toBe(epoch + 1);
    actor.dispose();
  });

  it('keeps the execution context stable while passive PTY output arrives', async () => {
    const backend = createFakeTerminalBackend();
    const actor = new SessionActor('s1', backend, { title: 't', terminalType: 'Zsh' });
    await actor.markPtyRunning();
    const before = actor.snapshot.executionContextId;

    backend.emitData('prompt> ');
    await vi.waitFor(() => expect(actor.snapshot.executionContextId).toBe(before));

    actor.dispose();
  });

  it('atomically validates execution context and environment before external write', async () => {
    const backend = createFakeTerminalBackend();
    const actor = new SessionActor('s1', backend, { title: 't', terminalType: 'Zsh' });
    await actor.markPtyRunning();
    await actor.verifyEnvironment('posix', 'unix');
    const snapshot = actor.snapshot;

    await expect(
      actor.writeExternal('printf ok\r', snapshot.environment.capabilityEpoch, 'stale-context'),
    ).resolves.toMatchObject({ ok: false, error: 'stale-execution-context' });
    expect(backend.writes).toEqual([]);

    await expect(
      actor.writeExternal(
        'printf ok\r',
        snapshot.environment.capabilityEpoch,
        snapshot.executionContextId,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(actor.snapshot.executionContextId).not.toBe(snapshot.executionContextId);
    expect(backend.writes).toEqual(['printf ok\r']);
    actor.dispose();
  });

  it('rejects user input after exit', async () => {
    const backend = createFakeTerminalBackend();
    const actor = new SessionActor('s1', backend, { title: 't', terminalType: 'Zsh' });
    await actor.markPtyRunning();
    backend.emitExit(0);
    await Promise.resolve();
    const result = await actor.writeUser('x');
    expect(result).toEqual({ ok: false, error: 'session-not-running' });
    expect(actor.snapshot.pty).toBe('exited');
    actor.dispose();
  });

  it('keeps a verified environment for external writes but invalidates it for user input', async () => {
    const backend = createFakeTerminalBackend();
    const actor = new SessionActor('s1', backend, { title: 't', terminalType: 'PowerShell' });
    await actor.markPtyRunning();
    await actor.verifyEnvironment('powershell', 'windows', '2026-08-31T00:00:00.000Z');
    const invalidations: number[] = [];
    actor.onEvent((event) => {
      if (event.type === 'environment_invalidated') invalidations.push(event.capabilityEpoch);
    });

    const epoch = actor.snapshot.environment.capabilityEpoch;
    const contextId = actor.snapshot.executionContextId;
    await expect(actor.writeExternal('Write-Output ok\r', epoch, contextId)).resolves.toEqual({
      ok: true,
    });
    expect(actor.snapshot.environment).toMatchObject({
      dialect: 'powershell',
      platform: 'windows',
      verificationStatus: 'verified',
      capabilityEpoch: epoch,
    });

    await expect(
      actor.writeExternal('stale\r', epoch - 1, actor.snapshot.executionContextId),
    ).resolves.toEqual({
      ok: false,
      error: 'stale-environment-epoch',
    });
    expect(backend.writes).toEqual(['Write-Output ok\r']);

    await expect(actor.writeUser('ssh host\r')).resolves.toEqual({ ok: true });
    expect(actor.snapshot.environment).toMatchObject({
      dialect: 'unknown',
      platform: 'unknown',
      verificationStatus: 'unverified',
      capabilityEpoch: epoch + 1,
    });
    expect(invalidations).toEqual([epoch + 1]);
    actor.dispose();
  });

  it('resolves waitForExit when the backend exits', async () => {
    const backend = createFakeTerminalBackend();
    const actor = new SessionActor('s1', backend, { title: 't', terminalType: 'Zsh' });
    const wait = actor.waitForExit(1_000);
    backend.emitExit(0);
    await expect(wait).resolves.toBeUndefined();
    actor.dispose();
  });

  it('does not write to the PTY after the SessionActor is disposed', async () => {
    const backend = createFakeTerminalBackend();
    const actor = new SessionActor('s1', backend, { title: 't', terminalType: 'Zsh' });
    await actor.markPtyRunning();
    await actor.verifyEnvironment('posix', 'unix');
    const snapshot = actor.snapshot;

    actor.dispose();

    await expect(actor.writeUser('user input\r')).resolves.toEqual({
      ok: false,
      error: 'session-not-running',
    });
    await expect(actor.writeProbe('probe\r')).resolves.toEqual({
      ok: false,
      error: 'session-not-running',
    });
    await expect(
      actor.writeExternal(
        'external\r',
        snapshot.environment.capabilityEpoch,
        snapshot.executionContextId,
      ),
    ).resolves.toEqual({ ok: false, error: 'session-not-running' });
    await actor.interrupt();

    expect(backend.writes).toEqual([]);
    expect(backend.interrupted).toBe(0);
  });
});
