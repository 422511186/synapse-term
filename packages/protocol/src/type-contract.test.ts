import type {
  AgentTask,
  ApprovalGrant,
  CommandTransaction,
  ProviderProfile,
  SessionState,
} from '@terminal-agent/domain';
import { expectTypeOf, it } from 'vitest';

import type {
  AgentTaskMessage,
  ApprovalGrantMessage,
  CommandTransactionMessage,
  ProviderProfileMessage,
  SessionStateMessage,
} from './domain-schemas.js';

function assertDomainAssignments(
  sessionMessage: SessionStateMessage,
  taskMessage: AgentTaskMessage,
  transactionMessage: CommandTransactionMessage,
  grantMessage: ApprovalGrantMessage,
  profileMessage: ProviderProfileMessage,
): void {
  const session: SessionState = sessionMessage;
  const task: AgentTask = taskMessage;
  const transaction: CommandTransaction = transactionMessage;
  const grant: ApprovalGrant = grantMessage;
  const profile: ProviderProfile = profileMessage;
  void [session, task, transaction, grant, profile];
}

it('keeps schema output assignable to the domain contracts', () => {
  expectTypeOf(assertDomainAssignments).toBeFunction();
});
