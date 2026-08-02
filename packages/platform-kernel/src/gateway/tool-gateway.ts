import {
  terminalToolCallSchema,
  type TerminalExecuteInput,
  type TerminalObserveInput,
  type TerminalToolCall,
} from '@synapse-term/protocol';
import type { AgentPermissionMode, ApprovalGrant, ExecutionDialect } from '@synapse-term/domain';

import type { ApprovalManager } from '../policy/approval-manager.js';
import { hashCommand } from '../policy/approval-manager.js';
import type { CommandExecutionResult, CommandExecutor } from '@synapse-term/terminal-service';
import type { PolicyEngine } from '../policy/policy-engine.js';
import { type PolicyDecision } from '../policy/policy-engine.js';
import { SecretRedactor } from '@synapse-term/infrastructure';
import type { SessionActor } from '@synapse-term/terminal-service';
import type { LocalFileService } from '@synapse-term/tooling';
import type { LocalFileChangePreview } from '@synapse-term/tooling';
import { AuthorizationPolicy, type AuthorizationDecision } from '../policy/authorization-policy.js';
import { LocalFilePolicy, type LocalFileOperation } from '../policy/local-file-policy.js';
import type { OutputJournal } from '@synapse-term/terminal-service';
import type { AuditService } from '@synapse-term/infrastructure';

export type ToolGatewayResult =
  | { ok: true; result: unknown }
  | {
      ok: false;
      error: 'invalid_tool_call' | 'approval_invalid' | 'policy_denied' | string;
      message?: string;
      recoverable?: boolean;
    };

export interface ToolGatewayOptions {
  sessionId: string;
  taskId: string;
  conversationId?: string;
  turnId?: string;
  leaseEpoch?: number;
  prepareExecution?: () => Promise<number>;
  actor: SessionActor;
  executor: CommandExecutor;
  policy: PolicyEngine;
  approvals: ApprovalManager;
  localFiles?: LocalFileService;
  localFilePolicy?: LocalFilePolicy;
  redactor?: SecretRedactor;
  permissionMode?: AgentPermissionMode;
  authorizationPolicy?: AuthorizationPolicy;
  journal?: OutputJournal;
  audit?: Pick<AuditService, 'record'>;
}

export interface ToolCallContext {
  toolCallId?: string;
  signal?: AbortSignal;
}

export interface ToolBatchCall {
  name: string;
  arguments: unknown;
  approval?: ApprovalGrant;
}

export class TerminalToolGateway {
  readonly #sessionId: string;
  readonly #taskId: string;
  readonly #conversationId: string | undefined;
  readonly #turnId: string | undefined;
  readonly #leaseEpoch: number | undefined;
  readonly #prepareExecution: (() => Promise<number>) | undefined;
  readonly #actor: SessionActor;
  readonly #executor: CommandExecutor;
  readonly #policy: PolicyEngine;
  readonly #approvals: ApprovalManager;
  readonly #localFiles: LocalFileService | undefined;
  readonly #localFilePolicy: LocalFilePolicy;
  readonly #redactor: SecretRedactor;
  readonly #permissionMode: AgentPermissionMode;
  readonly #authorizationPolicy: AuthorizationPolicy;
  readonly #journal: OutputJournal | undefined;
  readonly #audit: Pick<AuditService, 'record'> | undefined;

  constructor(options: ToolGatewayOptions) {
    this.#sessionId = options.sessionId;
    this.#taskId = options.taskId;
    this.#conversationId = options.conversationId;
    this.#turnId = options.turnId;
    this.#leaseEpoch = options.leaseEpoch;
    this.#prepareExecution = options.prepareExecution;
    this.#actor = options.actor;
    this.#executor = options.executor;
    this.#policy = options.policy;
    this.#approvals = options.approvals;
    this.#localFiles = options.localFiles;
    this.#localFilePolicy = options.localFilePolicy ?? new LocalFilePolicy();
    this.#redactor = options.redactor ?? new SecretRedactor();
    this.#permissionMode = options.permissionMode ?? 'manual';
    this.#authorizationPolicy = options.authorizationPolicy ?? new AuthorizationPolicy();
    this.#journal = options.journal;
    this.#audit = options.audit;
  }

