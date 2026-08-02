import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';

import { RunningStatusBar } from './running-status-bar.js';

describe('RunningStatusBar', () => {
  it('renders nothing when not running', () => {
    const html = renderToString(
      <RunningStatusBar
        modelName="GPT"
        onCancel={() => undefined}
        running={false}
        startedAt={1_000}
      />,
    );

    expect(html).toBe('');
  });

  it('renders running status with model name and cancel action', () => {
    const html = renderToString(
      <RunningStatusBar modelName="GPT" onCancel={() => undefined} running startedAt={1_000} />,
    );

    expect(html).toContain('Agent 运行中');
    expect(html).toContain('GPT');
    expect(html).toContain('取消任务');
  });

  it('renders the ACP startup hint when starting up', () => {
    const html = renderToString(
      <RunningStatusBar
        modelName="GPT"
        onCancel={() => undefined}
        running
        startedAt={1_000}
        startup
      />,
    );

    expect(html).toContain('正在启动外部 Agent（opencode）…');
  });

  it('shows the cancelling label while a cancellation is in flight', () => {
    const html = renderToString(
      <RunningStatusBar
        cancelling
        modelName="GPT"
        onCancel={() => undefined}
        running
        startedAt={1_000}
      />,
    );

    expect(html).toContain('取消中…');
    expect(html).toContain('disabled');
  });
});
