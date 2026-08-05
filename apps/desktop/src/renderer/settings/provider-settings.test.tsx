import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';

import type { DesktopApi, ProviderProfileView } from '../../preload/preload-api.js';
import { ToastProvider } from '../feedback/index.js';
import { ProviderSettings } from './provider-settings.js';

function provider(id: string): ProviderProfileView {
  return {
    id,
    name: `Provider ${id}`,
    protocol: 'openai_responses',
    baseUrl: `https://${id}.example.com/v1`,
    credentialConfigured: true,
    revision: 1,
  };
}

describe('ProviderSettings list controls', () => {
  it('does not show search for a small provider list', () => {
    const html = renderToString(
      <ToastProvider>
        <ProviderSettings
          api={{} as DesktopApi}
          providers={[provider('one')]}
          onEdit={() => undefined}
          onNew={() => undefined}
          onRefresh={async () => undefined}
        />
      </ToastProvider>,
    );

    expect(html).not.toContain('搜索服务商');
    expect(html).not.toContain('服务商分页');
  });

  it('shows search when the provider list becomes large instead of pagination', () => {
    const html = renderToString(
      <ToastProvider>
        <ProviderSettings
          api={{} as DesktopApi}
          providers={Array.from({ length: 16 }, (_, index) => provider(`provider-${index + 1}`))}
          onEdit={() => undefined}
          onNew={() => undefined}
          onRefresh={async () => undefined}
        />
      </ToastProvider>,
    );

    expect(html).toContain('搜索服务商');
    expect(html).not.toContain('服务商分页');
  });

  it('renders each provider as one row with comparable fields and row actions', () => {
    const html = renderToString(
      <ToastProvider>
        <ProviderSettings
          api={{} as DesktopApi}
          providers={[provider('provider-1')]}
          onEdit={() => undefined}
          onNew={() => undefined}
          onRefresh={async () => undefined}
        />
      </ToastProvider>,
    );

    expect(html).toContain('aria-label="服务商配置列表"');
    expect(html).toContain('<th');
    expect(html).toContain('服务商');
    expect(html).toContain('Base URL');
    expect(html).toContain('凭据状态');
    expect(html).toContain('操作');
    expect(html).toContain('<tbody');
    expect(html).toContain('Provider provider-1');
    expect(html).toContain('https://provider-1.example.com/v1');
    expect(html).toContain('测试连接');
    expect(html).toContain('编辑');
    expect(html).toContain('aria-label="测试连接 Provider provider-1"');
    expect(html).toContain('aria-label="编辑 Provider provider-1"');
    expect(html).not.toContain('测试连接 / 编辑');
    expect(html).toContain('>删除<');
    expect(html).not.toContain('lucide-x');
    expect(html).not.toContain('border-red-500/20');
    expect(html).not.toContain('grid-cols-1 md:grid-cols-2');
  });
});
