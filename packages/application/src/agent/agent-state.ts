/**
 * Agent 运行状态类型
 *
 * 单个 Session 上 Agent Task 的全部运行时状态：领域实体、执行器、
 * 工具网关、审批与模型运行时。类型独立成文件，供协调器与
 * ApprovalAwareGateway 共享，避免循环引用。
 */
import type {
  AgentConversation,
  AgentTask,
  AgentTurn,
  CommandRisk,
  ModelConfiguration,
  ProviderProfile,
  StagedAgentAttachment,
} from '@synapse-term/domain';
import type { ModelInputItem } from '@synapse-term/model-providers';
import type { ModelAdapter } from '@synapse-term/model-providers';
import type { AgentProgressSnapshot, AgentTimelineItem } from '@synapse-term/protocol';
import type { AgentRuntime } from '@synapse-term/agent-service';
import type { ApprovalManager, TerminalToolGateway } from '@synapse-term/platform-kernel';
import type {
  CommandExecutor,
  PtyDisposable,
  SessionActor,
  ShellProbe,
} from '@synapse-term/terminal-service';

import type { ApprovalAwareGateway } from './approval-aware-gateway.js';

/** 待用户批复的审批快照 */
export interface PendingApproval {
  id: string;
  toolCallId: string;
  environmentEpoch: number;
  approvalTarget: string;
  displayText: string;
  level: CommandRisk;
  reasons: readonly string[];
  change?: AgentTimelineItem['change'];
}

/** 一个 Session 上 Agent Task 的运行时状态 */
export interface AgentState {
  task: AgentTask;
  conversation: AgentConversation;
  turn: AgentTurn;
  actor: SessionActor;
  profile: ProviderProfile;
  model: ModelConfiguration;
  adapter: ModelAdapter;
  leaseEpoch: number | undefined;
  approvals: ApprovalManager;
  executor: CommandExecutor;
  gateway: TerminalToolGateway;
  wrapper: ApprovalAwareGateway;
  runtime: AgentRuntime | undefined;
  activeProbe: ShellProbe | undefined;
  pendingApproval: PendingApproval | undefined;
  executorSubscription: PtyDisposable;
  history: ModelInputItem[];
  attachments: readonly StagedAgentAttachment[];
  nextModelSequence: number;
  assistantTimelineId: string;
  assistantText: string;
  assistantSequence: number;
  progress: AgentProgressSnapshot;
  activeToolCallId: string | undefined;
  transactionToolCallIds: Map<string, string>;
}

/** 协调器统一错误：携带稳定错误码 */
export function coordinatorError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
