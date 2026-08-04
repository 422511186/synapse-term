import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';

import { RunningStatusBar } from './running-status-bar.js';

describe('RunningStatusBar', () => {
  it('renders nothing when not running', () => {
    const html = renderToString(
      <RunningStatusBar modelName="GPT" running={false} startedAt={1_000} />,
    );

    expect(html).toBe('');
  });

  it('renders running status with model name and duration without a cancel action', () => {
    const html = renderToString(<RunningStatusBar modelName="GPT" running startedAt={1_000} />);

    expect(html).toContain('Agent 运行中');
    expect(html).toContain('GPT');
    expect(html).toContain('已运行');
    expect(html).not.toContain('取消任务');
    expect(html).not.toContain('<button');
  });
});
