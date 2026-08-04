import { describe, expect, it } from 'vitest';

import { createDesktopCoreBridge } from './desktop-core-bridge.js';
import { createDesktopAttachmentController } from './desktop-attachment-controller.js';
import type { CoreSupervisor } from './core-supervisor.js';

class FakeSupervisor {
  readonly requests: Array<{ method: string; payload: unknown }> = [];
  readonly exitRequests: Array<'keep_background' | 'terminate_all'> = [];
  readonly eventListeners = new Set<(event: never) => void>();
  readonly outputListeners = new Set<
    (event: { sessionId: string; sequence: number; data: string }) => void
  >();
  state = 'connected' as const;

  async request<T>(method: string, payload: unknown): Promise<T> {
    this.requests.push({ method, payload });
    return { ok: true } as T;
  }

  onEvent(listener: (event: never) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onTerminalOutput(
    listener: (event: { sessionId: string; sequence: number; data: string }) => void,
  ): () => void {
    this.outputListeners.add(listener);
    return () => this.outputListeners.delete(listener);
  }

  async requestExit(
    choice: 'keep_background' | 'terminate_all' = 'keep_background',
  ): Promise<{ ok: true; state: 'detached' }> {
    this.exitRequests.push(choice);
    return { ok: true, state: 'detached' };
  }
}

class FakeAttachmentController {
  readonly resolved: unknown[] = [];

  async pick(): Promise<
    Array<{ attachmentId: string; name: string; mimeType: string; sizeBytes: number; kind: 'file' }>
  > {
    return [
      {
        attachmentId: 'ticket-1',
        name: 'notes.txt',
        mimeType: 'text/plain',
        sizeBytes: 2_048,
        kind: 'file',
      },
    ];
  }

  async resolve(value: unknown) {
    this.resolved.push(value);
    return [
      {
        id: 'ticket-1',
        name: 'notes.txt',
        mimeType: 'text/plain',
        sizeBytes: 2_048,
        kind: 'file' as const,
        sourcePath: 'C:/tmp/notes.txt',
      },
    ];
  }

