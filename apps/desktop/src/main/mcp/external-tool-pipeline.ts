import type {
  CommandRisk,
  ExternalCaller,
  ExternalErrorCode,
  ExecutionContextId,
  ExternalTransactionStatus,
  McpApprovalMode,
  OutputCursor,
} from '@synapse-term/domain';
import {
  CommandExecutorError,
  ExternalLeaseRegistry,
  ShellProbe as DefaultShellProbe,
  ShellDriverError,
  resolveShellDriver,
  type CommandExecutionResult,
  type CommandExecutor,
  type ShellProbe,
  type SessionActor,
} from '@synapse-term/terminal-service';

import type { PolicyDecision } from './policy-engine.js';
import { PolicyEngine } from './policy-engine.js';
import { SecretRedactor } from './secret-redactor.js';
import { OutputCursorError, SharingOutputHistory } from './sharing-output-history.js';

export interface McpToolContext {
  caller: ExternalCaller;
  mode: McpApprovalMode;
}

export type ApprovalDecision = 'allow_once' | 'allow_session' | 'denied';

interface AuthorizationResult {
  allowed: boolean;
  grantSessionCommand: boolean;
}

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
  history?: SharingOutputHistory | undefined;
  requestApproval?: ((request: ApprovalRequest) => Promise<ApprovalDecision>) | undefined;
}

export interface ExecuteInput {
  command: string;
  expectedContextId?: ExecutionContextId | undefined;
  observationWindowMs?: number | undefined;
}

export interface ObserveInput {
  afterCursor?: OutputCursor | undefined;
  tail?: boolean | undefined;
  maxBytes?: number | undefined;
}

export interface WaitInput {
  transactionId: string;
  timeoutMs?: number | undefined;
}

export type ExternalToolResult<T> =
  { ok: true; result: T } | { ok: false; error: string; message: string };

export class ExternalToolError extends Error {
  readonly code: ExternalErrorCode;
  readonly reason: string;
  readonly guidance: string;

  constructor(code: ExternalErrorCode, reason: string, guidance: string) {
    super(`${code}: ${reason} ${guidance}`);
    this.name = code;
    this.code = code;
    this.reason = reason;
    this.guidance = guidance;
  }
}

export class ExternalToolPipeline {
  readonly #actor: SessionActor;
  readonly #executor: CommandExecutor;
  readonly #policy: PolicyEngine;
  readonly #redactor: SecretRedactor;
  readonly #leases: ExternalLeaseRegistry;
  readonly #requestApproval: NonNullable<ExternalToolPipelineOptions['requestApproval']>;
  readonly #probe: ShellProbe;
  readonly #history: SharingOutputHistory;
  readonly #ownsHistory: boolean;
  readonly #removeHistoryListener: () => void;
  readonly #sessionGrants = new Set<string>();
  #disposed = false;
  #clearPromise: Promise<void> | undefined;

