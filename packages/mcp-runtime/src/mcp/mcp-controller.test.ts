import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createFakeTerminalBackend } from '@synapse-term/test-kit';
import { SessionActor } from '@synapse-term/terminal-service';

import { ApprovalQueue } from './approval-queue.js';
import { McpController, type McpSessionSource } from './mcp-controller.js';
import { generateMcpToken } from './mcp-settings.js';

function createSource() {
  const actors = new Map<string, SessionActor>();
  const listeners = new Set<(sessionId: string) => void>();
  const source: McpSessionSource = {
    get: (id) => actors.get(id),
    titleOf: (id) => actors.get(id)?.snapshot.title ?? id,
    onRemoved: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    source,
    async add(id: string) {
      const backend = createFakeTerminalBackend();
      const actor = new SessionActor(id, backend, { title: id, terminalType: 'bash' });
      await actor.markPtyRunning();
      actors.set(id, actor);
      return { actor, backend, remove: () => listeners.forEach((listener) => listener(id)) };
    },
  };
}

async function createController(enabled = false) {
  const directory = await mkdtemp(join(tmpdir(), 'synapse-controller-'));
  const sessions = createSource();
  const queue = new ApprovalQueue();
  const serverOperations: string[] = [];
  const controller = new McpController({
    settingsStoreDirectory: directory,
    sessions: sessions.source,
    approvalQueue: queue,
    initialSettings: {
      enabled,
      approvalMode: 'managed',
      ...(enabled ? { token: generateMcpToken() } : {}),
    },
    serverOverride: {
      start: async () => {
        serverOperations.push('start');
      },
      stop: async () => {
        serverOperations.push('stop');
      },
    },
  });
  return { controller, queue, serverOperations, sessions };
}

