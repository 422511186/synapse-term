import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { GeneralSettingsView, McpSettingsView } from '../mcp/mcp-settings-section.js';
import { createMockDesktopApi } from '../mock-api.js';
import { SettingsWorkspace } from './settings-workspace.js';

describe('SettingsWorkspace', () => {
  it('renders the dedicated workspace without topic dropdowns', () => {
    const markup = renderToStaticMarkup(
      <SettingsWorkspace api={createMockDesktopApi()} onBack={vi.fn()} />,
    );
    expect(markup).toContain('设置工作区');
    expect(markup).toContain('返回工作区');
    expect(markup).toContain('设置加载中');
    expect(markup).not.toContain('服务商配置');
    expect(markup).not.toContain('模型配置');
    expect(markup).not.toContain('ACP 集成');
    expect(markup).not.toContain('审计日志');
  });

  it('renders MCP controls, full-permission warning, and shared sessions', () => {
    const markup = renderToStaticMarkup(
      <McpSettingsView
        busy={false}
        onRegenerateToken={vi.fn()}
        onRevokeToken={vi.fn()}
        onSetMode={vi.fn()}
        onSetPort={vi.fn()}
        onToggleEnabled={vi.fn()}
        onToggleShowToken={vi.fn()}
        onUnshare={vi.fn()}
        shared={[{ id: 'session-1', title: 'build', sharedAt: '2026-08-25T00:00:00Z' }]}
        showToken={false}
        settings={{ enabled: true, approvalMode: 'full', port: 4_739, token: 'token-value' }}
        status={{ running: true, connectionString: 'http://127.0.0.1:4739/mcp' }}
      />,
    );
    expect(markup).toContain('MCP 服务');
    expect(markup).toContain('完全权限会自动执行高风险命令');
    expect(markup).toContain('http://127.0.0.1:4739/mcp');
    expect(markup).toContain('取消共享');
    expect(markup).not.toContain('暂无设置项');
  });

  it('renders the general probe visibility setting with the remote audit warning', () => {
    const markup = renderToStaticMarkup(
      <GeneralSettingsView
        busy={false}
        onToggleHideProbeEcho={vi.fn()}
        settings={{ hideCompletionProbeEcho: true }}
      />,
    );

    expect(markup).toContain('通用');
    expect(markup).toContain('隐藏自动 Probe 回显');
    expect(markup).toContain('仅控制本地终端 UI');
    expect(markup).toContain('Probe 仍会写入当前 PTY');
    expect(markup).toContain('远程服务器记录 Probe');
    expect(markup).toContain('checked=""');
  });

  it('keeps the fixed port and authorization header inside the MCP service configuration', () => {
    const markup = renderToStaticMarkup(
      <McpSettingsView
        busy={false}
        onRegenerateToken={vi.fn()}
        onRevokeToken={vi.fn()}
        onSetMode={vi.fn()}
        onSetPort={vi.fn()}
        onToggleEnabled={vi.fn()}
        onToggleShowToken={vi.fn()}
        onUnshare={vi.fn()}
        shared={[]}
        showToken={false}
        settings={{ enabled: true, approvalMode: 'managed', port: 4_739, token: 'token-value' }}
        status={{ running: true, port: 4_739, connectionString: 'http://127.0.0.1:4739/mcp' }}
      />,
    );

    expect(markup).toContain('MCP 服务端口');
    expect(markup).toContain('4739');
    expect(markup).toContain('Authorization');
    expect(markup).toContain('Bearer');
    expect(markup).toContain('复制请求头');
    expect(markup).not.toContain('settings-nav');
  });
});
