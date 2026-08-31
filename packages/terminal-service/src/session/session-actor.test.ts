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
    await expect(actor.writeExternal('Write-Output ok\r', epoch)).resolves.toEqual({ ok: true });
    expect(actor.snapshot.environment).toMatchObject({
      dialect: 'powershell',
      platform: 'windows',
      verificationStatus: 'verified',
      capabilityEpoch: epoch,
    });

    await expect(actor.writeExternal('stale\r', epoch - 1)).resolves.toEqual({
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
});
