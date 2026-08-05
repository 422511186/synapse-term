import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';

import { createMockDesktopApi } from '../renderer/mock-api.js';
import { ToastProvider } from '../renderer/feedback/index.js';
import { McpSettingsView } from './mcp-settings-view.js';

function renderSettings(): string {
  return renderToString(
    <ToastProvider>
      <McpSettingsView api={createMockDesktopApi()} onBack={() => undefined} />
    </ToastProvider>,
  );
}

describe('McpSettingsView', () => {
  it('offers read-only, managed and full permission modes', () => {
    const html = renderSettings();
    expect(html).toContain('只读模式');
    expect(html).toContain('托管模式');
    expect(html).toContain('完全权限模式');
    expect(html).toContain('不审查命令，任何命令直接放行（高风险）');
  });

  it('renders as workspace content without an inner return action', () => {
    const html = renderToString(
      <ToastProvider>
        <McpSettingsView api={createMockDesktopApi()} />
      </ToastProvider>,
    );

    expect(html).not.toContain('返回工作区');
    expect(html).not.toContain('absolute inset-0');
  });
});
