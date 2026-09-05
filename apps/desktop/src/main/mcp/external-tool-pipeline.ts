import type {
  CommandRisk,
  ExternalCaller,
  ExternalErrorCode,
  ExecutionContextId,
  ExternalTransactionKind,
  ExternalTransactionStatus,
  InputGrantMode,
  InputKey,
  McpApprovalMode,
  OutputCursor,
} from '@synapse-term/domain';
import {
  CommandExecutorError,
  ExternalLeaseRegistry,
  InteractiveCommandExecutor,
  InteractiveCommandExecutorError,
  ShellProbe as DefaultShellProbe,
  ShellDriverError,
  resolveShellDriver,
  type CommandExecutionResult,
  type CommandExecutor,
  type ExternalLeaseHandle,
  type InteractiveExecutionResult,
  type InteractiveInputPayload,
  type ShellProbe,
  type SessionActor,
} from '@synapse-term/terminal-service';

import type { PolicyDecision } from './policy-engine.js';
import { PolicyEngine } from './policy-engine.js';
import { SecretRedactor } from './secret-redactor.js';
import {
  BOUNDED_INPUT_IDLE_TIMEOUT_MS,
  BOUNDED_INPUT_MAX_BYTES,
  BOUNDED_INPUT_MAX_CALLS,
  encodeInput,
  InputEncoderError,
  validateInputRequestId,
} from './input-encoder.js';
import { OutputCursorError, SharingOutputHistory } from './sharing-output-history.js';

export interface McpToolContext {
  caller: ExternalCaller;
  mode: McpApprovalMode;
}

export type ApprovalDecision = 'allow_once' | 'allow_session' | 'denied';

export interface InputGrantLimits {
  maxCalls: number;
  maxBytes: number;
  idleTimeoutMs: number;
}

export interface ApprovalRequest {
  sessionId: string;
  command: string;
  risk: CommandRisk;
  reasons: readonly string[];
  kind?: ExternalTransactionKind | 'free_input' | undefined;
  inputGrantMode?: InputGrantMode | undefined;
  inputLimits?: InputGrantLimits | undefined;
  /** 仅自由输入审批显示规范化文本；交互启动不会显示未来输入。 */
  text?: string | undefined;
  keys?: readonly InputKey[] | undefined;
}

interface AuthorizationResult {
  allowed: boolean;
  grantSession: boolean;
}

