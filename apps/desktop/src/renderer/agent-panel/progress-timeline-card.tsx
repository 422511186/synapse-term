import type { JSX } from 'react';
import { Check, Circle, Clock, Loader2, XCircle } from 'lucide-react';

import type {
  AgentProgressPhase,
  AgentProgressSnapshot,
  AgentProgressStep,
} from '@synapse-term/ui-platform';

const phaseLabels: Record<AgentProgressPhase, string> = {
  planning: '正在规划',
  executing: '正在执行',
  verifying: '正在复核',
  waiting_approval: '等待审批',
  waiting_user: '等待用户',
  suspended: '已暂停',
  completed: '已完成',
  failed: '执行失败',
  cancelled: '已取消',
};

const stepStatusLabels: Record<AgentProgressStep['status'], string> = {
  pending: '待执行',
  running: '执行中',
  waiting_approval: '等待审批',
  waiting_user: '等待用户',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

export function ProgressTimelineCard({
  progress,
}: {
  progress: AgentProgressSnapshot;
}): JSX.Element {
  return (
    <div className="agent-progress-card" data-phase={progress.phase}>
      <div className="agent-progress-header">
        <div className="agent-progress-title">
          <Loader2 aria-hidden="true" className="agent-progress-spinner" size={14} />
          <span>{phaseLabels[progress.phase]}</span>
        </div>
        <span className="agent-progress-revision">#{progress.revision}</span>
      </div>
      {progress.steps.length > 0 && (
        <ol className="agent-progress-steps">
          {progress.steps.map((step) => (
            <li className="agent-progress-step" key={step.id}>
              <StepStatusIcon status={step.status} />
              <span className="agent-progress-step-label">{step.label}</span>
              <span className="agent-progress-step-status">{stepStatusLabels[step.status]}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function StepStatusIcon({ status }: { status: AgentProgressStep['status'] }): JSX.Element {
  if (status === 'completed') return <Check aria-hidden="true" size={13} />;
  if (status === 'failed' || status === 'cancelled') {
    return <XCircle aria-hidden="true" size={13} />;
  }
  if (status === 'running') return <Clock aria-hidden="true" size={13} />;
  return <Circle aria-hidden="true" size={13} />;
}
