import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import type { McpApprovalRequest } from '../../shared/contracts.js';
import { ApprovalCard } from './approval-card.js';

/** 夹具用真实引擎对这条命令会产生的理由，而不是随手编一个字符串。 */
const request: McpApprovalRequest = {
  id: 'approval-1',
  sessionId: 'session-1',
  command:
    'rm -rf build && npm run deploy -- --environment production --region ap-southeast-1 --confirm',
  risk: 'destructive',
  reasons: [
    { code: 'irreversible-destructive-command', subject: 'rm' },
    { code: 'state-changing-command', subject: 'npm' },
  ],
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
    expect(markup).toContain('rm 具有破坏性语义；npm 可能更改系统状态');
  });

  it('renders the reasons that used to leak English onto the card', () => {
    const markup = renderToStaticMarkup(
      <ApprovalCard
        onDecide={() => undefined}
        request={{
          ...request,
          reasons: [{ code: 'sort-output-file' }, { code: 'sysctl-kernel-state' }],
        }}
      />,
    );

    expect(markup).toContain('sort 的 -o/--output 可能修改文件系统');
    expect(markup).toContain('sysctl 写选项可能更改内核状态');
    expect(markup).not.toContain('can change filesystem state');
    expect(markup).not.toContain('kernel state');
  });

  it('keeps the three decision values attached to their visible actions', () => {
    const markup = renderToStaticMarkup(
      <ApprovalCard onDecide={() => undefined} request={request} />,
    );

    expect(markup).toContain('data-decision="allow_once"');
    expect(markup).toContain('data-decision="allow_session"');
    expect(markup).toContain('data-decision="denied"');
  });

  it('shows fixed limits for interactive grants without showing future input', () => {
    const markup = renderToStaticMarkup(
      <ApprovalCard
        onDecide={() => undefined}
        request={{
          ...request,
          kind: 'interactive',
          inputGrantMode: 'bounded',
          inputLimits: { maxCalls: 256, maxBytes: 262_144, idleTimeoutMs: 600_000 },
        }}
      />,
    );

    expect(markup).toContain('后续输入授权');
    expect(markup).toContain('bounded');
    expect(markup).toContain('256 次');
    expect(markup).toContain('262,144 bytes');
    expect(markup).toContain('10 分钟');
    expect(markup).not.toContain('future-password');
  });

  it('renders normalized free-input text and key names for approval matching', () => {
    const markup = renderToStaticMarkup(
      <ApprovalCard
        onDecide={() => undefined}
        request={{
          ...request,
          command: '[free_input]',
          kind: 'free_input',
          reasons: [{ code: 'free-input-writes-to-pty' }],
          text: 'menu choice',
          keys: ['down', 'enter'],
        }}
      />,
    );

    expect(markup).toContain('待发送的自由输入');
    expect(markup).toContain('menu choice');
    expect(markup).toContain('键名：down、enter');
  });
});
