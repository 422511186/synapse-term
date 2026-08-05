/**
 * 外部工具管线（specs/mcp-access、ADR-0023 / ADR-0024）
 *
 * MCP / ACP 外部调用的统一执行通道：策略分类 → 外部审批配置裁决 → 外部 JIT 租约
 * → 独立 Command Transaction → 审计（外部调用者 + Session）。不创建 Agent Task /
 * Turn，不经过 UI 审批；高危操作（unknown / privileged / destructive）不可配置放行。
 */
import { type CommandRisk, type ExternalCaller } from '@synapse-term/domain';
import { SecretRedactor, type AuditService } from '@synapse-term/infrastructure';
import type {
  LocalListFilesInput,
  LocalReadFileInput,
  LocalSearchFilesInput,
  TerminalExecuteInput,
  TerminalInterruptInput,
  TerminalObserveInput,
  TerminalWaitInput,
} from '@synapse-term/protocol';
import type {
  CommandExecutionResult,
  CommandExecutor,
  OutputJournal,
  SessionActor,
} from '@synapse-term/terminal-service';
import { ShellProbe } from '@synapse-term/terminal-service';
import type { LocalFileService } from '@synapse-term/tooling';

import type { PolicyEngine } from '../policy/policy-engine.js';
import { LocalFilePolicy } from '../policy/local-file-policy.js';

/**
 * 外部工具审批模式（specs/mcp-access、specs/acp-driver）
 *
 * - read_only：只放行读类操作（MCP 配置）；
 * - managed：低危（read_only / mutating）自动放行（MCP 配置）；
 * - full：完全权限模式（MCP 配置），不审查命令，全部放行；
 * - approved_once：仅由 ACP 桥接在用户人工批准某条具体命令后附加，
 *   让高危命令仍进入同一管线（策略分类 → 租约 → 事务 → 审计），
 *   不创建第二套审批通道（ADR-0030）。
 */
export type ExternalApprovalMode = 'read_only' | 'managed' | 'full' | 'approved_once';

export type ExternalToolResult =
  | { ok: true; result: unknown }
  | { ok: false; error: string; message?: string; recoverable?: boolean };

export interface ExternalToolPipelineOptions {
  actor: SessionActor;
  executor: CommandExecutor;
  policy: PolicyEngine;
  localFiles?: LocalFileService;
  localFilePolicy?: LocalFilePolicy;
  redactor?: SecretRedactor;
  journal?: OutputJournal;
  audit?: Pick<AuditService, 'record'>;
}

export interface ExternalToolContext {
  caller: ExternalCaller;
  approvalMode: ExternalApprovalMode;
  toolCallId?: string;
}

const TERMINAL_LEGACY_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'interaction_required',
  'interrupted',
  'shell_lost',
  'protocol_error',
]);

/**
 * 外部审批裁决（ADR-0023）：
 * - read-only：只放行读类工具（observe / 只读文件），任何执行类一律拒绝；
 * - managed：按 PolicyEngine 低危放行（read_only / mutating），unknown、privileged、
 *   destructive 一律拒绝，不可配置放行；
 * - full：完全权限模式，不审查命令，任何策略分类都进入执行管线；
 * - approved_once：人工批准后的单次执行，任何策略分类都进入执行管线
 *   （批准动作本身已在审批 UI 中绑定具体命令与风险）。
 */
function decideExternalAuthorization(
  mode: ExternalApprovalMode,
  risk: CommandRisk,
  effect: 'observe' | 'mutate',
): 'allowed' | 'denied' {
  if (mode === 'full' || mode === 'approved_once') return 'allowed';
  if (mode === 'read_only') {
    return effect === 'observe' && risk === 'read_only' ? 'allowed' : 'denied';
  }
  if (effect === 'observe') return risk === 'read_only' ? 'allowed' : 'denied';
  return risk === 'read_only' || risk === 'mutating' ? 'allowed' : 'denied';
}

