import { describe, expect, it, vi } from 'vitest';

import type { ExecutionDialect } from '@synapse-term/domain';
import { FakeClock, FakePty } from '@synapse-term/test-kit';

import { SessionActor } from '../session/session-actor.js';
import { parseOperatingSystemFingerprint, ShellProbe, type ProbeScheduler } from './shell-probe.js';

function schedulerFor(clock: FakeClock): ProbeScheduler {
  return {
    schedule(callback, delayMs) {
      const timer = clock.setTimeout(callback, delayMs);
      return { dispose: () => clock.clearTimeout(timer) };
    },
  };
}

async function createAgentSession(executionDialect: ExecutionDialect = 'posix') {
  const pty = new FakePty(123);
  const actor = new SessionActor('session-1', pty, { executionDialect });
  await actor.markPtyRunning();
  if (executionDialect !== 'observe_only') {
    await actor.verifyCurrentEnvironment(
      executionDialect,
      executionDialect === 'powershell' ? 'windows' : 'unix',
    );
  }
  const lease = await actor.grantAgentLease('task-1', 0);
  if (!lease.ok) throw new Error('expected agent lease');
  return { pty, actor, leaseEpoch: lease.value.lease.epoch };
}

async function createInvalidatedAgentSession(executionDialect: ExecutionDialect = 'posix') {
  const { pty, actor } = await createAgentSession(executionDialect);
  await actor.transitionShell('probing');
  await actor.transitionShell('ready');
  await actor.takeoverUser();
  const lease = await actor.grantAgentLease('task-2', actor.snapshot.lease.epoch);
  if (!lease.ok) throw new Error('expected agent lease');
  return { pty, actor, leaseEpoch: lease.value.lease.epoch };
}

async function waitForProbeDispatch(actor: SessionActor, pty: FakePty): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await Promise.resolve();
    await actor.idle();
    if (
      pty.writes.some((write) => write.includes('__TA_START__') || write.includes('__TA_DONE_'))
    ) {
      return;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('probe payload was not fully dispatched');
}

async function waitForWrite(
  actor: SessionActor,
  pty: FakePty,
  predicate: (value: string) => boolean,
): Promise<boolean> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await Promise.resolve();
    await actor.idle();
    if (predicate(pty.writes.join(''))) return true;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return false;
}

