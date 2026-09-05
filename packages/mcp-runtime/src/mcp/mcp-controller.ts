import type { ExternalCaller } from '@synapse-term/domain';
import {
  CommandExecutor,
  ExternalLeaseRegistry,
  type SessionActor,
} from '@synapse-term/terminal-service';

import { ApprovalQueue, type VisibleApprovalRequest } from './approval-queue.js';
import { ExternalToolPipeline } from './external-tool-pipeline.js';
import { SharingOutputHistory } from './sharing-output-history.js';
import {
  createMcpSettingsStore,
  DEFAULT_MCP_PORT,
  generateMcpToken,
  sanitizeMcpSettings,
  type McpSettings,
} from './mcp-settings.js';

export interface McpSessionSource {
  get(sessionId: string): SessionActor | undefined;
  titleOf(sessionId: string): string;
  onRemoved(listener: (sessionId: string) => void): () => void;
}

export interface EndpointLifecycle {
  start(port?: number): Promise<void>;
  stop(): Promise<void>;
  status?: McpRuntimeStatus;
}

export interface McpRuntimeStatus {
  running: boolean;
  port?: number | undefined;
  connectionString?: string | undefined;
}

export interface SharedMcpSession {
  id: string;
  title: string;
  sharedAt: string;
}

export interface McpExecutionEvent {
  sessionId: string;
  transactionId: string;
  command: string;
  source: string;
  phase: 'started' | 'finished';
  kind?: 'structured' | 'interactive' | undefined;
}

export interface McpControllerOptions {
  settingsStoreDirectory: string;
  sessions: McpSessionSource;
  approvalQueue?: ApprovalQueue | undefined;
  serverOverride?: EndpointLifecycle | undefined;
  initialSettings?: Partial<McpSettings> | undefined;
}

interface SharedSession {
  id: string;
  title: string;
  sharedAt: string;
  pipeline: ExternalToolPipeline;
  history: SharingOutputHistory;
  removeOutputListener: () => void;
  removeLifecycleListener: () => void;
}

const CALLER: ExternalCaller = { kind: 'mcp', id: 'mcp-client', displayName: 'MCP 外部客户端' };

