import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FakeClock, FakePty, withTemporaryDirectory } from '@terminal-agent/test-kit';

import { ApprovalManager } from './approval-manager.js';
import { CommandExecutor, type ExecutorScheduler } from './command-executor.js';
import { PolicyEngine, type ShellAstParser } from './policy-engine.js';
import { LocalFilePolicy } from './local-file-policy.js';
import { LocalFileService } from './local-file-service.js';
import { OutputJournal } from './output-journal.js';
import { SessionActor } from './session-actor.js';
import { TerminalToolGateway } from './tool-gateway.js';

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
  localFiles?: LocalFileService,
  permissionMode: 'manual' | 'auto' | 'full_access' = 'manual',
  options: {
    journal?: OutputJournal;
    audit?: { record(input: { type: string; payload: Record<string, unknown> }): void };
  } = {},
) {
  const pty = new FakePty(1);
  const actor = new SessionActor('session-1', pty, { executionDialect: 'posix' });
  await actor.markPtyRunning();
  await actor.transitionShell('probing');
  await actor.transitionShell('ready');
  await actor.verifyCurrentEnvironment('posix', 'unix', 'linux');
  const lease = await actor.grantAgentLease('task-1', 0);
  if (!lease.ok) throw new Error('expected lease');
  const clock = new FakeClock(0);
  const executor = new CommandExecutor(actor, {
    scheduler: schedulerFor(clock),
    observationWindowMs: 100,
    nonceFactory: () => 'tx-1',
  });
  const gateway = new TerminalToolGateway({
    sessionId: 'session-1',
    taskId: 'task-1',
    conversationId: 'conversation-1',
    turnId: 'turn-1',
    leaseEpoch: lease.value.lease.epoch,
    actor,
    executor,
    policy: new PolicyEngine(parser),
    approvals: new ApprovalManager(),
    permissionMode,
    ...(options.journal === undefined ? {} : { journal: options.journal }),
    ...(options.audit === undefined ? {} : { audit: options.audit }),
    ...(localFiles === undefined ? {} : { localFiles, localFilePolicy: new LocalFilePolicy() }),
  });
  return { pty, actor, gateway, leaseEpoch: lease.value.lease.epoch, clock };
}

