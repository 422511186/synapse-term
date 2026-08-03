import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';

import type {
  DesktopApi,
  ModelConfigurationView,
  ProviderProfileView,
} from '../../preload/preload-api.js';
import { ToastProvider } from '../feedback/index.js';
import { ModelEditModal } from './model-edit-modal.js';

const provider: ProviderProfileView = {
  id: 'provider-1',
  name: 'OpenAI',
  protocol: 'openai_responses',
  baseUrl: 'https://api.openai.com/v1',
  extraHeaders: {},
  timeoutMs: 30_000,
  credentialConfigured: true,
  revision: 1,
};

const model: ModelConfigurationView = {
  id: 'model-1',
  name: 'GPT',
  providerProfileId: provider.id,
  providerName: provider.name,
  providerProtocol: provider.protocol,
  modelId: 'gpt-test',
  declaredCapabilities: {
    responses: true,
    streaming: true,
    toolCalls: true,
    multimodal: true,
  },
  contextWindowTokens: 128_000,
  maxOutputTokens: 4_096,
  autoCompact: true,
  compactThresholdPercent: 80,
  supportedReasoningEfforts: ['low', 'medium', 'high'],
  defaultReasoningEffort: 'medium',
  enabled: true,
  isDefault: false,
  status: 'unverified',
  validation: { status: 'unverified' },
  revision: 1,
};

describe('ModelEditModal multimodal declaration', () => {
  it('loads an existing multimodal declaration into the editor', () => {
    const html = renderToString(
      <ToastProvider>
        <ModelEditModal
          api={{} as DesktopApi}
          model={model}
          onClose={() => undefined}
          onSaved={async () => undefined}
          providers={[provider]}
        />
      </ToastProvider>,
    );

    expect(html).toContain('支持多模态');
    expect(html).toContain('aria-label="支持多模态"');
    expect(html).toContain('checked=""');
    expect(html).toContain('已开启');
  });

  it('defaults new models to non-multimodal', () => {
    const html = renderToString(
      <ToastProvider>
        <ModelEditModal
          api={{} as DesktopApi}
          model={undefined}
          onClose={() => undefined}
          onSaved={async () => undefined}
          providers={[provider]}
        />
      </ToastProvider>,
    );

    expect(html).toContain('aria-label="支持多模态"');
    expect(html).toContain('已关闭');
  });
});
