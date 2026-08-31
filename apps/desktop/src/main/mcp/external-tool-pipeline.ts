import type { CommandRisk, ExternalCaller, McpApprovalMode } from '@synapse-term/domain';
import type { CommandExecutor, ShellProbe } from '@synapse-term/terminal-service';

import {
  ExternalLeaseRegistry,
  ShellProbe as DefaultShellProbe,
  type SessionActor,
} from '@synapse-term/terminal-service';

import type { PolicyDecision } from './policy-engine.js';
import { PolicyEngine } from './policy-engine.js';
import { SecretRedactor } from './secret-redactor.js';

export interface McpToolContext {
  caller: ExternalCaller;
  mode: McpApprovalMode;
}

export type ApprovalDecision = 'allow_once' | 'allow_session' | 'denied';

export interface ApprovalRequest {
  sessionId: string;
  command: string;
  risk: CommandRisk;
  reasons: readonly string[];
}

export interface ExternalToolPipelineOptions {
  actor: SessionActor;
  executor: CommandExecutor;
  policy?: PolicyEngine;
  redactor?: SecretRedactor;
  leases?: ExternalLeaseRegistry;
  probe?: ShellProbe;
  requestApproval?: ((request: ApprovalRequest) => Promise<ApprovalDecision>) | undefined;
}

type ExecuteInput = { command: string; observationWindowMs?: number | undefined };
type ObserveInput = { afterCursor?: number | undefined };
type WaitInput = { transactionId: string };

export type ExternalToolResult<T> =
  { ok: true; result: T } | { ok: false; error: string; message: string };

class ExternalToolError extends Error {}

export class ExternalToolPipeline {
  readonly #actor: SessionActor;
  readonly #executor: CommandExecutor;
  readonly #policy: PolicyEngine;
  readonly #redactor: SecretRedactor;
  readonly #leases: ExternalLeaseRegistry;
  readonly #requestApproval: NonNullable<ExternalToolPipelineOptions['requestApproval']>;
  readonly #probe: ShellProbe;
  readonly #sessionGrants = new Set<string>();
  #lastTransactionId: string | undefined;
  #disposed = false;