export class McpController {
  readonly #store: ReturnType<typeof createMcpSettingsStore>;
  readonly #sessions: McpSessionSource;
  readonly #approvals: ApprovalQueue;
  #endpoint: EndpointLifecycle;
  readonly #shared = new Map<string, SharedSession>();
  #endpointRunning = false;
  #settings: McpSettings = {
    enabled: false,
    approvalMode: 'read_only',
    port: DEFAULT_MCP_PORT,
  };
  #executionListener: ((event: McpExecutionEvent) => void) | undefined;

  constructor(options: McpControllerOptions) {
    this.#store = createMcpSettingsStore(options.settingsStoreDirectory);
    this.#sessions = options.sessions;
    this.#approvals = options.approvalQueue ?? new ApprovalQueue();
    this.#endpoint =
      options.serverOverride ??
      ({
        start: () => Promise.resolve(),
        stop: () => Promise.resolve(),
      } satisfies EndpointLifecycle);
    if (options.initialSettings !== undefined) {
      this.#settings = sanitizeMcpSettings({
        ...{ enabled: false, approvalMode: 'read_only', port: DEFAULT_MCP_PORT },
        ...options.initialSettings,
      });
    }
    this.#sessions.onRemoved((sessionId) => {
      void this.unshare(sessionId);
    });
  }

  setEndpoint(endpoint: EndpointLifecycle): void {
    const previous = this.#endpoint;
    this.#approvals.cancelAll();
    void this.unshareAll();
    void previous.stop().catch(() => undefined);
    this.#endpoint = endpoint;
    this.#endpointRunning = false;
  }

  async reload(): Promise<McpSettings> {
    const persisted = await this.#store.load();
    this.#settings =
      this.#settings.token === undefined && persisted.token === undefined
        ? persisted
        : sanitizeMcpSettings({
            ...persisted,
            ...(this.#settings.token === undefined ? {} : { token: this.#settings.token }),
          });
    await this.#reconcileEndpoint();
    return structuredClone(this.#settings);
  }

  async getSettings(): Promise<McpSettings> {
    return structuredClone(this.#settings);
  }

  getSettingsSnapshot(): McpSettings {
    return structuredClone(this.#settings);
  }

  getStatus(): McpRuntimeStatus {
    const endpointStatus = this.#endpoint.status;
    const running =
      this.#settings.enabled &&
      this.#settings.token !== undefined &&
      endpointStatus?.running === true;
    return { running, ...(running ? endpointStatus : {}) };
  }

  onExecution(listener: (event: McpExecutionEvent) => void): () => void {
    this.#executionListener = listener;
    return () => {
      if (this.#executionListener === listener) this.#executionListener = undefined;
    };
  }

  async updateSettings(
    patch: Partial<Omit<McpSettings, 'token'>> & { token?: string | null },
  ): Promise<McpSettings> {
    const shouldCreateToken =
      patch.enabled === true &&
      this.#settings.token === undefined &&
      (patch.token === undefined || patch.token === null);
    const previous = this.#settings;
    const next = sanitizeMcpSettings({
      ...this.#settings,
      ...(shouldCreateToken ? { token: generateMcpToken() } : {}),
      ...patch,
    });
    if (patch.token === null) delete next.token;
    else if (typeof patch.token === 'string') next.token = patch.token;
    this.#settings = next;
    if (!next.enabled || previous.token !== next.token) {
      this.#approvals.cancelAll();
      await this.unshareAll();
    }
    await this.#store.save(next);
    await this.#reconcileEndpoint();
    return structuredClone(this.#settings);
  }

  async regenerateToken(): Promise<McpSettings> {
    return this.updateSettings({
      token: generateMcpToken(),
      ...(this.#settings.enabled ? {} : {}),
    });
  }

  async revokeToken(): Promise<McpSettings> {
    this.#approvals.cancelAll();
    return this.updateSettings({ token: null });
  }

  async share(sessionId: string): Promise<SharedMcpSession[]> {
    const actor = this.#requireLiveSession(sessionId);
    if (this.#shared.has(sessionId)) return this.listShared();
    const sharedAt = new Date().toISOString();
    const history = new SharingOutputHistory({
      sessionId,
      sharingId: `${sessionId}:${sharedAt}`,
    });
    const executor = new CommandExecutor(actor, {
      completionDrainMs: 50,
      outputCursor: () => history.cursor,
    });
    const removeOutputListener = await actor.onPtyOutputAfterBoundary((event) => {
      history.append(event.historyData ?? event.data);
    });
    const pipeline = new ExternalToolPipeline({
      actor,
      executor,
      history,
      leases: new ExternalLeaseRegistry(),
      requestApproval: (request) => this.#requestApproval(request),
    });
    const shared: SharedSession = {
      id: sessionId,
      title: this.#sessions.titleOf(sessionId),
      sharedAt,
      history,
      removeOutputListener,
      removeLifecycleListener: () => undefined,
      pipeline,
    };
    this.#shared.set(sessionId, shared);
    shared.removeLifecycleListener = actor.onEvent((event) => {
      if (event.type === 'pty_exit') void this.unshare(sessionId);
    });
    pipeline.onEvent((event) => {
      this.#executionListener?.({
        sessionId,
        transactionId: event.transaction.id,
        command: event.transaction.command,
        source: 'MCP 外部客户端',
        kind: event.transaction.kind,
        phase: event.type,
      });
    });
    if (actor.snapshot.pty !== 'running') {
      await this.unshare(sessionId);
      throw new Error('SESSION_EXPIRED: 会话已退出，无法共享。');
    }
    return this.listShared();
  }

  async unshare(sessionId: string): Promise<SharedMcpSession[]> {
    const shared = this.#shared.get(sessionId);
    const clearPromise = shared?.pipeline.clear() ?? Promise.resolve();
    shared?.removeLifecycleListener();
    shared?.removeOutputListener();
    shared?.history.dispose();
    this.#approvals.cancelSession(sessionId);
    this.#shared.delete(sessionId);
    await clearPromise;
    return this.listShared();
  }

  listShared(): SharedMcpSession[] {
    return [...this.#shared.values()].map(({ id, title, sharedAt }) => ({ id, title, sharedAt }));
  }

  decideApproval(id: string, decision: 'allow_once' | 'allow_session' | 'denied'): boolean {
    return this.#approvals.decide(id, decision);
  }

  async stop(): Promise<void> {
    await this.unshareAll();
    await this.updateSettings({ enabled: false }).catch(() => undefined);
  }

  async unshareAll(): Promise<void> {
    await Promise.all([...this.#shared.keys()].map((id) => this.unshare(id)));
  }

  async callTool(name: string, rawInput: Record<string, unknown>): Promise<unknown> {
    const sessionId = typeof rawInput.sessionId === 'string' ? rawInput.sessionId : '';
    const shared = this.#shared.get(sessionId);
    if (shared === undefined) {
      this.unshare(sessionId);
      if (name === 'synapse_status') {
        return { status: 'expired', guidance: '请在桌面端重新共享会话 ID。' };
      }
      throw new Error(`SESSION_EXPIRED: 会话不存在或未共享。请在桌面端重新复制并共享会话 ID。`);
    }
    switch (name) {
      case 'synapse_status': {
        const result = shared.pipeline.status();
        if (!result.ok || result.result.status === 'expired') {
          this.unshare(sessionId);
          if (!result.ok) throw new Error(`${result.error}: ${result.message}`);
        }
        return result.ok ? result.result : { status: 'expired', guidance: '请重新共享会话。' };
      }
      case 'synapse_observe':
        return unwrap(await shared.pipeline.observe(rawInput, this.#context()));
      case 'synapse_execute':
        return unwrap(
          await shared.pipeline.execute(
            rawInput as unknown as Parameters<ExternalToolPipeline['execute']>[0],
            this.#context(),
          ),
        );
      case 'synapse_start_interactive':
        return unwrap(
          await shared.pipeline.startInteractive(
            rawInput as unknown as Parameters<ExternalToolPipeline['startInteractive']>[0],
            this.#context(),
          ),
        );
      case 'synapse_input':
        return unwrap(
          await shared.pipeline.input(
            rawInput as unknown as Parameters<ExternalToolPipeline['input']>[0],
            this.#context(),
          ),
        );
      case 'synapse_finish_interactive':
        return unwrap(
          await shared.pipeline.finishInteractive(
            rawInput as unknown as Parameters<ExternalToolPipeline['finishInteractive']>[0],
            this.#context(),
          ),
        );
      case 'synapse_wait':
        return unwrap(
          await shared.pipeline.wait(rawInput as { transactionId: string }, this.#context()),
        );
      case 'synapse_interrupt':
        return unwrap(
          await shared.pipeline.interrupt(rawInput as { transactionId: string }, this.#context()),
        );
      default:
        throw new Error('POLICY_DENIED: 请求的工具不存在。仅提供八个 synapse_* 工具。');
    }
  }

  #context() {
    return { caller: CALLER, mode: this.#settings.approvalMode };
  }

  #requireLiveSession(sessionId: string): SessionActor {
    const actor = this.#sessions.get(sessionId);
    if (actor?.snapshot.pty !== 'running') {
      throw new Error('SESSION_EXPIRED: 会话不存在或未运行，无法共享。');
    }
    return actor;
  }

  async #requestApproval(request: Omit<VisibleApprovalRequest, 'id'>) {
    const resolution = await this.#approvals.request(request);
    if (resolution.reason === 'timeout') {
      throw new Error('APPROVAL_TIMEOUT: 审批卡片已超时拒绝。可重新发起调用。');
    }
    if (resolution.reason === 'cancelled') {
      throw new Error('SESSION_EXPIRED: MCP 服务已关闭或 token 已吊销，审批已取消。');
    }
    return resolution.decision;
  }

  async #reconcileEndpoint(): Promise<void> {
    if (this.#settings.enabled && this.#settings.token !== undefined) {
      if (this.#shared.size > 0) await this.unshareAll();
      if (this.#endpointRunning) {
        this.#endpointRunning = false;
        await this.#endpoint.stop().catch(() => undefined);
      }
      await this.#endpoint.start(this.#settings.port);
      this.#endpointRunning = true;
      return;
    }
    this.#approvals.cancelAll();
    await this.unshareAll();
    if (!this.#endpointRunning) return;
    this.#endpointRunning = false;
    await this.#endpoint.stop().catch(() => undefined);
  }
}

function unwrap(
  result: { ok: true; result: unknown } | { ok: false; error: string; message: string },
): unknown {
  if (result.ok) return result.result;
  throw new Error(`${result.error}: ${result.message}`);
}
