import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createExternalCaller, type ShellAstParser } from '@synapse-term/domain';
import { CORE_MIGRATIONS, CoreRepositories, SqliteStore } from '@synapse-term/infrastructure';
import { PolicyEngine } from '@synapse-term/platform-kernel';
import { OutputJournal, SessionManager, type PtySpawner } from '@synapse-term/terminal-service';
import { FakePty, withTemporaryDirectory } from '@synapse-term/test-kit';

import { CoreRequestRouter } from './core-request-router.js';

class FakeSpawner implements PtySpawner {
  readonly ptys: FakePty[] = [];

  spawn(): FakePty {
    const pty = new FakePty(this.ptys.length + 1);
    this.ptys.push(pty);
    return pty;
  }
}

const parser: ShellAstParser = { parse: async () => ({ hasError: false, tree: 'program' }) };
const caller = createExternalCaller('mcp', 'mcp-client', 'Codex');

const launch = {
  title: 'local shell',
  terminalType: 'Git Bash',
  executable: 'bash.exe',
  args: ['-i'],
  cwd: 'C:/work',
  env: {},
  columns: 80,
  rows: 24,
  executionDialect: 'posix' as const,
};

interface RouterContext {
  router: CoreRequestRouter;
  sessions: SessionManager;
  repositories: CoreRepositories;
  audit: Array<{ type: string; sessionId?: string; payload: Record<string, unknown> }>;
}

async function withRouter(
  callback: (context: RouterContext) => Promise<void>,
  options: { external?: boolean } = {},
) {
  await withTemporaryDirectory(async (directory) => {
    const store = new SqliteStore(join(directory, 'core.sqlite'), CORE_MIGRATIONS);
    await store.open();
    const repositories = new CoreRepositories(store);
    const spawner = new FakeSpawner();
    const journal = new OutputJournal();
    const sessions = new SessionManager(spawner);
    const audit: Array<{ type: string; sessionId?: string; payload: Record<string, unknown> }> = [];
    const router = new CoreRequestRouter({
      sessions,
      journal,
      repositories,
      emitTerminalOutput: () => undefined,
      audit: {
        query: () => [],
        record: (input) => audit.push(input),
      },
      ...(options.external === false ? {} : { external: { policy: new PolicyEngine(parser) } }),
      // 共享自动探测使用短超时：测试不模拟探测响应时快速失败，避免悬挂
      shareProbe: { timeoutMs: 15 },
    });
    await callback({ router, sessions, repositories, audit });
  });
}

async function createSharedSession(context: { router: CoreRequestRouter }): Promise<string> {
  const created = await context.router.handle('session.create', launch, 'connection-1');
  const sessionId = (created as { id: string }).id;
  await context.router.handle('session.markShared', { sessionId }, 'connection-1');
  // 等待共享自动探测结束（短超时失败并释放外部租约），避免与后续外部调用竞争
  await new Promise<void>((resolve) => setTimeout(resolve, 40));
  return sessionId;
}

