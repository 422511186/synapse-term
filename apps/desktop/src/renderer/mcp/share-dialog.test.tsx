import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { ShareDialog } from './share-dialog.js';

describe('ShareDialog', () => {
  it('shows an actionable, shell-aware MCP handoff instead of vague setup instructions', () => {
    const props = {
      onClose: vi.fn(),
      sessionId: 'session-1',
      title: '系统监控',
      terminalType: 'Git Bash',
      mcpStatus: {
        running: true,
        port: 4_739,
        connectionString: 'http://127.0.0.1:4739/mcp',
      },
    };
    const markup = renderToStaticMarkup(
      <ShareDialog {...(props as Parameters<typeof ShareDialog>[0])} />,
    );

    expect(markup).toContain('内嵌 MCP Server 可连接');
    expect(markup).toContain('系统监控');
    expect(markup).toContain('启动 Shell 提示：Git Bash（仅供参考）');
    expect(markup).toContain('当前 PTY environment');
    expect(markup).toContain('synapse_status');
    expect(markup).not.toContain('先在 MCP 配置中填入');
  });

  it('distinguishes a shared Session from a stopped MCP Server', () => {
    const markup = renderToStaticMarkup(
      <ShareDialog
        mcpStatus={{ running: false }}
        onClose={vi.fn()}
        sessionId="session-1"
        terminalType="PowerShell"
        title="系统监控"
      />,
    );

    expect(markup).toContain('Session 已共享');
    expect(markup).toContain('内嵌 MCP Server 当前未运行');
    expect(markup).not.toContain('MCP 服务已配置连接方式');
  });
});
