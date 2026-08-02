export interface CreateCommandTransactionInput {
  id: string;
  sessionId: string;
  taskId: string;
  command: string;
  nonce: string;
  toolCallId?: string | undefined;
}

export type CommandRisk = 'read_only' | 'unknown' | 'mutating' | 'privileged' | 'destructive';

export type CommandTransactionStatus =
  | 'draft'
  | 'policy_checked'
  | 'waiting_approval'
  | 'lease_acquired'
  | 'dispatched'
  | 'running'
  | 'completed'
  | 'interaction_required'
  | 'interrupted'
  | 'shell_lost'
  | 'protocol_error';

export interface CommandTransaction {
  id: string;
  sessionId: string;
  taskId: string;
  command: string;
  nonce: string;
  toolCallId?: string | undefined;
  status: CommandTransactionStatus;
  revision: number;
  risk?: CommandRisk | undefined;
  leaseEpoch?: number | undefined;
  approvalGrantId?: string | undefined;
  exitCode?: number | undefined;
  reason?: string | undefined;
}

export type CommandTransactionTransition =
  | { status: 'policy_checked'; risk: CommandRisk }
  | { status: 'waiting_approval' }
  | { status: 'lease_acquired'; leaseEpoch: number; approvalGrantId?: string }
  | { status: 'dispatched' }
  | { status: 'running' }
  | { status: 'completed'; exitCode: number }
  | {
      status: 'interaction_required' | 'interrupted' | 'shell_lost' | 'protocol_error';
      reason: string;
    };

export type CommandTransactionTransitionResult =
  | { ok: true; value: CommandTransaction }
  | {
      ok: false;
      error: 'invalid-command-transaction-transition' | 'approval-required';
    };

export function createCommandTransaction(input: CreateCommandTransactionInput): CommandTransaction {
  return {
    ...input,
    status: 'draft',
    revision: 0,
  };
}

export function transitionCommandTransaction(
  transaction: CommandTransaction,
  transition: CommandTransactionTransition,
): CommandTransactionTransitionResult {
  const allowedTransitions: Readonly<
    Record<CommandTransactionStatus, readonly CommandTransactionStatus[]>
  > = {
    draft: ['policy_checked'],
    policy_checked: ['waiting_approval', 'lease_acquired'],
    waiting_approval: ['lease_acquired'],
    lease_acquired: ['dispatched'],
    dispatched: ['running'],
    running: ['completed', 'interaction_required', 'interrupted', 'shell_lost', 'protocol_error'],
    completed: [],
    interaction_required: [],
    interrupted: [],
    shell_lost: [],
    protocol_error: [],
  };

  if (!allowedTransitions[transaction.status].includes(transition.status)) {
    return { ok: false, error: 'invalid-command-transaction-transition' };
  }

  if (
    transaction.status === 'waiting_approval' &&
    transition.status === 'lease_acquired' &&
    transition.approvalGrantId === undefined
  ) {
    return { ok: false, error: 'approval-required' };
  }

  return {
    ok: true,
    value: {
      ...transaction,
      ...transition,
      revision: transaction.revision + 1,
    },
  };
}
