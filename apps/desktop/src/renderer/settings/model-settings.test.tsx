import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';

import type { DesktopApi, ModelConfigurationView } from '../../preload/preload-api.js';
import { ToastProvider } from '../feedback/index.js';
import { ModelSettings } from './model-settings.js';

function view(overrides: Partial<ModelConfigurationView>): ModelConfigurationView {
  return {
    id: 'model-1',
    name: 'GPT',
    providerProfileId: 'provider-1',
    providerName: 'OpenAI',
    providerProtocol: 'openai_responses',
    modelId: 'gpt-test',
    declaredCapabilities: { responses: true, streaming: true, toolCalls: true },
    contextWindowTokens: 128_000,
    maxOutputTokens: 4_096,
    autoCompact: true,
    compactThresholdPercent: 80,
    supportedReasoningEfforts: ['low', 'medium', 'high'],
    defaultReasoningEffort: 'medium',
    enabled: false,
    isDefault: false,
    status: 'unverified',
    validation: { status: 'unverified' },
    revision: 1,
    ...overrides,
  };
}

describe('ModelSettings status columns', () => {
  it('separates enable state, detection result, and multimodal capability', () => {
    const models = [
      view({
        name: 'Multimodal',
        declaredCapabilities: {
          responses: true,
          streaming: true,
          toolCalls: true,
          multimodal: true,
        },
        enabled: true,
        status: 'available',
        validation: {
          status: 'available',
          checkedAt: '2026-01-01T00:00:00.000Z',
          attempt: 1,
          capabilities: {
            responses: true,
            streaming: true,
            toolCalls: true,
            multimodal: true,
          },
        },
      }),
      view({
        id: 'legacy',
        name: 'Legacy',
        enabled: false,
      }),
    ];

    const html = renderToString(
      <ToastProvider>
        <ModelSettings
          api={{} as DesktopApi}
          models={models}
          onBack={() => undefined}
          onEdit={() => undefined}
          onNew={() => undefined}
          onRefresh={async () => undefined}
          onModelsChange={() => undefined}
        />
      </ToastProvider>,
    );

    expect(html).toContain('启用/停用');
    expect(html).toContain('检测结果');
    expect(html).toContain('多模态');
    expect(html).toContain('可用');
    expect(html).toContain('待检测');
    expect(html).toContain('支持');
    expect(html).toContain('不支持');
    expect(html).not.toContain('运行状态');
    expect(html).not.toContain('已启用 · 可用');
  });
});