describe('ExternalRequestHandler through CoreRequestRouter', () => {
  it('rejects external calls until the user copies the sessionId', async () => {
    await withRouter(async ({ router }) => {
      const created = await router.handle('session.create', launch, 'connection-1');
      const sessionId = (created as { id: string }).id;

      await expect(
        router.handle(
          'external.terminalObserve',
          { sessionId, approvalMode: 'read_only', caller },
          'connection-1',
        ),
      ).rejects.toMatchObject({ code: 'invalid_session' });
      await expect(
        router.handle(
          'external.terminalObserve',
          { sessionId: 'does-not-exist', approvalMode: 'read_only', caller },
          'connection-1',
        ),
      ).rejects.toMatchObject({ code: 'invalid_session' });
    });
  });

  it('marks a Session as shared and exposes observe as a read tool', async () => {
    await withRouter(async ({ router, repositories, audit }) => {
      const sessionId = await createSharedSession({ router });

      expect(repositories.getSession(sessionId)?.sharedAt).toBeDefined();
      expect(
        audit.some((entry) => entry.type === 'session.shared' && entry.sessionId === sessionId),
      ).toBe(true);

      await expect(
        router.handle(
          'external.terminalObserve',
          { sessionId, approvalMode: 'read_only', caller },
          'connection-1',
        ),
      ).resolves.toMatchObject({
        ok: true,
        result: { status: 'observed', sessionId, view: 'screen' },
      });
      expect(audit.at(-1)).toMatchObject({
        type: 'external.observe',
        sessionId,
        actor: { kind: 'external', callerKind: 'mcp', callerId: 'mcp-client' },
      });
    });
  });

  it('probes session status without throwing for expired sessions', async () => {
    await withRouter(async ({ router, audit }) => {
      await expect(
        router.handle(
          'external.terminalStatus',
          { sessionId: 'does-not-exist', approvalMode: 'read_only', caller },
          'connection-1',
        ),
      ).resolves.toMatchObject({
        ok: true,
        result: { sessionId: 'does-not-exist', status: 'expired', shared: false },
      });

      const sessionId = await createSharedSession({ router });
      await expect(
        router.handle(
          'external.terminalStatus',
          { sessionId, approvalMode: 'read_only', caller },
          'connection-1',
        ),
      ).resolves.toMatchObject({
        ok: true,
        result: {
          sessionId,
          status: 'not_ready',
          shared: true,
          pty: 'running',
          shell: 'unknown',
        },
      });

      expect(audit.filter((entry) => entry.type === 'external.status')).toMatchObject([
        {
          sessionId: 'does-not-exist',
          actor: { kind: 'external', callerKind: 'mcp', callerId: 'mcp-client' },
          payload: { status: 'expired', source: 'mcp' },
        },
        {
          sessionId,
          actor: { kind: 'external', callerKind: 'mcp', callerId: 'mcp-client' },
          payload: { status: 'not_ready', shared: true },
        },
      ]);
    });
  });

  it('reports ready after the shell becomes ready', async () => {
    await withRouter(async ({ router, sessions }) => {
      const sessionId = await createSharedSession({ router });
      const actor = sessions.get(sessionId);
      if (actor === undefined) throw new Error('expected session actor');
      await actor.transitionShell('probing');
      await actor.transitionShell('ready');

      await expect(
        router.handle(
          'external.terminalStatus',
          { sessionId, approvalMode: 'read_only', caller },
          'connection-1',
        ),
      ).resolves.toMatchObject({
        ok: true,
        result: { sessionId, status: 'ready', shared: true, shell: 'ready' },
      });
    });
  });

  it('gives actionable hints for unknown and probing shells', async () => {
    await withRouter(async ({ router, sessions }) => {
      const sessionId = await createSharedSession({ router });
      const actor = sessions.get(sessionId);
      if (actor === undefined) throw new Error('expected session actor');

      await expect(
        router.handle(
          'external.terminalStatus',
          { sessionId, approvalMode: 'read_only', caller },
          'connection-1',
        ),
      ).resolves.toMatchObject({
        ok: true,
        result: {
          status: 'not_ready',
          shell: 'unknown',
          hint: expect.stringContaining('terminal_execute'),
        },
      });

      await actor.transitionShell('probing');
      await expect(
        router.handle(
          'external.terminalStatus',
          { sessionId, approvalMode: 'read_only', caller },
          'connection-1',
        ),
      ).resolves.toMatchObject({
        ok: true,
        result: {
          status: 'not_ready',
          shell: 'probing',
          hint: expect.stringContaining('Shell 探测'),
        },
      });
    });
  });

  it('treats an unshared session as expired for external callers', async () => {
    await withRouter(async ({ router }) => {
      const created = await router.handle('session.create', launch, 'connection-1');
      const sessionId = (created as { id: string }).id;

      await expect(
        router.handle(
          'external.terminalStatus',
          { sessionId, approvalMode: 'read_only', caller },
          'connection-1',
        ),
      ).resolves.toMatchObject({
        ok: true,
        result: { sessionId, status: 'expired', shared: false },
      });
    });
  });

  it('treats a closed session as expired and allows subsequent sessions', async () => {
    await withRouter(async ({ router }) => {
      const sessionId = await createSharedSession({ router });
      await router.handle('session.close', { sessionId }, 'connection-1');

      await expect(
        router.handle(
          'external.terminalStatus',
          { sessionId, approvalMode: 'read_only', caller },
          'connection-1',
        ),
      ).resolves.toMatchObject({
        ok: true,
        result: { sessionId, status: 'expired', shared: false },
      });

      const nextSessionId = await createSharedSession({ router });
      await expect(
        router.handle(
          'external.terminalStatus',
          { sessionId: nextSessionId, approvalMode: 'read_only', caller },
          'connection-1',
        ),
      ).resolves.toMatchObject({
        ok: true,
        result: { sessionId: nextSessionId, status: 'not_ready', shared: true },
      });
    });
  });

  it('enforces read-only approval mode and managed low-risk execution', async () => {
    await withRouter(async ({ router, sessions, audit }) => {
      const sessionId = await createSharedSession({ router });
      const actor = sessions.get(sessionId);
      if (actor === undefined) throw new Error('expected session actor');
      await actor.transitionShell('probing');
      await actor.transitionShell('ready');
      await actor.verifyCurrentEnvironment('posix', 'unix', 'linux');

      await expect(
        router.handle(
          'external.terminalExecute',
          { sessionId, approvalMode: 'read_only', caller, command: 'ls' },
          'connection-1',
        ),
      ).resolves.toMatchObject({ ok: false, error: 'policy_denied' });

      const execution = router.handle(
        'external.terminalExecute',
        {
          sessionId,
          approvalMode: 'managed',
          caller,
          command: 'printf ok',
          observationWindowMs: 10,
        },
        'connection-1',
      );
      await new Promise((resolve) => setTimeout(resolve, 30));
      await expect(execution).resolves.toMatchObject({
        ok: true,
        result: { status: 'running' },
      });
      expect(audit.at(-1)).toMatchObject({
        type: 'external.command',
        sessionId,
        actor: { kind: 'external', callerKind: 'mcp', callerId: 'mcp-client' },
        payload: { approvalMode: 'managed', authorization: 'auto_allowed' },
      });

      await expect(
        router.handle(
          'external.terminalExecute',
          { sessionId, approvalMode: 'managed', caller, command: 'rm -rf /tmp/x' },
          'connection-1',
        ),
      ).resolves.toMatchObject({ ok: false, error: 'policy_denied' });
    });
  });

  it('classifies ACP commands through the policy engine without executing', async () => {
    await withRouter(async ({ router }) => {
      const sessionId = await createSharedSession({ router });

      await expect(
        router.handle(
          'external.classifyCommand',
          { sessionId, caller, approvalMode: 'managed', command: 'ls' },
          'connection-1',
        ),
      ).resolves.toMatchObject({
        risk: 'read_only',
        requiresApproval: false,
        authorization: 'allow_once',
      });

      await expect(
        router.handle(
          'external.classifyCommand',
          { sessionId, caller, approvalMode: 'managed', command: 'mkdir /tmp/acp-test' },
          'connection-1',
        ),
      ).resolves.toMatchObject({
        risk: 'mutating',
        requiresApproval: false,
        authorization: 'allow_once',
      });

      await expect(
        router.handle(
          'external.classifyCommand',
          {
            sessionId,
            caller,
            approvalMode: 'managed',
            command: 'dd if=/dev/zero of=/tmp/x bs=1 count=1',
          },
          'connection-1',
        ),
      ).resolves.toMatchObject({
        risk: 'destructive',
        requiresApproval: true,
        authorization: 'approval_required',
      });

      await expect(
        router.handle(
          'external.classifyCommand',
          { sessionId, caller, approvalMode: 'manual', command: 'mkdir /tmp/acp-test' },
          'connection-1',
        ),
      ).resolves.toMatchObject({
        risk: 'mutating',
        requiresApproval: true,
        authorization: 'approval_required',
      });

      await expect(
        router.handle(
          'external.classifyCommand',
          { sessionId, caller, approvalMode: 'manual', command: 'ls' },
          'connection-1',
        ),
      ).resolves.toMatchObject({
        risk: 'read_only',
        requiresApproval: false,
        authorization: 'allow_once',
      });
    });
  });

  it('records ACP permission rejections to the audit journal', async () => {
    await withRouter(async ({ router, audit }) => {
      const sessionId = await createSharedSession({ router });

      await expect(
        router.handle(
          'external.recordRejection',
          { sessionId, caller, toolName: 'native_edit', reason: 'undeclared_capability' },
          'connection-1',
        ),
      ).resolves.toEqual({ ok: true });
      expect(audit.at(-1)).toMatchObject({
        type: 'external.rejected',
        sessionId,
        actor: { kind: 'external', callerKind: 'mcp', callerId: 'mcp-client' },
        payload: { tool: 'native_edit', reason: 'undeclared_capability', source: 'mcp' },
      });

      await expect(
        router.handle(
          'external.recordRejection',
          { sessionId: 'unknown-session', caller, toolName: 'x', reason: 'user_rejected' },
          'connection-1',
        ),
      ).rejects.toMatchObject({ code: 'invalid_session' });
    });
  });

  it('fails cleanly when the external pipeline is not configured', async () => {
    await withRouter(
      async ({ router }) => {
        await expect(
          router.handle(
            'external.terminalObserve',
            { sessionId: 'session-1', approvalMode: 'read_only', caller },
            'connection-1',
          ),
        ).rejects.toMatchObject({ code: 'external_not_configured' });
      },
      { external: false },
    );
  });
});
