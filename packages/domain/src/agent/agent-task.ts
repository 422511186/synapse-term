export interface CreateAgentTaskInput {
  id: string;
  sessionId: string;
  /** 内置驱动者必填；外部驱动者的 Task 不要求 Provider Profile（specs/agent-execution） */
  providerProfileId?: string | undefined;
  goal: string;
}

export type AgentTaskStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'waiting_user'
  | 'suspended'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface AgentTask {
  id: string;
  sessionId: string;
  providerProfileId?: string | undefined;
  goal: string;
  status: AgentTaskStatus;
  revision: number;
}

export type AgentTaskTransitionResult =
  { ok: true; value: AgentTask } | { ok: false; error: 'invalid-agent-task-transition' };

export function createAgentTask(input: CreateAgentTaskInput): AgentTask {
  return {
    ...input,
    status: 'queued',
    revision: 0,
  };
}

export function transitionAgentTask(
  task: AgentTask,
  nextStatus: AgentTaskStatus,
): AgentTaskTransitionResult {
  const allowedTransitions: Readonly<Record<AgentTaskStatus, readonly AgentTaskStatus[]>> = {
    queued: ['running', 'cancelled'],
    running: ['waiting_approval', 'waiting_user', 'suspended', 'completed', 'failed', 'cancelled'],
    waiting_approval: ['running', 'cancelled'],
    waiting_user: ['running', 'cancelled'],
    suspended: ['running', 'cancelled'],
    completed: [],
    failed: [],
    cancelled: [],
  };

  if (!allowedTransitions[task.status].includes(nextStatus)) {
    return { ok: false, error: 'invalid-agent-task-transition' };
  }

  return {
    ok: true,
    value: {
      ...task,
      status: nextStatus,
      revision: task.revision + 1,
    },
  };
}
