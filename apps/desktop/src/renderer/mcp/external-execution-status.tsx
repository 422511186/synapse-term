import { Radio } from 'lucide-react';
import type { JSX } from 'react';

import type { McpExecutionEvent } from '../../shared/contracts.js';

export function ExternalExecutionStatus({
  execution,
}: {
  execution: McpExecutionEvent;
}): JSX.Element | null {
  if (execution.phase === 'finished') return null;

  return (
    <aside
      aria-label="外部执行状态"
      className="external-execution-banner"
      data-testid="external-execution-banner"
    >
      <div className="external-execution-status-label">
        <Radio aria-hidden="true" size={14} />
        <span>外部执行中</span>
      </div>
      <code
        aria-label={`外部执行命令：${execution.command}`}
        className="external-execution-command"
        title={execution.command}
      >
        {execution.command}
      </code>
      <span className="external-execution-source">来源：{execution.source}</span>
    </aside>
  );
}
