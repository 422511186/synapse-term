import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { ExternalExecutionStatus } from './external-execution-status.js';

const execution = {
  sessionId: 'session-1',
  transactionId: 'transaction-1',
  command: 'npm run build -- --profile production --very-long-argument',
  source: 'MCP 外部客户端',
  phase: 'started' as const,
};

describe('ExternalExecutionStatus', () => {
  it('shows a command summary, source, and accessible full command while started', () => {
    const markup = renderToStaticMarkup(<ExternalExecutionStatus execution={execution} />);

    expect(markup).toContain('外部执行中');
    expect(markup).toContain('来源：MCP 外部客户端');
    expect(markup).toContain('npm run build -- --profile production --very-long-argument');
    expect(markup).toContain('data-testid="external-execution-banner"');
    expect(markup).toContain('title="npm run build -- --profile production --very-long-argument"');
  });

  it('does not render after the execution finishes', () => {
    const markup = renderToStaticMarkup(
      <ExternalExecutionStatus execution={{ ...execution, phase: 'finished' }} />,
    );

    expect(markup).toBe('');
  });
});