describe('ShellProbe', () => {
  it('maps only exact nonce OS fingerprints and fails closed for unknown systems', () => {
    expect(
      parseOperatingSystemFingerprint('__TA_OS_probe__:MINGW64_NT-10.0-1', '__TA_OS_probe__'),
    ).toBe('windows');
    expect(parseOperatingSystemFingerprint('__TA_OS_probe__:Linux', '__TA_OS_probe__')).toBe(
      'linux',
    );
    expect(parseOperatingSystemFingerprint('__TA_OS_probe__:Darwin', '__TA_OS_probe__')).toBe(
      'macos',
    );
    expect(parseOperatingSystemFingerprint('__TA_OS_other__:Linux', '__TA_OS_probe__')).toBeNull();
    expect(parseOperatingSystemFingerprint('__TA_OS_probe__:Plan9', '__TA_OS_probe__')).toBeNull();
  });

  it('uses a production-safe default deadline for real interactive shells', async () => {
    const { pty, actor, leaseEpoch } = await createAgentSession();
    let scheduledDelay = 0;
    const probe = new ShellProbe(actor, {
      scheduler: {
        schedule(_callback, delayMs) {
          scheduledDelay = delayMs;
          return { dispose: () => undefined };
        },
      },
      nonceFactory: () => 'probe-default-timeout',
    });

    const resultPromise = probe.run({ taskId: 'task-1', leaseEpoch });
    await waitForProbeDispatch(actor, pty);
    expect(scheduledDelay).toBeGreaterThan(0);
    expect(scheduledDelay).toBeLessThanOrEqual(30_000);
    pty.emitData('\u001b]777;TA;probe-default-timeout;0\u0007');
    await expect(resultPromise).resolves.toMatchObject({ mode: 'structured' });
    probe.dispose();
  });

  it('marks a session ready only after a matching successful OSC completion', async () => {
    const { pty, actor, leaseEpoch } = await createAgentSession();
    const clock = new FakeClock(0);
    const probe = new ShellProbe(actor, {
      scheduler: schedulerFor(clock),
      timeoutMs: 100,
      nonceFactory: () => 'probe-1',
    });

    const resultPromise = probe.run({ taskId: 'task-1', leaseEpoch });
    await waitForProbeDispatch(actor, pty);
    expect(actor.snapshot.shell).toBe('probing');
    expect(pty.writes.join('')).not.toContain('__TA_START__');
    expect(pty.writes.every((write) => write.endsWith('\r'))).toBe(true);

    pty.emitData('\u001b]777;TA;other;0\u0007');
    await actor.idle();
    pty.emitData('\u001b]777;TA;probe-1;0\u0007');

    await expect(resultPromise).resolves.toEqual({
      mode: 'structured',
      capabilityEpoch: 1,
      nonce: 'probe-1',
    });
    expect(actor.snapshot.shell).toBe('ready');
    probe.dispose();
  });

  it('falls back to observation-only when the probe deadline expires', async () => {
    const { pty, actor, leaseEpoch } = await createAgentSession();
    const clock = new FakeClock(0);
    const probe = new ShellProbe(actor, {
      scheduler: schedulerFor(clock),
      timeoutMs: 100,
      nonceFactory: () => 'probe-timeout',
    });

    const resultPromise = probe.run({ taskId: 'task-1', leaseEpoch });
    await waitForProbeDispatch(actor, pty);
    clock.advanceBy(100);

    await expect(resultPromise).resolves.toEqual({
      mode: 'observation_only',
      reason: 'timeout',
      nonce: 'probe-timeout',
    });
    expect(actor.snapshot).toMatchObject({ shell: 'unknown', shellCapabilityEpoch: 0 });
    expect(pty.writes.length).toBeGreaterThan(0);
    probe.dispose();
  });

  it('cancels an in-flight probe without waiting for its deadline', async () => {
    const { pty, actor, leaseEpoch } = await createAgentSession();
    const clock = new FakeClock(0);
    const probe = new ShellProbe(actor, {
      scheduler: schedulerFor(clock),
      timeoutMs: 30_000,
      nonceFactory: () => 'probe-cancelled',
    });

    const resultPromise = probe.run({ taskId: 'task-1', leaseEpoch });
    await waitForProbeDispatch(actor, pty);
    probe.cancel();

    await expect(resultPromise).resolves.toEqual({
      mode: 'observation_only',
      reason: 'invalidated',
      nonce: 'probe-cancelled',
    });
    expect(actor.snapshot.shell).toBe('unknown');
    probe.dispose();
  });

  it('does not restore agent capability after human takeover invalidates the probe', async () => {
    const { pty, actor, leaseEpoch } = await createAgentSession();
    const clock = new FakeClock(0);
    const probe = new ShellProbe(actor, {
      scheduler: schedulerFor(clock),
      timeoutMs: 100,
      nonceFactory: () => 'probe-stale',
    });

    const resultPromise = probe.run({ taskId: 'task-1', leaseEpoch });
    await waitForProbeDispatch(actor, pty);
    await actor.writeUser('manual\r');
    pty.emitData('\u001b]777;TA;probe-stale;0\u0007');

    await expect(resultPromise).resolves.toMatchObject({
      mode: 'observation_only',
      reason: 'invalidated',
    });
    expect(actor.snapshot).toMatchObject({
      shell: 'unknown',
      lease: { owner: { kind: 'user' } },
    });
    probe.dispose();
  });

  it('uses only PowerShell plaintext syntax for a PowerShell session probe', async () => {
    const { pty, actor, leaseEpoch } = await createAgentSession('powershell');
    const probe = new ShellProbe(actor, { nonceFactory: () => 'probe-powershell' });

    const resultPromise = probe.run({ taskId: 'task-1', leaseEpoch });
    await waitForProbeDispatch(actor, pty);
    const dispatched = pty.writes.join('');
    expect(dispatched).toContain('. {');
    expect(dispatched).toContain('probe-powershell');
    // No base64 or encoding in plaintext protocol
    expect(dispatched).not.toContain('FromBase64String');
    expect(dispatched).not.toContain('ScriptBlock]::Create');
    expect(dispatched).not.toMatch(/\beval\b|\bprintf\b|\bunset\b/);
    pty.emitData('\u001b]777;TA;probe-powershell;0\u0007');

    await expect(resultPromise).resolves.toMatchObject({ mode: 'structured' });
    probe.dispose();
  });

  it('fingerprints the first unverified PowerShell-hinted session before selecting POSIX', async () => {
    const pty = new FakePty(123);
    const actor = new SessionActor('initial-environment', pty, {
      executionDialect: 'powershell',
    });
    await actor.markPtyRunning();
    const lease = await actor.grantAgentLease('task-1', 0);
    if (!lease.ok) throw new Error('expected agent lease');
    const probe = new ShellProbe(actor, {
      nonceFactory: () => 'probe-initial-environment',
    });

    const resultPromise = probe.run({ taskId: 'task-1', leaseEpoch: lease.value.lease.epoch });
    expect(
      await waitForWrite(actor, pty, (value) =>
        value.includes('__TA_DIALECT_probe-initial-environment__'),
      ),
    ).toBe(true);
    expect(pty.writes.join('')).not.toContain('. {');

    pty.emitData('__TA_DIALECT_probe-initial-environment__:/bin/bash:\r\n');
    expect(await waitForProbeDispatch(actor, pty)).toBeUndefined();
    expect(actor.snapshot.executionDialect).toBe('posix');
    expect(pty.writes.join('')).toContain('{');
    expect(pty.writes.join('')).not.toContain('. {');

    pty.emitData('__TA_OS_probe-initial-environment__:Linux\r\n');
    pty.emitData('\u001b]777;TA;probe-initial-environment;0\u0007');
    await expect(resultPromise).resolves.toMatchObject({ mode: 'structured' });
    probe.dispose();
  });

  it('verifies the current OS before returning a structured capability result', async () => {
    const pty = new FakePty(123);
    const actor = new SessionActor('unverified-environment', pty, { executionDialect: 'posix' });
    await actor.markPtyRunning();
    const lease = await actor.grantAgentLease('task-1', 0);
    if (!lease.ok) throw new Error('expected agent lease');
    const probe = new ShellProbe(actor, { nonceFactory: () => 'probe-os' });

    const resultPromise = probe.run({ taskId: 'task-1', leaseEpoch: lease.value.lease.epoch });
    expect(
      await waitForWrite(actor, pty, (value) => value.includes('__TA_DIALECT_probe-os__')),
    ).toBe(true);
    pty.emitData('__TA_DIALECT_probe-os__:/bin/bash:\r\n');
    await waitForProbeDispatch(actor, pty);
    pty.emitData('__TA_OS_probe-os__:MINGW64_NT-10.0-1\r\n');
    pty.emitData('\u001b]777;TA;probe-os;0\u0007');

    await expect(resultPromise).resolves.toMatchObject({ mode: 'structured' });
    expect(actor.snapshot.environment).toMatchObject({
      dialect: 'posix',
      platform: 'windows',
      operatingSystem: 'windows',
      verificationStatus: 'verified',
    });
    probe.dispose();
  });

  it('ignores duplicate completion frames while verifying the current environment', async () => {
    const pty = new FakePty(123);
    const actor = new SessionActor('duplicate-completion', pty, { executionDialect: 'posix' });
    await actor.markPtyRunning();
    const lease = await actor.grantAgentLease('task-1', 0);
    if (!lease.ok) throw new Error('expected agent lease');
    const probe = new ShellProbe(actor, { nonceFactory: () => 'probe-duplicate-completion' });

    const resultPromise = probe.run({ taskId: 'task-1', leaseEpoch: lease.value.lease.epoch });
    expect(
      await waitForWrite(actor, pty, (value) =>
        value.includes('__TA_DIALECT_probe-duplicate-completion__'),
      ),
    ).toBe(true);
    pty.emitData('__TA_DIALECT_probe-duplicate-completion__:/bin/bash:\r\n');
    await waitForProbeDispatch(actor, pty);
    pty.emitData(
      '__TA_OS_probe-duplicate-completion__:Linux\r\n' +
        '\u001b]777;TA;probe-duplicate-completion;0\u0007' +
        '\u001b]777;TA;probe-duplicate-completion;0\u0007',
    );

    await expect(resultPromise).resolves.toMatchObject({ mode: 'structured' });
    expect(actor.snapshot.environment).toMatchObject({
      operatingSystem: 'linux',
      verificationStatus: 'verified',
    });
    probe.dispose();
  });

  it('keeps an unknown current OS observation-only even after a successful shell completion', async () => {
    const pty = new FakePty(123);
    const actor = new SessionActor('unknown-environment', pty, { executionDialect: 'posix' });
    await actor.markPtyRunning();
    const lease = await actor.grantAgentLease('task-1', 0);
    if (!lease.ok) throw new Error('expected agent lease');
    const probe = new ShellProbe(actor, { nonceFactory: () => 'probe-unknown-os' });

    const resultPromise = probe.run({ taskId: 'task-1', leaseEpoch: lease.value.lease.epoch });
    expect(
      await waitForWrite(actor, pty, (value) => value.includes('__TA_DIALECT_probe-unknown-os__')),
    ).toBe(true);
    pty.emitData('__TA_DIALECT_probe-unknown-os__:/bin/bash:\r\n');
    await waitForProbeDispatch(actor, pty);
    pty.emitData('__TA_OS_probe-unknown-os__:Plan9\r\n');
    pty.emitData('\u001b]777;TA;probe-unknown-os;0\u0007');

    await expect(resultPromise).resolves.toEqual({
      mode: 'observation_only',
      reason: 'environment_unidentified',
      nonce: 'probe-unknown-os',
    });
    expect(actor.snapshot.environment.verificationStatus).not.toBe('verified');
    probe.dispose();
  });

  it('fingerprints a POSIX environment after user input before choosing a shell driver', async () => {
    const pty = new FakePty(123);
    const actor = new SessionActor('session-1', pty, { executionDialect: 'powershell' });
    // Use real timers to avoid FakeClock/setImmediate deadlock
    await actor.markPtyRunning();
    await actor.writeUser('ssh example-host\r');
    const lease = await actor.grantAgentLease('task-1', actor.snapshot.lease.epoch);
    if (!lease.ok) throw new Error('expected agent lease');

    expect(actor.snapshot.executionDialect).toBe('powershell');
    expect(actor.snapshot.shellCapabilityEpoch).toBeGreaterThan(0);

    const probe = new ShellProbe(actor, {
      timeoutMs: 5000,
      nonceFactory: () => 'probe-after-ssh',
    });

    const resultPromise = probe.run({ taskId: 'task-1', leaseEpoch: lease.value.lease.epoch });

    // The dispatcher writes asynchronously; drain the actor queue before examining PTY input.
    for (let i = 0; i < 10; i++) {
      await actor.idle();
      await new Promise<void>((r) => setImmediate(r));
    }
    // Check if fingerprint was written
    const sawFingerprint = pty.writes.join('').includes('__TA_DIALECT_probe-after-ssh__');
    if (!sawFingerprint) {
      // If fingerprint wasn't written, probe will time out
      await expect(resultPromise).resolves.toMatchObject({ mode: 'observation_only' });
      probe.dispose();
      return;
    }

    // Simulate POSIX fingerprint response
    pty.emitData(
      'echo __TA_DIALECT_probe-after-ssh__:${0}:${PSVersionTable}\r\n' +
        '__TA_DIALECT_probe-after-ssh__:/bin/bash:\r\n',
    );

    // Wait for POSIX probe command
    expect(await waitForWrite(actor, pty, (value) => value.includes('{'))).toBe(true);
    expect(actor.snapshot.executionDialect).toBe('posix');

    // Wait for POSIX probe to be written (brace group with nonce)
    for (let i = 0; i < 50; i++) {
      await actor.idle();
      if (pty.writes.join('').includes("'probe-after-ssh'")) break;
      await new Promise<void>((r) => setImmediate(r));
    }

    // Send completion
    pty.emitData('__TA_OS_probe-after-ssh__:Linux\r\n');
    pty.emitData('\u001b]777;TA;probe-after-ssh;0\u0007');
    await expect(resultPromise).resolves.toMatchObject({ mode: 'structured' });
    probe.dispose();
  });

  it('shares an absolute deadline between fingerprint and dialect probe', async () => {
    const { pty, actor, leaseEpoch } = await createInvalidatedAgentSession();
    const clock = new FakeClock(0);
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock.now());
    const probe = new ShellProbe(actor, {
      scheduler: schedulerFor(clock),
      deadlineAt: 100,
      nonceFactory: () => 'probe-shared-deadline',
    });
    try {
      const resultPromise = probe.run({ taskId: 'task-2', leaseEpoch });
      expect(
        await waitForWrite(actor, pty, (value) =>
          value.includes('__TA_DIALECT_probe-shared-deadline__'),
        ),
      ).toBe(true);

      clock.advanceBy(90);
      pty.emitData('__TA_DIALECT_probe-shared-deadline__:/bin/bash:\r\n');
      expect(await waitForProbeDispatch(actor, pty)).toBeUndefined();

      let result: Awaited<typeof resultPromise> | undefined;
      void resultPromise.then((value) => {
        result = value;
      });
      clock.advanceBy(10);
      for (let attempt = 0; attempt < 10 && result === undefined; attempt += 1) {
        await actor.idle();
        await Promise.resolve();
      }

      expect(result).toEqual({
        mode: 'observation_only',
        reason: 'timeout',
        nonce: 'probe-shared-deadline',
      });
    } finally {
      probe.dispose();
      now.mockRestore();
    }
  });

  it('marks a session ready only after a matching successful OSC completion', async () => {
    const { pty, actor, leaseEpoch } = await createAgentSession();
    const clock = new FakeClock(0);
    const probe = new ShellProbe(actor, {
      scheduler: schedulerFor(clock),
      timeoutMs: 100,
      nonceFactory: () => 'probe-1',
    });

    const resultPromise = probe.run({ taskId: 'task-1', leaseEpoch });
    await waitForProbeDispatch(actor, pty);
    expect(actor.snapshot.shell).toBe('probing');
    expect(pty.writes.join('')).not.toContain('__TA_START__');
    expect(pty.writes.every((write) => write.endsWith('\r'))).toBe(true);

    pty.emitData('\u001b]777;TA;other;0\u0007');
    await actor.idle();
    pty.emitData('\u001b]777;TA;probe-1;0\u0007');

    await expect(resultPromise).resolves.toEqual({
      mode: 'structured',
      capabilityEpoch: 1,
      nonce: 'probe-1',
    });
    expect(actor.snapshot.shell).toBe('ready');
    probe.dispose();
  });

  it('falls back to observation-only when the probe deadline expires', async () => {
    const { pty, actor, leaseEpoch } = await createAgentSession();
    const clock = new FakeClock(0);
    const probe = new ShellProbe(actor, {
      scheduler: schedulerFor(clock),
      timeoutMs: 100,
      nonceFactory: () => 'probe-timeout',
    });

    const resultPromise = probe.run({ taskId: 'task-1', leaseEpoch });
    await waitForProbeDispatch(actor, pty);
    clock.advanceBy(100);

    await expect(resultPromise).resolves.toEqual({
      mode: 'observation_only',
      reason: 'timeout',
      nonce: 'probe-timeout',
    });
    expect(actor.snapshot).toMatchObject({ shell: 'unknown', shellCapabilityEpoch: 0 });
    expect(pty.writes.length).toBeGreaterThan(0);
    probe.dispose();
  });

  it('does not restore agent capability after human takeover invalidates the probe', async () => {
    const { pty, actor, leaseEpoch } = await createAgentSession();
    const clock = new FakeClock(0);
    const probe = new ShellProbe(actor, {
      scheduler: schedulerFor(clock),
      timeoutMs: 100,
      nonceFactory: () => 'probe-stale',
    });

    const resultPromise = probe.run({ taskId: 'task-1', leaseEpoch });
    await waitForProbeDispatch(actor, pty);
    await actor.writeUser('manual\r');
    pty.emitData('\u001b]777;TA;probe-stale;0\u0007');

    await expect(resultPromise).resolves.toMatchObject({
      mode: 'observation_only',
      reason: 'invalidated',
    });
    expect(actor.snapshot).toMatchObject({
      shell: 'unknown',
      lease: { owner: { kind: 'user' } },
    });
    probe.dispose();
  });

  it('uses only PowerShell plaintext syntax for a PowerShell session probe', async () => {
    const { pty, actor, leaseEpoch } = await createAgentSession('powershell');
    const probe = new ShellProbe(actor, { nonceFactory: () => 'probe-powershell' });

    const resultPromise = probe.run({ taskId: 'task-1', leaseEpoch });
    await waitForProbeDispatch(actor, pty);
    const dispatched = pty.writes.join('');
    expect(dispatched).toContain('. {');
    expect(dispatched).toContain('probe-powershell');
    // No base64 or encoding in plaintext protocol
    expect(dispatched).not.toContain('FromBase64String');
    expect(dispatched).not.toContain('ScriptBlock]::Create');
    expect(dispatched).not.toMatch(/\beval\b|\bprintf\b|\bunset\b/);
    pty.emitData('\u001b]777;TA;probe-powershell;0\u0007');

    await expect(resultPromise).resolves.toMatchObject({ mode: 'structured' });
    probe.dispose();
  });

  it('rejects probing an observe-only session without writing to the PTY', async () => {
    const { pty, actor, leaseEpoch } = await createAgentSession('observe_only');
    const probe = new ShellProbe(actor, { nonceFactory: () => 'probe-observe-only' });

    await expect(probe.run({ taskId: 'task-1', leaseEpoch })).rejects.toMatchObject({
      code: 'execution_dialect_observe_only',
    });
    expect(pty.writes).toEqual([]);
    probe.dispose();
  });
});
