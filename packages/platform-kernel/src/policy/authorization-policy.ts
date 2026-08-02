import type { AgentPermissionMode, CommandRisk } from '@synapse-term/domain';

export type ToolEffect = 'observe' | 'mutate';
export type AuthorizationToolKind = 'terminal' | 'local_file';

export interface AuthorizationDecision {
  requiresApproval: boolean;
  authorization: 'read_only' | 'manual' | 'automatic' | 'full_access';
}

export class AuthorizationPolicy {
  decide(input: {
    mode: AgentPermissionMode;
    risk: CommandRisk;
    effect: ToolEffect;
    toolKind?: AuthorizationToolKind;
  }): AuthorizationDecision {
    if (input.mode === 'full_access') {
      return { requiresApproval: false, authorization: 'full_access' };
    }
    if (input.mode === 'manual' && input.toolKind === 'terminal') {
      return { requiresApproval: true, authorization: 'manual' };
    }
    if (input.risk === 'read_only' && input.effect === 'observe') {
      return { requiresApproval: false, authorization: 'read_only' };
    }
    if (input.mode === 'auto' && input.risk === 'mutating') {
      return { requiresApproval: false, authorization: 'automatic' };
    }
    return { requiresApproval: true, authorization: 'manual' };
  }
}