async function flushActorQueue(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('McpController', () => {
  it('starts only when enabled and reconciles the loopback endpoint', async () => {
    const { controller, serverOperations } = await createController();
    await controller.reload();
    expect(serverOperations).toEqual([]);
    await controller.updateSettings({ enabled: true, approvalMode: 'full' });
    expect(serverOperations).toEqual(['start']);
    const settings = await controller.getSettings();
    expect(settings.enabled).toBe(true);
    expect(settings.approvalMode).toBe('full');
    await controller.updateSettings({ enabled: false });
    expect(serverOperations).toEqual(['start', 'stop']);
  });

  it('starts on the fixed default port and restarts on an explicitly changed port', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'synapse-controller-port-'));
    const sessions = createSource();
    const startPorts: number[] = [];
    const controller = new McpController({
      settingsStoreDirectory: directory,
      sessions: sessions.source,
      serverOverride: {
        start: async (port) => {
          startPorts.push(port ?? -1);
        },
        stop: async () => undefined,
      },
    });

    await controller.reload();
    await controller.updateSettings({ enabled: true });
    expect(startPorts).toEqual([4_739]);

    await controller.updateSettings({ port: 5_123 });
    expect(startPorts).toEqual([4_739, 5_123]);
    await expect(controller.getSettings()).resolves.toMatchObject({ port: 5_123 });
  });

  it('shares sessions and exposes exact-session cancellation', async () => {
    const harness = await createController(true);
    const session = await harness.sessions.add('session-1');
    await session.actor.verifyEnvironment('posix', 'unix');
    await expect(harness.controller.share('session-1')).resolves.toMatchObject([
      { id: 'session-1' },
    ]);
    expect(harness.controller.listShared()).toHaveLength(1);

    await expect(
      harness.controller.callTool('synapse_status', { sessionId: 'session-1' }),
    ).resolves.toMatchObject({ status: 'ready' });

    expect(await Promise.resolve(harness.controller.unshare('session-1'))).toEqual([]);
    expect(harness.controller.listShared()).toHaveLength(0);
    await expect(
      harness.controller.callTool('synapse_status', { sessionId: 'session-1' }),
    ).resolves.toMatchObject({ status: 'expired', guidance: '请在桌面端重新共享会话 ID。' });
  });

  it('cleans pipelines when the terminal source reports removal', async () => {
    const harness = await createController();
    const session = await harness.sessions.add('session-exit');
    await harness.controller.share('session-exit');
    session.remove();

    expect(harness.controller.listShared()).toHaveLength(0);
    await expect(
      harness.controller.callTool('synapse_status', { sessionId: 'session-exit' }),
    ).resolves.toMatchObject({ status: 'expired' });
  });

  it('cleans Sharing directly when the Session PTY exits', async () => {
    const harness = await createController(true);
    const session = await harness.sessions.add('session-direct-exit');
    await session.actor.verifyEnvironment('posix', 'unix');
    await harness.controller.share('session-direct-exit');

    const pending = harness.controller.callTool('synapse_execute', {
      sessionId: 'session-direct-exit',
      command: 'npm test',
      expectedContextId: session.actor.snapshot.executionContextId,
    });
    await vi.waitFor(() => expect(session.backend.writes.join('')).toContain('npm test'));

    session.backend.emitExit(1);
    await flushActorQueue();

    expect(harness.controller.listShared()).toEqual([]);
    await expect(pending).resolves.toMatchObject({
      status: 'unknown',
      retryable: false,
      safeToResubmit: false,
    });
  });

  it('invalidates an approval when Sharing is cancelled before the decision', async () => {
    const harness = await createController();
    const session = await harness.sessions.add('session-approval');
    await session.actor.verifyEnvironment('posix', 'unix');
    await harness.controller.share('session-approval');

    const pending = harness.controller.callTool('synapse_execute', {
      sessionId: 'session-approval',
      command: 'deploy-production.sh',
      expectedContextId: session.actor.snapshot.executionContextId,
    });
    await vi.waitFor(() => expect(harness.queue.current?.sessionId).toBe('session-approval'));
    const approvalId = harness.queue.current?.id ?? '';

    expect(await Promise.resolve(harness.controller.unshare('session-approval'))).toEqual([]);
    expect(harness.controller.decideApproval(approvalId, 'allow_once')).toBe(false);
    await expect(pending).rejects.toThrow(/SESSION_EXPIRED/);
    expect(session.backend.writes).toEqual([]);
  });

  it('interrupts an active external transaction when Sharing is cancelled', async () => {
    const harness = await createController(true);
    const session = await harness.sessions.add('session-running');
    await session.actor.verifyEnvironment('posix', 'unix');
    await harness.controller.share('session-running');

    const pending = harness.controller.callTool('synapse_execute', {
      sessionId: 'session-running',
      command: 'npm test',
      expectedContextId: session.actor.snapshot.executionContextId,
    });
    await vi.waitFor(() => expect(session.backend.writes.join('')).toContain('npm test'));
    await expect(harness.controller.unshare('session-running')).resolves.toEqual([]);

    await expect(pending).resolves.toMatchObject({
      status: 'unknown',
      retryable: false,
      safeToResubmit: false,
    });
    expect(session.backend.interrupted).toBe(1);
  });

  it('clears Sharing when the MCP Token is revoked', async () => {
    const harness = await createController(true);
    await harness.sessions.add('session-token');
    await harness.controller.share('session-token');
    expect(harness.controller.listShared()).toHaveLength(1);

    await harness.controller.revokeToken();

    expect(harness.controller.listShared()).toEqual([]);
    await expect(
      harness.controller.callTool('synapse_status', { sessionId: 'session-token' }),
    ).resolves.toMatchObject({ status: 'expired' });
  });

  it('clears Sharing when the MCP Token is regenerated', async () => {
    const harness = await createController(true);
    await harness.sessions.add('session-regenerate');
    await harness.controller.share('session-regenerate');

    await harness.controller.regenerateToken();

    expect(harness.controller.listShared()).toEqual([]);
  });

  it('clears Sharing when the MCP service is disabled', async () => {
    const harness = await createController(true);
    await harness.sessions.add('session-disabled');
    await harness.controller.share('session-disabled');

    await harness.controller.updateSettings({ enabled: false });

    expect(harness.controller.listShared()).toEqual([]);
  });

  it('clears Sharing when the embedded endpoint is replaced', async () => {
    const harness = await createController(true);
    await harness.sessions.add('session-endpoint-replaced');
    await harness.controller.share('session-endpoint-replaced');
    const replacementOperations: string[] = [];

    harness.controller.setEndpoint({
      start: async () => {
        replacementOperations.push('start');
      },
      stop: async () => {
        replacementOperations.push('stop');
      },
    });

    expect(harness.controller.listShared()).toEqual([]);
    await expect(
      harness.controller.callTool('synapse_status', { sessionId: 'session-endpoint-replaced' }),
    ).resolves.toMatchObject({ status: 'expired' });
    await Promise.resolve();
    expect(replacementOperations).toEqual([]);
    expect(harness.serverOperations).toContain('stop');
  });

  it('dispatches the complete interactive chain and exposes its transaction kind', async () => {
    const harness = await createController(true);
    await harness.controller.updateSettings({ approvalMode: 'full' });
    const session = await harness.sessions.add('session-interactive-chain');
    await session.actor.verifyEnvironment('posix', 'unix');
    await harness.controller.share('session-interactive-chain');
    const events: Array<{ phase: string; kind: string }> = [];
    harness.controller.onExecution((event) =>
      events.push({ phase: event.phase, kind: event.kind ?? 'unknown' }),
    );

    const observed = (await harness.controller.callTool('synapse_observe', {
      sessionId: 'session-interactive-chain',
    })) as { executionContextId: string };
    const started = (await harness.controller.callTool('synapse_start_interactive', {
      sessionId: 'session-interactive-chain',
      command: 'sudo su -',
      expectedContextId: observed.executionContextId,
      inputGrantMode: 'one_shot',
    })) as {
      transaction: { id: string; kind: string; status: string };
      inputGrantId: string;
    };
    expect(started.transaction).toMatchObject({ kind: 'interactive', status: 'running' });
    expect(started.inputGrantId).toEqual(expect.any(String));
    expect(
      (await harness.controller.callTool('synapse_status', {
        sessionId: 'session-interactive-chain',
      })) as unknown,
    ).toMatchObject({
      activeTransactionId: started.transaction.id,
      activeTransactionKind: 'interactive',
    });

    const inputResult = (await harness.controller.callTool('synapse_input', {
      sessionId: 'session-interactive-chain',
      transactionId: started.transaction.id,
      inputGrantId: started.inputGrantId,
      inputRequestId: 'controller-input-1',
      text: 'password\n',
    })) as { sent: { textLength: number }; output?: string };
    expect(inputResult.sent.textLength).toBe(9);
    expect(JSON.stringify(inputResult)).not.toContain('password');

    session.backend.emitData('shell$ ');
    await flushActorQueue();
    const afterInput = (await harness.controller.callTool('synapse_observe', {
      sessionId: 'session-interactive-chain',
    })) as { nextCursor: string };
    const finishPromise = harness.controller.callTool('synapse_finish_interactive', {
      sessionId: 'session-interactive-chain',
      transactionId: started.transaction.id,
      observedCursor: afterInput.nextCursor,
    });
    await vi.waitFor(() => expect(session.backend.writes).toHaveLength(3));
    const finishWrite = session.backend.writes[2]!;
    const nonce = /'([A-Za-z0-9-]+)'/.exec(finishWrite)?.[1];
    expect(nonce).toBeDefined();
    session.backend.emitData(`\x1b]777;TA;${nonce};0\x07`);
    await expect(finishPromise).resolves.toMatchObject({
      transaction: { kind: 'interactive', status: 'completed' },
      completion: { confirmed: true, exitCode: 0 },
    });
    expect(events).toEqual([
      { phase: 'started', kind: 'interactive' },
      { phase: 'finished', kind: 'interactive' },
    ]);
    session.actor.dispose();
  });

  it('blocks structured and free writes while an interactive transaction owns the lease', async () => {
    const harness = await createController(true);
    await harness.controller.updateSettings({ approvalMode: 'full' });
    const session = await harness.sessions.add('session-interactive-busy');
    await session.actor.verifyEnvironment('posix', 'unix');
    await harness.controller.share('session-interactive-busy');
    const observed = (await harness.controller.callTool('synapse_observe', {
      sessionId: 'session-interactive-busy',
    })) as { executionContextId: string };
    const started = (await harness.controller.callTool('synapse_start_interactive', {
      sessionId: 'session-interactive-busy',
      command: 'bash -i',
      expectedContextId: observed.executionContextId,
      inputGrantMode: 'bounded',
    })) as { transaction: { id: string } };

    await expect(
      harness.controller.callTool('synapse_execute', {
        sessionId: 'session-interactive-busy',
        command: 'echo must-not-run',
        expectedContextId: session.actor.snapshot.executionContextId,
      }),
    ).rejects.toThrow(/^SESSION_BUSY:/);
    await expect(
      harness.controller.callTool('synapse_input', {
        sessionId: 'session-interactive-busy',
        expectedContextId: session.actor.snapshot.executionContextId,
        inputRequestId: 'free-while-busy',
        keys: ['enter'],
      }),
    ).rejects.toThrow(/^SESSION_BUSY:/);
    expect(session.backend.writes).toEqual(['bash -i\r']);
    await harness.controller.unshare('session-interactive-busy');
    session.actor.dispose();
    void started;
  });

  it('clears interactive executors, grants, and pending handles when the token is revoked', async () => {
    const harness = await createController(true);
    await harness.controller.updateSettings({ approvalMode: 'full' });
    const session = await harness.sessions.add('session-interactive-revoke');
    await session.actor.verifyEnvironment('posix', 'unix');
    await harness.controller.share('session-interactive-revoke');
    const observed = (await harness.controller.callTool('synapse_observe', {
      sessionId: 'session-interactive-revoke',
    })) as { executionContextId: string };
    const pending = harness.controller.callTool('synapse_start_interactive', {
      sessionId: 'session-interactive-revoke',
      command: 'bash -i',
      expectedContextId: observed.executionContextId,
      inputGrantMode: 'bounded',
    });
    await vi.waitFor(() => expect(session.backend.writes).toContain('bash -i\r'));

    await harness.controller.revokeToken();
    await expect(pending).resolves.toMatchObject({ status: 'running' });
    expect(harness.controller.listShared()).toEqual([]);
    expect(session.backend.interrupted).toBe(1);
    await expect(
      harness.controller.callTool('synapse_status', {
        sessionId: 'session-interactive-revoke',
      }),
    ).resolves.toMatchObject({ status: 'expired' });
    session.actor.dispose();
  });

  it('clears Sharing before restarting the endpoint after a port change', async () => {
    const harness = await createController(true);
    await harness.sessions.add('session-endpoint-restart');
    await harness.controller.share('session-endpoint-restart');

    await harness.controller.updateSettings({ port: 5_124 });

    expect(harness.controller.listShared()).toEqual([]);
  });

  it('starts the output history at the Sharing boundary', async () => {
    const harness = await createController(true);
    const session = await harness.sessions.add('session-boundary');
    await session.actor.verifyEnvironment('posix', 'unix');
    session.backend.emitData('before-share\r\n');
    await flushActorQueue();

    await harness.controller.share('session-boundary');
    session.backend.emitData('after-share\r\n');
    await flushActorQueue();

    await expect(
      harness.controller.callTool('synapse_observe', { sessionId: 'session-boundary' }),
    ).resolves.toMatchObject({ output: 'after-share\r\n' });
    session.actor.dispose();
  });

  it('does not capture PTY output queued before the Sharing boundary', async () => {
    const harness = await createController(true);
    const session = await harness.sessions.add('session-boundary-race');
    session.backend.emitData('before-share-queued\r\n');

    await harness.controller.share('session-boundary-race');
    await flushActorQueue();
    session.backend.emitData('after-share\r\n');
    await flushActorQueue();

    await expect(
      harness.controller.callTool('synapse_observe', { sessionId: 'session-boundary-race' }),
    ).resolves.toMatchObject({ output: 'after-share\r\n' });
    session.actor.dispose();
  });

  it('invalidates old output cursors when Sharing is recreated', async () => {
    const harness = await createController(true);
    const session = await harness.sessions.add('session-reshare');
    await harness.controller.share('session-reshare');
    session.backend.emitData('first-sharing\r\n');
    await flushActorQueue();
    const first = (await harness.controller.callTool('synapse_observe', {
      sessionId: 'session-reshare',
    })) as { nextCursor: string };

    await harness.controller.unshare('session-reshare');
    await harness.controller.share('session-reshare');
    session.backend.emitData('second-sharing\r\n');
    await flushActorQueue();

    await expect(
      harness.controller.callTool('synapse_observe', {
        sessionId: 'session-reshare',
        afterCursor: first.nextCursor,
      }),
    ).rejects.toThrow(/^OUTPUT_CURSOR_STALE:/);
    await expect(
      harness.controller.callTool('synapse_observe', { sessionId: 'session-reshare' }),
    ).resolves.toMatchObject({ output: 'second-sharing\r\n' });
    session.actor.dispose();
  });

  it('does not accept a cursor from another Session', async () => {
    const harness = await createController(true);
    const first = await harness.sessions.add('session-one');
    const second = await harness.sessions.add('session-two');
    await harness.controller.share('session-one');
    await harness.controller.share('session-two');
    second.backend.emitData('session-two-output\r\n');
    await flushActorQueue();
    const page = (await harness.controller.callTool('synapse_observe', {
      sessionId: 'session-two',
    })) as { nextCursor: string };

    await expect(
      harness.controller.callTool('synapse_observe', {
        sessionId: 'session-one',
        afterCursor: page.nextCursor,
      }),
    ).rejects.toThrow(/^OUTPUT_CURSOR_STALE:/);
    first.actor.dispose();
    second.actor.dispose();
  });
});