  constructor(options: ExternalToolPipelineOptions) {
    this.#actor = options.actor;
    this.#executor = options.executor;
    this.#policy = options.policy ?? new PolicyEngine();
    this.#redactor = options.redactor ?? new SecretRedactor();
    this.#leases = options.leases ?? new ExternalLeaseRegistry();
    this.#requestApproval = options.requestApproval ?? (() => Promise.resolve('denied'));
    this.#probe = options.probe ?? new DefaultShellProbe(this.#actor);
    this.#history =
      options.history ?? new SharingOutputHistory({ sessionId: this.#actor.snapshot.id });
    this.#ownsHistory = options.history === undefined;
    this.#removeHistoryListener =
      options.history === undefined
        ? this.#actor.onEvent((event) => {
            if (event.type === 'pty_output') this.#history.append(event.historyData ?? event.data);
          })
        : () => undefined;
    this.#executor.onEvent((event) => {
      if (event.type === 'finished') this.#leases.clear(event.transaction.sessionId);
    });
  }

  get grants(): ReadonlySet<string> {
    return new Set(this.#sessionGrants);
  }

  clear(): Promise<void> {
    if (this.#clearPromise !== undefined) return this.#clearPromise;
    this.#disposed = true;
    this.#sessionGrants.clear();
    this.#removeHistoryListener();
    if (this.#ownsHistory) this.#history.dispose();
    this.#probe.dispose();
    this.#leases.clear(this.#actor.snapshot.id);
    const activeTransactionId = this.#executor.activeTransactionId;
    const interruptPromise =
      activeTransactionId === undefined
        ? Promise.resolve()
        : this.#actor.interrupt().catch(() => undefined);
    this.#clearPromise = Promise.all([interruptPromise, this.#executor.dispose()]).then(
      () => undefined,
    );
    return this.#clearPromise;
  }

  status(): ExternalToolResult<{
    sessionId: string;
    status: 'ready' | 'not_ready' | 'expired';
    environment?: {
      dialect: 'posix' | 'powershell' | 'unknown';
      platform: 'unix' | 'windows' | 'unknown';
      verificationStatus: 'unverified' | 'verified';
    };
    readinessReason?: string;
    guidance?: string;
    activeTransactionId?: string;
  }> {
    const snapshot = this.#actor.snapshot;
    if (this.#disposed || snapshot.pty !== 'running') {
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
              readinessReason: '当前 PTY environment 尚未验证。',
              guidance:
                'synapse_status 是只读快照，不会触发 Probe；远端 Shell 提示符就绪后请直接调用 synapse_execute，执行前会运行固定明文 Probe。Probe 失败时不要盲目重试或循环查询 status。',
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
    void context;
    if (this.#disposed || this.#actor.snapshot.pty !== 'running') {
      return denied('SESSION_EXPIRED', '该 Session 的 Sharing 已失效，请重新共享。');
    }
    this.#requireObservation();
    try {
      const page = this.#history.read(input);
      return {
        ok: true,
        result: {
          sessionId: this.#actor.snapshot.id,
          output: page.output,
          redacted: page.redacted,
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
          historyTruncated: page.historyTruncated,
          earliestCursor: page.earliestCursor,
          executionContextId: this.#actor.snapshot.executionContextId,
          ...(this.#executor.activeTransactionId === undefined
            ? {}
            : { activeTransactionId: this.#executor.activeTransactionId }),
        },
      };
    } catch (error) {
      if (error instanceof OutputCursorError) {
        return denied(
          error.code,
          error.message,
          '请重新调用 synapse_observe（省略 afterCursor）获取当前 Sharing 的 earliestCursor。',
        );
      }
      if (error instanceof RangeError) {
        return denied('COMMAND_NOT_AUDITABLE', error.message, '请调整 observe 的分页参数。');
      }
      return denied('SESSION_NOT_READY', '无法读取当前 Sharing 输出历史。', '请稍后重试。');
    }
  }

  async execute(
    input: ExecuteInput,
    context: McpToolContext,
  ): Promise<ExternalToolResult<Record<string, unknown>>> {
    if (this.#disposed || this.#actor.snapshot.pty !== 'running') {
      return denied('SESSION_EXPIRED', '该 Session 的 Sharing 已失效，请重新共享。');
    }
    if (typeof input.expectedContextId !== 'string' || input.expectedContextId.length === 0) {
      return denied(
        'EXECUTION_CONTEXT_REQUIRED',
        '执行上下文 ID 缺失，未发送用户命令。',
        '请先调用 synapse_observe 获取当前终端内容和 executionContextId，再将它作为 expectedContextId 传入。',
      );
    }
    const initial = this.#actor.snapshot;
    if (initial.pty !== 'running') {
      return denied(
        'SESSION_EXPIRED',
        '该 Session 已不在运行，未发送用户命令。',
        '请重新共享 Session。',
      );
    }
    if (initial.executionContextId !== input.expectedContextId) {
      return denied(
        'EXECUTION_CONTEXT_STALE',
        '执行上下文已变化，未发送用户命令。',
        '请先调用 synapse_observe（必要时使用 tail: true）重新获取终端内容和新的 executionContextId。',
      );
    }
    if (context.mode === 'read_only') {
      return denied(
        'POLICY_DENIED',
        '只读审批模式不允许执行命令。',
        '请让用户调整审批模式或改用 observe。',
      );
    }
    const sessionId = initial.id;
    if (this.#leases.owner(sessionId) !== undefined) {
      return denied(
        'SESSION_BUSY',
        '会话已有外部事务或审批中的外部调用。',
        '请先等待或中断当前事务。',
      );
    }
    try {
      this.#leases.acquire(sessionId, context.caller.id);
    } catch {
      return denied('SESSION_BUSY', '会话已有外部事务或外部调用。', '请先等待或中断当前事务。');
    }

    let executionStarted = false;
    try {
      const environment = await this.#probe.run({
        environmentEpoch: initial.environment.capabilityEpoch,
      });
      this.#ensureContext(input.expectedContextId);
      if (environment.mode !== 'structured') {
        return denied(
          'SESSION_NOT_READY',
          `当前 PTY environment 未验证（${environment.reason}），未发送用户命令。`,
          '请完成当前 Shell/SSH/嵌套 Shell 交互，等待提示符稳定后再执行；不要循环调用 status。',
        );
      }
      let shellDriver;
      try {
        shellDriver = resolveShellDriver(environment.dialect);
        shellDriver.validateCommand(input.command);
      } catch (error) {
        if (error instanceof ShellDriverError) {
          const code: ExternalErrorCode =
            error.code === 'UNSUPPORTED_SHELL' ? 'SHELL_MISMATCH' : error.code;
          throw new ExternalToolError(
            code,
            error.message,
            code === 'INTERACTIVE_COMMAND_UNSUPPORTED'
              ? '请先在本地 PTY 中完成交互，再重新观察当前 Session。'
              : '请修改 command 后重新提交；本次未发送用户命令。',
          );
        }
        throw error;
      }
      const terminalType = currentEnvironmentLabel(environment.dialect);
      const shellMismatch = detectPowerShellMismatch(input.command, terminalType);
      if (shellMismatch !== undefined) return denied('SHELL_MISMATCH', shellMismatch);
      const decision = await this.#policy.classify(input.command, { terminalType });
      this.#ensureContext(input.expectedContextId);
      const authorization = await this.#authorize(decision, input.command, context);
      this.#ensureContext(input.expectedContextId);
      if (!authorization.allowed) {
        return denied('POLICY_DENIED', '审批模式拒绝了该命令。', '请调整命令或审批模式后再试。');
      }

      const result = await this.#executor.execute({
        command: input.command,
        expectedContextId: input.expectedContextId,
        risk: decision.level,
        riskEvidence: {
          risk: decision.risk,
          confidence: decision.confidence,
          reasons: decision.reasons,
          requiresConfirmation: decision.requiresConfirmation,
        },
        ...(input.observationWindowMs === undefined
          ? {}
          : { observationWindowMs: input.observationWindowMs }),
      });
      executionStarted = true;
      if (authorization.grantSessionCommand) this.#sessionGrants.add(input.command);
      return { ok: true, result: this.#redactExecution(result) };
    } catch (error) {
      return this.#errorResult(error);
    } finally {
      if (!executionStarted) this.#leases.clear(sessionId);
    }
  }

  async wait(
    input: WaitInput,
    context: McpToolContext,
  ): Promise<ExternalToolResult<Record<string, unknown>>> {
    void context;
    if (this.#disposed || this.#actor.snapshot.pty !== 'running') {
      return denied('SESSION_EXPIRED', '该 Session 的 Sharing 已失效，请重新共享。');
    }
    this.#requireObservation();
    try {
      const result = await this.#executor.wait(input);
      return { ok: true, result: this.#redactExecution(result) };
    } catch (error) {
      return this.#errorResult(error);
    }
  }

  async interrupt(
    input: WaitInput,
    context: McpToolContext,
  ): Promise<
    ExternalToolResult<{
      interrupted: boolean;
      status?: ExternalTransactionStatus | undefined;
      retryable?: boolean | undefined;
      safeToResubmit?: boolean | undefined;
    }>
  > {
    if (this.#disposed)
      return denied('SESSION_EXPIRED', '该 Session 的 Sharing 已失效，请重新共享。');
    try {
      this.#leases.acquire(this.#actor.snapshot.id, context.caller.id);
    } catch {
      return denied('SESSION_BUSY', '无法取得当前 Session 的外部租约。', '请稍后重试。');
    }
    try {
      const interrupted = await this.#executor.interrupt(input.transactionId);
      if (!interrupted) {
        return denied(
          'TRANSACTION_NOT_FOUND',
          '事务不存在、已结束或尚未写入 PTY。',
          '请检查 synapse_execute 返回的 transactionId，并使用 wait/observe 查看当前状态。',
        );
      }
      const result = this.#executor.get(input.transactionId);
      return {
        ok: true,
        result: {
          interrupted: result?.status === 'interrupted',
          ...(result === undefined
            ? {}
            : {
                status: result.status,
                retryable: result.retryable,
                safeToResubmit: result.safeToResubmit,
              }),
        },
      };
    } finally {
      this.#leases.clear(this.#actor.snapshot.id);
    }
  }

  #requireObservation(): void {
    // 观察类外部调用不创建租约，也不触发 Probe。
  }

  async #authorize(
    decision: PolicyDecision,
    command: string,
    context: McpToolContext,
  ): Promise<AuthorizationResult> {
    if (context.mode === 'full') return { allowed: true, grantSessionCommand: false };
    if (decision.level === 'read_only' || decision.level === 'mutating') {
      return { allowed: true, grantSessionCommand: false };
    }
    if (this.#sessionGrants.has(command)) return { allowed: true, grantSessionCommand: false };

    try {
      const response = await this.#requestApproval({
        sessionId: this.#actor.snapshot.id,
        command,
        risk: decision.level,
        reasons: decision.reasons,
      });
      if (response === 'denied') {
        throw new ExternalToolError(
          'APPROVAL_DENIED',
          '用户拒绝执行该命令。',
          '可调整命令后重新提交。',
        );
      }
      return { allowed: true, grantSessionCommand: response === 'allow_session' };
    } catch (error) {
      if (error instanceof ExternalToolError) throw error;
      const parsed = parseStableError(error);
      throw new ExternalToolError(
        parsed.code === 'APPROVAL_TIMEOUT' || parsed.code === 'SESSION_EXPIRED'
          ? parsed.code
          : 'APPROVAL_DENIED',
        parsed.reason,
        parsed.guidance,
      );
    }
  }

  #ensureContext(expectedContextId: ExecutionContextId): void {
    if (this.#disposed) {
      throw new ExternalToolError(
        'SESSION_EXPIRED',
        '该 Session 的 Sharing 已失效。',
        '请重新共享 Session。',
      );
    }
    const snapshot = this.#actor.snapshot;
    if (snapshot.pty !== 'running') {
      throw new ExternalToolError('SESSION_EXPIRED', '该 Session 已退出。', '请重新共享 Session。');
    }
    if (snapshot.executionContextId !== expectedContextId) {
      throw new ExternalToolError(
        'EXECUTION_CONTEXT_STALE',
        'Probe 或审批等待期间当前执行上下文已变化，未发送用户命令。',
        '请先调用 synapse_observe（必要时使用 tail: true）获取当前终端内容和新的 executionContextId。',
      );
    }
  }

  #errorResult(error: unknown): { ok: false; error: string; message: string } {
    if (error instanceof ExternalToolError) return denied(error.code, error.reason, error.guidance);
    if (error instanceof CommandExecutorError) {
      const parsed = parseStableError(error);
      return denied(parsed.code, parsed.reason, parsed.guidance);
    }
    if (error instanceof RangeError) {
      return denied('SESSION_NOT_READY', error.message, '请检查参数并稍后重试。');
    }
    const parsed = parseStableError(error);
    return denied(parsed.code, parsed.reason, parsed.guidance);
  }

  #redactExecution(result: CommandExecutionResult): Record<string, unknown> {
    const redacted = redactContinuous(this.#redactor, result.output.text);
    const riskEvidence = result.transaction.riskEvidence;
    return {
      transaction: withoutCompletionNonce(result.transaction),
      status: result.status,
      output: redacted.text,
      redacted: redacted.redacted,
      outputRange: result.outputRange,
      nextCursor: result.nextCursor,
      executionContextId: result.executionContextId,
      completion: result.completion,
      retryable: result.retryable,
      safeToResubmit: result.safeToResubmit,
      ...(riskEvidence === undefined
        ? {}
        : {
            risk: riskEvidence.risk,
            confidence: riskEvidence.confidence,
            reasons: riskEvidence.reasons,
            requiresConfirmation: riskEvidence.requiresConfirmation,
          }),
      ...(result.waitTimedOut === true ? { waitTimedOut: true } : {}),
    };
  }
}

