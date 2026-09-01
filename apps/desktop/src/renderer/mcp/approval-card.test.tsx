import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { ApprovalCard } from './approval-card.js';

const request = {
  id: 'approval-1',
  sessionId: 'session-1',
  command:
    'rm -rf build && npm run deploy -- --environment production --region ap-southeast-1 --confirm',
  risk: 'destructive' as const,
  reasons: ['irreversible'],
};

describe('ApprovalCard', () => {
  it('shows the full command, target, reason, and three decisions', () => {
    const markup = renderToStaticMarkup(<ApprovalCard onDecide={vi.fn()} request={request} />);
    expect(markup).toContain('session-1');
    expect(markup).toContain('命令全文');
    expect(markup).toContain('风险理由');
    expect(markup).toContain('破坏性');
    expect(markup).toContain('rm -rf build');
    expect(markup).toContain('approval-command-scroll');
    expect(markup).toContain(
      'title="rm -rf build &amp;&amp; npm run deploy -- --environment production --region ap-southeast-1 --confirm"',
    );
    expect(markup).toContain('允许一次');
    expect(markup).toContain('本会话内放行该命令');
    expect(markup).toContain('拒绝');
  });

  it('keeps the three decision values attached to their visible actions', () => {
    const markup = renderToStaticMarkup(
      <ApprovalCard onDecide={() => undefined} request={request} />,
    );

    expect(markup).toContain('data-decision="allow_once"');
    expect(markup).toContain('data-decision="allow_session"');
    expect(markup).toContain('data-decision="denied"');
  });
});
