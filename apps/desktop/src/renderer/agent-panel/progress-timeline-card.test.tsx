import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import type { AgentProgressSnapshot } from '@synapse-term/ui-platform';
import { ProgressTimelineCard } from './progress-timeline-card.js';

describe('ProgressTimelineCard', () => {
  it('renders bounded phase and step metadata without tool arguments', () => {
    const progress: AgentProgressSnapshot = {
      phase: 'executing',
      revision: 2,
      steps: [
        {
          id: 'progress-step-call-1',
          label: 'terminal_execute',
          status: 'running',
          toolCallId: 'call-1',
        },
      ],
    };

    const markup = renderToStaticMarkup(<ProgressTimelineCard progress={progress} />);

    expect(markup).toContain('正在执行');
    expect(markup).toContain('terminal_execute');
    expect(markup).toContain('执行中');
    expect(markup).not.toContain('command');
    expect(markup).not.toContain('secret');
  });
});