  constructor(options: ExternalToolPipelineOptions) {
    this.#actor = options.actor;
    this.#executor = options.executor;
    this.#policy = options.policy ?? new PolicyEngine();
    this.#redactor = options.redactor ?? new SecretRedactor();
    this.#leases = options.leases ?? new ExternalLeaseRegistry();
    this.#requestApproval = options.requestApproval ?? (() => Promise.resolve('denied'));
    this.#probe = options.probe ?? new DefaultShellProbe(this.#actor);
    this.#executor.onEvent((event) => {
      if (event.type === 'finished') void this.#leases.clear(event.transaction.sessionId);
      if (event.type === 'finished') this.#lastTransactionId = event.transaction.id;
    });
  }

  get grants(): ReadonlySet<string> {
    return new Set(this.#sessionGrants);
  }

  clear(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#sessionGrants.clear();
    this.#probe.dispose();
    this.#leases.clear(this.#actor.snapshot.id);
    const activeTransactionId = this.#executor.activeTransactionId;
    if (activeTransactionId !== undefined) void this.#executor.interrupt(activeTransactionId);
    this.#executor.dispose();
  }

  status(): ExternalToolResult<{
    sessionId: string;
    status: 'ready' | 'not_ready' | 'expired';
    environment?: {
      dialect: 'posix' | 'powershell' | 'unknown';
      platform: 'unix' | 'windows' | 'unknown';
      verificationStatus: 'unverified' | 'verified';
    };
    guidance?: string;
    activeTransactionId?: string;
  }> {
    const snapshot = this.#actor.snapshot;
    if (snapshot.pty !== 'running') {
      return {
        ok: true,
        result: { sessionId: snapshot.id, status: 'expired', guidance: '请在桌面端重新共享会话。' },
      };
    }
    const environment = snapshot.environment;
    const verified =
      environment.verificationStatus === 'verified' &&
      environment.dialect !== 'unknown' &&
      environment.platform !== 'unknown';
    return {
      ok: true,
      result: {
        sessionId: snapshot.id,
        status: verified ? 'ready' : 'not_ready',
        environment: {
          dialect: environment.dialect,
          platform: environment.platform,
          verificationStatus: environment.verificationStatus,
        },
        ...(verified
          ? {}
          : {
              guidance:
                '当前 PTY environment 尚未验证。synapse_status 仅返回只读快照，不会触发 Probe；如果远端 Shell 提示符已就绪，请直接调用 synapse_execute 提交原文命令，执行前会先运行固定明文 Probe。若 Probe 失败将返回 SESSION_NOT_READY，且不会发送用户命令。',
            }),
        ...(this.#executor.activeTransactionId === undefined
          ? {}
          : { activeTransactionId: this.#executor.activeTransactionId }),
      },
    };
  }

  async observe(
    input: ObserveInput,
    context: McpToolContext,
  ): Promise<ExternalToolResult<Record<string, unknown>>> {
    this.#requireObservation(context);
    const activeId = this.#executor.activeTransactionId ?? this.#lastTransactionId;
    const execution = activeId === undefined ? undefined : this.#executor.get(activeId);
    const raw =
      execution?.output.text.slice(Math.max(0, input.afterCursor ?? 0)) ??
      '终端当前没有可用的增量输出缓冲。';
    const redacted = this.#redactor.redact(raw);
    return {
      ok: true,
      result: {
        sessionId: this.#actor.snapshot.id,
        cursor: execution?.cursor ?? input.afterCursor ?? 0,
        output: redacted.text,
        redacted: redacted.redacted,
        ...(activeId === undefined ? {} : { activeTransactionId: activeId }),
      },
    };
  }

  async execute(
    input: ExecuteInput,
    context: McpToolContext,
  ): Promise<ExternalToolResult<Record<string, unknown>>> {
    if (this.#disposed)
      return denied('SESSION_EXPIRED', '该 Session 的 Sharing 已失效，请重新共享。');
    if (context.mode === 'read_only') {
      return denied('POLICY_DENIED', '只读模式不允许执行命令。');
    }
    const sessionId = this.#actor.snapshot.id;
    if (this.#leases.owner(sessionId) !== undefined) {
      return denied('SESSION_BUSY', '会话已有外部事务，请稍后重试。');
    }
    let executionStarted = false;
    try {
      this.#leases.acquire(sessionId, context.caller.id);
    } catch {
      return denied('SESSION_BUSY', '会话已有外部事务，请稍后重试。');
    }
    try {
      const environment = await this.#probe.run({
        environmentEpoch: this.#actor.snapshot.environment.capabilityEpoch,
      });
      this.#ensureActive();
      if (environment.mode !== 'structured') {
        return denied(
          'SESSION_NOT_READY',
          `当前 PTY 环境未验证（${environment.reason}），未发送用户命令。请完成 SSH/嵌套 Shell 交互后重试。`,
        );
      }
      const terminalType = currentEnvironmentLabel(environment.dialect);
      const shellMismatch = detectPowerShellMismatch(input.command, terminalType);
      if (shellMismatch !== undefined) return denied('SHELL_MISMATCH', shellMismatch);
      const decision = await this.#policy.classify(input.command, { terminalType });
      const allowed = await this.#authorize(commandRisk(decision), input.command, context);
      this.#ensureActive();
      if (!allowed) {
        return denied('POLICY_DENIED', '审批模式拒绝了该命令。');
      }

      const result = await this.#executor.execute({
        command: input.command,
        risk: decision.level,
        ...(input.observationWindowMs === undefined
          ? {}
          : { observationWindowMs: input.observationWindowMs }),
      });
      executionStarted = true;
      this.#lastTransactionId = result.transaction.id;
      return { ok: true, result: this.#redactExecution(result) };
    } finally {
      if (!executionStarted) this.#leases.clear(this.#actor.snapshot.id);
    }
  }

  async wait(
    input: WaitInput,
    context: McpToolContext,
  ): Promise<ExternalToolResult<Record<string, unknown>>> {
    this.#requireObservation(context);
    const result = await this.#executor.wait({ transactionId: input.transactionId });
    return { ok: true, result: this.#redactExecution(result) };
  }

  async interrupt(
    input: WaitInput,
    context: McpToolContext,
  ): Promise<ExternalToolResult<{ interrupted: boolean }>> {
    try {
      this.#leases.acquire(this.#actor.snapshot.id, context.caller.id);
      const interrupted = await this.#executor.interrupt(input.transactionId);
      if (!interrupted) {
        throw new ExternalToolError(
          'TRANSACTION_NOT_FOUND: 事务不存在或已结束，请检查 synapse_execute 返回值。',
        );
      }
      return { ok: true, result: { interrupted: true } };
    } catch (error) {
      if (error instanceof ExternalToolError) throw error;
      return denied('SESSION_BUSY', '无法取得中断租约，请稍后重试。');
    } finally {
      this.#leases.clear(this.#actor.snapshot.id);
    }
  }

  #requireObservation(context: McpToolContext): void {
    if (context.mode === 'read_only') return;
  }

  async #authorize(risk: CommandRisk, command: string, context: McpToolContext): Promise<boolean> {
    this.#ensureActive();
    if (context.mode === 'full') return true;
    if (risk === 'read_only' || risk === 'mutating') return true;
    if (this.#sessionGrants.has(command)) return true;

    const decision = await this.#policy.classify(command, {
      terminalType: currentEnvironmentLabel(this.#actor.snapshot.environment.dialect),
    });
    const response = await this.#requestApproval({
      sessionId: this.#actor.snapshot.id,
      command,
      risk,
      reasons: decision.reasons,
    });
    this.#ensureActive();
    if (response === 'allow_session') this.#sessionGrants.add(command);
    if (response === 'denied') {
      throw new ExternalToolError('APPROVAL_DENIED: 用户拒绝执行该命令。可调整命令后重新提交。');
    }
    return true;
  }

  #ensureActive(): void {
    if (this.#disposed) {
      throw new ExternalToolError('SESSION_EXPIRED: 该 Session 的 Sharing 已失效，请重新共享。');
    }
  }

  #redactExecution(
    result: Awaited<ReturnType<CommandExecutor['execute']>>,
  ): Record<string, unknown> {
    const redacted = this.#redactor.redact(result.output.text);
    return {
      transaction: result.transaction,
      status: result.status,
      cursor: result.cursor,
      output: redacted.text,
      redacted: redacted.redacted,
    };
  }
}

