import process from 'node:process';

import { describe, expect, it } from 'vitest';

import { PosixShellDriver, ShellDriverError } from './shell/shell-driver.js';
import { NodePtySpawner } from './shell/pty-adapter.js';
import { SessionActor } from './session/session-actor.js';
import { ShellProbe } from './shell/shell-probe.js';
import { CommandExecutor } from './execution/command-executor.js';
import { PlaintextShellDispatcher } from './execution/plaintext-dispatcher.js';
import { ShellLocator } from './shell/shell-locator.js';

const bashExecutable =
  process.env.TERMINAL_AGENT_BASH ??
  new ShellLocator().list().find((shell) => shell.kind === 'bash' && shell.available)?.executable ??
  '/bin/bash';

function createPtyEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

interface TestSession {
  pty: ReturnType<NodePtySpawner['spawn']>;
  actor: SessionActor;
  executor: CommandExecutor;
  leaseEpoch: number;
  ptyInputs: string[];
  dispose: () => void;
}

async function createTestSession(): Promise<TestSession> {
  const pty = new NodePtySpawner().spawn({
    executable: bashExecutable,
    args: ['--noprofile', '--norc', '-i'],
    cwd: process.cwd(),
    env: { ...createPtyEnv(), TERM: 'xterm-256color', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' },
    columns: 120,
    rows: 40,
  });
  const actor = new SessionActor('e2e-session', pty, {
    columns: 120,
    rows: 40,
    executionDialect: 'posix',
  });
  const ptyInputs: string[] = [];
  const origWrite = pty.write.bind(pty);
  pty.write = (data: string) => {
    ptyInputs.push(data);
    origWrite(data);
  };

  await actor.markPtyRunning();
  const lease = await actor.grantAgentLease('e2e-task', 0);
  if (!lease.ok) throw new Error('expected agent lease');
  const leaseEpoch = lease.value.lease.epoch;

  // Probe once to verify environment
  const probe = new ShellProbe(actor, { timeoutMs: 15_000 });
  const probeResult = await probe.run({ taskId: 'e2e-task', leaseEpoch });
  probe.dispose();
  if (probeResult.mode !== 'structured') {
    throw new Error(`probe failed: ${JSON.stringify(probeResult)}`);
  }

  const executor = new CommandExecutor(actor, {
    observationWindowMs: 1_000,
    hardDeadlineMs: 15_000,
    nonceFactory: () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  });

  const dispose = async () => {
    executor.onEvent(() => {});
    actor.dispose();
    pty.terminate();
    // Allow PTY cleanup to complete before next test
    await new Promise((r) => setTimeout(r, 100));
  };

  return { pty, actor, executor, leaseEpoch, ptyInputs, dispose };
}

async function runCommand(session: TestSession, command: string) {
  const { executor, leaseEpoch } = session;
  const initial = await executor.execute({
    taskId: 'e2e-task',
    leaseEpoch,
    command,
    risk: 'read_only',
    observationWindowMs: 10_000,
  });
  const completed =
    initial.status === 'running'
      ? await executor.wait({ transactionId: initial.transaction.id, timeoutMs: 15_000 })
      : initial;
  return completed;
}

/**
 * End-to-end tests: plaintext protocol with real Bash PTY.
 */
describe('Plaintext protocol E2E with real Bash', () => {
  it('writes plaintext brace group with visible command, no base64/eval', async () => {
    const session = await createTestSession();
    try {
      const completed = await runCommand(session, "printf 'hello-plaintext'");
      expect(completed.status).toBe('completed');
      expect(completed.transaction.exitCode).toBe(0);

      const allInput = session.ptyInputs.join('');
      expect(allInput).not.toContain('base64');
      expect(allInput).not.toContain('eval');
      expect(allInput).not.toContain('__ta_b64');
      expect(allInput).toContain("printf 'hello-plaintext'");
      expect(allInput).toContain('{');
      expect(allInput).toContain('}');
    } finally {
      await session.dispose();
    }
  }, 40_000);

  it('captures non-zero exit codes', async () => {
    const session = await createTestSession();
    try {
      const completed = await runCommand(session, 'false');
      expect(completed.status).toBe('completed');
      expect(completed.transaction.exitCode).toBe(1);
    } finally {
      await session.dispose();
    }
  }, 40_000);

  it('handles Unicode output', async () => {
    const session = await createTestSession();
    try {
      const completed = await runCommand(session, "printf '中文emoji\\U0001f642\\n'");
      expect(completed.status).toBe('completed');
      expect(completed.transaction.exitCode).toBe(0);
      expect(completed.output.text).toContain('中文');
    } finally {
      await session.dispose();
    }
  }, 40_000);

  it.skip('preserves working directory across sequential commands', async () => {
    const session = await createTestSession();
    try {
      const r1 = await runCommand(session, 'cd /tmp');
      expect(r1.status).toBe('completed');

      const r2 = await runCommand(session, 'printf "%s" "$PWD"');
      expect(r2.status).toBe('completed');
      expect(r2.output.text).toContain('/tmp');
    } finally {
      await session.dispose();
    }
  }, 60_000);

  it.skip('preserves exported variables across commands', async () => {
    const session = await createTestSession();
    try {
      const r1 = await runCommand(session, 'export __E2E_VAR=kept-value');
      expect(r1.status).toBe('completed');

      const r2 = await runCommand(session, 'printf "%s" "$__E2E_VAR"');
      expect(r2.status).toBe('completed');
      expect(r2.output.text).toContain('kept-value');
    } finally {
      await session.dispose();
    }
  }, 60_000);

  it('rejects commands with disallowed control characters', () => {
    const driver = new PosixShellDriver();
    expect(() => driver.wrapCommand('echo \x00', 'nonce')).toThrow(ShellDriverError);
    expect(() => driver.wrapCommand('echo \x00', 'nonce')).toThrow(
      expect.objectContaining({ code: 'command_not_auditable' }),
    );
  });

  it('rejects commands containing transaction boundary markers', () => {
    const driver = new PosixShellDriver();
    expect(() => driver.wrapCommand('echo __TA_START__', 'nonce')).toThrow(
      expect.objectContaining({ code: 'command_not_auditable' }),
    );
    expect(() => driver.wrapCommand('echo __TA_DONE_fake;0__', 'nonce')).toThrow(
      expect.objectContaining({ code: 'command_not_auditable' }),
    );
  });
});

describe('PlaintextShellDispatcher E2E', () => {
  it('rejects dispatch when environment is unverified', async () => {
    const pty = new NodePtySpawner().spawn({
      executable: bashExecutable,
      args: ['--noprofile', '--norc', '-i'],
      cwd: process.cwd(),
      env: { ...createPtyEnv(), TERM: 'xterm-256color' },
      columns: 80,
      rows: 24,
    });
    const actor = new SessionActor('dispatcher-unverified', pty, {
      executionDialect: 'posix',
    });
    try {
      await actor.markPtyRunning();
      const lease = await actor.grantAgentLease('task-1', 0);
      if (!lease.ok) throw new Error('expected lease');

      const dispatcher = new PlaintextShellDispatcher(actor);
      const result = dispatcher.prepare({
        sessionId: 'dispatcher-unverified',
        taskId: 'task-1',
        leaseEpoch: lease.value.lease.epoch,
        command: 'echo test',
        nonce: 'nonce-1',
        dialect: 'posix',
        platform: 'unix',
        environmentEpoch: actor.snapshot.environment.capabilityEpoch,
        sourceKind: 'plaintext_shell',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorCode).toBe('execution_environment_unverified');
      }
    } finally {
      actor.dispose();
      pty.terminate();
      await new Promise((r) => setTimeout(r, 50));
    }
  }, 10_000);

  it('allows dispatch after probe verifies environment', async () => {
    const pty = new NodePtySpawner().spawn({
      executable: bashExecutable,
      args: ['--noprofile', '--norc', '-i'],
      cwd: process.cwd(),
      env: { ...createPtyEnv(), TERM: 'xterm-256color' },
      columns: 80,
      rows: 24,
    });
    const actor = new SessionActor('dispatcher-verified', pty, {
      executionDialect: 'posix',
    });
    try {
      await actor.markPtyRunning();
      const lease = await actor.grantAgentLease('task-1', 0);
      if (!lease.ok) throw new Error('expected lease');

      const probe = new ShellProbe(actor, { timeoutMs: 10_000 });
      const probeResult = await probe.run({
        taskId: 'task-1',
        leaseEpoch: lease.value.lease.epoch,
      });
      probe.dispose();
      expect(probeResult.mode).toBe('structured');

      const dispatcher = new PlaintextShellDispatcher(actor);
      const env = actor.snapshot.environment;
      const result = dispatcher.prepare({
        sessionId: 'dispatcher-verified',
        taskId: 'task-1',
        leaseEpoch: lease.value.lease.epoch,
        command: 'echo dispatcher-ok',
        nonce: 'nonce-2',
        dialect: env.dialect as 'posix',
        platform: env.platform,
        environmentEpoch: env.capabilityEpoch,
        sourceKind: 'plaintext_shell',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.transportMode).toBe('plaintext');
        expect(result.wrappedCommand).toContain('echo dispatcher-ok');
        expect(result.wrappedCommand).not.toContain('base64');
        expect(result.wrappedCommand).not.toContain('eval');
      }
    } finally {
      actor.dispose();
      pty.terminate();
      await new Promise((r) => setTimeout(r, 50));
    }
  }, 30_000);
});