  async call(
    name: string,
    rawArguments: unknown,
    approval?: ApprovalGrant,
    context: ToolCallContext = {},
  ): Promise<ToolGatewayResult> {
    const parsed = terminalToolCallSchema.safeParse({ name, arguments: rawArguments });
    if (!parsed.success) return { ok: false, error: 'invalid_tool_call' };
    return this.#callParsed(parsed.data, approval, context);
  }

  async callBatch(calls: readonly ToolBatchCall[]): Promise<ToolGatewayResult[]> {
    const results: ToolGatewayResult[] = [];
    for (const call of calls) {
      const result = await this.call(call.name, call.arguments, call.approval);
      results.push(result);
      if (!result.ok) break;
      if (isBlockingResult(result.result)) break;
    }
    return results;
  }

  createApproval(input: {
    toolCallId?: string;
    commands: ReadonlyArray<{
      command: string;
      level: PolicyDecision['level'];
      reasons: readonly string[];
    }>;
    expiresAt?: string;
  }): ApprovalGrant {
    return this.#approvals.createGrant({
      sessionId: this.#sessionId,
      taskId: this.#taskId,
      environmentEpoch: this.#actor.snapshot.environment.capabilityEpoch,
      ...this.#approvalScope(
        input.toolCallId === undefined ? {} : { toolCallId: input.toolCallId },
      ),
      commands: input.commands,
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    });
  }

  async #callParsed(
    call: TerminalToolCall,
    approval: ApprovalGrant | undefined,
    context: ToolCallContext,
  ): Promise<ToolGatewayResult> {
    try {
      switch (call.name) {
        case 'terminal_observe':
          return this.#observe(call.arguments);
        case 'terminal_execute':
          return await this.#execute(call.arguments, approval, context);
        case 'terminal_wait': {
          const result = await this.#executor.wait({
            transactionId: call.arguments.transactionId,
            ...(call.arguments.afterCursor === undefined
              ? {}
              : { afterCursor: call.arguments.afterCursor }),
            ...(call.arguments.timeoutMs === undefined
              ? {}
              : { timeoutMs: call.arguments.timeoutMs }),
          });
          return classifyCommandExecutionResult(result) ?? { ok: true, result };
        }
        case 'terminal_interrupt':
          return {
            ok: true,
            result: { interrupted: await this.#executor.interrupt(call.arguments.transactionId) },
          };
        case 'local_list_files':
        case 'local_search_files':
        case 'local_read_file':
        case 'local_write_file':
        case 'local_edit_file':
          return await this.#localFile(call, approval, context);
      }
    } catch (error) {
      const code =
        error instanceof Error && 'code' in error ? String(error.code) : 'internal_error';
      const isRecoverable =
        code === 'execution_environment_unverified' ||
        code === 'command_not_auditable' ||
        code === 'plaintext_protocol_error' ||
        (error instanceof Error && 'recoverable' in error && error.recoverable === true);
      return {
        ok: false,
        error: code,
        message: error instanceof Error ? error.message : String(error),
        recoverable: isRecoverable,
      };
    }
  }

  #observe(input: TerminalObserveInput): ToolGatewayResult {
    const view = input.view ?? 'screen';
    const activeTransactionId = this.#executor.activeTransactionId;
    if (view === 'output' && this.#journal !== undefined) {
      const afterCursor = input.afterCursor ?? 0;
      const replay = this.#journal.replay(this.#sessionId, afterCursor);
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
      return {
        ok: true,
        result: {
          status: 'observed',
          sessionId: this.#sessionId,
          view,
          cursor: replay.events.at(-1)?.sequence ?? afterCursor,
          historyGap: replay.historyGap || truncated,
          ...(replay.oldestSequence === undefined ? {} : { oldestCursor: replay.oldestSequence }),
          output: redacted.text,
          truncated,
          ...(activeTransactionId === undefined ? {} : { activeTransactionId }),
          redacted: redacted.redacted,
        },
      };
    }
    const screen = this.#redactor.redact(this.#actor.terminalSnapshot());
    const bounded = input.maxBytes === undefined ? screen.text : screen.text.slice(-input.maxBytes);
    const replay = this.#journal?.replay(this.#sessionId, input.afterCursor ?? 0);
    return {
      ok: true,
      result: {
        status: 'observed',
        sessionId: this.#sessionId,
        view,
        cursor: replay === undefined ? (input.afterCursor ?? 0) : replay.nextSequence - 1,
        historyGap: replay?.historyGap ?? false,
        screen: bounded,
        ...(activeTransactionId === undefined ? {} : { activeTransactionId }),
        redacted: screen.redacted,
      },
    };
  }

  async #execute(
    input: TerminalExecuteInput,
    approval?: ApprovalGrant,
    context: ToolCallContext = {},
  ): Promise<ToolGatewayResult> {
    if (this.#executor.activeTransactionId !== undefined) {
      return {
        ok: false,
        error: 'terminal_busy',
        message:
          'A terminal command is still running; call terminal_wait before executing another command',
        recoverable: true,
      };
    }
    const snapshot = this.#actor.snapshot;
    const executionDialect = snapshot.executionDialect;
    if (
      executionDialect !== 'observe_only' &&
      snapshot.environment.verificationStatus === 'observation_only'
    ) {
      return {
        ok: false,
        error: 'execution_environment_unverified',
        message: 'Current environment is observation-only; cannot execute commands',
        recoverable: true,
      };
    }
    const decision = await this.#policy.classify(input.command, { executionDialect });
    const authorization = this.#authorizationPolicy.decide({
      mode: this.#permissionMode,
      risk: decision.level,
      effect: decision.level === 'read_only' ? 'observe' : 'mutate',
      toolKind: 'terminal',
    });
    this.#auditAuthorization({
      tool: 'terminal_execute',
      context,
      risk: decision.level,
      authorization,
      executionDialect,
      ...(approval === undefined ? {} : { approval }),
    });
    if (authorization.requiresApproval) {
      if (approval === undefined) {
        return {
          ok: true,
          result: {
            status: 'waiting_approval',
            command: input.command,
            approvalTarget: input.command,
            displayText: input.command,
            decision,
            environmentEpoch: snapshot.environment.capabilityEpoch,
          },
        };
      }
      const candidate = {
        sessionId: this.#sessionId,
        taskId: this.#taskId,
        environmentEpoch: this.#actor.snapshot.environment.capabilityEpoch,
        ...this.#approvalScope(context),
        commands: [
          {
            sequence: 0,
            command: input.command,
            commandHash: hashCommand(input.command),
            risk: { level: decision.level, reasons: decision.reasons },
          },
        ],
      };
      const validation = this.#approvals.validate(approval, candidate);
      if (!validation.ok) return { ok: false, error: validation.error };
    }

    const leaseEpoch =
      this.#prepareExecution === undefined ? this.#leaseEpoch : await this.#prepareExecution();
    if (leaseEpoch === undefined) {
      return {
        ok: false,
        error: 'lease_unavailable',
        message: 'Terminal execution lease is not available',
      };
    }
    const result = await this.#executor.execute({
      taskId: this.#taskId,
      leaseEpoch,
      command: input.command,
      ...(context.toolCallId === undefined ? {} : { toolCallId: context.toolCallId }),
      risk: decision.level,
      ...(approval === undefined ? {} : { approvalGrantId: approval.id }),
      ...(input.observationWindowMs === undefined
        ? {}
        : { observationWindowMs: input.observationWindowMs }),
    });
    return classifyCommandExecutionResult(result) ?? { ok: true, result };
  }

  async #localFile(
    call: Extract<TerminalToolCall, { name: `local_${string}` }>,
    approval?: ApprovalGrant,
    context: ToolCallContext = {},
  ): Promise<ToolGatewayResult> {
    if (this.#localFiles === undefined) {
      await this.#releaseNonTerminalLease();
      return {
        ok: false,
        error: 'local_file_service_unavailable',
        message: 'Local file service is not configured',
      };
    }
    const path = 'path' in call.arguments ? (call.arguments.path ?? '') : '';
    const decision = this.#localFilePolicy.classify({
      operation: localOperation(call.name),
      path,
      ...localContent(call),
    });
    const operation = localOperation(call.name);
    const authorization = this.#authorizationPolicy.decide({
      mode: this.#permissionMode,
      risk: decision.level,
      effect: operation === 'write' || operation === 'edit' ? 'mutate' : 'observe',
    });
    this.#auditAuthorization({
      tool: call.name,
      context,
      risk: decision.level,
      authorization,
      ...(approval === undefined ? {} : { approval }),
    });
    const change = await this.#previewLocalChange(call);
    const approvalTarget = `${call.name}:${stableJson(call.arguments)}`;
    if (authorization.requiresApproval) {
      if (approval === undefined) {
        await this.#releaseNonTerminalLease();
        return {
          ok: true,
          result: {
            status: 'waiting_approval',
            approvalTarget,
            displayText: `${call.name} ${path}`.trim(),
            decision,
            environmentEpoch: this.#actor.snapshot.environment.capabilityEpoch,
            ...(change === undefined ? {} : { change }),
          },
        };
      }
      const candidate = {
        sessionId: this.#sessionId,
        taskId: this.#taskId,
        environmentEpoch: this.#actor.snapshot.environment.capabilityEpoch,
        ...this.#approvalScope(context),
        commands: [
          {
            sequence: 0,
            command: approvalTarget,
            commandHash: hashCommand(approvalTarget),
            risk: { level: decision.level, reasons: decision.reasons },
          },
        ],
      };
      const validation = this.#approvals.validate(approval, candidate);
      if (!validation.ok) {
        await this.#releaseNonTerminalLease();
        return { ok: false, error: validation.error };
      }
    }

    let result: unknown;
    switch (call.name) {
      case 'local_list_files':
        result = await this.#localFiles.list(call.arguments);
        break;
      case 'local_search_files':
        result = await this.#localFiles.search(call.arguments, context.signal);
        break;
      case 'local_read_file':
        result = await this.#localFiles.read(call.arguments);
        break;
      case 'local_write_file':
        result = await this.#localFiles.write(call.arguments);
        break;
      case 'local_edit_file':
        result = await this.#localFiles.edit(call.arguments);
        break;
    }
    this.#auditLocalFile({
      call,
      result,
      risk: decision.level,
      authorization: authorization.authorization,
      context,
      ...(approval === undefined ? {} : { approval }),
      ...(change === undefined ? {} : { change }),
    });
    await this.#releaseNonTerminalLease();
    return { ok: true, result: redactStructured(result, this.#redactor) };
  }

  async #releaseNonTerminalLease(): Promise<void> {
    const snapshot = this.#actor.snapshot;
    if (snapshot.lease.owner.kind !== 'agent' || snapshot.lease.owner.taskId !== this.#taskId) {
      return;
    }
    await this.#actor.returnAgentLeaseToUser(this.#taskId, snapshot.lease.epoch);
  }

  async #previewLocalChange(
    call: Extract<TerminalToolCall, { name: `local_${string}` }>,
  ): Promise<LocalFileChangePreview | undefined> {
    if (this.#localFiles === undefined) return undefined;
    if (call.name === 'local_write_file') return this.#localFiles.previewWrite(call.arguments);
    if (call.name === 'local_edit_file') return this.#localFiles.previewEdit(call.arguments);
    return undefined;
  }

  #auditLocalFile(input: {
    call: Extract<TerminalToolCall, { name: `local_${string}` }>;
    result: unknown;
    risk: PolicyDecision['level'];
    authorization: 'read_only' | 'manual' | 'automatic' | 'full_access';
    approval?: ApprovalGrant;
    context: ToolCallContext;
    change?: LocalFileChangePreview;
  }): void {
    if (this.#audit === undefined) return;
    const operation = localOperation(input.call.name);
    const result = input.result as Record<string, unknown>;
    this.#audit.record({
      actor: { kind: 'agent', taskId: this.#taskId },
      sessionId: this.#sessionId,
      taskId: this.#taskId,
      type: `file.${result.operation ?? operation}.completed`,
      payload: {
        path: 'path' in input.call.arguments ? (input.call.arguments.path ?? '') : '',
        operation: result.operation ?? operation,
        risk: input.risk,
        permissionMode: this.#permissionMode,
        authorization: input.authorization,
        ...(input.context.toolCallId === undefined ? {} : { toolCallId: input.context.toolCallId }),
        ...(input.approval === undefined ? {} : { approvalGrantId: input.approval.id }),
        ...(input.change?.beforeSha256 === undefined
          ? {}
          : { beforeSha256: input.change.beforeSha256 }),
        ...(input.change === undefined ? {} : { afterSha256: input.change.afterSha256 }),
        ...(typeof result.bytes === 'number' ? { bytes: result.bytes } : {}),
        ...(typeof result.totalBytes === 'number' ? { bytes: result.totalBytes } : {}),
        status: 'completed',
      },
    });
  }

  #auditAuthorization(input: {
    tool: TerminalToolCall['name'];
    context: ToolCallContext;
    risk: PolicyDecision['level'];
    authorization: AuthorizationDecision;
    executionDialect?: ExecutionDialect;
    approval?: ApprovalGrant;
  }): void {
    this.#audit?.record({
      actor: { kind: 'agent', taskId: this.#taskId },
      sessionId: this.#sessionId,
      taskId: this.#taskId,
      type: 'tool.authorization',
      payload: {
        tool: input.tool,
        ...(input.context.toolCallId === undefined ? {} : { toolCallId: input.context.toolCallId }),
        permissionMode: this.#permissionMode,
        risk: input.risk,
        authorization: input.authorization.authorization,
        requiresApproval: input.authorization.requiresApproval,
        approvalProvided: input.approval !== undefined,
        ...(input.executionDialect === undefined
          ? {}
          : { executionDialect: input.executionDialect }),
        ...(input.approval === undefined ? {} : { approvalGrantId: input.approval.id }),
      },
    });
  }

  #approvalScope(context: ToolCallContext): {
    scope?: { conversationId: string; turnId: string; toolCallId: string };
  } {
    if (
      this.#conversationId === undefined ||
      this.#turnId === undefined ||
      context.toolCallId === undefined
    ) {
      return {};
    }
    return {
      scope: {
        conversationId: this.#conversationId,
        turnId: this.#turnId,
        toolCallId: context.toolCallId,
      },
    };
  }
}

