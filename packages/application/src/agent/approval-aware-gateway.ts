/**
 * 审批感知工具网关
 *
 * 包装 TerminalToolGateway，为 AgentRuntime 提供带审批语义的工具调用面：
 * 触发审批时生成 PendingApproval 并通过回调上报协调器，工具结果回传时
 * 记录事务 ID 与工具调用关联。
 */
import { randomUUID } from 'node:crypto';

import type { ApprovalGrant, CommandRisk } from '@synapse-term/domain';
import type { RuntimeToolGateway } from '@synapse-term/agent-service';
import type { ToolGatewayResult } from '@synapse-term/platform-kernel';
import { localFileChangeSchema, type AgentTimelineItem } from '@synapse-term/protocol';

import type { AgentState, PendingApproval } from './agent-state.js';

export class ApprovalAwareGateway implements RuntimeToolGateway {
  #grant: ApprovalGrant | undefined;
  readonly #state: AgentState;
  readonly #onPending: (approval: PendingApproval) => void;
  readonly #onToolStart: (toolCallId: string) => void;
  readonly #onToolResult: (toolCallId: string, result: ToolGatewayResult) => void;

  constructor(
    state: AgentState,
    onPending: (approval: PendingApproval) => void,
    onToolStart: (toolCallId: string) => void,
    onToolResult: (toolCallId: string, result: ToolGatewayResult) => void,
  ) {
    this.#state = state;
    this.#onPending = onPending;
    this.#onToolStart = onToolStart;
    this.#onToolResult = onToolResult;
  }

  setGrant(grant: ApprovalGrant): void {
    this.#grant = grant;
  }

  call(name: string, argumentsValue: unknown): Promise<ToolGatewayResult> {
    return this.callWithContext(name, argumentsValue, { toolCallId: randomUUID() });
  }

  async callWithContext(
    name: string,
    argumentsValue: unknown,
    context: { toolCallId: string; signal?: AbortSignal },
  ): Promise<ToolGatewayResult> {
    const toolCallId = context.toolCallId;
    this.#onToolStart(toolCallId);
    const result = await this.#state.gateway.call(name, argumentsValue, this.#grant, {
      toolCallId,
    });
    this.#onToolResult(toolCallId, result);
    if (!result.ok) {
      // 失败路径同样清空 grant：否则后续相同命令的工具调用会被命中而静默放行，
      // 违反"一次性审批"语义（H-5）。
      if (this.#grant !== undefined) this.#grant = undefined;
      return result;
    }
    if (isWaitingApproval(result.result)) {
      const args = argumentsValue as { command?: unknown };
      const decision = result.result.decision as {
        level: CommandRisk;
        reasons: readonly string[];
      };
      const approval: PendingApproval = {
        id: randomUUID(),
        toolCallId,
        environmentEpoch:
          typeof result.result.environmentEpoch === 'number'
            ? result.result.environmentEpoch
            : this.#state.actor.snapshot.environment.capabilityEpoch,
        approvalTarget:
          typeof result.result.approvalTarget === 'string'
            ? result.result.approvalTarget
            : typeof args.command === 'string'
              ? args.command
              : `${name}:${JSON.stringify(argumentsValue)}`,
        displayText:
          typeof result.result.displayText === 'string'
            ? result.result.displayText
            : typeof args.command === 'string'
              ? args.command
              : name,
        level: decision.level,
        reasons: decision.reasons,
        ...extractFileChange(result.result),
      };
      this.#onPending(approval);
      return { ok: true, result: { ...result.result, approvalId: approval.id } };
    }
    if (this.#grant !== undefined) this.#grant = undefined;
    return result;
  }
}

function extractFileChange(value: unknown): { change?: AgentTimelineItem['change'] } {
  if (typeof value !== 'object' || value === null || !('change' in value)) return {};
  const parsed = localFileChangeSchema.safeParse((value as { change?: unknown }).change);
  return parsed.success ? { change: parsed.data } : {};
}

export function extractTransactionId(result: ToolGatewayResult): string | undefined {
  if (!result.ok || typeof result.result !== 'object' || result.result === null) return undefined;
  const transaction = (result.result as { transaction?: unknown }).transaction;
  if (typeof transaction !== 'object' || transaction === null) return undefined;
  const id = (transaction as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

export function isWaitingApproval(value: unknown): value is {
  decision: unknown;
  approvalTarget?: unknown;
  displayText?: unknown;
  environmentEpoch?: unknown;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { status?: unknown }).status === 'waiting_approval'
  );
}