export interface ExternalToolPipelineOptions {
  actor: SessionActor;
  executor: CommandExecutor;
  interactiveExecutor?: InteractiveCommandExecutor | undefined;
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

export interface StartInteractiveInput {
  command: string;
  expectedContextId?: ExecutionContextId | undefined;
  inputGrantMode: InputGrantMode;
}

export interface InputInput {
  transactionId?: string | undefined;
  inputGrantId?: string | undefined;
  expectedContextId?: ExecutionContextId | undefined;
  inputRequestId: string;
  text?: unknown;
  keys?: unknown;
}

export interface FinishInteractiveInput {
  transactionId: string;
  observedCursor: OutputCursor;
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

export type ExternalToolPipelineEvent = {
  type: 'started' | 'finished';
  transaction: {
    id: string;
    sessionId: string;
    kind: ExternalTransactionKind;
    command: string;
    status: ExternalTransactionStatus;
  };
};

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

interface InputDedupeRecord {
  mode: 'transactional' | 'free';
  transactionId: string | undefined;
  grantId: string | undefined;
  payloadHash: string;
  promise: Promise<ExternalToolResult<Record<string, unknown>>>;
  outcome?: ExternalToolResult<Record<string, unknown>> | undefined;
}

export class ExternalToolPipeline {
  readonly #actor: SessionActor;
  readonly #executor: CommandExecutor;
  readonly #interactiveExecutor: InteractiveCommandExecutor;
  readonly #policy: PolicyEngine;
  readonly #redactor: SecretRedactor;
  readonly #leases: ExternalLeaseRegistry;
  readonly #requestApproval: NonNullable<ExternalToolPipelineOptions['requestApproval']>;
  readonly #probe: ShellProbe;
  readonly #history: SharingOutputHistory;
  readonly #ownsHistory: boolean;
  readonly #removeHistoryListener: () => void;
  readonly #removeExecutorListener: () => void;
  readonly #removeInteractiveExecutorListener: () => void;
  readonly #sessionGrants = new Set<string>();
  readonly #inputRequests = new Map<string, InputDedupeRecord>();
  readonly #listeners = new Set<(event: ExternalToolPipelineEvent) => void>();
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
    this.#interactiveExecutor =
      options.interactiveExecutor ??
      new InteractiveCommandExecutor(this.#actor, {
        outputCursor: () => this.#history.cursor,
        validateObservedCursor: (cursor, minimum) =>
          this.#history.assertCursorAtOrAfter(cursor, minimum),
      });
    this.#removeExecutorListener = this.#executor.onEvent((event) => {
      if (event.type === 'finished') this.#leases.clear(event.transaction.sessionId);
      this.#emitExecutorEvent(event.type, event.transaction);
    });
    this.#removeInteractiveExecutorListener = this.#interactiveExecutor.onEvent((event) => {
      this.#emitExecutorEvent(event.type, event.transaction);
    });
  }

  get grants(): ReadonlySet<string> {
    return new Set(this.#sessionGrants);
  }

  get activeTransactionId(): string | undefined {
    return this.#executor.activeTransactionId ?? this.#interactiveExecutor.activeTransactionId;
  }

  get activeTransactionKind(): ExternalTransactionKind | undefined {
    if (this.#interactiveExecutor.activeTransactionId !== undefined) return 'interactive';
    if (this.#executor.activeTransactionId !== undefined) return 'structured';
    return undefined;
  }

  onEvent(listener: (event: ExternalToolPipelineEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  clear(): Promise<void> {
    if (this.#clearPromise !== undefined) return this.#clearPromise;
    this.#disposed = true;
    this.#sessionGrants.clear();
    this.#inputRequests.clear();
    this.#removeHistoryListener();
    this.#removeExecutorListener();
    this.#removeInteractiveExecutorListener();
    this.#listeners.clear();
    if (this.#ownsHistory) this.#history.dispose();
    this.#probe.dispose();
    this.#leases.clear(this.#actor.snapshot.id);
    const hasActive = this.activeTransactionId !== undefined;
    const interruptPromise = hasActive
      ? this.#actor.interrupt().catch(() => undefined)
      : Promise.resolve();
    this.#clearPromise = Promise.all([
      interruptPromise,
      this.#executor.dispose(),
      this.#interactiveExecutor.clear(),
    ]).then(() => undefined);
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
    activeTransactionKind?: ExternalTransactionKind;
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
    const activeTransactionId = this.activeTransactionId;
    const activeTransactionKind = this.activeTransactionKind;
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
                'synapse_status 是只读快照，不会触发 Probe；远端 Shell 提示符就绪后请直接调用 synapse_execute 或 synapse_start_interactive，执行前会运行固定明文 Probe。Probe 失败时不要盲目重试或循环查询 status。',
            }),
        ...(activeTransactionId === undefined ? {} : { activeTransactionId }),
        ...(activeTransactionKind === undefined ? {} : { activeTransactionKind }),
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
          ...(this.activeTransactionId === undefined
            ? {}
            : { activeTransactionId: this.activeTransactionId }),
          ...(this.activeTransactionKind === undefined
            ? {}
            : { activeTransactionKind: this.activeTransactionKind }),
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
    if (!isNonEmptyString(input.expectedContextId)) {
      return denied(
        'EXECUTION_CONTEXT_REQUIRED',
        '执行上下文 ID 缺失，未发送用户命令。',
        '请先调用 synapse_observe 获取当前终端内容和 executionContextId，再将它作为 expectedContextId 传入。',
      );
    }
    const initial = this.#actor.snapshot;
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
    if (this.#hasExternalActivity()) {
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
        throw new ExternalToolError(
          'SESSION_NOT_READY',
          `当前 PTY environment 未验证（${environment.reason}），未发送用户命令。`,
          '请完成当前 Shell/SSH/嵌套 Shell 交互，等待提示符稳定后再执行；不要循环调用 status。',
        );
      }
      this.#resolveAndValidateDriver(environment.dialect, input.command, false);
      const terminalType = currentEnvironmentLabel(environment.dialect);
      const shellMismatch = detectPowerShellMismatch(input.command, terminalType);
      if (shellMismatch !== undefined)
        throw new ExternalToolError('SHELL_MISMATCH', shellMismatch, '');
      const decision = await this.#policy.classify(input.command, { terminalType });
      this.#ensureContext(input.expectedContextId);
      const authorization = await this.#authorizeStructured(decision, input.command, context);
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
      if (authorization.grantSession) {
        this.#sessionGrants.add(commandGrantKey(input.command, 'structured', undefined));
      }
      return { ok: true, result: this.#redactExecution(result) };
    } catch (error) {
      return this.#errorResult(error);
    } finally {
      if (!executionStarted) this.#leases.release(sessionId, context.caller.id);
    }
  }

  async startInteractive(
    input: StartInteractiveInput,
    context: McpToolContext,
  ): Promise<ExternalToolResult<Record<string, unknown>>> {
    if (this.#disposed || this.#actor.snapshot.pty !== 'running') {
      return denied('SESSION_EXPIRED', '该 Session 的 Sharing 已失效，请重新共享。');
    }
    if (!isNonEmptyString(input.expectedContextId)) {
      return denied(
        'EXECUTION_CONTEXT_REQUIRED',
        '执行上下文 ID 缺失，未发送交互 command。',
        '请先调用 synapse_observe 获取当前终端内容和 executionContextId。',
      );
    }
    if (input.inputGrantMode !== 'one_shot' && input.inputGrantMode !== 'bounded') {
      return denied('POLICY_DENIED', 'inputGrantMode 无效。', '请选择 one_shot 或 bounded。');
    }
    const initial = this.#actor.snapshot;
    if (initial.executionContextId !== input.expectedContextId) {
      return denied(
        'EXECUTION_CONTEXT_STALE',
        '执行上下文已变化，未发送交互 command。',
        '请先调用 synapse_observe（必要时使用 tail: true）重新获取当前内容和新的 executionContextId。',
      );
    }
    if (context.mode === 'read_only') {
      return denied(
        'POLICY_DENIED',
        '只读审批模式不允许启动交互事务。',
        '请让用户调整审批模式或改用 observe。',
      );
    }
    if (this.#hasExternalActivity()) {
      return denied(
        'SESSION_BUSY',
        '会话已有外部事务或审批中的外部调用。',
        '请先等待或中断当前事务。',
      );
    }
    let lease: ExternalLeaseHandle;
    try {
      lease = this.#leases.acquireHandle(initial.id, context.caller.id);
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
        throw new ExternalToolError(
          'SESSION_NOT_READY',
          `当前 PTY environment 未验证（${environment.reason}），未发送交互 command。`,
          '请完成当前 Shell/SSH/嵌套 Shell 交互后重新观察。',
        );
      }
      this.#resolveAndValidateDriver(environment.dialect, input.command, true);
      const terminalType = currentEnvironmentLabel(environment.dialect);
      const shellMismatch = detectPowerShellMismatch(input.command, terminalType);
      if (shellMismatch !== undefined)
        throw new ExternalToolError('SHELL_MISMATCH', shellMismatch, '');
      const decision = await this.#policy.classify(input.command, { terminalType });
      this.#ensureContext(input.expectedContextId);
      const authorization = await this.#authorizeInteractive(
        decision,
        input.command,
        input.inputGrantMode,
        context,
      );
      this.#ensureContext(input.expectedContextId);
      if (!authorization.allowed) {
        return denied('POLICY_DENIED', '审批模式拒绝了交互启动。', '请调整审批模式后再试。');
      }
      const result = await this.#interactiveExecutor.start({
        command: input.command,
        expectedContextId: input.expectedContextId,
        expectedEnvironmentEpoch: environment.capabilityEpoch,
        inputGrantMode: input.inputGrantMode,
        callerId: context.caller.id,
        risk: decision.level,
        riskEvidence: {
          risk: decision.risk,
          confidence: decision.confidence,
          reasons: decision.reasons,
          requiresConfirmation: decision.requiresConfirmation,
        },
        lease,
      });
      executionStarted = true;
      if (authorization.grantSession) {
        this.#sessionGrants.add(
          commandGrantKey(input.command, 'interactive', input.inputGrantMode),
        );
      }
      return { ok: true, result: this.#redactInteractive(result) };
    } catch (error) {
      return this.#errorResult(error);
    } finally {
      if (!executionStarted) lease.release();
    }
  }

  async input(
    input: InputInput,
    context: McpToolContext,
  ): Promise<ExternalToolResult<Record<string, unknown>>> {
    if (this.#disposed || this.#actor.snapshot.pty !== 'running') {
      return denied('SESSION_EXPIRED', '该 Session 的 Sharing 已失效，请重新共享。');
    }
    if (!validateInputRequestId(input.inputRequestId)) {
      return denied(
        'POLICY_DENIED',
        'inputRequestId 必须是 1 到 256 个不含控制字符的字符串。',
        '请为每次逻辑输入生成新的合法标识。',
      );
    }
    let payload: InteractiveInputPayload;
    try {
      payload = encodeInput({ text: input.text, keys: input.keys });
    } catch (error) {
      if (error instanceof InputEncoderError) return deniedFromError(error);
      return denied('COMMAND_NOT_AUDITABLE', '输入无法通过协议校验。', '请检查 text 和 keys。');
    }

    const mode =
      input.transactionId !== undefined || input.inputGrantId !== undefined
        ? 'transactional'
        : input.expectedContextId !== undefined
          ? 'free'
          : undefined;
    if (
      mode === undefined ||
      (mode === 'transactional' &&
        (typeof input.transactionId !== 'string' ||
          input.transactionId.length === 0 ||
          typeof input.inputGrantId !== 'string' ||
          input.inputGrantId.length === 0 ||
          input.expectedContextId !== undefined)) ||
      (mode === 'free' &&
        (typeof input.expectedContextId !== 'string' ||
          input.expectedContextId.length === 0 ||
          input.transactionId !== undefined ||
          input.inputGrantId !== undefined))
    ) {
      return denied(
        'POLICY_DENIED',
        'synapse_input 必须在事务字段组合与 expectedContextId 之间二选一。',
        '事务内输入请同时提供 transactionId/inputGrantId；自由输入请只提供 expectedContextId。',
      );
    }

    const payloadHash = payload.payloadHash ?? '';
    const grantId = mode === 'transactional' ? input.inputGrantId : undefined;
    const key = this.#inputRequestKey(context.caller, input.inputRequestId);
    const existing = this.#inputRequests.get(key);
    if (existing !== undefined) {
      if (
        existing.mode !== mode ||
        existing.transactionId !== input.transactionId ||
        existing.grantId !== grantId ||
        existing.payloadHash !== payloadHash
      ) {
        return denied(
          'POLICY_DENIED',
          'inputRequestId 已登记但 payload、输入模式或 inputGrantId 不一致。',
          '请使用新的 inputRequestId；不确定写入不得自动重放。',
        );
      }
      return existing.outcome === undefined ? existing.promise : structuredClone(existing.outcome);
    }

    let resolve!: (result: ExternalToolResult<Record<string, unknown>>) => void;
    const promise = new Promise<ExternalToolResult<Record<string, unknown>>>((done) => {
      resolve = done;
    });
    const record: InputDedupeRecord = {
      mode,
      transactionId: input.transactionId,
      grantId,
      payloadHash,
      promise,
    };
    this.#inputRequests.set(key, record);
    void this.#performInput(mode, input, payload, context).then(
      (result) => {
        record.outcome = cloneInputDedupeResult(result);
        record.promise = Promise.resolve(record.outcome);
        resolve(result);
      },
      (error: unknown) => {
        const result = this.#errorResult(error);
        record.outcome = result;
        record.promise = Promise.resolve(record.outcome);
        resolve(result);
      },
    );
    return promise;
  }

  async finishInteractive(
    input: FinishInteractiveInput,
    context: McpToolContext,
  ): Promise<ExternalToolResult<Record<string, unknown>>> {
    if (this.#disposed || this.#actor.snapshot.pty !== 'running') {
      return denied('SESSION_EXPIRED', '该 Session 的 Sharing 已失效，请重新共享。');
    }
    if (!isNonEmptyString(input.observedCursor)) {
      return denied(
        'OUTPUT_CURSOR_STALE',
        'observedCursor 缺失，未发送终结 Probe。',
        '请先调用 synapse_observe 并使用最近一次响应的 nextCursor。',
      );
    }
    if (this.#executor.get(input.transactionId) !== undefined) {
      return denied(
        'POLICY_DENIED',
        '该 transactionId 属于结构化事务，不能使用交互终结工具。',
        '请使用 synapse_wait 等待，或使用 synapse_interrupt 中断该结构化事务。',
      );
    }
    try {
      const result = await this.#interactiveExecutor.finish({
        transactionId: input.transactionId,
        observedCursor: input.observedCursor,
        callerId: context.caller.id,
      });
      return { ok: true, result: this.#redactInteractive(result) };
    } catch (error) {
      return this.#errorResult(error);
    }
  }

  async wait(
    input: WaitInput,
    context: McpToolContext,
  ): Promise<ExternalToolResult<Record<string, unknown>>> {
    void context;
    if (this.#disposed)
      return denied('SESSION_EXPIRED', '该 Session 的 Sharing 已失效，请重新共享。');
    try {
      const interactive = this.#interactiveExecutor.get(input.transactionId);
      if (interactive !== undefined) {
        return {
          ok: true,
          result: this.#redactInteractive(
            await this.#interactiveExecutor.wait({
              transactionId: input.transactionId,
              timeoutMs: input.timeoutMs,
            }),
          ),
        };
      }
      return {
        ok: true,
        result: this.#redactExecution(
          await this.#executor.wait({
            transactionId: input.transactionId,
            timeoutMs: input.timeoutMs,
          }),
        ),
      };
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
      kind?: ExternalTransactionKind | undefined;
      retryable?: boolean | undefined;
      safeToResubmit?: boolean | undefined;
    }>
  > {
    if (this.#disposed) return denied('SESSION_EXPIRED', '该 Session 的 Sharing 已失效。');
    if (this.#interactiveExecutor.get(input.transactionId) !== undefined) {
      try {
        const interrupted = await this.#interactiveExecutor.interrupt(
          input.transactionId,
          context.caller.id,
        );
        if (!interrupted) {
          return denied(
            'TRANSACTION_NOT_FOUND',
            '事务不存在、已结束或尚未写入 PTY。',
            '请检查返回的 transactionId，并使用 wait/observe 查看当前状态。',
          );
        }
        const result = this.#interactiveExecutor.get(input.transactionId);
        return {
          ok: true,
          result: {
            interrupted: interrupted && result?.status === 'interrupted',
            kind: 'interactive',
            ...(result === undefined
              ? {}
              : {
                  status: result.status,
                  retryable: result.retryable,
                  safeToResubmit: result.safeToResubmit,
                }),
          },
        };
      } catch (error) {
        return this.#errorResult(error);
      }
    }
    if (this.#interactiveExecutor.activeTransactionId !== undefined) {
      return denied(
        'SESSION_BUSY',
        '当前 Session 有另一个交互事务正在进行。',
        '请使用当前交互事务的 transactionId，或先等待、终结或中断它。',
      );
    }
    if (this.#executor.get(input.transactionId) === undefined) {
      return denied(
        'TRANSACTION_NOT_FOUND',
        '事务不存在、已结束或尚未写入 PTY。',
        '请检查返回的 transactionId，并使用 wait/observe 查看当前状态。',
      );
    }
    try {
      const interrupted = await this.#executor.interrupt(input.transactionId);
      if (!interrupted) {
        return denied(
          'TRANSACTION_NOT_FOUND',
          '事务不存在、已结束或尚未写入 PTY。',
          '请检查返回的 transactionId，并使用 wait/observe 查看当前状态。',
        );
      }
      const result = this.#executor.get(input.transactionId);
      return {
        ok: true,
        result: {
          interrupted: result?.status === 'interrupted',
          kind: 'structured',
          ...(result === undefined
            ? {}
            : {
                status: result.status,
                retryable: result.retryable,
                safeToResubmit: result.safeToResubmit,
              }),
        },
      };
    } catch (error) {
      return this.#errorResult(error);
    }
  }

  async #performInput(
    mode: 'transactional' | 'free',
    input: InputInput,
    payload: InteractiveInputPayload,
    context: McpToolContext,
  ): Promise<ExternalToolResult<Record<string, unknown>>> {
    if (mode === 'transactional') {
      if (this.#executor.get(input.transactionId!) !== undefined) {
        return denied(
          'INPUT_GRANT_EXHAUSTED',
          '结构化 synapse_execute 事务不提供后续输入授权。',
          '预期会读取 stdin 的命令必须通过 synapse_start_interactive 建立有限 inputGrantId。',
        );
      }
      try {
        const result = await this.#interactiveExecutor.input({
          transactionId: input.transactionId!,
          inputGrantId: input.inputGrantId!,
          inputRequestId: input.inputRequestId,
          payload,
          callerId: context.caller.id,
        });
        return {
          ok: true,
          result: this.#redactInteractive(result, input.text),
        };
      } catch (error) {
        return this.#errorResult(error);
      }
    }

    if (context.mode === 'read_only') {
      return denied(
        'POLICY_DENIED',
        '只读审批模式不允许自由输入。',
        '请让用户调整审批模式或改用 observe。',
      );
    }
    if (this.#hasExternalActivity()) {
      return denied(
        'SESSION_BUSY',
        '当前 Session 存在活动外部事务，不能使用自由输入。',
        '请改用该交互事务返回的 inputGrantId。',
      );
    }
    const expectedContextId = input.expectedContextId!;
    if (this.#actor.snapshot.executionContextId !== expectedContextId) {
      return denied(
        'EXECUTION_CONTEXT_STALE',
        '自由输入的执行上下文已失效，未写入 PTY。',
        '请先调用 synapse_observe 获取当前内容和新的 executionContextId。',
      );
    }
    let lease: ExternalLeaseHandle;
    try {
      lease = this.#leases.acquireHandle(this.#actor.snapshot.id, context.caller.id);
    } catch {
      return denied('SESSION_BUSY', '无法取得当前 Session 的外部租约。', '请稍后重试。');
    }
    try {
      const authorization = await this.#authorizeFreeInput(payload, context);
      this.#ensureContext(expectedContextId);
      if (!authorization.allowed) {
        return denied('POLICY_DENIED', '审批模式拒绝了自由输入。', '请调整审批模式后再试。');
      }
      const startCursor = this.#history.cursor;
      const result = await this.#actor.writeFreeInput(payload.data, expectedContextId);
      if (!result.ok) {
        if (result.error === 'stale-execution-context') {
          return denied(
            'EXECUTION_CONTEXT_STALE',
            '自由输入的执行上下文在写入前已失效，未写入用户输入。',
            '请先调用 synapse_observe 获取当前内容和新的 executionContextId。',
          );
        }
        if (result.error === 'write-unknown') {
          return denied(
            'INPUT_WRITE_UNKNOWN',
            'PTY 后端未能确认自由输入是否交付。',
            '当前 environment/context 已失效；不要使用新的 inputRequestId 自动重放。',
          );
        }
        return denied('SESSION_EXPIRED', 'Session 在自由输入前已退出。', '请重新共享 Session。');
      }
      if (authorization.grantSession) {
        this.#sessionGrants.add(freeInputGrantKey(payload));
      }
      const page = this.#readImmediateOutput(startCursor);
      const redacted = redactInputOutput(this.#redactor, page.output, input.text);
      return {
        ok: true,
        result: {
          sessionId: this.#actor.snapshot.id,
          sent: {
            textLength: payload.textLength,
            keys: [...payload.keys],
            payloadBytes: payload.payloadBytes,
          },
          output: redacted.text,
          redacted: page.redacted || redacted.redacted,
          outputRange: { startCursor, endCursor: page.nextCursor },
          nextCursor: page.nextCursor,
          executionContextId: result.executionContextId,
        },
      };
    } catch (error) {
      return this.#errorResult(error);
    } finally {
      lease.release();
    }
  }

  async #authorizeStructured(
    decision: PolicyDecision,
    command: string,
    context: McpToolContext,
  ): Promise<AuthorizationResult> {
    if (context.mode === 'full') return { allowed: true, grantSession: false };
    if (decision.level === 'read_only' || decision.level === 'mutating') {
      return { allowed: true, grantSession: false };
    }
    const key = commandGrantKey(command, 'structured', undefined);
    if (this.#sessionGrants.has(key)) return { allowed: true, grantSession: false };
    return this.#askApproval({
      sessionId: this.#actor.snapshot.id,
      command,
      risk: decision.level,
      reasons: decision.reasons,
      kind: 'structured',
    });
  }

  async #authorizeInteractive(
    decision: PolicyDecision,
    command: string,
    inputGrantMode: InputGrantMode,
    context: McpToolContext,
  ): Promise<AuthorizationResult> {
    if (context.mode === 'full') return { allowed: true, grantSession: false };
    const key = commandGrantKey(command, 'interactive', inputGrantMode);
    if (this.#sessionGrants.has(key)) return { allowed: true, grantSession: false };
    return this.#askApproval({
      sessionId: this.#actor.snapshot.id,
      command,
      risk: decision.level,
      reasons: decision.reasons,
      kind: 'interactive',
      inputGrantMode,
      inputLimits: inputGrantLimits(inputGrantMode),
    });
  }

  async #authorizeFreeInput(
    payload: InteractiveInputPayload,
    context: McpToolContext,
  ): Promise<AuthorizationResult> {
    if (context.mode === 'full') return { allowed: true, grantSession: false };
    const key = freeInputGrantKey(payload);
    if (this.#sessionGrants.has(key)) return { allowed: true, grantSession: false };
    return this.#askApproval({
      sessionId: this.#actor.snapshot.id,
      command: '[free_input]',
      risk: 'mutating',
      reasons: ['free input writes directly to the current PTY'],
      kind: 'free_input',
      text: payload.normalizedText,
      keys: payload.keys,
    });
  }

  async #askApproval(request: ApprovalRequest): Promise<AuthorizationResult> {
    try {
      const response = await this.#requestApproval(request);
      if (response === 'denied') {
        throw new ExternalToolError(
          'APPROVAL_DENIED',
          '用户拒绝该外部调用。',
          '可调整输入或审批模式后重新提交。',
        );
      }
      return { allowed: true, grantSession: response === 'allow_session' };
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

  #resolveAndValidateDriver(
    dialect: 'posix' | 'powershell',
    command: string,
    interactive: boolean,
  ): void {
    try {
      const driver = resolveShellDriver(dialect);
      if (interactive) driver.validateInteractiveCommand(command);
      else driver.validateCommand(command);
    } catch (error) {
      if (error instanceof ShellDriverError) {
        const code: ExternalErrorCode =
          error.code === 'UNSUPPORTED_SHELL' ? 'SHELL_MISMATCH' : error.code;
        throw new ExternalToolError(
          code,
          error.message,
          code === 'INTERACTIVE_COMMAND_UNSUPPORTED'
            ? '请改用 synapse_start_interactive；本次未发送用户命令。'
            : '请检查当前 PTY environment 和 command。',
        );
      }
      throw error;
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

  #hasExternalActivity(): boolean {
    return (
      this.#executor.activeTransactionId !== undefined ||
      this.#interactiveExecutor.activeTransactionId !== undefined ||
      this.#leases.owner(this.#actor.snapshot.id) !== undefined
    );
  }

  #inputRequestKey(caller: ExternalCaller, requestId: string): string {
    return `${caller.kind}\u0000${caller.id}\u0000${this.#actor.snapshot.id}\u0000${requestId}`;
  }

  #readImmediateOutput(afterCursor: OutputCursor) {
    try {
      return this.#history.read({ afterCursor, maxBytes: 64 * 1024 });
    } catch {
      return this.#history.read();
    }
  }

  #errorResult(error: unknown): { ok: false; error: string; message: string } {
    if (error instanceof ExternalToolError) return denied(error.code, error.reason, error.guidance);
    if (error instanceof CommandExecutorError || error instanceof InteractiveCommandExecutorError) {
      const parsed = parseStableError(error);
      return denied(parsed.code, parsed.reason, parsed.guidance);
    }
    if (error instanceof InputEncoderError) return deniedFromError(error);
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

  #redactInteractive(
    result: InteractiveExecutionResult,
    submittedText?: unknown,
  ): Record<string, unknown> {
    const redacted = redactInputOutput(this.#redactor, result.output.text, submittedText);
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
      ...(result.inputGrantId === undefined ? {} : { inputGrantId: result.inputGrantId }),
      ...(result.inputGrantMode === undefined ? {} : { inputGrantMode: result.inputGrantMode }),
      ...(result.sent === undefined ? {} : { sent: result.sent }),
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

  #emitExecutorEvent(
    type: 'started' | 'finished',
    transaction: {
      id: string;
      sessionId: string;
      kind: ExternalTransactionKind;
      command: string;
      status: ExternalTransactionStatus;
    },
  ): void {
    const event: ExternalToolPipelineEvent = {
      type,
      transaction: {
        id: transaction.id,
        sessionId: transaction.sessionId,
        kind: transaction.kind,
        command: transaction.command,
        status: transaction.status,
      },
    };
    for (const listener of this.#listeners) listener(event);
  }
}

function withoutCompletionNonce(
  transaction: CommandExecutionResult['transaction'] | InteractiveExecutionResult['transaction'],
) {
  const { nonce, ...publicTransaction } = transaction;
  void nonce;
  return publicTransaction;
}

function currentEnvironmentLabel(dialect: 'posix' | 'powershell' | 'unknown'): string {
  if (dialect === 'powershell') return 'PowerShell';
  if (dialect === 'posix') return 'POSIX';
  return 'unknown';
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

function denied(
  error: ExternalErrorCode | string,
  reason: string,
  guidance = '请检查当前 Session 状态后重试。',
): { ok: false; error: string; message: string } {
  return { ok: false, error, message: `${reason} ${guidance}` };
}

function deniedFromError(error: Error): { ok: false; error: string; message: string } {
  const parsed = parseStableError(error);
  return denied(parsed.code, parsed.reason, parsed.guidance);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function inputGrantLimits(mode: InputGrantMode): InputGrantLimits {
  return {
    maxCalls: mode === 'one_shot' ? 1 : BOUNDED_INPUT_MAX_CALLS,
    maxBytes: mode === 'one_shot' ? 16 * 1024 : BOUNDED_INPUT_MAX_BYTES,
    idleTimeoutMs: BOUNDED_INPUT_IDLE_TIMEOUT_MS,
  };
}

function commandGrantKey(
  command: string,
  kind: 'structured' | 'interactive',
  inputGrantMode: InputGrantMode | undefined,
): string {
  return JSON.stringify({ command, executionMode: kind, inputGrantMode: inputGrantMode ?? 'none' });
}

function freeInputGrantKey(payload: InteractiveInputPayload): string {
  return JSON.stringify({
    freeInput: true,
    text: payload.normalizedText ?? payload.data,
    keys: payload.keys,
  });
}

function cloneInputDedupeResult(
  result: ExternalToolResult<Record<string, unknown>>,
): ExternalToolResult<Record<string, unknown>> {
  const cloned = structuredClone(result);
  if (!cloned.ok) return cloned;
  // The replay record is metadata-only; the first response has already passed
  // through the normal output redaction path.
  return { ...cloned, result: { ...cloned.result, output: '' } };
}

function redactContinuous(redactor: SecretRedactor, value: string) {
  const stream = redactor.createStream();
  const first = stream.push(value);
  const last = stream.flush();
  return { text: `${first.text}${last.text}`, redacted: first.redacted || last.redacted };
}

function redactInputOutput(
  redactor: SecretRedactor,
  value: string,
  submittedText: unknown,
): { text: string; redacted: boolean } {
  const redacted = redactContinuous(redactor, value);
  if (typeof submittedText !== 'string' || submittedText.length === 0) return redacted;
  const candidates = [...new Set([submittedText, submittedText.replaceAll('\n', '\r')])].filter(
    (candidate) => candidate.length > 0,
  );
  let text = redacted.text;
  let replaced = false;
  for (const candidate of candidates) {
    if (!text.includes(candidate)) continue;
    text = text.split(candidate).join('[REDACTED]');
    replaced = true;
  }
  return { text, redacted: redacted.redacted || replaced };
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
  'AUTHORIZATION_REVOKED',
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
  'INPUT_GRANT_EXHAUSTED',
  'INPUT_WRITE_UNKNOWN',
  'INTERACTIVE_START_WRITE_UNKNOWN',
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
