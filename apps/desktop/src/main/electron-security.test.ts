import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { DesktopWindowRegistry, createBrowserWindowOptions } from './electron-window.js';
import {
  createDesktopApi,
  type ModelConfigurationInput,
  type ProviderProfileInput,
  type RendererIpc,
} from '../preload/preload-api.js';

describe('Electron security boundary', () => {
  it('enables sandbox and context isolation while disabling Node integration', () => {
    expect(createBrowserWindowOptions('C:/app/preload.js')).toMatchObject({
      minWidth: 360,
      minHeight: 600,
      webPreferences: {
        preload: 'C:/app/preload.js',
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
  });

  it('starts desktop windows with the native menu bar hidden', () => {
    expect(createBrowserWindowOptions('C:/app/preload.js')).toMatchObject({
      autoHideMenuBar: true,
    });
  });

  it('integrates macOS traffic lights with the prototype Header', () => {
    expect(createBrowserWindowOptions('C:/app/preload.js')).toMatchObject({
      backgroundColor: '#09090b',
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 20 },
    });
  });

  it('keeps Markdown links outside the Electron renderer process', () => {
    const source = readFileSync(new URL('./electron-main.ts', import.meta.url), 'utf8');

    expect(source).toContain('setWindowOpenHandler');
    expect(source).toContain('shell.openExternal');
    expect(source).toContain("action: 'deny'");
  });

  it('retains desktop windows until Electron reports that they closed', () => {
    let onClosed: (() => void) | undefined;
    const window = {
      once: (event: 'closed', listener: () => void) => {
        expect(event).toBe('closed');
        onClosed = listener;
      },
    };
    const registry = new DesktopWindowRegistry();

    expect(registry.retain(window)).toBe(window);
    expect(registry.size).toBe(1);

    onClosed?.();
    expect(registry.size).toBe(0);
  });

  it('exposes only the narrow declared renderer API', async () => {
    const channels: string[] = [];
    const subscriptions: string[] = [];
    let sessionChangedListener: ((payload: unknown) => void) | undefined;
    const ipc: RendererIpc = {
      invoke: async (channel) => {
        channels.push(channel);
        return [];
      },
      on: (channel, listener) => {
        subscriptions.push(channel);
        if (channel === 'session:changed') sessionChangedListener = listener;
        return () => undefined;
      },
    };
    const api = createDesktopApi(ipc, 'darwin');

    await api.sessions.list();
    await api.providers.list();
    expect(channels).toEqual(['sessions:list', 'providers:list']);
    expect(api.platform).toBe('darwin');
    expect(api.sessions).toHaveProperty('onChanged');
    const onChanged = (
      api.sessions as typeof api.sessions & {
        onChanged?: (listener: (session: unknown) => void) => () => void;
      }
    ).onChanged;
    if (onChanged !== undefined) {
      const received: unknown[] = [];
      onChanged((session) => received.push(session));
      sessionChangedListener?.({ id: 'session-1' });
      expect(subscriptions).toContain('session:changed');
      expect(received).toEqual([{ id: 'session-1' }]);
    }
    expect(api).not.toHaveProperty('secrets');
    expect(api).not.toHaveProperty('databasePath');
  });

  it('maps every declared DesktopApi request and stream to its narrow IPC channel', async () => {
    const requests: string[] = [];
    const streams: string[] = [];
    const ipc: RendererIpc = {
      invoke: async (channel) => {
        requests.push(channel);
        if (channel === 'audit:list') return { items: [] };
        if (channel === 'audit:detail') return null;
        if (channel === 'audit:retention') {
          return { auditRetentionDays: 30, rawLogRetentionHours: 24 };
        }
        if (channel === 'audit:cleanup') return { rawLogs: 0, auditEvents: 0 };
        return null;
      },
      on: (channel) => {
        streams.push(channel);
        return () => undefined;
      },
    };
    const api = createDesktopApi(ipc);
    const provider: ProviderProfileInput = {
      id: 'provider-1',
      name: 'Operations',
      protocol: 'openai_responses',
      baseUrl: 'https://api.example.test/v1',
      extraHeaders: {},
      timeoutMs: 30_000,
    };
    const model: ModelConfigurationInput = {
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
    const launch = {
      title: 'production shell',
      terminalType: 'Git Bash',
      executable: 'bash',
      args: ['-i'],
      cwd: '/tmp',
      env: {},
      executionDialect: 'posix' as const,
    };

    await api.sessions.list();
    await api.sessions.environment();
    await api.sessions.create(launch);
    await api.sessions.setDialect('session-1', 'powershell');
    await api.sessions.close('session-1');
    await api.terminal.write('session-1', 'pwd\r');
    await api.terminal.resize('session-1', 120, 40);
    await api.terminal.replay('session-1', 0);
    await api.resources.get('session-1');
    await api.resources.refresh('session-1');
    await api.attachments.pick({ kind: 'file' });
    await api.agent.start('session-1', 'check status', { permissionMode: 'manual' });
    await api.agent.cancel('session-1', 'turn-1');
    await api.agent.history('session-1');
    await api.agent.resetConversation('session-1', 'conversation-1');
    await api.agent.interrupt('session-1', 'transaction-1');
    await api.agent.approve('session-1', 'approval-1', true);
    await api.agent.takeover('session-1');
    await api.providers.list();
    await api.providers.save(provider, 'test-key');
    await api.providers.discoverModels(provider.id);
    await api.providers.cancelDiscovery(provider.id);
    await api.providers.remove(provider.id);
    await api.models.list();
    await api.models.save(model);
    await api.models.test(model.id);
    await api.models.setEnabled(model.id, true);
    await api.models.setDefault(model.id, true);
    await api.models.remove(model.id);
    await api.models.importDiscovered(provider.id, ['local-model']);
    await api.audit.list({ sessionId: 'session-1' });
    await api.audit.detail('task:task-1');
    await api.audit.retention();
    await api.audit.cleanup();
    await api.core.status();
    await api.core.exit('keep_sessions');
    api.sessions.onChanged(() => undefined);
    api.terminal.onOutput(() => undefined);
    api.resources.onSnapshot(() => undefined);
    api.agent.onTimeline(() => undefined);

    expect(requests).toEqual([
      'sessions:list',
      'sessions:environment',
      'sessions:create',
      'sessions:set-dialect',
      'sessions:close',
      'terminal:write',
      'terminal:resize',
      'terminal:replay',
      'resources:get',
      'resources:refresh',
      'attachments:pick',
      'agent:start',
      'agent:cancel',
      'agent:history',
      'agent:reset-conversation',
      'agent:interrupt',
      'agent:approve',
      'agent:takeover',
      'providers:list',
      'providers:save',
      'providers:discover-models',
      'providers:cancel-discovery',
      'providers:remove',
      'models:list',
      'models:save',
      'models:test',
      'models:set-enabled',
      'models:set-default',
      'models:remove',
      'models:import-discovered',
      'audit:list',
      'audit:detail',
      'audit:retention',
      'audit:cleanup',
      'core:status',
      'core:exit',
    ]);
    expect(streams).toEqual([
      'session:changed',
      'terminal:output',
      'session:resources',
      'agent:timeline',
    ]);
  });

  it('normalizes an absent audit detail returned as IPC null', async () => {
    const api = createDesktopApi({
      invoke: async () => null,
      on: () => () => undefined,
    });

    await expect(api.audit.detail('event:missing')).resolves.toBeUndefined();
  });

  it('rejects an audit list response that is not a stable DTO', async () => {
    const api = createDesktopApi({
      invoke: async () => ({ items: [{ payload: { secret: 'must-not-cross-ipc' } }] }),
      on: () => () => undefined,
    });

    await expect(api.audit.list()).rejects.toThrow();
  });

  it('ships a renderer Content Security Policy without unsafe script execution', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain("script-src 'self'");
    expect(html).not.toContain("script-src 'self' 'unsafe-eval'");
  });
});