describe('TerminalToolGateway', () => {
  it('rejects unknown tools and attempts to switch Session', async () => {
    const { gateway } = await setup();
    await expect(
      gateway.call('terminal_execute', { command: 'ls', sessionId: 'other' }),
    ).resolves.toMatchObject({
      ok: false,
      error: 'invalid_tool_call',
    });
    await expect(gateway.call('terminal_send_keys', {})).resolves.toMatchObject({
      ok: false,
      error: 'invalid_tool_call',
    });
  });

  it('keeps schema and Session boundaries in full-access mode', async () => {
    const { gateway } = await setup(undefined, 'full_access');
    await expect(
      gateway.call('terminal_execute', { command: 'ls', sessionId: 'other' }),
    ).resolves.toMatchObject({ ok: false, error: 'invalid_tool_call' });
    await expect(gateway.call('terminal_send_keys', {})).resolves.toMatchObject({
      ok: false,
      error: 'invalid_tool_call',
    });
  });

  it('executes read-only commands through the bound Session and returns redacted output', async () => {
    const { pty, actor, gateway } = await setup(undefined, 'auto');
    const resultPromise = gateway.call('terminal_execute', { command: 'printf ok' });
    await Promise.resolve();
    await actor.idle();
    pty.emitData('ok__TA_DONE_tx-1;0__');

    await expect(resultPromise).resolves.toMatchObject({
      ok: true,
      result: { status: 'completed' },
    });
  });

  it('returns unavailable commands to the model as recoverable command-not-found errors', async () => {
    const { pty, actor, gateway } = await setup(undefined, 'auto');
    const resultPromise = gateway.call('terminal_execute', { command: 'free -h' });
    await Promise.resolve();
    await actor.idle();
    pty.emitData('__TA_START__bash: free: command not found\n__TA_DONE_tx-1;127__');

    await expect(resultPromise).resolves.toMatchObject({
      ok: false,
      error: 'command_not_found',
      message: expect.stringContaining('bash: free: command not found'),
      recoverable: true,
    });
  });

  it('returns ordinary non-zero command execution to the model as a recoverable error', async () => {
    const { pty, actor, gateway } = await setup(undefined, 'auto');
    const resultPromise = gateway.call('terminal_execute', {
      command: 'cat /definitely/missing/path',
    });
    await Promise.resolve();
    await actor.idle();
    pty.emitData(
      '__TA_START__cat: /definitely/missing/path: No such file or directory\n__TA_DONE_tx-1;1__',
    );

    const actual = await resultPromise;
    expect(actual).toMatchObject({
      ok: false,
      error: 'command_failed',
      message: expect.stringContaining('No such file or directory'),
      recoverable: true,
    });
  });

  it('observes bounded Session output by journal cursor and reports the active transaction', async () => {
    const journal = new OutputJournal({ maxSessionBytes: 8, maxGlobalBytes: 16 });
    journal.append('session-1', Buffer.from('old'));
    journal.append('session-1', Buffer.from('new'));
    journal.append('session-1', Buffer.from('tail'));
    const { pty, actor, gateway, clock } = await setup(undefined, 'auto', { journal });

    const running = gateway.call('terminal_execute', {
      command: 'printf partial',
      observationWindowMs: 10,
    });
    await Promise.resolve();
    await actor.idle();
    pty.emitData('__TA_START__partial');
    await actor.idle();
    clock.advanceBy(10);

    const runningResult = await running;
    expect(runningResult).toMatchObject({
      ok: true,
      result: { status: 'running', transaction: { id: expect.any(String) } },
    });
    if (!runningResult.ok) throw new Error('expected running command');
    const transactionId = (runningResult.result as { transaction: { id: string } }).transaction.id;
    await expect(
      gateway.call('terminal_observe', { view: 'output', afterCursor: 0, maxBytes: 5 }),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        status: 'observed',
        view: 'output',
        cursor: 3,
        historyGap: true,
        truncated: true,
        output: 'tail',
        activeTransactionId: transactionId,
      },
    });
    await expect(gateway.call('terminal_observe', { view: 'screen' })).resolves.toMatchObject({
      ok: true,
      result: {
        status: 'observed',
        view: 'screen',
        cursor: 3,
        screen: expect.stringContaining('partial'),
        activeTransactionId: transactionId,
      },
    });
  });

  it('returns a recoverable busy result instead of probing during an active transaction', async () => {
    const { pty, actor, gateway, clock } = await setup(undefined, 'auto');
    const running = gateway.call('terminal_execute', {
      command: 'df -P',
      observationWindowMs: 10,
    });
    await Promise.resolve();
    await actor.idle();
    pty.emitData('__TA_START__partial');
    await actor.idle();
    clock.advanceBy(10);
    await expect(running).resolves.toMatchObject({
      ok: true,
      result: { status: 'running', transaction: { id: expect.any(String) } },
    });
    const writesBefore = pty.writes.length;

    await expect(
      gateway.call('terminal_execute', { command: 'cat /proc/loadavg' }),
    ).resolves.toEqual({
      ok: false,
      error: 'terminal_busy',
      message:
        'A terminal command is still running; call terminal_wait before executing another command',
      recoverable: true,
    });
    expect(pty.writes).toHaveLength(writesBefore);
  });

  it('returns a failed long-running command from terminal_wait as a recoverable error', async () => {
    const { pty, actor, gateway, clock } = await setup(undefined, 'auto');
    const running = gateway.call('terminal_execute', {
      command: 'cat /definitely/missing/path',
      observationWindowMs: 10,
    });
    await Promise.resolve();
    await actor.idle();
    pty.emitData('__TA_START__partial');
    await actor.idle();
    clock.advanceBy(10);

    const runningResult = await running;
    expect(runningResult).toMatchObject({
      ok: true,
      result: { status: 'running', transaction: { id: expect.any(String) } },
    });
    if (!runningResult.ok) throw new Error('expected running command');
    const transactionId = (runningResult.result as { transaction: { id: string } }).transaction.id;
    const completed = gateway.call('terminal_wait', { transactionId });
    await Promise.resolve();
    await actor.idle();
    pty.emitData('cat: /definitely/missing/path: No such file or directory\n__TA_DONE_tx-1;1__');

    await expect(completed).resolves.toMatchObject({
      ok: false,
      error: 'command_failed',
      message: expect.stringContaining('No such file or directory'),
      recoverable: true,
    });
  });

  it('requires and validates an exact approval for mutations', async () => {
    const { pty, actor, gateway } = await setup();
    const pending = await gateway.call('terminal_execute', { command: 'systemctl restart api' });
    expect(pending).toMatchObject({ ok: true, result: { status: 'waiting_approval' } });
    const grant = gateway.createApproval({
      commands: [
        {
          command: 'systemctl restart api',
          level: 'mutating',
          reasons: ['systemctl action changes service state'],
        },
      ],
    });
    const allowedPromise = gateway.call(
      'terminal_execute',
      { command: 'systemctl restart api' },
      grant,
    );
    await Promise.resolve();
    await actor.idle();
    pty.emitData('__TA_DONE_tx-1;0__');
    const allowed = await allowedPromise;
    expect(allowed).toMatchObject({ ok: true, result: { status: 'completed' } });
  });

  it('requires approval for read-only terminal commands in manual mode', async () => {
    const { gateway } = await setup(undefined, 'manual');
    await expect(
      gateway.call('terminal_execute', { command: 'cat /proc/loadavg' }),
    ).resolves.toMatchObject({
      ok: true,
      result: { status: 'waiting_approval', decision: { level: 'read_only' } },
    });
  });

  it('applies automatic and full-access modes after risk classification', async () => {
    for (const mode of ['auto', 'full_access'] as const) {
      const { pty, actor, gateway } = await setup(undefined, mode);
      const result = gateway.call('terminal_execute', { command: 'systemctl restart api' });
      await Promise.resolve();
      await actor.idle();
      pty.emitData('__TA_DONE_tx-1;0__');
      await expect(result).resolves.toMatchObject({
        ok: true,
        result: { status: 'completed' },
      });
    }

    const { gateway } = await setup(undefined, 'auto');
    await expect(
      gateway.call('terminal_execute', { command: 'rm -rf /tmp/cache' }),
    ).resolves.toMatchObject({
      ok: true,
      result: { status: 'waiting_approval', decision: { level: 'destructive' } },
    });
  });

  it('audits the permission mode and authorization decision for a terminal tool call', async () => {
    const records: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const { pty, actor, gateway } = await setup(undefined, 'auto', {
      audit: { record: (input) => records.push(input) },
    });
    const result = gateway.call(
      'terminal_execute',
      { command: 'systemctl restart api' },
      undefined,
      { toolCallId: 'call-command' },
    );
    await Promise.resolve();
    await actor.idle();
    pty.emitData('__TA_DONE_tx-1;0__');
    await expect(result).resolves.toMatchObject({ ok: true, result: { status: 'completed' } });
    expect(records).toContainEqual(
      expect.objectContaining({
        type: 'tool.authorization',
        payload: expect.objectContaining({
          tool: 'terminal_execute',
          toolCallId: 'call-command',
          permissionMode: 'auto',
          risk: 'mutating',
          authorization: 'automatic',
          requiresApproval: false,
        }),
      }),
    );
  });

  it('classifies and audits terminal commands with the current Session dialect', async () => {
    const records: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const { actor, gateway } = await setup(undefined, 'auto', {
      audit: { record: (input) => records.push(input) },
    });
    await actor.setExecutionDialect('powershell');

    await expect(
      gateway.call(
        'terminal_execute',
        { command: 'Remove-Item -Recurse -Force ./cache' },
        undefined,
        { toolCallId: 'call-powershell-delete' },
      ),
    ).resolves.toMatchObject({
      ok: true,
      result: { status: 'waiting_approval', decision: { level: 'destructive' } },
    });
    expect(records).toContainEqual(
      expect.objectContaining({
        type: 'tool.authorization',
        payload: expect.objectContaining({
          toolCallId: 'call-powershell-delete',
          executionDialect: 'powershell',
          permissionMode: 'auto',
          risk: 'destructive',
          authorization: 'manual',
          requiresApproval: true,
        }),
      }),
    );
  });

  it('executes ordinary local file tools and returns recoverable hash conflicts', async () => {
    await withTemporaryDirectory(async (directory) => {
      const home = join(directory, 'home');
      await mkdir(home);
      await writeFile(join(home, 'note.txt'), 'hello');
      const service = await LocalFileService.create({ root: home });
      const { gateway } = await setup(service, 'auto');

      const read = await gateway.call('local_read_file', { path: 'note.txt' });
      expect(read).toMatchObject({
        ok: true,
        result: { path: 'note.txt', content: 'hello', sha256: expect.any(String) },
      });
      await expect(
        gateway.call('local_write_file', {
          path: 'note.txt',
          mode: 'replace',
          content: 'changed',
          expectedSha256: '0'.repeat(64),
        }),
      ).resolves.toMatchObject({
        ok: false,
        error: 'local_file_conflict',
        recoverable: true,
      });
    });
  });

  it('binds sensitive local file approval to the exact tool and arguments', async () => {
    await withTemporaryDirectory(async (directory) => {
      const home = join(directory, 'home');
      await mkdir(join(home, '.ssh'), { recursive: true });
      await writeFile(
        join(home, '.ssh', 'id_ed25519'),
        '-----BEGIN OPENSSH PRIVATE KEY-----\nsecret\n-----END OPENSSH PRIVATE KEY-----',
      );
      const service = await LocalFileService.create({ root: home });
      const { gateway } = await setup(service);

      const pending = await gateway.call('local_read_file', { path: '.ssh/id_ed25519' });
      expect(pending).toMatchObject({
        ok: true,
        result: {
          status: 'waiting_approval',
          approvalTarget: expect.any(String),
          decision: { level: 'privileged', reasons: expect.any(Array) },
        },
      });
      if (!pending.ok) throw new Error('expected pending approval');
      const details = pending.result as {
        approvalTarget: string;
        decision: { level: 'privileged'; reasons: string[] };
      };
      const grant = gateway.createApproval({
        commands: [
          {
            command: details.approvalTarget,
            level: details.decision.level,
            reasons: details.decision.reasons,
          },
        ],
      });

      await expect(
        gateway.call('local_read_file', { path: '.ssh/id_ed25519' }, grant),
      ).resolves.toMatchObject({
        ok: true,
        result: { path: '.ssh/id_ed25519', content: expect.not.stringContaining('PRIVATE KEY') },
      });
      await expect(
        gateway.call('local_read_file', { path: '.ssh/other' }, grant),
      ).resolves.toMatchObject({ ok: false, error: 'approval_invalid' });
    });
  });

  it('previews local edits before approval and audits hashes without file content', async () => {
    await withTemporaryDirectory(async (directory) => {
      const home = join(directory, 'home');
      await mkdir(home);
      await writeFile(join(home, 'note.txt'), 'hello\n');
      const service = await LocalFileService.create({ root: home });
      const current = await service.read({ path: 'note.txt' });
      const records: Array<{ type: string; payload: Record<string, unknown> }> = [];
      const { gateway } = await setup(service, 'manual', {
        audit: { record: (input) => records.push(input) },
      });
      const argumentsValue = {
        path: 'note.txt',
        expectedSha256: current.sha256,
        edits: [{ oldText: 'hello', newText: 'world' }],
      };

      const pending = await gateway.call('local_edit_file', argumentsValue, undefined, {
        toolCallId: 'call-edit',
      });
      expect(pending).toMatchObject({
        ok: true,
        result: {
          status: 'waiting_approval',
          change: {
            path: 'note.txt',
            operation: 'edit',
            beforeSha256: current.sha256,
            afterSha256: expect.any(String),
            diff: expect.stringContaining('-hello'),
          },
        },
      });
      expect(await service.read({ path: 'note.txt' })).toMatchObject({ content: 'hello\n' });
      if (!pending.ok) throw new Error('expected pending approval');
      const details = pending.result as {
        approvalTarget: string;
        decision: { level: 'mutating'; reasons: string[] };
      };
      const grant = gateway.createApproval({
        toolCallId: 'call-edit',
        commands: [
          {
            command: details.approvalTarget,
            level: details.decision.level,
            reasons: details.decision.reasons,
          },
        ],
      });

      await expect(
        gateway.call('local_edit_file', argumentsValue, grant, { toolCallId: 'call-other' }),
      ).resolves.toMatchObject({ ok: false, error: 'approval_invalid' });
      await expect(
        gateway.call('local_edit_file', argumentsValue, grant, { toolCallId: 'call-edit' }),
      ).resolves.toMatchObject({ ok: true, result: { operation: 'edit' } });
      expect(records).toContainEqual(
        expect.objectContaining({
          type: 'file.edit.completed',
          payload: expect.objectContaining({
            path: 'note.txt',
            toolCallId: 'call-edit',
            risk: 'mutating',
            beforeSha256: current.sha256,
            afterSha256: expect.any(String),
          }),
        }),
      );
      expect(JSON.stringify(records)).not.toContain('world');
    });
  });
});