  clear(): void {}
}

describe('DesktopCoreBridge', () => {
  it('preserves inherited environment while applying explicit Session overrides', async () => {
    const supervisor = new FakeSupervisor();
    const bridge = createDesktopCoreBridge(
      supervisor as unknown as CoreSupervisor,
      () => undefined,
      () => undefined,
      { PATH: 'C:/tools', HOME: 'C:/Users/test' },
    );

    await bridge.invoke('sessions:create', {
      title: 'shell',
      terminalType: 'PowerShell',
      executable: 'powershell.exe',
      args: ['-NoLogo'],
      cwd: 'C:/work',
      env: { PATH: 'C:/session-tools', TERM: 'screen-256color', CUSTOM: 'enabled' },
      executionDialect: 'powershell',
    });

    expect(supervisor.requests[0]).toMatchObject({
      method: 'session.create',
      payload: {
        env: {
          PATH: 'C:/session-tools',
          HOME: 'C:/Users/test',
          TERM: 'screen-256color',
          CUSTOM: 'enabled',
        },
      },
    });
    bridge.dispose();
  });

  it('maps only declared renderer channels to validated Core methods', async () => {
    const supervisor = new FakeSupervisor();
    const outputs: unknown[] = [];
    const timelines: unknown[] = [];
    const deltas: unknown[] = [];
    const resources: unknown[] = [];
    const bridge = createDesktopCoreBridge(
      supervisor as unknown as CoreSupervisor,
      (event) => outputs.push(event),
      (event) => timelines.push(event),
      { PATH: 'C:/tools', HOME: 'C:/Users/test' },
      () => ({ home: 'C:/Users/test', shells: [] }),
      (event) => resources.push(event),
      undefined,
      (event) => deltas.push(event),
    );

    await expect(bridge.invoke('sessions:environment')).resolves.toEqual({
      home: 'C:/Users/test',
      shells: [],
    });

    await bridge.invoke('sessions:create', {
      title: 'shell',
      terminalType: 'Git Bash',
      executable: 'bash.exe',
      args: ['-i'],
      cwd: 'C:/work',
      env: {},
      executionDialect: 'posix',
    });
    await bridge.invoke('sessions:set-dialect', 'session-1', 'powershell');
    await bridge.invoke('sessions:rename', 'session-1', 'renamed shell');
    await bridge.invoke('sessions:mark-shared', 'session-1');
    await bridge.invoke('resources:get', 'session-1');
    await bridge.invoke('resources:refresh', 'session-1');
    await bridge.invoke('agent:start', 'session-1', '检查状态', {
      modelConfigurationId: 'model-1',
      reasoningEffort: 'high',
      permissionMode: 'manual',
    });
    await bridge.invoke('providers:discover-models', 'provider-1');
    await bridge.invoke('providers:cancel-discovery', 'provider-1');
    await bridge.invoke('models:list');
    await bridge.invoke('models:test', 'model-1');
    await bridge.invoke('models:set-enabled', 'model-1', true);
    await bridge.invoke('models:set-default', 'model-1', true);
    await bridge.invoke('models:import-discovered', 'provider-1', ['model-a', 'model-b']);
    expect(supervisor.requests).toEqual([
      {
        method: 'session.create',
        payload: {
          title: 'shell',
          terminalType: 'Git Bash',
          executable: 'bash.exe',
          args: ['-i'],
          cwd: 'C:/work',
          env: { PATH: 'C:/tools', HOME: 'C:/Users/test', TERM: 'xterm-256color' },
          columns: 80,
          rows: 24,
          executionDialect: 'posix',
        },
      },
      {
        method: 'session.setDialect',
        payload: { sessionId: 'session-1', executionDialect: 'powershell' },
      },
      { method: 'session.rename', payload: { sessionId: 'session-1', alias: 'renamed shell' } },
      { method: 'session.markShared', payload: { sessionId: 'session-1' } },
      { method: 'resources.get', payload: { sessionId: 'session-1' } },
      { method: 'resources.refresh', payload: { sessionId: 'session-1' } },
      {
        method: 'agent.start',
        payload: {
          sessionId: 'session-1',
          goal: '检查状态',
          modelConfigurationId: 'model-1',
          reasoningEffort: 'high',
          permissionMode: 'manual',
        },
      },
      { method: 'provider.discoverModels', payload: { providerId: 'provider-1' } },
      { method: 'provider.cancelDiscovery', payload: { providerId: 'provider-1' } },
      { method: 'model.list', payload: {} },
      { method: 'model.test', payload: { modelConfigurationId: 'model-1' } },
      {
        method: 'model.setEnabled',
        payload: { modelConfigurationId: 'model-1', enabled: true },
      },
      {
        method: 'model.setDefault',
        payload: { modelConfigurationId: 'model-1', isDefault: true },
      },
      {
        method: 'model.importDiscovered',
        payload: { providerProfileId: 'provider-1', modelIds: ['model-a', 'model-b'] },
      },
    ]);
    await expect(bridge.invoke('filesystem:read', { path: 'secret' })).rejects.toThrow();

    for (const listener of supervisor.outputListeners) {
      listener({ sessionId: 'session-1', sequence: 2, data: 'output' });
    }
    for (const listener of supervisor.eventListeners) {
      listener({
        event: 'agent.timeline',
        payload: {
          id: 'timeline-1',
          sessionId: 'session-1',
          kind: 'assistant',
          text: 'done',
          occurredAt: '2026-07-27T00:00:00.000Z',
        },
      } as never);
      listener({
        event: 'agent.text_delta',
        payload: {
          id: 'assistant-1',
          sessionId: 'session-1',
          conversationId: 'conversation-1',
          turnId: 'turn-1',
          operation: 'append',
          delta: 'done',
          sequence: 0,
          occurredAt: '2026-07-27T00:00:00.000Z',
        },
      } as never);
      listener({
        event: 'session.resources',
        payload: {
          sessionId: 'session-1',
          snapshot: {
            dialect: 'posix',
            collectedAt: '2026-07-28T00:00:00.000Z',
            status: 'unavailable',
            host: { status: 'unavailable', reason: 'not_reported', message: '不可用' },
            os: { status: 'unavailable', reason: 'not_reported', message: '不可用' },
            uptime: { status: 'unavailable', reason: 'not_reported', message: '不可用' },
            cpu: { status: 'unavailable', reason: 'not_reported', message: '不可用' },
            memory: { status: 'unavailable', reason: 'not_reported', message: '不可用' },
            swap: { status: 'unavailable', reason: 'not_reported', message: '不可用' },
            disks: { status: 'unavailable', reason: 'not_reported', message: '不可用' },
            network: { status: 'unavailable', reason: 'not_reported', message: '不可用' },
          },
        },
      } as never);
    }
    expect(outputs).toEqual([{ sessionId: 'session-1', sequence: 2, data: 'output' }]);
    expect(timelines).toMatchObject([{ id: 'timeline-1', text: 'done' }]);
    expect(deltas).toEqual([
      expect.objectContaining({ id: 'assistant-1', delta: 'done', operation: 'append' }),
    ]);
    expect(resources).toMatchObject([{ sessionId: 'session-1' }]);
    bridge.dispose();
  });

  it('forwards schema-valid Session changes from Core to the desktop event boundary', () => {
    const supervisor = new FakeSupervisor();
    const changes: unknown[] = [];
    const createBridge = createDesktopCoreBridge as unknown as (
      supervisor: CoreSupervisor,
      emitOutput: (event: unknown) => void,
      emitTimeline: (event: unknown) => void,
      environment?: Readonly<Record<string, string | undefined>>,
      getSessionEnvironment?: () => unknown,
      emitResources?: (event: unknown) => void,
      emitSessionChanged?: (event: unknown) => void,
    ) => { dispose(): void };
    const bridge = createBridge(
      supervisor as unknown as CoreSupervisor,
      () => undefined,
      () => undefined,
      {},
      undefined,
      () => undefined,
      (event) => changes.push(event),
    );

    for (const listener of supervisor.eventListeners) {
      listener({
        event: 'session.changed',
        payload: {
          id: 'session-1',
          title: 'production shell',
          terminalType: 'Git Bash',
          pty: 'running',
          shell: 'ready',
          executionDialect: 'posix',
        },
      } as never);
    }

    expect(changes).toEqual([
      {
        id: 'session-1',
        title: 'production shell',
        terminalType: 'Git Bash',
        pty: 'running',
        shell: 'ready',
        executionDialect: 'posix',
      },
    ]);
    bridge.dispose();
  });

  it('maps every declared request channel to its schema-validated Core operation', async () => {
    const supervisor = new FakeSupervisor();
    const bridge = createDesktopCoreBridge(
      supervisor as unknown as CoreSupervisor,
      () => undefined,
      () => undefined,
      { PATH: '/usr/bin', HOME: '/tmp' },
      () => ({ home: '/tmp', shells: [] }),
    );
    const provider = {
      id: 'provider-1',
      name: 'Operations',
      protocol: 'openai_responses',
      baseUrl: 'https://api.example.test/v1',
    };
    const model = {
      id: 'model-1',
      name: 'Local model',
      providerProfileId: provider.id,
      modelId: 'local-model',
      contextWindowTokens: 32_768,
      maxOutputTokens: 4_096,
      autoCompact: true,
      compactThresholdPercent: 80,
      supportedReasoningEfforts: ['low', 'medium'],
      defaultReasoningEffort: 'medium',
      declaredCapabilities: { responses: true, streaming: true, toolCalls: true },
    };

    await bridge.invoke('sessions:list');
    await bridge.invoke('sessions:environment');
    await bridge.invoke('sessions:create', {
      title: 'production shell',
      terminalType: 'Git Bash',
      executable: 'bash',
      args: ['-i'],
      cwd: '/tmp',
      env: {},
      executionDialect: 'posix',
    });
    await bridge.invoke('sessions:set-dialect', 'session-1', 'powershell');
    await bridge.invoke('sessions:close', 'session-1');
    await bridge.invoke('terminal:write', 'session-1', 'pwd\r');
    await bridge.invoke('terminal:resize', 'session-1', 120, 40);
    await bridge.invoke('terminal:replay', 'session-1', 0);
    await bridge.invoke('resources:get', 'session-1');
    await bridge.invoke('resources:refresh', 'session-1');
    await bridge.invoke('agent:start', 'session-1', 'check status', { permissionMode: 'manual' });
    await bridge.invoke('agent:cancel', 'session-1', 'turn-1');
    await bridge.invoke('agent:history', 'session-1');
    await bridge.invoke('agent:reset-conversation', 'session-1', 'conversation-1');
    await bridge.invoke('agent:interrupt', 'session-1', 'transaction-1');
    await bridge.invoke('agent:approve', 'session-1', 'approval-1', true);
    await bridge.invoke('agent:takeover', 'session-1');
    await bridge.invoke('providers:list');
    await bridge.invoke('providers:save', provider, 'test-key');
    await bridge.invoke('providers:discover-models', provider.id);
    await bridge.invoke('providers:cancel-discovery', provider.id);
    await bridge.invoke('providers:remove', provider.id);
    await bridge.invoke('models:list');
    await bridge.invoke('models:save', model);
    await bridge.invoke('models:test', model.id);
    await bridge.invoke('models:set-enabled', model.id, true);
    await bridge.invoke('models:set-default', model.id, true);
    await bridge.invoke('models:remove', model.id);
    await bridge.invoke('models:import-discovered', provider.id, [model.modelId]);
    await bridge.invoke('audit:list', { sessionId: 'session-1' });
    await bridge.invoke('audit:cleanup');
    await bridge.invoke('core:status');
    await bridge.invoke('core:exit', 'keep_sessions');
    await bridge.invoke('core:exit', 'terminate_sessions');

    expect(supervisor.requests.map((request) => request.method)).toEqual([
      'session.list',
      'session.create',
      'session.setDialect',
      'session.close',
      'terminal.write',
      'terminal.resize',
      'terminal.replay',
      'resources.get',
      'resources.refresh',
      'agent.start',
      'agent.cancel',
      'agent.history',
      'agent.resetConversation',
      'agent.interrupt',
      'agent.approve',
      'agent.takeover',
      'provider.list',
      'provider.save',
      'provider.discoverModels',
      'provider.cancelDiscovery',
      'provider.remove',
      'model.list',
      'model.save',
      'model.test',
      'model.setEnabled',
      'model.setDefault',
      'model.remove',
      'model.importDiscovered',
      'audit.list',
      'audit.cleanup',
      'core.status',
    ]);
    expect(supervisor.exitRequests).toEqual(['keep_background', 'terminate_all']);
    await expect(bridge.invoke('filesystem:read', { path: '/tmp/secret' })).rejects.toThrow(
      'Renderer channel is not available',
    );
    bridge.dispose();
  });

  it('picks renderer-safe attachments and resolves their tickets before Core start', async () => {
    const supervisor = new FakeSupervisor();
    const attachmentController = new FakeAttachmentController();
    const bridge = createDesktopCoreBridge(
      supervisor as unknown as CoreSupervisor,
      () => undefined,
      () => undefined,
      {},
      undefined,
      () => undefined,
      () => undefined,
      attachmentController as never,
    );

    await expect(
      bridge.invoke('attachments:pick', { kind: 'file', currentCount: 0 }),
    ).resolves.toEqual([
      {
        attachmentId: 'ticket-1',
        name: 'notes.txt',
        mimeType: 'text/plain',
        sizeBytes: 2_048,
        kind: 'file',
      },
    ]);
    await bridge.invoke('agent:start', 'session-1', 'read notes', {
      attachments: [
        {
          attachmentId: 'ticket-1',
          name: 'notes.txt',
          mimeType: 'text/plain',
          sizeBytes: 2_048,
          kind: 'file',
        },
      ],
      permissionMode: 'manual',
    });

    expect(attachmentController.resolved).toEqual([
      [
        {
          attachmentId: 'ticket-1',
          name: 'notes.txt',
          mimeType: 'text/plain',
          sizeBytes: 2_048,
          kind: 'file',
        },
      ],
    ]);
    expect(supervisor.requests[0]).toEqual({
      method: 'agent.start',
      payload: {
        sessionId: 'session-1',
        goal: 'read notes',
        attachments: [
          {
            id: 'ticket-1',
            name: 'notes.txt',
            mimeType: 'text/plain',
            sizeBytes: 2_048,
            kind: 'file',
            sourcePath: 'C:/tmp/notes.txt',
          },
        ],
        permissionMode: 'manual',
      },
    });
    bridge.dispose();
  });

  it('rejects renderer attachment fields that include sourcePath before forwarding to Core', async () => {
    const supervisor = new FakeSupervisor();
    const bridge = createDesktopCoreBridge(
      supervisor as unknown as CoreSupervisor,
      () => undefined,
      () => undefined,
      {},
      undefined,
      () => undefined,
      () => undefined,
      createDesktopAttachmentController({ selectPaths: async () => [] }),
    );

    await expect(
      bridge.invoke('agent:start', 'session-1', 'read notes', {
        attachments: [
          {
            attachmentId: 'ticket-1',
            name: 'notes.txt',
            mimeType: 'text/plain',
            sizeBytes: 2_048,
            kind: 'file',
            sourcePath: 'C:/tmp/notes.txt',
          },
        ],
      }),
    ).rejects.toThrow();
    expect(supervisor.requests).toEqual([]);
    bridge.dispose();
  });
});
