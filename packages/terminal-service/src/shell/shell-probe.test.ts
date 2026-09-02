import { describe, expect, it, vi } from 'vitest';

import { createFakeTerminalBackend } from '@synapse-term/test-kit';

import { ShellProbe } from './shell-probe.js';
import { SessionActor } from '../session/session-actor.js';

async function createActor(terminalType: string) {
  const backend = createFakeTerminalBackend();
  const actor = new SessionActor('session-1', backend, { title: 'test', terminalType });
  await actor.markPtyRunning();
  return { actor, backend };
}

async function flushActorQueue(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('ShellProbe', () => {
  it('detects the current POSIX PTY after a PowerShell launch hint', async () => {
    const { actor, backend } = await createActor('PowerShell');
    const probe = new ShellProbe(actor, { nonceFactory: () => 'probe-posix', timeoutMs: 100 });

    const resultPromise = probe.run({ environmentEpoch: 0 });
    await vi.waitFor(() =>
      expect(backend.writes.join('')).toContain('echo __SYNAPSE_DIALECT_probe-posix__:$?\r'),
    );
    backend.emitData(
      'echo __SYNAPSE_DIALECT_probe-posix__:$?\r\n__SYNAPSE_DIALECT_probe-posix__:0\r\n',
    );

    await expect(resultPromise).resolves.toMatchObject({
      mode: 'structured',
      dialect: 'posix',
      platform: 'unix',
      capabilityEpoch: 1,
    });
    expect(actor.snapshot.environment).toMatchObject({
      dialect: 'posix',
      verificationStatus: 'verified',
    });
    probe.dispose();
    actor.dispose();
  });

  it('detects PowerShell after a POSIX launch hint', async () => {
    const { actor, backend } = await createActor('Git Bash');
    const probe = new ShellProbe(actor, { nonceFactory: () => 'probe-powershell' });

    const resultPromise = probe.run({ environmentEpoch: 0 });
    await vi.waitFor(() => expect(backend.writes.join('')).toContain('probe-powershell'));
    backend.emitData(
      'echo __SYNAPSE_DIALECT_probe-powershell__:$?\r\n__SYNAPSE_DIALECT_probe-powershell__:True\r\n',
    );

    await expect(resultPromise).resolves.toMatchObject({
      mode: 'structured',
      dialect: 'powershell',
      platform: 'windows',
    });
    probe.dispose();
    actor.dispose();
  });

  it('fails closed on timeout and does not send a user command', async () => {
    vi.useFakeTimers();
    try {
      const { actor, backend } = await createActor('PowerShell');
      const probe = new ShellProbe(actor, { nonceFactory: () => 'probe-timeout', timeoutMs: 20 });
      const resultPromise = probe.run({ environmentEpoch: 0 });
      await vi.waitFor(() => expect(backend.writes.join('')).toContain('probe-timeout'));
      await vi.advanceTimersByTimeAsync(20);

      await expect(resultPromise).resolves.toMatchObject({
        mode: 'observation_only',
        reason: 'timeout',
      });
      expect(backend.writes).toHaveLength(1);
      expect(actor.snapshot.environment.verificationStatus).toBe('unverified');
      probe.dispose();
      actor.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('invalidates a pending probe when the user takes over the PTY', async () => {
    const { actor, backend } = await createActor('PowerShell');
    const probe = new ShellProbe(actor, { nonceFactory: () => 'probe-stale', timeoutMs: 100 });
    const resultPromise = probe.run({ environmentEpoch: 0 });
    await vi.waitFor(() => expect(backend.writes.join('')).toContain('probe-stale'));

    await actor.writeUser('ssh host\r');
    backend.emitData(
      'echo __SYNAPSE_DIALECT_probe-stale__:$?\r\n__SYNAPSE_DIALECT_probe-stale__:0\r\n',
    );

    await expect(resultPromise).resolves.toMatchObject({
      mode: 'observation_only',
      reason: 'invalidated',
    });
    expect(backend.writes).toEqual(['echo __SYNAPSE_DIALECT_probe-stale__:$?\r', 'ssh host\r']);
    expect(actor.snapshot.environment.verificationStatus).toBe('unverified');
    probe.dispose();
    actor.dispose();
  });

  it('does not resurrect a verified environment after queued user input invalidates the Probe', async () => {
    const { actor, backend } = await createActor('PowerShell');
    const probe = new ShellProbe(actor, {
      nonceFactory: () => 'probe-queued-user',
      timeoutMs: 100,
    });
    const resultPromise = probe.run({ environmentEpoch: 0 });
    await vi.waitFor(() => expect(backend.writes.join('')).toContain('probe-queued-user'));

    backend.emitData(
      'echo __SYNAPSE_DIALECT_probe-queued-user__:$?\r\n' +
        '__SYNAPSE_DIALECT_probe-queued-user__:0\r\n',
    );
    const userWrite = actor.writeUser('ssh host\r');

    await expect(resultPromise).resolves.toMatchObject({
      mode: 'observation_only',
      reason: 'invalidated',
    });
    await userWrite;
    await flushActorQueue();
    expect(actor.snapshot.environment.verificationStatus).toBe('unverified');
    probe.dispose();
    actor.dispose();
  });

  it('does not reuse a verified environment for a stale capability epoch', async () => {
    const { actor, backend } = await createActor('PowerShell');
    await actor.verifyEnvironment('powershell', 'windows');
    const probe = new ShellProbe(actor, { nonceFactory: () => 'probe-old-epoch' });

    await expect(probe.run({ environmentEpoch: 0 })).resolves.toEqual({
      mode: 'observation_only',
      reason: 'invalidated',
    });
    expect(backend.writes).toEqual([]);
    probe.dispose();
    actor.dispose();
  });

  it('does not write a Probe after the PTY has exited', async () => {
    const { actor, backend } = await createActor('PowerShell');
    backend.emitExit(0);
    await Promise.resolve();
    await Promise.resolve();
    const probe = new ShellProbe(actor, { nonceFactory: () => 'probe-after-exit' });

    await expect(probe.run({ environmentEpoch: 0 })).resolves.toEqual({
      mode: 'observation_only',
      reason: 'pty_exit',
    });
    expect(backend.writes).toEqual([]);
    probe.dispose();
    actor.dispose();
  });
});