function isBlockingResult(result: unknown): boolean {
  if (typeof result !== 'object' || result === null || !('status' in result)) return false;
  const status = (result as { status?: unknown }).status;
  return status === 'waiting_approval' || status === 'interaction_required';
}

function classifyCommandExecutionResult(
  result: CommandExecutionResult,
): Extract<ToolGatewayResult, { ok: false }> | undefined {
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

function localOperation(
  name: Extract<TerminalToolCall['name'], `local_${string}`>,
): LocalFileOperation {
  switch (name) {
    case 'local_list_files':
      return 'list';
    case 'local_search_files':
      return 'search';
    case 'local_read_file':
      return 'read';
    case 'local_write_file':
      return 'write';
    case 'local_edit_file':
      return 'edit';
  }
}

function localContent(call: Extract<TerminalToolCall, { name: `local_${string}` }>): {
  content?: string;
} {
  if (call.name === 'local_write_file') return { content: call.arguments.content };
  if (call.name === 'local_edit_file') {
    return { content: call.arguments.edits.map((edit) => edit.newText).join('\n') };
  }
  return {};
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right, 'en-US'))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function redactStructured(value: unknown, redactor: SecretRedactor): unknown {
  const serialized = JSON.stringify(value);
  const redacted = redactor.redact(serialized);
  return JSON.parse(redacted.text) as unknown;
}
