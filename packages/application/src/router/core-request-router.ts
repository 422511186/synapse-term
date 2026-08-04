/**
 * Core API 请求路由（组合门面）
 *
 * 按架构文档第 11 节，将单一分发器拆分为按域划分的 RequestHandler：
 * Session / Agent / Provider / Model / Resource / Audit。本类只负责
 * 协议解析、依赖组装与核心状态用例（status/shutdown/idle/closeAll）。
 */
import type { CoreRepositories } from '@synapse-term/infrastructure';
import type { SecretRedactor } from '@synapse-term/infrastructure';
import type {
  ModelCatalogService,
  ModelValidator,
  ProviderProfileService,
} from '@synapse-term/model-providers';
import type { LocalFilePolicy, PolicyEngine } from '@synapse-term/platform-kernel';
import { parseCoreRequest, type CoreServiceEvent } from '@synapse-term/protocol';
import type { OutputJournal, ProbeScheduler, SessionManager } from '@synapse-term/terminal-service';
import type { LocalFileService } from '@synapse-term/tooling';

import { routerError } from './contracts.js';
import type {
  AgentCoordinatorLike,
  AuditQueryLike,
  CoreSecretStore,
  ProviderAdapterFactory,
  ProviderModelDiscoveryLike,
  SessionResourcesLike,
  TerminalOutputNotification,
} from './contracts.js';
import { AgentRequestHandler } from './handlers/agent-handler.js';
import { AuditRequestHandler } from './handlers/audit-handler.js';
import { ExternalRequestHandler } from './handlers/external-handler.js';
import { ModelRequestHandler } from './handlers/model-handler.js';
import { ProviderRequestHandler } from './handlers/provider-handler.js';
import { ResourceRequestHandler } from './handlers/resource-handler.js';
import { SessionRequestHandler } from './handlers/session-handler.js';

export type {
  AgentCoordinatorLike,
  AuditQueryLike,
  CoreSecretStore,
  ProviderAdapterFactory,
  ProviderModelDiscoveryLike,
  SessionResourcesLike,
  TerminalOutputNotification,
} from './contracts.js';

export interface CoreRequestRouterOptions {
  sessions: SessionManager;
  journal: OutputJournal;
  repositories: CoreRepositories;
  emitTerminalOutput(event: TerminalOutputNotification): void;
  emitEvent?(event: CoreServiceEvent): void;
  onActivityChange?(activity: { sessions: number; agentTasks: number }): void;
  providers?: ProviderProfileService;
  models?: ModelCatalogService;
  secrets?: CoreSecretStore;
  modelValidator?: ModelValidator;
  modelDiscovery?: ProviderModelDiscoveryLike;
  createAdapter?: ProviderAdapterFactory;
  agents?: AgentCoordinatorLike;
  audit?: AuditQueryLike;
  resources?: SessionResourcesLike;
  cleanup?(): Promise<{ rawLogs: number; auditEvents: number }>;
  getStatus?(): { connected: boolean; version: string; instanceId?: string };
  shutdown?(mode: 'keep_background' | 'terminate_all'): Promise<unknown>;
  external?: {
    policy: PolicyEngine;
    localFiles?: LocalFileService;
    localFilePolicy?: LocalFilePolicy;
    redactor?: SecretRedactor;
  };
  shareProbe?: { timeoutMs?: number; scheduler?: ProbeScheduler };
}

export class CoreRequestRouter {
  readonly #sessions: SessionManager;
  readonly #sessionHandler: SessionRequestHandler;
  readonly #agentHandler: AgentRequestHandler;
  readonly #providerHandler: ProviderRequestHandler;
  readonly #modelHandler: ModelRequestHandler;
  readonly #resourceHandler: ResourceRequestHandler;
  readonly #auditHandler: AuditRequestHandler;
  readonly #externalHandler: ExternalRequestHandler | undefined;
  readonly #getStatus: () => { connected: boolean; version: string; instanceId?: string };
  readonly #shutdown: ((mode: 'keep_background' | 'terminate_all') => Promise<unknown>) | undefined;
  readonly #onActivityChange: (activity: { sessions: number; agentTasks: number }) => void;

