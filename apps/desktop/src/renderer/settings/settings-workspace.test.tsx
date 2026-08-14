import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { SettingsWorkspace } from './settings-workspace.js';

describe('SettingsWorkspace', () => {
  it('renders a single placeholder page without topic navigation', () => {
    const markup = renderToStaticMarkup(<SettingsWorkspace onBack={vi.fn()} />);
    expect(markup).toContain('设置工作区');
    expect(markup).toContain('返回工作区');
    expect(markup).toContain('暂无设置项');
    expect(markup).not.toContain('服务商配置');
    expect(markup).not.toContain('模型配置');
    expect(markup).not.toContain('MCP 服务');
    expect(markup).not.toContain('ACP 集成');
    expect(markup).not.toContain('审计日志');
  });
});
