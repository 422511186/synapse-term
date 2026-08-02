import {
  createAgentTask,
  transitionAgentTask,
  type AgentTask,
  type AgentTaskStatus,
  type CreateAgentTaskInput,
} from '@synapse-term/domain';

export class AgentTaskScheduler {
  readonly #maxRunningTasks: number;
  readonly #tasks = new Map<string, AgentTask>();

  constructor(options: { maxRunningTasks?: number } = {}) {
    this.#maxRunningTasks = options.maxRunningTasks ?? 4;
    if (!Number.isInteger(this.#maxRunningTasks) || this.#maxRunningTasks < 1) {
      throw new RangeError('maxRunningTasks must be a positive integer');
    }
  }

  create(input: CreateAgentTaskInput): AgentTask {
    if (this.#tasks.has(input.id)) throw new Error(`Agent Task ${input.id} already exists`);
    if (
      [...this.#tasks.values()].some(
        (task) => task.sessionId === input.sessionId && !isTerminal(task.status),
      )
    ) {
      throw new Error(`Session ${input.sessionId} already has an active Agent Task`);
    }
    const task = createAgentTask(input);
    this.#tasks.set(task.id, task);
    return structuredClone(task);
  }

  start(id: string): AgentTask {
    if (
      [...this.#tasks.values()].filter((task) => task.status === 'running').length >=
      this.#maxRunningTasks
    ) {
      throw new Error('global running Agent Task limit reached');
    }
    return this.transition(id, 'running');
  }

  transition(id: string, status: AgentTaskStatus): AgentTask {
    const current = this.#tasks.get(id);
    if (current === undefined) throw new Error(`Agent Task ${id} not found`);
    const transition = transitionAgentTask(current, status);
    if (!transition.ok) throw new Error(transition.error);
    this.#tasks.set(id, transition.value);
    return structuredClone(transition.value);
  }

  get(id: string): AgentTask | undefined {
    const task = this.#tasks.get(id);
    return task === undefined ? undefined : structuredClone(task);
  }

  list(): AgentTask[] {
    return [...this.#tasks.values()].map((task) => structuredClone(task));
  }
}

function isTerminal(status: AgentTaskStatus): boolean {
  return (
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'waiting_user' ||
    status === 'suspended'
  );
}
