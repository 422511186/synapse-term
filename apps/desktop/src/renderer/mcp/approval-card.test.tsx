import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { ApprovalCard } from './approval-card.js';

const request = {
  id: 'approval-1',
  sessionId: 'session-1',
  command: 'rm -rf build',
  risk: 'destructive' as const,
  reasons: ['irreversible'],
};

describe('ApprovalCard', () => {
  it('shows the full command, target, reason, and three decisions', () => {
    const markup = renderToStaticMarkup(<ApprovalCard onDecide={vi.fn()} request={request} />);
    expect(markup).toContain('session-1');
    expect(markup).toContain('rm -rf build');
    expect(markup).toContain('允许一次');
    expect(markup).toContain('本会话内放行该命令');
    expect(markup).toContain('拒绝');
  });
});
