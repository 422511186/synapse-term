/**
 * 外部工具调用请求处理（specs/mcp-access、ADR-0022 / ADR-0024）
 *
 * 边界层职责：校验会话可寻址（用户复制过 sessionId、PTY 存活），
 * 将带 sessionId 的外部形态翻译为按会话作用域的内部 Tool Pipeline 调用。
 * 不创建 Agent Task / Turn；无效会话统一返回稳定错误，不泄露存在性。
 */
import { isSessionShared, type CommandRisk, type ExternalCaller } from '@synapse-term/domain';
import type { SecretRedactor } from '@synapse-term/infrastructure';
import {
  ExternalToolPipeline,
  type ExternalApprovalMode,
  type ExternalToolResult,
  type LocalFilePolicy,
  type PolicyEngine,
} from '@synapse-term/platform-kernel';
import type { CoreRequest } from '@synapse-term/protocol';
import {
  CommandExecutor,
  type OutputJournal,
  type SessionActor,
  type SessionManager,
} from '@synapse-term/terminal-service';
import type { LocalFileService } from '@synapse-term/tooling';

import { routerError } from '../contracts.js';
import type { AuditQueryLike } from '../contracts.js';

type ExternalPayload<M extends CoreRequest['method']> = Extract<
  CoreRequest,
  { method: M }
>['payload'];

export interface ExternalRequestHandlerOptions {
  sessions: SessionManager;
  journal: OutputJournal;
  policy: PolicyEngine;
  localFiles?: LocalFileService | undefined;
  localFilePolicy?: LocalFilePolicy | undefined;
  redactor?: SecretRedactor | undefined;
  audit?: AuditQueryLike | undefined;
}

interface CachedPipeline {
  actor: SessionActor;
  pipeline: ExternalToolPipeline;
}

export class ExternalRequestHandler {
  readonly #sessions: SessionManager;
  readonly #journal: OutputJournal;
  readonly #policy: PolicyEngine;
  readonly #localFiles: LocalFileService | undefined;
  readonly #localFilePolicy: LocalFilePolicy | undefined;
  readonly #redactor: SecretRedactor | undefined;
  readonly #audit: AuditQueryLike | undefined;
  readonly #pipelines = new Map<string, CachedPipeline>();

  constructor(options: ExternalRequestHandlerOptions) {
    this.#sessions = options.sessions;
    this.#journal = options.journal;
    this.#policy = options.policy;
    this.#localFiles = options.localFiles;
    this.#localFilePolicy = options.localFilePolicy;
    this.#redactor = options.redactor;
    this.#audit = options.audit;
  }

  terminalExecute(
    payload: ExternalPayload<'external.terminalExecute'>,
  ): Promise<ExternalToolResult> {
    const pipeline = this.#pipelineFor(payload.sessionId);
    return pipeline.execute(
      {
        command: payload.command,
        ...(payload.observationWindowMs === undefined
          ? {}
          : { observationWindowMs: payload.observationWindowMs }),
      },
      this.#context(payload),
    );
  }

  terminalObserve(payload: ExternalPayload<'external.terminalObserve'>): ExternalToolResult {
    const pipeline = this.#pipelineFor(payload.sessionId);
    return pipeline.observe(
      {
        ...(payload.view === undefined ? {} : { view: payload.view }),
        ...(payload.afterCursor === undefined ? {} : { afterCursor: payload.afterCursor }),
        ...(payload.maxBytes === undefined ? {} : { maxBytes: payload.maxBytes }),
      },
      this.#context(payload),
    );
  }

  terminalWait(payload: ExternalPayload<'external.terminalWait'>): Promise<ExternalToolResult> {
    const pipeline = this.#pipelineFor(payload.sessionId);
    return pipeline.wait(
      {
        transactionId: payload.transactionId,
        ...(payload.afterCursor === undefined ? {} : { afterCursor: payload.afterCursor }),
        ...(payload.timeoutMs === undefined ? {} : { timeoutMs: payload.timeoutMs }),
      },
      this.#context(payload),
    );
  }

