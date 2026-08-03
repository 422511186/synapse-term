import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentTimelineItem } from '../preload/preload-api.js';
import { createMockDesktopApi } from './mock-api.js';

describe('mock desktop API', () => {
  afterEach(() => vi.useRealTimers());

  it('models approval and user takeover states for browser workflow tests', async () => {
    vi.useFakeTimers();
    const api = createMockDesktopApi();
    const timeline: AgentTimelineItem[] = [];
    api.agent.onTimeline((item) => timeline.push(item));

    await api.agent.start('session-local', 'delete the cache recursively');
    await vi.advanceTimersByTimeAsync(400);
    const approval = timeline.find((item) => item.kind === 'approval');
    expect(approval).toMatchObject({
      text: 'rm -rf /tmp/cache',
      status: 'waiting_approval',
      risk: 'destructive',
    });

    await expect(api.agent.approve('session-local', approval!.id, false)).rejects.toThrow(
      '破坏性操作需要二次确认',
    );
    await api.agent.approve('session-local', approval!.id, true);
    expect(timeline.findLast((item) => item.id === approval!.id)).toMatchObject({
      kind: 'approval',
      status: 'completed',
    });

    expect(timeline).toContainEqual(
      expect.objectContaining({ kind: 'command', text: 'rm -rf /tmp/cache', status: 'completed' }),
    );

    await api.agent.takeover('session-local');
    expect(timeline.at(-1)).toMatchObject({ kind: 'system', text: '已进入人工接管状态' });
  });

  it('closes a pending approval when takeover rejects the operation', async () => {
    vi.useFakeTimers();
    const api = createMockDesktopApi();
    const timeline: AgentTimelineItem[] = [];
    api.agent.onTimeline((item) => timeline.push(item));

    await api.agent.start('session-local', 'restart the api service');
    await vi.advanceTimersByTimeAsync(400);
    const approval = timeline.find((item) => item.kind === 'approval');
    expect(approval).toMatchObject({ status: 'waiting_approval' });

    await api.agent.takeover('session-local');

    expect(timeline.findLast((item) => item.id === approval!.id)).toMatchObject({
      kind: 'approval',
      status: 'cancelled',
    });
    await expect(api.agent.history('session-local')).resolves.not.toHaveProperty('activeTurnId');
  });

  it('releases an interactive turn after takeover so the next message can start', async () => {
    vi.useFakeTimers();
    const api = createMockDesktopApi();

    await api.agent.start('session-local', 'restart the api service');
    await vi.advanceTimersByTimeAsync(400);
    const history = await api.agent.history('session-local');
    expect(history.activeTurnId).toEqual(expect.any(String));

    await api.agent.takeover('session-local');
    await expect(api.agent.history('session-local')).resolves.not.toHaveProperty('activeTurnId');
    await expect(api.agent.start('session-local', '你好')).resolves.toMatchObject({
      turnId: expect.any(String),
    });
  });

  it('exposes resettable per-session conversation history', async () => {
    vi.useFakeTimers();
    const api = createMockDesktopApi();
    await api.agent.start('session-local', '你好');
    await vi.advanceTimersByTimeAsync(800);

    const history = await api.agent.history('session-local');
    expect(history).toMatchObject({
      conversation: { id: expect.any(String), permissionMode: 'auto' },
      items: expect.arrayContaining([
        expect.objectContaining({ type: 'user_text', content: '你好' }),
      ]),
    });
    await api.agent.resetConversation('session-local', history.conversation!.id);
    await expect(api.agent.history('session-local')).resolves.not.toHaveProperty('conversation');
  });

  it('separates provider connections from their model catalog and imports discovery results idempotently', async () => {
    const api = createMockDesktopApi();

    const providers = await api.providers.list();
    const models = await api.models.list();
    expect(providers).toEqual([
      expect.objectContaining({ id: 'provider-openai', credentialConfigured: true }),
    ]);
    expect(providers[0]).not.toHaveProperty('model');
    expect(models.filter((model) => model.providerProfileId === 'provider-openai')).toHaveLength(2);

    const discovered = await api.providers.discoverModels('provider-openai');
    expect(discovered.models.map((model) => model.id)).toContain('gpt-5-nano');

    await expect(
      api.models.importDiscovered('provider-openai', ['gpt-5', 'gpt-5-nano']),
    ).resolves.toEqual({ created: [expect.any(String)], skipped: ['gpt-5'] });
    await expect(api.models.importDiscovered('provider-openai', ['gpt-5-nano'])).resolves.toEqual({
      created: [],
      skipped: ['gpt-5-nano'],
    });

    const imported = (await api.models.list()).find((model) => model.modelId === 'gpt-5-nano');
    expect(imported).toMatchObject({ enabled: false, isDefault: false, status: 'unverified' });
  });

  it('enables and starts an unverified Model Configuration without a test prerequisite', async () => {
    const api = createMockDesktopApi();

    await expect(api.models.setEnabled('model-fast', true)).resolves.toMatchObject({
      enabled: true,
      status: 'unverified',
    });
    await expect(api.models.setDefault('model-fast', true)).resolves.toMatchObject({
      enabled: true,
      isDefault: true,
      status: 'unverified',
    });
    await expect(
      api.agent.start('session-local', '你好', { modelConfigurationId: 'model-missing' }),
    ).rejects.toThrow('模型配置不存在');

    await api.agent.start('session-local', '你好', { modelConfigurationId: 'model-fast' });
    const history = await api.agent.history('session-local');
    expect(history.turns[0]).toMatchObject({
      driver: 'builtin',
      model: {
        modelConfigurationId: 'model-fast',
        modelConfigurationName: '快速诊断',
        providerProfileId: 'provider-openai',
        modelId: 'gpt-5-mini',
      },
    });
  });

  it('preserves enabled and default state when an existing model is saved', async () => {
    const api = createMockDesktopApi();
    const current = (await api.models.list()).find((model) => model.id === 'model-openai')!;

    await api.models.save({
      id: current.id,
      name: 'GPT-5 renamed',
      providerProfileId: current.providerProfileId,
      modelId: 'gpt-5-updated',
      declaredCapabilities: current.declaredCapabilities,
      contextWindowTokens: current.contextWindowTokens,
      maxOutputTokens: current.maxOutputTokens,
      autoCompact: current.autoCompact,
      compactThresholdPercent: current.compactThresholdPercent,
      supportedReasoningEfforts: current.supportedReasoningEfforts,
      defaultReasoningEffort: current.defaultReasoningEffort,
    });

    await expect(api.models.list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'model-openai',
          enabled: true,
          isDefault: true,
          status: 'unverified',
        }),
      ]),
    );
  });

  it('round-trips renderer-safe attachments into Agent timeline history', async () => {
    vi.useFakeTimers();
    const api = createMockDesktopApi();
    const picked = await api.attachments.pick({ kind: 'file' });
    expect(picked[0]).toMatchObject({
      attachmentId: expect.any(String),
      name: 'notes.txt',
      mimeType: 'text/plain',
      sizeBytes: 2_048,
      kind: 'file',
    });
    expect(picked[0]).not.toHaveProperty('sourcePath');

    const timeline: AgentTimelineItem[] = [];
    api.agent.onTimeline((item) => timeline.push(item));
    await api.agent.start('session-local', '分析 notes.txt', {
      modelConfigurationId: 'model-openai',
      attachments: picked,
    });

    expect(timeline[0]).toMatchObject({
      kind: 'user',
      attachments: [
        {
          id: picked[0]!.attachmentId,
          name: 'notes.txt',
          mimeType: 'text/plain',
          sizeBytes: 2_048,
          kind: 'file',
          relativePath: 'notes.txt',
        },
      ],
    });
    const history = await api.agent.history('session-local');
    expect(history.items[0]).toMatchObject({
      type: 'user_text',
      content: '分析 notes.txt',
      attachments: [
        {
          id: picked[0]!.attachmentId,
          name: 'notes.txt',
          mimeType: 'text/plain',
          sizeBytes: 2_048,
          kind: 'file',
          relativePath: 'notes.txt',
        },
      ],
    });
  });

  it('rejects image submissions when the selected model is not multimodal', async () => {
    const api = createMockDesktopApi();
    const image = await api.attachments.pick({ kind: 'image' });
    await api.models.setEnabled('model-fast', true);

    await expect(
      api.agent.start('session-local', '查看截图', {
        modelConfigurationId: 'model-fast',
        attachments: image,
      }),
    ).rejects.toThrow('当前模型不支持图片输入');
    await expect(
      api.agent.start('session-local', '查看截图', {
        modelConfigurationId: 'model-openai',
        attachments: image,
      }),
    ).resolves.toMatchObject({ turnId: expect.any(String) });
  });

  it('enforces the renderer attachment count budget in mock mode', async () => {
    const api = createMockDesktopApi();

    await expect(api.attachments.pick({ kind: 'file', currentCount: 8 })).rejects.toThrow(
      '一次任务最多可携带 8 个附件',
    );
  });
});
