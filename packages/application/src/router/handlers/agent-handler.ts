/**
 * Agent 请求处理
 *
 * agent.* 用例的统一入口：启动、取消、历史、重置、中断、审批与接管。
 * 全部转发给 AgentCoordinatorLike 端口，不直接触碰任务状态。
 */
import type {
  AgentAttachmentInput,
  AgentPermissionMode,
  ReasoningEffort,
} from '@synapse-term/domain';
import type { AgentHistoryView } from '@synapse-term/protocol';

import { routerError } from '../contracts.js';
import type { AgentCoordinatorLike } from '../contracts.js';

export interface AgentRequestHandlerOptions {
  agents?: AgentCoordinatorLike | undefined;
}

export class AgentRequestHandler {
  readonly #agents: AgentCoordinatorLike | undefined;

  constructor(options: AgentRequestHandlerOptions) {
    this.#agents = options.agents;
  }

  start(
    sessionId: string,
    goal: string,
    options?: {
      attachments?: readonly AgentAttachmentInput[];
      modelConfigurationId?: string;
      reasoningEffort?: ReasoningEffort;
      permissionMode?: AgentPermissionMode;
    },
  ): Promise<{ taskId: string; conversationId: string; turnId: string }> {
    return this.#requireAgents().start(sessionId, goal, options);
  }

  async cancel(sessionId: string, turnId?: string): Promise<null> {
    await this.#requireAgents().cancel(sessionId, turnId);
    return null;
  }

  history(sessionId: string): Promise<AgentHistoryView> {
    return this.#requireAgents().history(sessionId);
  }

  async resetConversation(sessionId: string, expectedConversationId: string): Promise<null> {
    await this.#requireAgents().resetConversation(sessionId, expectedConversationId);
    return null;
  }

  async interrupt(sessionId: string, transactionId: string): Promise<null> {
    await this.#requireAgents().interrupt(sessionId, transactionId);
    return null;
  }

  async approve(
    sessionId: string,
    approvalId: string,
    confirmedDestructive: boolean,
  ): Promise<null> {
    await this.#requireAgents().approve(sessionId, approvalId, confirmedDestructive);
    return null;
  }

  async takeover(sessionId: string): Promise<null> {
    await this.#requireAgents().takeover(sessionId);
    return null;
  }

  async closeAllIfConfigured(): Promise<void> {
    await this.#agents?.closeAll?.();
  }

  #requireAgents(): AgentCoordinatorLike {
    if (this.#agents === undefined) {
      throw routerError('internal_error', 'Agent coordinator is not configured');
    }
    return this.#agents;
  }
}