export class ExternalToolPipeline {
  readonly #actor: SessionActor;
  readonly #executor: CommandExecutor;
  readonly #policy: PolicyEngine;
  readonly #localFiles: LocalFileService | undefined;
  readonly #localFilePolicy: LocalFilePolicy;
  readonly #redactor: SecretRedactor;
  readonly #journal: OutputJournal | undefined;
  readonly #audit: Pick<AuditService, 'record'> | undefined;
  #leaseEpoch: number | undefined;
  #leaseCallerId: string | undefined;

  constructor(options: ExternalToolPipelineOptions) {
    this.#actor = options.actor;
    this.#executor = options.executor;
    this.#policy = options.policy;
    this.#localFiles = options.localFiles;
    this.#localFilePolicy = options.localFilePolicy ?? new LocalFilePolicy();
    this.#redactor = options.redactor ?? new SecretRedactor();
    this.#journal = options.journal;
    this.#audit = options.audit;
    // 长命令在事务结束后自动归还外部租约，避免悬挂阻塞内置 Agent
    this.#executor.onEvent((event) => {
      if (event.type !== 'transaction') return;
      if (TERMINAL_LEGACY_STATUSES.has(event.transaction.status)) {
        void this.#releaseLease();
      }
    });
  }

  get leaseEpoch(): number | undefined {
    return this.#leaseEpoch;
  }

  observe(input: TerminalObserveInput, context: ExternalToolContext): ExternalToolResult {
    const view = input.view ?? 'screen';
    const activeTransactionId = this.#executor.activeTransactionId;
    let result: Record<string, unknown>;
    if (view === 'output' && this.#journal !== undefined) {
      const afterCursor = input.afterCursor ?? 0;
      const replay = this.#journal.replay(this.#actor.snapshot.id, afterCursor);
      const maxBytes = input.maxBytes ?? 64 * 1024;
      const selected: typeof replay.events = [];
      let selectedBytes = 0;
      let truncated = false;
      for (const event of [...replay.events].reverse()) {
        if (selectedBytes + event.data.byteLength > maxBytes) {
          truncated = true;
          continue;
        }
        selected.unshift(event);
        selectedBytes += event.data.byteLength;
      }
      const output = Buffer.concat(selected.map((event) => Buffer.from(event.data))).toString(
        'utf8',
      );
      const redacted = this.#redactor.redact(output);
      result = {
        status: 'observed',
        sessionId: this.#actor.snapshot.id,
        view,
        cursor: replay.events.at(-1)?.sequence ?? afterCursor,
        historyGap: replay.historyGap || truncated,
        ...(replay.oldestSequence === undefined ? {} : { oldestCursor: replay.oldestSequence }),
        output: redacted.text,
        truncated,
        ...(activeTransactionId === undefined ? {} : { activeTransactionId }),
        redacted: redacted.redacted,
      };
    } else {
      const screen = this.#redactor.redact(this.#actor.terminalSnapshot());
      const bounded =
        input.maxBytes === undefined ? screen.text : screen.text.slice(-input.maxBytes);
      const replay = this.#journal?.replay(this.#actor.snapshot.id, input.afterCursor ?? 0);
      result = {
        status: 'observed',
        sessionId: this.#actor.snapshot.id,
        view,
        cursor: replay === undefined ? (input.afterCursor ?? 0) : replay.nextSequence - 1,
        historyGap: replay?.historyGap ?? false,
        screen: bounded,
        ...(activeTransactionId === undefined ? {} : { activeTransactionId }),
        redacted: screen.redacted,
      };
    }
    this.#audit?.record({
      actor: this.#externalActor(context.caller),
      sessionId: this.#actor.snapshot.id,
      type: 'external.observe',
      payload: {
        source: context.caller.kind,
        callerId: context.caller.id,
        ...(context.caller.displayName === undefined
          ? {}
          : { displayName: context.caller.displayName }),
        view,
        cursor: result.cursor,
        redacted: result.redacted,
      },
    });
    return { ok: true, result };
  }

  async execute(
    input: TerminalExecuteInput,
    context: ExternalToolContext,
  ): Promise<ExternalToolResult> {
    const decision = await this.#policy.classify(input.command, {
      executionDialect: this.#actor.snapshot.executionDialect,
    });
    const authorization = decideExternalAuthorization(
      context.approvalMode,
      decision.level,
      'mutate',
    );
    if (authorization === 'denied') {
      this.#recordDenied(
        'external.command',
        decision,
        context,
        'approval_mode_denied',
        input.command,
      );
      return {
        ok: false,
        error: 'policy_denied',
        message: '当前外部审批配置不允许执行该命令（read-only 或高危命令）',
        recoverable: false,
      };
    }

    const leaseEpoch = await this.#grantLease(context.caller.id);
    if (leaseEpoch === undefined) {
      return {
        ok: false,
        error: 'lease_unavailable',
        message: '会话当前被用户或内置 Agent 占用，外部调用无法取得租约',
        recoverable: true,
      };
    }

    let result: CommandExecutionResult;
    try {
      // 外部调用没有内置 Agent 的 #prepareExecution 前置步骤：会话 Shell 未就绪
      // 或环境未验证时，在执行前懒触发一次 Shell 探测（与内置 Agent 同语义，
      // ADR-0024）。探测失败返回可恢复的 session_not_ready，不写业务命令。
      const snapshot = this.#actor.snapshot;
      const needsProbe =
        snapshot.shell !== 'ready' ||
        snapshot.environment.verificationStatus !== 'verified' ||
        snapshot.environment.platform === 'unknown' ||
        snapshot.environment.operatingSystem === 'unknown';
      if (needsProbe) {
        const probe = new ShellProbe(this.#actor);
        try {
          const probeResult = await probe.run({
            taskId: context.caller.id,
            leaseEpoch,
            ownerKind: 'external',
          });
          if (probeResult.mode !== 'structured') {
            await this.#releaseLease();
            return {
              ok: false,
              error: 'session_not_ready',
              message: `Shell probe failed: ${probeResult.reason}`,
              recoverable: true,
            };
          }
        } finally {
          probe.dispose();
        }
      }
      result = await this.#executor.execute({
        taskId: context.caller.id,
        ownerKind: 'external',
        leaseEpoch,
        command: input.command,
        risk: decision.level,
        ...(input.observationWindowMs === undefined
          ? {}
          : { observationWindowMs: input.observationWindowMs }),
        ...(context.toolCallId === undefined ? {} : { toolCallId: context.toolCallId }),
      });
    } catch (error) {
      await this.#releaseLease();
      const code =
        error instanceof Error && 'code' in error ? String(error.code) : 'internal_error';
      return {
        ok: false,
        error: code,
        message: error instanceof Error ? error.message : String(error),
        recoverable: code !== 'command_transaction_conflict',
      };
    }

    const classified = classifyExternalExecution(result);
    if (TERMINAL_LEGACY_STATUSES.has(result.status)) {
      await this.#releaseLease();
    }
    this.#audit?.record({
      actor: this.#externalActor(context.caller),
      sessionId: this.#actor.snapshot.id,
      type: 'external.command',
      payload: {
        commandPreview: this.#redactor.redact(input.command).text,
        source: context.caller.kind,
        callerId: context.caller.id,
        ...(context.caller.displayName === undefined
          ? {}
          : { displayName: context.caller.displayName }),
        commandHash: decision.commandHash,
        risk: decision.level,
        approvalMode: context.approvalMode,
        authorization: context.approvalMode === 'approved_once' ? 'user_approved' : 'auto_allowed',
        status: result.status,
        ...(result.transaction.id === undefined ? {} : { transactionId: result.transaction.id }),
      },
    });
    return classified ?? { ok: true, result };
  }

  async wait(input: TerminalWaitInput, context: ExternalToolContext): Promise<ExternalToolResult> {
    let result: CommandExecutionResult;
    try {
      result = await this.#executor.wait({
        transactionId: input.transactionId,
        ...(input.afterCursor === undefined ? {} : { afterCursor: input.afterCursor }),
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      });
    } catch (error) {
      const code =
        error instanceof Error && 'code' in error ? String(error.code) : 'internal_error';
      return {
        ok: false,
        error: code,
        message: error instanceof Error ? error.message : String(error),
        recoverable: code === 'transaction_not_found' ? false : true,
      };
    }
    this.#audit?.record({
      actor: this.#externalActor(context.caller),
      sessionId: this.#actor.snapshot.id,
      type: 'external.wait',
      payload: {
        source: context.caller.kind,
        callerId: context.caller.id,
        ...(context.caller.displayName === undefined
          ? {}
          : { displayName: context.caller.displayName }),
        transactionId: input.transactionId,
        commandPreview: this.#redactor.redact(result.transaction.command).text,
        ...(result.commandHash === undefined ? {} : { commandHash: result.commandHash }),
        ...(result.transaction.risk === undefined ? {} : { risk: result.transaction.risk }),
        status: result.status,
        ...(result.transaction.exitCode === undefined
          ? {}
          : { exitCode: result.transaction.exitCode }),
        ...(result.transaction.reason === undefined ? {} : { reason: result.transaction.reason }),
      },
    });
    if (TERMINAL_LEGACY_STATUSES.has(result.status)) {
      await this.#releaseLease();
    }
    const classified = classifyExternalExecution(result);
    return classified ?? { ok: true, result };
  }

  async interrupt(
    input: TerminalInterruptInput,
    context: ExternalToolContext,
  ): Promise<ExternalToolResult> {
    let interrupted: boolean;
    try {
      interrupted = await this.#executor.interrupt(input.transactionId);
    } catch (error) {
      const code =
        error instanceof Error && 'code' in error ? String(error.code) : 'internal_error';
      return { ok: false, error: code, message: String(error), recoverable: false };
    }
    if (interrupted) {
      await this.#releaseLease();
    }
    this.#audit?.record({
      actor: this.#externalActor(context.caller),
      sessionId: this.#actor.snapshot.id,
      type: 'external.interrupt',
      payload: {
        source: context.caller.kind,
        callerId: context.caller.id,
        transactionId: input.transactionId,
        interrupted,
      },
    });
    return { ok: true, result: { interrupted } };
  }

  async listFiles(
    input: LocalListFilesInput,
    context: ExternalToolContext,
  ): Promise<ExternalToolResult> {
    return this.#localFile('list', input.path ?? '', context, () =>
      this.#requireLocalFiles().list(input),
    );
  }

  async searchFiles(
    input: LocalSearchFilesInput,
    context: ExternalToolContext,
  ): Promise<ExternalToolResult> {
    return this.#localFile('search', input.path ?? '', context, () =>
      this.#requireLocalFiles().search(input),
    );
  }

  async readFile(
    input: LocalReadFileInput,
    context: ExternalToolContext,
  ): Promise<ExternalToolResult> {
    return this.#localFile('read', input.path, context, () =>
      this.#requireLocalFiles().read(input),
    );
  }

  async #localFile(
    operation: 'list' | 'search' | 'read',
    path: string,
    context: ExternalToolContext,
    perform: () => Promise<unknown>,
  ): Promise<ExternalToolResult> {
    if (this.#localFiles === undefined) {
      return { ok: false, error: 'local_file_service_unavailable', recoverable: false };
    }
    const decision = this.#localFilePolicy.classify({ operation, path });
    const authorization = decideExternalAuthorization(
      context.approvalMode,
      decision.level,
      'observe',
    );
    if (authorization === 'denied') {
      this.#recordDenied(`external.file.${operation}`, decision, context, 'approval_mode_denied');
      return {
        ok: false,
        error: 'policy_denied',
        message: '当前外部审批配置不允许该只读文件操作',
        recoverable: false,
      };
    }
    try {
      const result = await perform();
      this.#audit?.record({
        actor: this.#externalActor(context.caller),
        sessionId: this.#actor.snapshot.id,
        type: `external.file.${operation}.completed`,
        payload: {
          source: context.caller.kind,
          callerId: context.caller.id,
          path,
          risk: decision.level,
          approvalMode: context.approvalMode,
          authorization: 'auto_allowed',
          status: 'completed',
        },
      });
      return { ok: true, result };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error && 'code' in error ? String(error.code) : 'file_operation_failed',
        message: error instanceof Error ? error.message : String(error),
        recoverable: true,
      };
    }
  }

  #requireLocalFiles(): LocalFileService {
    if (this.#localFiles === undefined) {
      throw new Error('local file service is not configured');
    }
    return this.#localFiles;
  }

  #recordDenied(
    tool: string,
    decision: { level: CommandRisk; reasons: readonly string[]; commandHash?: string },
    context: ExternalToolContext,
    reason: string,
    command?: string,
  ): void {
    this.#audit?.record({
      actor: this.#externalActor(context.caller),
      sessionId: this.#actor.snapshot.id,
      type: 'external.denied',
      payload: {
        tool,
        source: context.caller.kind,
        callerId: context.caller.id,
        ...(command === undefined ? {} : { commandPreview: this.#redactor.redact(command).text }),
        ...(decision.commandHash === undefined ? {} : { commandHash: decision.commandHash }),
        risk: decision.level,
        reasons: decision.reasons,
        approvalMode: context.approvalMode,
        reason,
      },
    });
  }

  #externalActor(caller: ExternalCaller): {
    kind: 'external';
    callerKind: ExternalCaller['kind'];
    callerId: string;
  } {
    return { kind: 'external', callerKind: caller.kind, callerId: caller.id };
  }

  async #grantLease(callerId: string): Promise<number | undefined> {
    if (this.#leaseEpoch !== undefined && this.#leaseCallerId === callerId) {
      return this.#leaseEpoch;
    }
    const snapshot = this.#actor.snapshot;
    const grant = await this.#actor.grantExternalLease(callerId, snapshot.lease.epoch);
    if (!grant.ok) return undefined;
    this.#leaseEpoch = grant.value.lease.epoch;
    this.#leaseCallerId = callerId;
    return this.#leaseEpoch;
  }

  async #releaseLease(): Promise<void> {
    if (this.#leaseEpoch === undefined || this.#leaseCallerId === undefined) return;
    const epoch = this.#leaseEpoch;
    const callerId = this.#leaseCallerId;
    this.#leaseEpoch = undefined;
    this.#leaseCallerId = undefined;
    await this.#actor.releaseExternalLease(callerId, epoch);
  }
}

function classifyExternalExecution(
  result: CommandExecutionResult,
): Extract<ExternalToolResult, { ok: false }> | undefined {
  const output = result.output.text.trim();
  if (result.status === 'completed') {
    const exitCode =
      result.transaction.status === 'completed' ? result.transaction.exitCode : undefined;
    if (exitCode === undefined || exitCode === 0) return undefined;
    const unavailable =
      exitCode === 127 ||
      /command not found|is not recognized as the name of a cmdlet/i.test(output);
    return {
      ok: false,
      error: unavailable ? 'command_not_found' : 'command_failed',
      message: 'Command exited with code ' + exitCode + formatCommandOutput(output),
      recoverable: true,
    };
  }
  if (result.status === 'running' || result.status === 'interaction_required') {
    return undefined;
  }
  const reason =
    'reason' in result.transaction && typeof result.transaction.reason === 'string'
      ? ': ' + result.transaction.reason
      : '';
  return {
    ok: false,
    error: 'command_' + result.status,
    message: 'Command execution ended with ' + result.status + reason + formatCommandOutput(output),
    recoverable: true,
  };
}

function formatCommandOutput(output: string): string {
  return output.length === 0 ? '' : ': ' + output;
}