  terminalInterrupt(
    payload: ExternalPayload<'external.terminalInterrupt'>,
  ): Promise<ExternalToolResult> {
    const pipeline = this.#pipelineFor(payload.sessionId);
    return pipeline.interrupt({ transactionId: payload.transactionId }, this.#context(payload));
  }

  localListFiles(payload: ExternalPayload<'external.localListFiles'>): Promise<ExternalToolResult> {
    const pipeline = this.#pipelineFor(payload.sessionId);
    return pipeline.listFiles(
      {
        ...(payload.path === undefined ? {} : { path: payload.path }),
        ...(payload.maxDepth === undefined ? {} : { maxDepth: payload.maxDepth }),
        ...(payload.maxResults === undefined ? {} : { maxResults: payload.maxResults }),
      },
      this.#context(payload),
    );
  }

  localSearchFiles(
    payload: ExternalPayload<'external.localSearchFiles'>,
  ): Promise<ExternalToolResult> {
    const pipeline = this.#pipelineFor(payload.sessionId);
    return pipeline.searchFiles(
      {
        path: payload.path,
        query: payload.query,
        mode: payload.mode,
        ...(payload.maxDepth === undefined ? {} : { maxDepth: payload.maxDepth }),
        ...(payload.maxResults === undefined ? {} : { maxResults: payload.maxResults }),
        ...(payload.maxBytes === undefined ? {} : { maxBytes: payload.maxBytes }),
        ...(payload.timeoutMs === undefined ? {} : { timeoutMs: payload.timeoutMs }),
      },
      this.#context(payload),
    );
  }

  localReadFile(payload: ExternalPayload<'external.localReadFile'>): Promise<ExternalToolResult> {
    const pipeline = this.#pipelineFor(payload.sessionId);
    return pipeline.readFile(
      {
        path: payload.path,
        ...(payload.startLine === undefined ? {} : { startLine: payload.startLine }),
        ...(payload.endLine === undefined ? {} : { endLine: payload.endLine }),
        ...(payload.maxBytes === undefined ? {} : { maxBytes: payload.maxBytes }),
      },
      this.#context(payload),
    );
  }

  /**
   * ACP 权限闸门预分类（specs/acp-driver、ADR-0030）
   *
   * 外部驱动者在执行前请求权限时，由 Core 策略引擎统一裁决：
   * - managed：read_only / mutating 自动放行一次，unknown / privileged / destructive 转人工；
   * - manual：仅 read_only 自动放行，其余全部转人工。
   * 不在这里执行命令、不创建租约；放行后的执行仍走 external.* 完整管线。
   */
  async classifyCommand(payload: ExternalPayload<'external.classifyCommand'>): Promise<{
    risk: CommandRisk;
    requiresApproval: boolean;
    authorization: 'allow_once' | 'approval_required';
  }> {
    this.#session(payload.sessionId);
    const session = this.#sessions.get(payload.sessionId);
    const decision = await this.#policy.classify(payload.command, {
      ...(session === undefined ? {} : { executionDialect: session.snapshot.executionDialect }),
    });
    const authorization = decideAcpAuthorization(payload.approvalMode, decision.level);
    return {
      risk: decision.level,
      requiresApproval: authorization === 'approval_required',
      authorization,
    };
  }

  /**
   * ACP 权限拒绝审计（specs/acp-driver、ADR-0030）
   *
   * 非平台工具或用户拒绝的权限请求不进入执行管线，但仍以
   * “外部调用者 + Session”为主体持久化审计。
   */
  recordRejection(payload: ExternalPayload<'external.recordRejection'>): { ok: true } {
    this.#session(payload.sessionId);
    this.#audit?.record?.({
      actor: { kind: 'external', callerKind: payload.caller.kind, callerId: payload.caller.id },
      sessionId: payload.sessionId,
      type: 'external.rejected',
      payload: {
        tool: payload.toolName,
        source: payload.caller.kind,
        callerId: payload.caller.id,
        ...(payload.caller.displayName === undefined
          ? {}
          : { displayName: payload.caller.displayName }),
        reason: payload.reason,
      },
    });
    return { ok: true };
  }

  #context(payload: { caller: ExternalCaller; approvalMode: ExternalApprovalMode }): {
    caller: ExternalCaller;
    approvalMode: ExternalApprovalMode;
  } {
    return { caller: payload.caller, approvalMode: payload.approvalMode };
  }

  #pipelineFor(sessionId: string): ExternalToolPipeline {
    const actor = this.#session(sessionId);
    const cached = this.#pipelines.get(sessionId);
    if (cached !== undefined && cached.actor === actor) return cached.pipeline;

    const executor = new CommandExecutor(actor);
    const pipeline = new ExternalToolPipeline({
      actor,
      executor,
      policy: this.#policy,
      journal: this.#journal,
      ...(this.#localFiles === undefined ? {} : { localFiles: this.#localFiles }),
      ...(this.#localFilePolicy === undefined ? {} : { localFilePolicy: this.#localFilePolicy }),
      ...(this.#redactor === undefined ? {} : { redactor: this.#redactor }),
      ...(this.#audit?.record === undefined
        ? {}
        : { audit: { record: (input) => this.#audit?.record?.(input) } }),
    });
    this.#pipelines.set(sessionId, { actor, pipeline });
    return pipeline;
  }

  /** 会话可寻址校验：用户复制过 sessionId、PTY 存活；不泄露会话存在性 */
  #session(sessionId: string) {
    const actor = this.#sessions.get(sessionId);
    if (
      actor === undefined ||
      !isSessionShared(actor.snapshot) ||
      actor.snapshot.pty !== 'running'
    ) {
      throw routerError('invalid_session', '无效的会话标识');
    }
    return actor;
  }
}

/** ACP 审批裁决（ADR-0030）：只返回自动放行或转人工，不在 Core 之外复制策略 */
function decideAcpAuthorization(
  mode: 'managed' | 'manual',
  risk: CommandRisk,
): 'allow_once' | 'approval_required' {
  if (mode === 'managed') {
    return risk === 'read_only' || risk === 'mutating' ? 'allow_once' : 'approval_required';
  }
  return risk === 'read_only' ? 'allow_once' : 'approval_required';
}
