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
    notifyRemoved: (listener) => {
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

  it('invalidates an approval when Sharing is cancelled before the decision', async () => {
    const harness = await createController();
    const session = await harness.sessions.add('session-approval');
    await session.actor.verifyEnvironment('posix', 'unix');
    await harness.controller.share('session-approval');

    const pending = harness.controller.callTool('synapse_execute', {
      sessionId: 'session-approval',
      command: 'deploy-production.sh',
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
    });
    await vi.waitFor(() => expect(session.backend.writes.join('')).toContain('npm test'));
    await expect(harness.controller.unshare('session-running')).resolves.toEqual([]);

    await expect(pending).resolves.toMatchObject({ status: 'interrupted' });
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
});
