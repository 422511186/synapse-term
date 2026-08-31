import type { ExternalCaller } from '@synapse-term/domain';
import {
  CommandExecutor,
  ExternalLeaseRegistry,
  type SessionActor,
} from '@synapse-term/terminal-service';

import { ApprovalQueue, type VisibleApprovalRequest } from './approval-queue.js';
import { ExternalToolPipeline } from './external-tool-pipeline.js';
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
  notifyRemoved(listener: (sessionId: string) => void): () => void;
}

export interface EndpointLifecycle {
  start(port?: number): Promise<void>;
  stop(): Promise<void>;
  status?: {
    running: boolean;
    port?: number | undefined;
    connectionString?: string | undefined;
  };
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
  #executionListener:
    | ((event: {
        sessionId: string;
        transactionId: string;
        command: string;
        source: string;
        phase: 'started' | 'finished';
      }) => void)
    | undefined;

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
    this.#sessions.notifyRemoved((sessionId) => {
      void this.unshare(sessionId);
    });
  }

  setEndpoint(endpoint: EndpointLifecycle): void {
    void this.#endpoint.stop().catch(() => undefined);
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

  getStatus(): {
    running: boolean;
    port?: number | undefined;
    connectionString?: string | undefined;
  } {
    const endpointStatus = this.#endpoint.status;
    const running =
      this.#settings.enabled &&
      this.#settings.token !== undefined &&
      endpointStatus?.running === true;
    return { running, ...(running ? endpointStatus : {}) };
  }

  onExecution(
    listener: (event: {
      sessionId: string;
      transactionId: string;
      command: string;
      source: string;
    }) => void,
  ): () => void {
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
      this.unshareAll();
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

  async share(sessionId: string): Promise<Array<{ id: string; title: string; sharedAt: string }>> {
    const actor = this.#requireLiveSession(sessionId);
    if (this.#shared.has(sessionId)) return this.listShared();
    const executor = new CommandExecutor(actor, { completionDrainMs: 50 });
    executor.onEvent((event) => {
      this.#executionListener?.({
        sessionId,
        transactionId: event.transaction.id,
        command: event.transaction.command,
        source: 'MCP 外部客户端',
        phase: event.type,
      });
    });
    this.#shared.set(sessionId, {
      id: sessionId,
      title: this.#sessions.titleOf(sessionId),
      sharedAt: new Date().toISOString(),
      pipeline: new ExternalToolPipeline({
        actor,
        executor,
        leases: new ExternalLeaseRegistry(),
        requestApproval: (request) => this.#requestApproval(request),
      }),
    });
    return this.listShared();
  }

  async unshare(
    sessionId: string,
  ): Promise<Array<{ id: string; title: string; sharedAt: string }>> {
    this.#shared.get(sessionId)?.pipeline.clear();
    this.#approvals.cancelSession(sessionId);
    this.#shared.delete(sessionId);
    return this.listShared();
  }

  listShared(): Array<{ id: string; title: string; sharedAt: string }> {
    return [...this.#shared.values()].map(({ id, title, sharedAt }) => ({ id, title, sharedAt }));
  }

  decideApproval(id: string, decision: 'allow_once' | 'allow_session' | 'denied'): boolean {
    return this.#approvals.decide(id, decision);
  }

  async stop(): Promise<void> {
    this.unshareAll();
    await this.updateSettings({ enabled: false }).catch(() => undefined);
  }

  unshareAll(): void {
    for (const id of [...this.#shared.keys()]) void this.unshare(id);
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
            rawInput as Parameters<ExternalToolPipeline['execute']>[0],
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
        throw new Error('POLICY_DENIED: 请求的工具不存在。仅提供五个 synapse_* 工具。');
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
      if (this.#endpointRunning) await this.#endpoint.stop().catch(() => undefined);
      await this.#endpoint.start(this.#settings.port);
      this.#endpointRunning = true;
      return;
    }
    this.#approvals.cancelAll();
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