function withoutCompletionNonce(transaction: CommandExecutionResult['transaction']) {
  const { nonce, ...publicTransaction } = transaction;
  void nonce;
  return publicTransaction;
}

function currentEnvironmentLabel(dialect: 'posix' | 'powershell' | 'unknown'): string {
  if (dialect === 'powershell') return 'PowerShell';
  if (dialect === 'posix') return 'POSIX';
  return 'unknown';
}

function denied(
  error: ExternalErrorCode | string,
  reason: string,
  guidance = '请检查当前 Session 状态后重试。',
): { ok: false; error: string; message: string } {
  return { ok: false, error, message: `${reason} ${guidance}` };
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

function redactContinuous(redactor: SecretRedactor, value: string) {
  const stream = redactor.createStream();
  const first = stream.push(value);
  const last = stream.flush();
  return { text: `${first.text}${last.text}`, redacted: first.redacted || last.redacted };
}

function parseStableError(error: unknown): {
  code: ExternalErrorCode;
  reason: string;
  guidance: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  const match = /^([A-Z][A-Z0-9_]*):\s*([^。]+。?)(?:\s*(.*))?$/s.exec(message);
  if (match === null || !STABLE_ERROR_CODES.has(match[1] as ExternalErrorCode)) {
    return {
      code: 'SESSION_NOT_READY',
      reason: '外部调用失败。',
      guidance: '请检查当前 Session 状态后重试。',
    };
  }
  const code = match[1]!;
  const reason = sanitizeErrorPart(match[2] ?? '外部调用失败。');
  const guidance = sanitizeErrorPart(match[3] ?? '') || '请检查当前 Session 状态后重试。';
  return { code: code as ExternalErrorCode, reason, guidance };
}

const STABLE_ERROR_CODES = new Set<ExternalErrorCode>([
  'SESSION_EXPIRED',
  'SESSION_NOT_READY',
  'SESSION_BUSY',
  'TRANSACTION_NOT_FOUND',
  'POLICY_DENIED',
  'SHELL_MISMATCH',
  'COMMAND_NOT_AUDITABLE',
  'INTERACTIVE_COMMAND_UNSUPPORTED',
  'EXECUTION_CONTEXT_REQUIRED',
  'EXECUTION_CONTEXT_STALE',
  'OUTPUT_CURSOR_STALE',
  'APPROVAL_TIMEOUT',
  'APPROVAL_DENIED',
]);

function sanitizeErrorPart(value: string): string {
  let sanitized = '';
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    sanitized += isUnsafeErrorCodePoint(codePoint) ? ' ' : character;
  }
  return sanitized.replace(/\s+/g, ' ').trim().slice(0, 512);
}

function isUnsafeErrorCodePoint(codePoint: number): boolean {
  return codePoint <= 0x1f || codePoint === 0x7f || (codePoint >= 0x80 && codePoint <= 0x9f);
}
