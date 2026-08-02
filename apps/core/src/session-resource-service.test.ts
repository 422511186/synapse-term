import { Buffer } from 'node:buffer';
import process from 'node:process';

import { describe, expect, it, vi } from 'vitest';

import { FakePty } from '@terminal-agent/test-kit';

import { NodePtySpawner } from './pty-adapter.js';
import { SessionActor } from './session-actor.js';
import { RESOURCE_PROTOCOL_PREFIX } from './session-resource-parser.js';
import {
  SessionResourceService,
  TerminalSessionResourceCollector,
  type SessionResourceAuditEvent,
} from './session-resource-service.js';

describe('SessionResourceService', () => {
  it('rejects missing, busy, interactive, and observe-only Sessions without collecting', async () => {
    let calls = 0;
    const service = new SessionResourceService({
      sessions: { get: () => undefined },
      collector: {
        collect: async () => {
          calls += 1;
          return '';
        },
      },
    });
    await expect(service.refresh('missing')).resolves.toMatchObject({
      ok: false,
      error: { code: 'session_not_found', message: '终端会话不存在。' },
    });

    const actor = await readyActor('observe_only');
    const guarded = new SessionResourceService({
      sessions: { get: () => actor },
      isSessionBusy: () => true,
      collector: {
        collect: async () => {
          calls += 1;
          return '';
        },
      },
    });
    await expect(guarded.refresh('session-1')).resolves.toMatchObject({
      ok: false,
      error: { code: 'lease_unavailable', message: '终端会话正忙，暂时无法刷新资源。' },
    });
    expect(calls).toBe(0);

    const unsupported = new SessionResourceService({
      sessions: { get: () => actor },
      collector: {
        collect: async () => {
          calls += 1;
          return '';
        },
      },
    });
    await expect(unsupported.refresh('session-1')).resolves.toMatchObject({
      ok: false,
      error: { code: 'execution_dialect_unsupported' },
    });
    expect(calls).toBe(0);
  });

  it('parses, caches, and audits a successful explicit refresh', async () => {
    const actor = await readyActor('posix');
    const audit: SessionResourceAuditEvent[] = [];
    const service = new SessionResourceService({
      sessions: { get: () => actor },
      collector: {
        collect: async (_actor, dialect, commands) => {
          expect(dialect).toBe('posix');
          expect(commands.join('\n')).not.toMatch(/\b(?:rm|mv|cp|chmod|chown|shutdown|reboot)\b/);
          return [
            line('host', text('example-host')),
            line('os', text('Linux'), text('6.8'), text('x86_64')),
            line('uptime', '100'),
            line('cpu', '4', '12.5', '0.1', '0.2', '0.3'),
            line('memory', '1000', '400', '600'),
            line('swap', '0', '0', '0'),
            line('disk', text('/dev/sda1'), text('/'), '1000', '500', '500', '50'),
            line('network', text('eth0'), '10', '20'),
          ].join('\n');
        },
      },
      now: () => '2026-07-28T00:00:00.000Z',
      audit: (event) => audit.push(event),
    });

    const result = await service.refresh('session-1');
    expect(result).toMatchObject({
      ok: true,
      snapshot: {
        status: 'complete',
        host: { status: 'available', value: { name: 'example-host' } },
      },
    });
    expect(service.get('session-1')).toEqual(result.ok ? result.snapshot : undefined);
    expect(audit).toContainEqual(
      expect.objectContaining({
        type: 'session.resources_refreshed',
        sessionId: 'session-1',
        dialect: 'posix',
        status: 'complete',
        startedAt: '2026-07-28T00:00:00.000Z',
        completedAt: '2026-07-28T00:00:00.000Z',
        collectedFields: ['host', 'os', 'uptime', 'cpu', 'memory', 'swap', 'disks', 'network'],
        readOnlyPolicy: 'fixed_command',
      }),
    );
  });

  it('collects resource metrics through short sequential commands instead of one giant script', async () => {
    const actor = await readyActor('posix');
    const batches: Array<readonly string[]> = [];
    const outputs = [
      line('host', text('example-host')),
      line('os', text('Linux'), text('6.8'), text('x86_64')),
      line('uptime', '100'),
      line('cpu', '4', '12.5', '0.1', '0.2', '0.3'),
      [line('memory', '1000', '400', '600'), line('swap', '0', '0', '0')].join('\n'),
      line('disk', text('/dev/sda1'), text('/'), '1000', '500', '500', '50'),
      line('network', text('eth0'), '10', '20'),
    ];
    const service = new SessionResourceService({
      sessions: { get: () => actor },
      collector: {
        collect: async (_actor, _dialect, commands) => {
          if (Array.isArray(commands)) batches.push(commands);
          return outputs.join('\n');
        },
      },
    });

    await expect(service.refresh('session-1')).resolves.toMatchObject({
      ok: true,
      snapshot: { status: 'complete' },
    });
    expect(batches).toHaveLength(1);
    const commands = batches[0] ?? [];
    expect(commands).toHaveLength(8);
    expect(commands.every((command) => !/[\r\n]/.test(command))).toBe(true);
    expect(commands.every((command) => command.length <= 2_048)).toBe(true);
  });

  it('keeps terminal collection bounded and returns the Session lease after timeout', async () => {
    const actor = await readyActor('posix');
    const collector = new TerminalSessionResourceCollector({ timeoutMs: 20 });

    await expect(collector.collect(actor, 'posix', [':'])).rejects.toMatchObject({
      code: 'collection_timeout',
    });
    expect(actor.snapshot.lease.owner).toEqual({ kind: 'user' });
  });

  it('does not dispatch a resource command after probing exhausts the shared deadline', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(0));
      const pty = new FakePty(1);
      const actor = new SessionActor('session-1', pty, { executionDialect: 'posix' });
      await actor.markPtyRunning();
      await actor.verifyCurrentEnvironment('posix', 'unix');
      const collector = new TerminalSessionResourceCollector({ timeoutMs: 100 });
      const collection = collector.collect(actor, 'posix', ['printf resource-command']);
      const outcome = collection.then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );

      const nonce = await waitForProbeNonce(actor, pty);
      vi.setSystemTime(new Date(100));
      pty.emitData(`\u001b]777;TA;${nonce};0\u0007`);

      await vi.advanceTimersByTimeAsync(1_000);
      await expect(outcome).resolves.toMatchObject({
        ok: false,
        error: { code: 'collection_timeout' },
      });
      expect(pty.writes.join('')).not.toContain('resource-command');
      expect(actor.snapshot.lease.owner).toEqual({ kind: 'user' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns collection timeout without dispatching resources when a two-stage probe exhausts the deadline', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(0));
      const pty = new FakePty(1);
      const actor = new SessionActor('session-1', pty, { executionDialect: 'posix' });
      await actor.markPtyRunning();
      await actor.transitionShell('probing');
      await actor.transitionShell('ready');
      await actor.takeoverUser();
      const collector = new TerminalSessionResourceCollector({ timeoutMs: 100 });
      const collection = collector.collect(actor, 'posix', ['printf resource-command']);
      let outcome: { ok: true } | { ok: false; error: unknown } | undefined;
      void collection.then(
        () => {
          outcome = { ok: true };
        },
        (error: unknown) => {
          outcome = { ok: false, error };
        },
      );

      const fingerprint = await waitForFingerprint(actor, pty);
      await vi.advanceTimersByTimeAsync(90);
      pty.emitData(`${fingerprint}:/bin/bash:\r\n`);
      expect(await waitForPtyWrite(actor, pty, (value) => value.includes('__TA_DONE_'))).toBe(true);

      await vi.advanceTimersByTimeAsync(10);
      for (let attempt = 0; attempt < 10 && outcome === undefined; attempt += 1) {
        await actor.idle();
        await vi.advanceTimersByTimeAsync(0);
      }

      expect(outcome).toMatchObject({
        ok: false,
        error: { code: 'collection_timeout' },
      });
      expect(pty.writes.join('')).not.toContain('resource-command');
      expect(actor.snapshot.lease.owner).toEqual({ kind: 'user' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-probes an unknown operating system before dispatching resource commands', async () => {
    const pty = new FakePty(1);
    const actor = new SessionActor('session-1', pty, { executionDialect: 'posix' });
    await actor.markPtyRunning();
    await actor.transitionShell('probing');
    await actor.transitionShell('ready');
    expect(actor.snapshot.environment).toMatchObject({
      verificationStatus: 'verified',
      operatingSystem: 'unknown',
    });

    const collector = new TerminalSessionResourceCollector({ timeoutMs: 1_000 });
    const collection = collector.collect(actor, 'posix', ['printf resource-command']);

    expect(await waitForPtyWriteAsync(actor, pty, (value) => value.includes('__TA_DIALECT_'))).toBe(
      true,
    );
    expect(pty.writes.join('')).not.toContain('resource-command');

    const nonce = pty.writes.join('').match(/__TA_DIALECT_([0-9a-f-]{36})__/)?.[1];
    expect(nonce).toBeDefined();
    pty.emitData(`__TA_DIALECT_${nonce}__:/bin/bash:\r\n`);
    expect(await waitForPtyWriteAsync(actor, pty, (value) => value.includes('__TA_OS_'))).toBe(
      true,
    );
    pty.emitData(`__TA_OS_${nonce}__:Linux\r\n`);
    pty.emitData(`\u001b]777;TA;${nonce};0\u0007`);

    expect(
      await waitForPtyWriteAsync(actor, pty, (value) => value.includes('resource-command')),
    ).toBe(true);
    expect(actor.snapshot.environment).toMatchObject({
      platform: 'unix',
      operatingSystem: 'linux',
      verificationStatus: 'verified',
    });

    const transactionNonce = [...pty.writes.join('').matchAll(/'([0-9a-f-]{36})'/g)]
      .map((match) => match[1])
      .at(-1);
    expect(transactionNonce).toBeDefined();
    pty.emitData(`\u001b]777;TA;${transactionNonce};0\u0007`);
    await expect(collection).resolves.toBeDefined();
    expect(actor.snapshot.lease.owner).toEqual({ kind: 'user' });
  });
});

describe.skipIf(process.platform !== 'darwin')(
  'SessionResourceService on interactive macOS zsh',
  () => {
    it('collects resources when interactive zsh enables history expansion', async () => {
      const pty = new NodePtySpawner().spawn({
        executable: '/bin/zsh',
        args: ['-f', '-o', 'BANG_HIST', '-i'],
        cwd: process.cwd(),
        env: Object.fromEntries(
          Object.entries(process.env).filter(
            (entry): entry is [string, string] => entry[1] !== undefined,
          ),
        ),
        columns: 120,
        rows: 40,
      });
      const actor = new SessionActor('darwin-zsh-resources', pty, { executionDialect: 'posix' });
      const service = new SessionResourceService({
        sessions: { get: (sessionId) => (sessionId === actor.snapshot.id ? actor : undefined) },
        timeoutMs: 15_000,
      });

      try {
        await actor.markPtyRunning();
        await expect(service.refresh(actor.snapshot.id)).resolves.toMatchObject({
          ok: true,
          snapshot: {
            dialect: 'posix',
            host: { status: 'available' },
            os: { status: 'available', value: { name: 'Darwin' } },
            memory: { status: 'available' },
            swap: { status: 'available' },
          },
        });
      } finally {
        actor.dispose();
        pty.terminate();
      }
    }, 30_000);
  },
);

async function readyActor(dialect: 'posix' | 'powershell' | 'observe_only'): Promise<SessionActor> {
  const actor = new SessionActor('session-1', new FakePty(1), { executionDialect: dialect });
  await actor.markPtyRunning();
  await actor.transitionShell('probing');
  await actor.transitionShell('ready');
  return actor;
}

async function waitForProbeNonce(actor: SessionActor, pty: FakePty): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await actor.idle();
    const nonce = pty.writes.join('').match(/'([0-9a-f-]{36})'/)?.[1];
    if (nonce !== undefined) return nonce;
    await vi.advanceTimersByTimeAsync(0);
  }
  throw new Error('probe was not dispatched');
}

async function waitForFingerprint(actor: SessionActor, pty: FakePty): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await actor.idle();
    const fingerprint = pty.writes.join('').match(/(__TA_DIALECT_[0-9a-f-]{36}__)/)?.[1];
    if (fingerprint !== undefined) return fingerprint;
    await vi.advanceTimersByTimeAsync(0);
  }
  throw new Error('fingerprint was not dispatched');
}

async function waitForPtyWrite(
  _actor: SessionActor,
  pty: FakePty,
  predicate: (value: string) => boolean,
): Promise<boolean> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate(pty.writes.join(''))) return true;
    await vi.advanceTimersByTimeAsync(0);
  }
  return false;
}

async function waitForPtyWriteAsync(
  actor: SessionActor,
  pty: FakePty,
  predicate: (value: string) => boolean,
): Promise<boolean> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await actor.idle();
    if (predicate(pty.writes.join(''))) return true;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return predicate(pty.writes.join(''));
}

function line(metric: string, ...fields: string[]): string {
  return [RESOURCE_PROTOCOL_PREFIX, metric, 'ok', ...fields].join('|');
}

function text(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}
