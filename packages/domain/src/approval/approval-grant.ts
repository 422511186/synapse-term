import type { CommandRisk } from '../session/command-transaction.js';

export interface CommandRiskMetadata {
  level: CommandRisk;
  reasons: readonly string[];
}

export interface ApprovedCommand {
  sequence: number;
  command: string;
  commandHash: string;
  risk: CommandRiskMetadata;
}

export interface ApprovalScope {
  conversationId: string;
  turnId: string;
  toolCallId: string;
}

export interface ApprovalGrant {
  id: string;
  sessionId: string;
  taskId: string;
  environmentEpoch?: number | undefined;
  scope?: ApprovalScope | undefined;
  commands: readonly ApprovedCommand[];
  grantedAt: string;
  expiresAt?: string | undefined;
}

export interface ApprovalCandidate {
  sessionId: string;
  taskId: string;
  environmentEpoch?: number | undefined;
  scope?: ApprovalScope | undefined;
  commands: readonly ApprovedCommand[];
}

export function createApprovalGrant(input: ApprovalGrant): ApprovalGrant {
  return input;
}

export function matchesApprovalGrant(grant: ApprovalGrant, candidate: ApprovalCandidate): boolean {
  if (
    grant.sessionId !== candidate.sessionId ||
    grant.taskId !== candidate.taskId ||
    grant.environmentEpoch !== candidate.environmentEpoch ||
    !sameScope(grant.scope, candidate.scope) ||
    grant.commands.length !== candidate.commands.length
  ) {
    return false;
  }

  return grant.commands.every((approved, index) => {
    const proposed = candidate.commands[index];
    return (
      proposed !== undefined &&
      approved.sequence === proposed.sequence &&
      approved.command === proposed.command &&
      approved.commandHash === proposed.commandHash &&
      approved.risk.level === proposed.risk.level &&
      approved.risk.reasons.length === proposed.risk.reasons.length &&
      approved.risk.reasons.every(
        (reason, reasonIndex) => reason === proposed.risk.reasons[reasonIndex],
      )
    );
  });
}

function sameScope(left: ApprovalScope | undefined, right: ApprovalScope | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    left.conversationId === right.conversationId &&
    left.turnId === right.turnId &&
    left.toolCallId === right.toolCallId
  );
}
