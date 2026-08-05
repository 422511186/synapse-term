import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createExternalCaller, type ShellAstParser } from '@synapse-term/domain';
import type { AuditRecordInput } from '@synapse-term/infrastructure';
import { FakeClock, FakePty, withTemporaryDirectory } from '@synapse-term/test-kit';
import {
  CommandExecutor,
  OutputJournal,
  SessionActor,
  type ExecutorScheduler,
} from '@synapse-term/terminal-service';
import { LocalFileService } from '@synapse-term/tooling';

import { LocalFilePolicy } from '../policy/local-file-policy.js';
import { PolicyEngine } from '../policy/policy-engine.js';
import {
  ExternalToolPipeline,
  type ExternalApprovalMode,
  type ExternalToolContext,
} from './external-tool-pipeline.js';

const parser: ShellAstParser = { parse: async () => ({ hasError: false, tree: 'program' }) };

function schedulerFor(clock: FakeClock): ExecutorScheduler {
  return {
    schedule(callback, delayMs) {
      const timer = clock.setTimeout(callback, delayMs);
      return { dispose: () => clock.clearTimeout(timer) };
    },
  };
}

async function setup(
  options: {
    localFiles?: LocalFileService;
    journal?: OutputJournal;
    ready?: boolean;
  } = {},
) {
  const pty = new FakePty(80);
  const actor = new SessionActor('session-1', pty, { executionDialect: 'posix' });
  await actor.markPtyRunning();
  await actor.verifyCurrentEnvironment('posix', 'unix', 'linux');
  if (options.ready !== false) {
    await actor.transitionShell('probing');
    await actor.transitionShell('ready');
  }
  const clock = new FakeClock(0);
  const executor = new CommandExecutor(actor, {
    scheduler: schedulerFor(clock),
    observationWindowMs: 100,
    nonceFactory: () => 'tx-1',
  });
  const audit: AuditRecordInput[] = [];
  const pipeline = new ExternalToolPipeline({
    actor,
    executor,
    policy: new PolicyEngine(parser),
    ...(options.localFiles === undefined
      ? {}
      : { localFiles: options.localFiles, localFilePolicy: new LocalFilePolicy() }),
    ...(options.journal === undefined ? {} : { journal: options.journal }),
    audit: { record: (input) => audit.push(input) },
  });
  return { pty, actor, pipeline, clock, audit };
}

const caller = createExternalCaller('mcp', 'mcp-client', 'Codex');

function context(approvalMode: ExternalApprovalMode = 'managed'): ExternalToolContext {
  return { caller, approvalMode, toolCallId: 'call-1' };
}

async function waitForDispatch(actor: SessionActor, pty: FakePty): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await Promise.resolve();
    await actor.idle();
    if (
      pty.writes.some((write) => write.includes('__TA_START__') || write.includes('__TA_DONE_'))
    ) {
      return;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('command payload was not fully dispatched');
}