  constructor(options: CoreRequestRouterOptions) {
    this.#sessions = options.sessions;
    this.#onActivityChange = options.onActivityChange ?? (() => undefined);
    this.#getStatus = options.getStatus ?? (() => ({ connected: true, version: '0.0.0-dev' }));
    this.#shutdown = options.shutdown;
    this.#sessionHandler = new SessionRequestHandler({
      sessions: options.sessions,
      journal: options.journal,
      repositories: options.repositories,
      emitTerminalOutput: options.emitTerminalOutput,
      emitEvent: options.emitEvent,
      onActivityChange: options.onActivityChange,
      audit: options.audit,
      shareProbe: options.shareProbe,
    });
    this.#agentHandler = new AgentRequestHandler({ agents: options.agents });
    this.#providerHandler = new ProviderRequestHandler({
      providers: options.providers,
      secrets: options.secrets,
      modelDiscovery: options.modelDiscovery,
      audit: options.audit,
    });
    this.#modelHandler = new ModelRequestHandler({
      models: options.models,
      providers: options.providers,
      secrets: options.secrets,
      modelValidator: options.modelValidator,
      createAdapter: options.createAdapter,
      audit: options.audit,
    });
    this.#resourceHandler = new ResourceRequestHandler({
      resources: options.resources,
      emitEvent: options.emitEvent,
    });
    this.#auditHandler = new AuditRequestHandler({
      audit: options.audit,
      cleanup: options.cleanup,
    });
    this.#externalHandler =
      options.external === undefined
        ? undefined
        : new ExternalRequestHandler({
            sessions: options.sessions,
            journal: options.journal,
            policy: options.external.policy,
            ...(options.external.localFiles === undefined
              ? {}
              : { localFiles: options.external.localFiles }),
            ...(options.external.localFilePolicy === undefined
              ? {}
              : { localFilePolicy: options.external.localFilePolicy }),
            ...(options.external.redactor === undefined
              ? {}
              : { redactor: options.external.redactor }),
            ...(options.audit === undefined ? {} : { audit: options.audit }),
          });
  }

  async handle(method: string, payload: unknown, connectionId: string): Promise<unknown> {
    void connectionId;
    const request = parseCoreRequest(method, payload);
    switch (request.method) {
      case 'session.list':
        return this.#sessionHandler.listSessions();
      case 'session.create':
        return this.#sessionHandler.createSession(request.payload);
      case 'session.rename':
        return this.#sessionHandler.renameSession(request.payload.sessionId, request.payload.alias);
      case 'session.setDialect':
        return this.#sessionHandler.setSessionDialect(
          request.payload.sessionId,
          request.payload.executionDialect,
        );
      case 'session.close':
        return this.#sessionHandler.closeSession(request.payload.sessionId);
      case 'session.markShared':
        return this.#sessionHandler.markSessionShared(request.payload.sessionId);
      case 'terminal.write':
        return this.#sessionHandler.writeTerminal(request.payload.sessionId, request.payload.data);
      case 'terminal.resize':
        return this.#sessionHandler.resizeTerminal(
          request.payload.sessionId,
          request.payload.columns,
          request.payload.rows,
        );
      case 'terminal.replay':
        return this.#sessionHandler.replayTerminal(
          request.payload.sessionId,
          request.payload.afterSequence,
        );
      case 'resources.get':
        return this.#resourceHandler.getResources(request.payload.sessionId);
      case 'resources.refresh':
        return this.#resourceHandler.refreshResources(request.payload.sessionId);
      case 'agent.start':
        return this.#agentHandler.start(request.payload.sessionId, request.payload.goal, {
          ...(request.payload.attachments === undefined
            ? {}
            : { attachments: request.payload.attachments }),
          ...(request.payload.modelConfigurationId === undefined
            ? {}
            : { modelConfigurationId: request.payload.modelConfigurationId }),
          ...(request.payload.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: request.payload.reasoningEffort }),
          ...(request.payload.permissionMode === undefined
            ? {}
            : { permissionMode: request.payload.permissionMode }),
        });
      case 'agent.cancel':
        return this.#agentHandler.cancel(request.payload.sessionId, request.payload.turnId);
      case 'agent.history':
        return this.#agentHandler.history(request.payload.sessionId);
      case 'agent.resetConversation':
        return this.#agentHandler.resetConversation(
          request.payload.sessionId,
          request.payload.expectedConversationId,
        );
      case 'agent.interrupt':
        return this.#agentHandler.interrupt(
          request.payload.sessionId,
          request.payload.transactionId,
        );
      case 'agent.approve':
        return this.#agentHandler.approve(
          request.payload.sessionId,
          request.payload.approvalId,
          request.payload.confirmedDestructive,
        );
      case 'agent.takeover':
        return this.#agentHandler.takeover(request.payload.sessionId);
      case 'provider.list':
        return this.#providerHandler.listProviders();
      case 'provider.save':
        return this.#providerHandler.saveProvider(request.payload.profile, request.payload.apiKey);
      case 'provider.discoverModels':
        return this.#providerHandler.discoverModels(request.payload.providerId);
      case 'provider.cancelDiscovery':
        return this.#providerHandler.cancelModelDiscovery(request.payload.providerId);
      case 'provider.remove':
        return this.#providerHandler.removeProvider(request.payload.providerId);
      case 'model.list':
        return this.#modelHandler.listModels();
      case 'model.save':
        return this.#modelHandler.saveModel(request.payload.model);
      case 'model.test':
        return this.#modelHandler.testModel(request.payload.modelConfigurationId);
      case 'model.setEnabled':
        return this.#modelHandler.setModelEnabled(
          request.payload.modelConfigurationId,
          request.payload.enabled,
        );
      case 'model.setDefault':
        return this.#modelHandler.setDefaultModel(
          request.payload.modelConfigurationId,
          request.payload.isDefault,
        );
      case 'model.remove':
        return this.#modelHandler.removeModel(request.payload.modelConfigurationId);
      case 'model.importDiscovered':
        return this.#modelHandler.importDiscoveredModels(
          request.payload.providerProfileId,
          request.payload.modelIds,
        );
      case 'audit.list':
        return this.#auditHandler.listAudit(request.payload.sessionId, request.payload.taskId);
      case 'audit.cleanup':
        return this.#auditHandler.cleanup();
      case 'core.status':
        return this.#getStatus();
      case 'core.shutdown':
        if (this.#shutdown === undefined) {
          throw routerError('internal_error', 'Core shutdown is not configured');
        }
        return this.#shutdown(request.payload.mode);
      case 'external.terminalExecute':
        return this.#requireExternal().terminalExecute(request.payload);
      case 'external.terminalObserve':
        return this.#requireExternal().terminalObserve(request.payload);
      case 'external.terminalWait':
        return this.#requireExternal().terminalWait(request.payload);
      case 'external.terminalInterrupt':
        return this.#requireExternal().terminalInterrupt(request.payload);
      case 'external.terminalStatus':
        return this.#requireExternal().terminalStatus(request.payload);
      case 'external.localListFiles':
        return this.#requireExternal().localListFiles(request.payload);
      case 'external.localSearchFiles':
        return this.#requireExternal().localSearchFiles(request.payload);
      case 'external.localReadFile':
        return this.#requireExternal().localReadFile(request.payload);
      case 'external.classifyCommand':
        return this.#requireExternal().classifyCommand(request.payload);
      case 'external.recordRejection':
        return this.#requireExternal().recordRejection(request.payload);
      default:
        throw routerError('invalid_message', 'Core method is not available');
    }
  }

  #requireExternal(): ExternalRequestHandler {
    if (this.#externalHandler === undefined) {
      throw routerError('external_not_configured', 'External tool calls are not configured');
    }
    return this.#externalHandler;
  }

  async idle(): Promise<void> {
    await Promise.all(this.#sessions.list().map((session) => session.idle()));
  }

  async closeAll(): Promise<void> {
    // H-6: agent 关闭失败不应阻断 session PTY 关闭与活动状态通知。
    try {
      await this.#agentHandler.closeAllIfConfigured();
    } catch (error) {
      console.error('[CoreRequestRouter] agent closeAll failed during closeAll:', error);
    }
    for (const session of [...this.#sessions.list()])
      await this.#sessions.close(session.snapshot.id);
    this.#onActivityChange({ sessions: this.#sessions.activeCount, agentTasks: 0 });
  }
}
