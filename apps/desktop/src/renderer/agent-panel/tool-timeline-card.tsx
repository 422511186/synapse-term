/** 工具调用卡片（自 app.tsx 拆分）：状态、命令与返回值展示 */
import { useState, type JSX } from 'react';
import { Check, ChevronDown, Clock, FileText, Play, XCircle } from 'lucide-react';

import { isTerminalTimelineStatus, resolveTimelineStatus } from '@synapse-term/ui-platform';
import type { groupAgentTimelineItems } from '@synapse-term/ui-platform';
import type { AgentTimelineItem } from '../../preload/preload-api.js';
import { formatToolResult, parseToolCallSummary, timelineStatusLabel } from './timeline-utils.js';

export function ToolTimelineCard({
  group,
  onInterrupt,
}: {
  group: Extract<ReturnType<typeof groupAgentTimelineItems>[number], { kind: 'tool' }>;
  onInterrupt: (item: AgentTimelineItem) => Promise<void>;
}): JSX.Element {
  const [interrupting, setInterrupting] = useState(false);
  const call = group.call;
  const command = group.command;
  const result = group.result;
  const callSummary = call === undefined ? undefined : parseToolCallSummary(call.text);
  const status = resolveTimelineStatus(result, command, call);
  const statusClass =
    status === 'completed' || status === 'succeeded' || status === 'success' || status === 'done'
      ? 'is-complete'
      : isTerminalTimelineStatus(status)
        ? 'is-failed'
        : 'is-running';

  return (
    <div className="agent-tool-card">
      <div className="agent-tool-call-row">
        <Play className="agent-tool-icon" size={12} />
        <span className="agent-tool-name">{callSummary?.name ?? '工具调用'}</span>
        <code className="agent-tool-command">
          {callSummary?.command ?? command?.text ?? callSummary?.arguments ?? ''}
        </code>
        <span className={`agent-tool-status ${statusClass}`}>
          {status === 'completed' ||
          status === 'succeeded' ||
          status === 'success' ||
          status === 'done' ? (
            <Check size={12} />
          ) : isTerminalTimelineStatus(status) ? (
            <XCircle size={12} />
          ) : (
            <Clock size={12} />
          )}
          {timelineStatusLabel(status)}
        </span>
        {status === 'running' && command !== undefined && (
          <button
            aria-label="中断执行"
            className="agent-tool-interrupt"
            disabled={interrupting}
            onClick={() => {
              setInterrupting(true);
              void onInterrupt(command).finally(() => setInterrupting(false));
            }}
            type="button"
          >
            <XCircle size={12} />
            {interrupting ? '中断中…' : '中断执行'}
          </button>
        )}
      </div>
      {result !== undefined && (
        <details className="agent-tool-result">
          <summary>
            <span className="agent-tool-result-label">
              <FileText size={13} /> 返回值
            </span>
            <span className="agent-tool-result-toggle">展开</span>
            <ChevronDown className="agent-tool-result-chevron" size={14} />
          </summary>
          <pre>{formatToolResult(result.text)}</pre>
        </details>
      )}
    </div>
  );
}