describe('ExternalToolPipeline', () => {
  it('denies every execute in read-only mode without touching the PTY', async () => {
    const { pty, actor, pipeline, audit } = await setup();
    const writesBefore = pty.writes.length;

    await expect(pipeline.execute({ command: 'ls' }, context('read_only'))).resolves.toMatchObject({
      ok: false,
      error: 'policy_denied',
      message: expect.stringContaining('read-only'),
      recoverable: false,
    });

    expect(pty.writes).toHaveLength(writesBefore);
    expect(actor.snapshot.lease.owner).toEqual({ kind: 'user' });
    expect(audit.at(-1)).toMatchObject({
      actor: { kind: 'external', callerKind: 'mcp', callerId: 'mcp-client' },
      sessionId: 'session-1',
      type: 'external.denied',
      payload: {
        tool: 'external.command',
        source: 'mcp',
        callerId: 'mcp-client',
        commandPreview: 'ls',
        risk: 'read_only',
        approvalMode: 'read_only',
        reason: 'approval_mode_denied',
      },
    });
    expect(Object.keys(audit.at(-1)!)).not.toContain('taskId');
  });

  it('executes a low-risk command in managed mode and releases the external lease', async () => {
    const { pty, actor, pipeline, audit } = await setup();
    const execution = pipeline.execute({ command: 'printf ok' }, context());
    await Promise.resolve();
    await actor.idle();
    pty.emitData('ok__TA_DONE_tx-1;0__');

    await expect(execution).resolves.toMatchObject({
      ok: true,
      result: { status: 'completed', transaction: { status: 'completed', exitCode: 0 } },
    });
    expect(actor.snapshot.lease.owner).toEqual({ kind: 'none' });
    expect(audit.at(-1)).toMatchObject({
      actor: { kind: 'external', callerKind: 'mcp', callerId: 'mcp-client' },
      sessionId: 'session-1',
      type: 'external.command',
      payload: {
        source: 'mcp',
        callerId: 'mcp-client',
        commandPreview: 'printf ok',
        risk: 'read_only',
        approvalMode: 'managed',
        authorization: 'auto_allowed',
        status: 'completed',
      },
    });
    expect(Object.keys(audit.at(-1)!)).not.toContain('taskId');
  });

  it('runs a lazy shell probe for an unready session before external execution', async () => {
    const { pty, actor, pipeline } = await setup({ ready: false });
    const execution = pipeline.execute({ command: 'printf ok' }, context());

    await waitForDispatch(actor, pty);
    const dispatched = pty.writes.join('');
    const nonceMatch = dispatched.match(/__TA_OS_([A-Za-z0-9-]+)__/);
    if (nonceMatch === null) throw new Error('expected capability probe payload');
    expect(actor.snapshot.shell).toBe('probing');

    pty.emitData(`\u001b]777;TA;${nonceMatch[1]};0\u0007`);
    await Promise.resolve();
    await actor.idle();
    expect(actor.snapshot.shell).toBe('ready');

    pty.emitData('ok__TA_DONE_tx-1;0__');
    await expect(execution).resolves.toMatchObject({
      ok: true,
      result: { status: 'completed', transaction: { status: 'completed', exitCode: 0 } },
    });
    expect(actor.snapshot.lease.owner).toEqual({ kind: 'none' });
  });

  it('returns session_not_ready when the lazy shell probe is invalidated', async () => {
    const { pty, actor, pipeline } = await setup({ ready: false });
    const execution = pipeline.execute({ command: 'printf ok' }, context());

    await waitForDispatch(actor, pty);
    const dispatched = pty.writes.join('');
    const nonceMatch = dispatched.match(/__TA_OS_([A-Za-z0-9-]+)__/);
    if (nonceMatch === null) throw new Error('expected capability probe payload');
    await actor.writeUser('manual\r');
    pty.emitData(`\u001b]777;TA;${nonceMatch[1]};0\u0007`);

    await expect(execution).resolves.toMatchObject({
      ok: false,
      error: 'session_not_ready',
      recoverable: true,
    });
    expect(actor.snapshot.lease.owner).toEqual({ kind: 'user' });
  });

  it.each(['unknown', 'privileged', 'destructive'])(
    'rejects %s risk in managed mode with default deny',
    async (risk) => {
      const command =
        risk === 'unknown'
          ? 'some-unknown-tool'
          : risk === 'privileged'
            ? 'sudo ls'
            : 'rm -rf /tmp/external-test';
      const { pty, pipeline, audit } = await setup();
      const writesBefore = pty.writes.length;

      await expect(pipeline.execute({ command }, context())).resolves.toMatchObject({
        ok: false,
        error: 'policy_denied',
        recoverable: false,
      });
      expect(pty.writes).toHaveLength(writesBefore);
      expect(audit.at(-1)!.payload).toMatchObject({
        tool: 'external.command',
        risk,
        reason: 'approval_mode_denied',
      });
    },
  );

  it('executes a destructive command in full mode and audits the risk', async () => {
    const { pty, actor, pipeline, audit } = await setup();
    const execution = pipeline.execute(
      { command: 'rm -rf /tmp/external-full-test' },
      context('full'),
    );
    await Promise.resolve();
    await actor.idle();
    pty.emitData('ok__TA_DONE_tx-1;0__');

    await expect(execution).resolves.toMatchObject({
      ok: true,
      result: { status: 'completed', transaction: { status: 'completed', exitCode: 0 } },
    });
    expect(actor.snapshot.lease.owner).toEqual({ kind: 'none' });
    expect(audit.at(-1)).toMatchObject({
      type: 'external.command',
      payload: {
        risk: 'destructive',
        approvalMode: 'full',
        authorization: 'auto_allowed',
      },
    });
  });

  it('returns a recoverable lease conflict while the built-in agent owns the Session', async () => {
    const { pty, actor, pipeline } = await setup();
    const agentLease = await actor.grantAgentLease('task-1', actor.snapshot.lease.epoch);
    if (!agentLease.ok) throw new Error('expected agent lease');

    await expect(pipeline.execute({ command: 'ls' }, context())).resolves.toMatchObject({
      ok: false,
      error: 'lease_unavailable',
      recoverable: true,
    });
    expect(pty.writes).toHaveLength(0);
  });

  it('keeps a running command under the external lease and releases it after wait', async () => {
    const { pty, actor, pipeline, clock, audit } = await setup();
    const execution = pipeline.execute({ command: 'df -P', observationWindowMs: 10 }, context());
    await waitForDispatch(actor, pty);
    pty.emitData('__TA_START__partial');
    await actor.idle();
    clock.advanceBy(10);
    const running = await execution;
    expect(running).toMatchObject({ ok: true, result: { status: 'running' } });
    expect(actor.snapshot.lease.owner).toEqual({ kind: 'external', callerId: 'mcp-client' });

    if (!running.ok) throw new Error('expected running command');
    const transactionId = (running.result as { transaction: { id: string } }).transaction.id;
    const waiting = pipeline.wait({ transactionId }, context());
    await Promise.resolve();
    await actor.idle();
    pty.emitData('done\u001b]777;TA;tx-1;0\u0007');

    await expect(waiting).resolves.toMatchObject({
      ok: true,
      result: { status: 'completed' },
    });
    expect(actor.snapshot.lease.owner).toEqual({ kind: 'none' });
    expect(audit.at(-1)?.payload).toMatchObject({
      transactionId,
      commandPreview: 'df -P',
    });
  });

  it('observes journal output in read-only mode with redaction and external audit identity', async () => {
    const journal = new OutputJournal({ maxSessionBytes: 64, maxGlobalBytes: 128 });
    journal.append('session-1', Buffer.from('token='));
    journal.append('session-1', Buffer.from('sk-secret-1234567890'));
    const { pipeline, audit } = await setup({ journal });

    const observed = pipeline.observe(
      { view: 'output', afterCursor: 0, maxBytes: 64 },
      context('read_only'),
    );
    expect(observed).toMatchObject({ ok: true });
    if (!observed.ok) throw new Error('expected observation');
    expect(observed.result).toMatchObject({
      status: 'observed',
      sessionId: 'session-1',
      view: 'output',
      output: 'token=[REDACTED]',
      redacted: true,
    });
    expect(audit.at(-1)).toMatchObject({
      actor: { kind: 'external', callerKind: 'mcp', callerId: 'mcp-client' },
      sessionId: 'session-1',
      type: 'external.observe',
    });
    expect(Object.keys(audit.at(-1)!)).not.toContain('taskId');
  });

  it('reads local files when allowed and denies sensitive paths with default deny', async () => {
    await withTemporaryDirectory(async (root) => {
      await writeFile(join(root, 'app.txt'), 'hello', 'utf8');
      const localFiles = await LocalFileService.create({ root });
      const { pipeline, audit } = await setup({ localFiles });

      await expect(
        pipeline.readFile({ path: 'app.txt' }, context('read_only')),
      ).resolves.toMatchObject({ ok: true, result: { content: 'hello' } });
      await expect(pipeline.readFile({ path: '.ssh/id_rsa' }, context())).resolves.toMatchObject({
        ok: false,
        error: 'policy_denied',
        recoverable: false,
      });
      expect(audit.at(-1)!.payload).toMatchObject({
        tool: 'external.file.read',
        risk: 'privileged',
        reason: 'approval_mode_denied',
      });
    });
  });

  it('returns a recoverable error when local file service is not configured', async () => {
    const { pipeline } = await setup();
    await expect(pipeline.readFile({ path: 'app.txt' }, context())).resolves.toMatchObject({
      ok: false,
      error: 'local_file_service_unavailable',
      recoverable: false,
    });
  });
});
