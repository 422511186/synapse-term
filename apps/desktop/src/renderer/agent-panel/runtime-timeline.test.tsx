import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import type { AgentTimelineItem } from '../../preload/preload-api.js';
import { RuntimeTimeline } from './runtime-timeline.js';

function item(overrides: Partial<AgentTimelineItem>): AgentTimelineItem {
  return {
    id: overrides.id ?? 'item-1',
    sessionId: 'session-1',
    kind: overrides.kind ?? 'system',
    text: overrides.text ?? 'event',
    occurredAt: '2026-08-04T00:00:00.000Z',
    ...overrides,
  };
}

describe('RuntimeTimeline', () => {
  it('aligns user and assistant messages without avatars', () => {
    const markup = renderToStaticMarkup(
      <RuntimeTimeline
        events={[
          item({ id: 'user-1', kind: 'user', text: '请检查项目' }),
          item({
            id: 'assistant-1',
            kind: 'assistant',
            text: '我会检查项目。',
            status: 'completed',
          }),
        ]}
        onApprove={async () => undefined}
        onInterrupt={async () => undefined}
        onTakeOver={async () => undefined}
      />,
    );

    expect(markup).toContain('agent-timeline-user');
    expect(markup).toContain('agent-timeline-assistant');
    expect(markup).toContain('justify-end');
    expect(markup).not.toContain('>ME<');
    expect(markup).not.toContain('lucide-command');
  });

  it('marks structured events as full-width timeline content', () => {
    const markup = renderToStaticMarkup(
      <RuntimeTimeline
        events={[item({ id: 'system-1', kind: 'system', text: '任务完成', status: 'completed' })]}
        onApprove={async () => undefined}
        onInterrupt={async () => undefined}
        onTakeOver={async () => undefined}
      />,
    );

    expect(markup).toContain('agent-timeline-structured');
    expect(markup).toContain('w-full');
  });

  it('does not render progress snapshots as a separate plan card', () => {
    const markup = renderToStaticMarkup(
      <RuntimeTimeline
        events={[
          item({
            id: 'progress-1',
            kind: 'system',
            text: '已完成',
            progress: {
              phase: 'completed',
              revision: 9,
              steps: [
                {
                  id: 'progress-step-1',
                  label: 'terminal_execute',
                  status: 'completed',
                },
              ],
            },
          }),
        ]}
        onApprove={async () => undefined}
        onInterrupt={async () => undefined}
        onTakeOver={async () => undefined}
      />,
    );

    expect(markup).not.toContain('agent-progress-card');
    expect(markup).not.toContain('agent-timeline-structured');
    expect(markup).not.toContain('terminal_execute');
  });
});