function currentEnvironmentLabel(dialect: 'posix' | 'powershell' | 'unknown'): string {
  if (dialect === 'powershell') return 'PowerShell';
  if (dialect === 'posix') return 'POSIX';
  return 'unknown';
}

function commandRisk(decision: PolicyDecision): CommandRisk {
  return decision.level;
}

function denied(error: string, message: string): { ok: false; error: string; message: string } {
  return { ok: false, error, message };
}

function detectPowerShellMismatch(command: string, terminalType: string): string | undefined {
  if (/powershell|pwsh|cmd/i.test(terminalType)) return undefined;
  if (startsWithExplicitPowerShellInvocation(command)) return undefined;
  const match =
    /\b(?:Get|Select|Format|Where|Remove|Set|New|Start|Stop|Invoke|Test|Convert|Write)-[A-Za-z]+\b/i.exec(
      command,
    );
  if (match === null) return undefined;
  return (
    `命令包含 PowerShell 指令「${match[0]}」，但当前 PTY environment 已验证为 ${terminalType}` +
    '。本次未发送用户命令，请改用当前 Shell 语法，或先在当前 Session 内进入 PowerShell 后重试。'
  );
}

function startsWithExplicitPowerShellInvocation(command: string): boolean {
  const firstToken = /^\s*(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/.exec(command);
  if (firstToken === null) return false;
  const executable = firstToken[1] ?? firstToken[2] ?? firstToken[3] ?? '';
  return /(?:^|[\\/])(?:powershell|pwsh)(?:\.exe)?$/i.test(executable);
}
