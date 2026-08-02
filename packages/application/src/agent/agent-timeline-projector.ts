/**
 * Agent 时间线投影
 *
 * 负责从持久化仓库投影 AgentHistoryView（会话、Turn、模型条目与活跃 Turn），
 * 以及时间线展示所需的纯函数（命令状态映射、会话摘要、序列号推进）。
 */
import type { ModelItem, SessionState } from '@synapse-term/domain';
import type { CoreRepositories } from '@synapse-term/infrastructure';
import type { AgentHistoryView } from '@synapse-term/protocol';

export class AgentTimelineProjector {
  readonly #repositories: CoreRepositories;

  constructor(repositories: CoreRepositories) {
    this.#repositories = repositories;
  }

  project(sessionId: string, activeTurnId?: string): AgentHistoryView {
    const conversation = [...this.#repositories.listAgentConversations(sessionId)]
      .reverse()
      .find((candidate) => candidate.status === 'active');
    if (conversation === undefined) return { sessionId, turns: [], items: [] };
    return {
      sessionId,
      conversation,
      turns: this.#repositories.listAgentTurns(conversation.id).map((turn) => {
        const model = turn.model;
        const { model: _model, ...rest } = turn;
        void _model;
        return {
          ...rest,
          ...(model === undefined
            ? {}
            : {
                model: {
                  ...model,
                  capabilities: { ...model.capabilities },
                  supportedReasoningEfforts: [...model.supportedReasoningEfforts],
                },
              }),
        };
      }),
      items: this.#repositories.listModelItems(conversation.id),
      ...(activeTurnId === undefined ? {} : { activeTurnId }),
    };
  }
}

/** 命令事务状态 → 时间线展示状态（非零退出码视为 failed） */
export function commandTimelineStatus(status: string, exitCode: number | undefined): string {
  return status === 'completed' && exitCode !== undefined && exitCode !== 0 ? 'failed' : status;
}

/** 从 Session 快照构建模型初始上下文摘要 */
export function buildSessionSummary(snapshot: SessionState): string {
  return [
    `sessionId=${snapshot.id}`,
    `shell=${snapshot.shell}`,
    `operatingSystem=${snapshot.environment.operatingSystem}`,
    `dialect=${snapshot.environment.dialect}`,
    `platform=${snapshot.environment.platform}`,
    `verificationStatus=${snapshot.environment.verificationStatus}`,
    `capabilityEpoch=${snapshot.environment.capabilityEpoch}`,
  ].join('; ');
}

/** 从已有模型条目计算下一条消息序列号 */
export function nextModelSequence(items: readonly ModelItem[]): number {
  return items.reduce((next, item) => Math.max(next, item.sequence + 1), 0);
}
