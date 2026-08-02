import { randomUUID } from 'node:crypto';

import {
  parseCoreRequest,
  sessionResourceRefreshResultSchema,
  sessionResourceSnapshotSchema,
  type CoreServiceEvent,
  type SessionLaunch,
  type SessionLaunchMetadata,
  type SessionSummary,
  type TerminalReplay,
  type AgentHistoryView,
} from '@terminal-agent/protocol';
import type { ModelConfiguration, ProviderProfile, SessionState } from '@terminal-agent/domain';
import type { AgentPermissionMode, ReasoningEffort } from '@terminal-agent/domain';

import type { AuditEvent, CoreRepositories } from './repositories.js';
import type { AuditRecordInput } from './audit-service.js';
import type { OutputJournal } from './output-journal.js';
import type { SessionActor, SessionActorEvent } from './session-actor.js';
import type { SessionManager } from './session-manager.js';
import type { ProviderProfileService, ProviderProfileUpdate } from './provider-profile-service.js';
import type { ModelCatalogService } from './model-catalog-service.js';
import type { ModelValidator } from './provider-validator.js';
import type { ProviderModelDiscoveryService } from './provider-model-discovery.js';
import type { ModelAdapter } from './model-adapter.js';

export interface CoreSecretStore {
  set(reference: string, secret: string): Promise<void>;
  get(reference: string): Promise<string | undefined>;
  delete(reference: string): Promise<boolean>;
}

export type ProviderAdapterFactory = (
  profile: ProviderProfile,
  model: ModelConfiguration,
  secret: string,
) => ModelAdapter;

export interface ProviderModelDiscoveryLike {
  discover(
    profile: ProviderProfile,
    secret: string,
    signal?: AbortSignal,
  ): ReturnType<ProviderModelDiscoveryService['discover']>;
  cancel(providerProfileId: string): boolean;
}

export interface AgentCoordinatorLike {
  start(
    sessionId: string,
    goal: string,
    options?: {
      modelConfigurationId?: string;
      reasoningEffort?: ReasoningEffort;
      permissionMode?: AgentPermissionMode;
    },
  ): Promise<{ taskId: string; conversationId: string; turnId: string }>;
  cancel(sessionId: string, turnId?: string): Promise<void>;
  history(sessionId: string): Promise<AgentHistoryView>;
  resetConversation(sessionId: string, expectedConversationId: string): Promise<void>;
  interrupt(sessionId: string, transactionId: string): Promise<void>;
  approve(sessionId: string, approvalId: string, confirmedDestructive: boolean): Promise<void>;
  takeover(sessionId: string): Promise<void>;
  closeAll?(): Promise<void>;
}

export interface AuditQueryLike {
  query(filter?: { sessionId?: string; taskId?: string }): AuditEvent[];
  record?(input: AuditRecordInput): void;
}

export interface SessionResourcesLike {
  get(sessionId: string): unknown;
  refresh(sessionId: string): Promise<unknown>;
}

export interface TerminalOutputNotification {
  sessionId: string;
  sequence: number;
  data: string;
}

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
}

export class CoreRequestRouter {
  readonly #sessions: SessionManager;
  readonly #journal: OutputJournal;
  readonly #repositories: CoreRepositories;
  readonly #emitTerminalOutput: (event: TerminalOutputNotification) => void;
  readonly #emitEvent: (event: CoreServiceEvent) => void;
  readonly #onActivityChange: (activity: { sessions: number; agentTasks: number }) => void;
  readonly #providers: ProviderProfileService | undefined;
  readonly #models: ModelCatalogService | undefined;
  readonly #secrets: CoreSecretStore | undefined;
  readonly #modelValidator: ModelValidator | undefined;
  readonly #modelDiscovery: ProviderModelDiscoveryLike | undefined;
  readonly #createAdapter: ProviderAdapterFactory | undefined;
  readonly #agents: AgentCoordinatorLike | undefined;
  readonly #audit: AuditQueryLike | undefined;
  readonly #resources: SessionResourcesLike | undefined;
  readonly #cleanup: (() => Promise<{ rawLogs: number; auditEvents: number }>) | undefined;
  readonly #getStatus: () => { connected: boolean; version: string; instanceId?: string };
  readonly #shutdown: ((mode: 'keep_background' | 'terminate_all') => Promise<unknown>) | undefined;
  readonly #titles = new Map<string, string>();
  readonly #terminalTypes = new Map<string, string>();

  constructor(options: CoreRequestRouterOptions) {
    this.#sessions = options.sessions;
    this.#journal = options.journal;
    this.#repositories = options.repositories;
    this.#emitTerminalOutput = options.emitTerminalOutput;
    this.#emitEvent = options.emitEvent ?? (() => undefined);
    this.#onActivityChange = options.onActivityChange ?? (() => undefined);
    this.#providers = options.providers;
    this.#models = options.models;
    this.#secrets = options.secrets;
    this.#modelValidator = options.modelValidator;
    this.#modelDiscovery = options.modelDiscovery;
    this.#createAdapter = options.createAdapter;
    this.#agents = options.agents;
    this.#audit = options.audit;
    this.#resources = options.resources;
    this.#cleanup = options.cleanup;
    this.#getStatus = options.getStatus ?? (() => ({ connected: true, version: '0.0.0-dev' }));
    this.#shutdown = options.shutdown;
    for (const record of this.#repositories.listSessionMetadata()) {
      this.#titles.set(record.id, record.metadata.title);
      this.#terminalTypes.set(record.id, record.metadata.launch.terminalType);
    }
  }

  async handle(method: string, payload: unknown, connectionId: string): Promise<unknown> {
    void connectionId;
    const request = parseCoreRequest(method, payload);
    switch (request.method) {
      case 'session.list':
        return this.#listSessions();
      case 'session.create':
        return this.#createSession(request.payload);
      case 'session.setDialect':
        return this.#setSessionDialect(request.payload.sessionId, request.payload.executionDialect);
      case 'session.close':
        return this.#closeSession(request.payload.sessionId);
      case 'terminal.write':
        return this.#writeTerminal(request.payload.sessionId, request.payload.data);
      case 'terminal.resize':
        return this.#resizeTerminal(
          request.payload.sessionId,
          request.payload.columns,
          request.payload.rows,
        );
      case 'terminal.replay':
        return this.#replayTerminal(request.payload.sessionId, request.payload.afterSequence);
      case 'resources.get':
        return this.#getResources(request.payload.sessionId);
      case 'resources.refresh':
        return this.#refreshResources(request.payload.sessionId);
      case 'agent.start':
        return this.#requireAgents().start(request.payload.sessionId, request.payload.goal, {
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
        await this.#requireAgents().cancel(request.payload.sessionId, request.payload.turnId);
        return null;
      case 'agent.history':
        return this.#requireAgents().history(request.payload.sessionId);
      case 'agent.resetConversation':
        await this.#requireAgents().resetConversation(
          request.payload.sessionId,
          request.payload.expectedConversationId,
        );
        return null;
      case 'agent.interrupt':
        await this.#requireAgents().interrupt(
          request.payload.sessionId,
          request.payload.transactionId,
        );
        return null;
      case 'agent.approve':
        await this.#requireAgents().approve(
          request.payload.sessionId,
          request.payload.approvalId,
          request.payload.confirmedDestructive,
        );
        return null;
      case 'agent.takeover':
        await this.#requireAgents().takeover(request.payload.sessionId);
        return null;
      case 'provider.list':
        return this.#listProviders();
      case 'provider.save':
        return this.#saveProvider(request.payload.profile, request.payload.apiKey);
      case 'provider.discoverModels':
        return this.#discoverModels(request.payload.providerId);
      case 'provider.cancelDiscovery':
        return this.#cancelModelDiscovery(request.payload.providerId);
      case 'provider.remove':
        return this.#removeProvider(request.payload.providerId);
      case 'model.list':
        return this.#listModels();
      case 'model.save':
        return this.#saveModel(request.payload.model);
      case 'model.test':
        return this.#testModel(request.payload.modelConfigurationId);
      case 'model.setEnabled':
        return this.#setModelEnabled(request.payload.modelConfigurationId, request.payload.enabled);
      case 'model.setDefault':
        return this.#setDefaultModel(
          request.payload.modelConfigurationId,
          request.payload.isDefault,
        );
      case 'model.remove':
        return this.#removeModel(request.payload.modelConfigurationId);
      case 'model.importDiscovered':
        return this.#importDiscoveredModels(
          request.payload.providerProfileId,
          request.payload.modelIds,
        );
      case 'audit.list':
        return this.#listAudit(request.payload.sessionId, request.payload.taskId);
      case 'audit.cleanup':
        return this.#cleanup === undefined ? { rawLogs: 0, auditEvents: 0 } : this.#cleanup();
      case 'core.status':
        return this.#getStatus();
      case 'core.shutdown':
        if (this.#shutdown === undefined) {
          throw routerError('internal_error', 'Core shutdown is not configured');
        }
        return this.#shutdown(request.payload.mode);
      default:
        throw routerError('invalid_message', 'Core method is not available');
    }
  }

  async #listProviders(): Promise<unknown[]> {
    const secrets = this.#secrets;
    return Promise.all(
      this.#requireProviders()
        .list()
        .map(async (profile) =>
          this.#providerView(
            profile,
            secrets === undefined
              ? false
              : (await secrets.get(profile.credentialRef)) !== undefined,
          ),
        ),
    );
  }

  async #saveProvider(
    input: {
      id: string;
      name: string;
      protocol: ProviderProfile['protocol'];
      baseUrl: string;
      extraHeaders?: Readonly<Record<string, string>> | undefined;
      timeoutMs?: number | undefined;
    },
    apiKey?: string | undefined,
  ): Promise<null> {
    const providers = this.#requireProviders();
    const current = providers.get(input.id);
    if (current === undefined) {
      providers.create({
        id: input.id,
        name: input.name,
        protocol: input.protocol,
        baseUrl: input.baseUrl,
        credentialRef: `provider:${input.id}`,
        extraHeaders: input.extraHeaders ?? {},
        timeoutMs: input.timeoutMs ?? 30_000,
      });
    } else {
      const update: ProviderProfileUpdate = {
        name: input.name,
        protocol: input.protocol,
        baseUrl: input.baseUrl,
        extraHeaders: input.extraHeaders ?? {},
        timeoutMs: input.timeoutMs ?? 30_000,
      };
      providers.update(input.id, update);
    }
    if (apiKey !== undefined) await this.#requireSecrets().set(`provider:${input.id}`, apiKey);
    this.#recordAudit({
      actor: { kind: 'user' },
      type: current === undefined ? 'provider.created' : 'provider.updated',
      payload: { providerId: input.id, protocol: input.protocol },
    });
    return null;
  }

  #listModels(): unknown[] {
    return this.#requireModels()
      .list()
      .map((model) => this.#modelView(model));
  }

  #saveModel(input: {
    id: string;
    name: string;
    providerProfileId: string;
    modelId: string;
    contextWindowTokens: number;
    maxOutputTokens: number;
    autoCompact: boolean;
    compactThresholdPercent: number;
    supportedReasoningEfforts: ModelConfiguration['supportedReasoningEfforts'];
    defaultReasoningEffort: ModelConfiguration['defaultReasoningEffort'];
    declaredCapabilities: ModelConfiguration['declaredCapabilities'];
  }): null {
    this.#requireProvider(input.providerProfileId);
    const models = this.#requireModels();
    const current = models.get(input.id);
    if (current === undefined) {
      models.create(input);
    } else {
      if (current.providerProfileId !== input.providerProfileId) {
        throw routerError('invalid_message', 'Model Configuration provider cannot be changed');
      }
      models.update(input.id, {
        name: input.name,
        modelId: input.modelId,
        contextWindowTokens: input.contextWindowTokens,
        maxOutputTokens: input.maxOutputTokens,
        autoCompact: input.autoCompact,
        compactThresholdPercent: input.compactThresholdPercent,
        supportedReasoningEfforts: input.supportedReasoningEfforts,
        defaultReasoningEffort: input.defaultReasoningEffort,
        declaredCapabilities: input.declaredCapabilities,
      });
    }
    this.#recordAudit({
      actor: { kind: 'user' },
      type: current === undefined ? 'model.created' : 'model.updated',
      payload: { modelConfigurationId: input.id, providerProfileId: input.providerProfileId },
    });
    return null;
  }

  async #testModel(modelConfigurationId: string): Promise<unknown> {
    const models = this.#requireModels();
    const model = models.get(modelConfigurationId);
    if (model === undefined)
      throw routerError('provider_unavailable', 'Model Configuration not found');
    const profile = this.#requireProvider(model.providerProfileId);
    const secret = await this.#requireSecrets().get(profile.credentialRef);
    if (secret === undefined)
      throw routerError('provider_unavailable', 'Provider credential is missing');
    const validator = this.#modelValidator;
    const createAdapter = this.#createAdapter;
    if (validator === undefined || createAdapter === undefined) {
      throw routerError('provider_unavailable', 'Model validation is not configured');
    }
    const validated = await validator.validate(
      model,
      profile,
      createAdapter(profile, model, secret),
    );
    models.save(validated);
    this.#recordAudit({
      actor: { kind: 'user' },
      type: 'model.tested',
      payload: {
        modelConfigurationId,
        providerProfileId: profile.id,
        status: validated.validation.status,
        ...(validated.validation.status === 'unavailable'
          ? { reason: validated.validation.reason }
          : {}),
      },
    });
    return this.#modelView(validated);
  }

  #setModelEnabled(modelConfigurationId: string, enabled: boolean): unknown {
    return this.#modelView(this.#requireModels().setEnabled(modelConfigurationId, enabled));
  }

  #setDefaultModel(modelConfigurationId: string, isDefault: boolean): unknown {
    return this.#modelView(this.#requireModels().setDefault(modelConfigurationId, isDefault));
  }

  #removeModel(modelConfigurationId: string): boolean {
    const removed = this.#requireModels().delete(modelConfigurationId);
    if (removed) {
      this.#recordAudit({
        actor: { kind: 'user' },
        type: 'model.removed',
        payload: { modelConfigurationId },
      });
    }
    return removed;
  }

  async #discoverModels(providerId: string): Promise<unknown> {
    const profile = this.#requireProvider(providerId);
    const secret = await this.#requireSecrets().get(profile.credentialRef);
    if (secret === undefined)
      throw routerError('provider_unavailable', 'Provider credential is missing');
    if (this.#modelDiscovery === undefined) {
      throw routerError('provider_unavailable', 'Model discovery is not configured');
    }
    const result = await this.#modelDiscovery.discover(profile, secret);
    return { providerProfileId: providerId, ...result };
  }

  #cancelModelDiscovery(providerId: string): boolean {
    return this.#modelDiscovery?.cancel(providerId) ?? false;
  }

  #importDiscoveredModels(providerProfileId: string, modelIds: readonly string[]): unknown {
    this.#requireProvider(providerProfileId);
    return this.#requireModels().importDiscovered(providerProfileId, modelIds);
  }

  async #removeProvider(providerId: string): Promise<boolean> {
    const profile = this.#requireProviders().get(providerId);
    if (profile === undefined) return false;
    const removed = this.#requireProviders().delete(providerId);
    await this.#requireSecrets().delete(profile.credentialRef);
    if (removed) {
      this.#recordAudit({
        actor: { kind: 'user' },
        type: 'provider.removed',
        payload: { providerId },
      });
    }
    return removed;
  }

  #listAudit(sessionId?: string, taskId?: string): unknown[] {
    if (this.#audit === undefined) return [];
    const events = this.#audit.query({
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(taskId === undefined ? {} : { taskId }),
    });
    return events.map((event) => ({
      id: event.id,
      type: event.type,
      ...(event.sessionId === undefined ? {} : { sessionId: event.sessionId }),
      ...(event.taskId === undefined ? {} : { taskId: event.taskId }),
      occurredAt: event.occurredAt,
      summary: summarizeAudit(event),
    }));
  }

  #requireAgents(): AgentCoordinatorLike {
    if (this.#agents === undefined) {
      throw routerError('internal_error', 'Agent coordinator is not configured');
    }
    return this.#agents;
  }

  #getResources(sessionId: string): unknown {
    const snapshot = this.#requireResources().get(sessionId);
    return snapshot === undefined ? undefined : sessionResourceSnapshotSchema.parse(snapshot);
  }

  async #refreshResources(sessionId: string): Promise<unknown> {
    const result = sessionResourceRefreshResultSchema.parse(
      await this.#requireResources().refresh(sessionId),
    );
    if (result.ok) {
      this.#emitEvent({
        type: 'session.resources',
        streamId: `resources:${sessionId}`,
        payload: { sessionId, snapshot: result.snapshot },
      });
    }
    return result;
  }

  #requireResources(): SessionResourcesLike {
    if (this.#resources === undefined) {
      throw routerError('internal_error', 'Session resource service is not configured');
    }
    return this.#resources;
  }

  #providerView(
    profile: ProviderProfile,
    credentialConfigured: boolean,
  ): {
    id: string;
    name: string;
    protocol: ProviderProfile['protocol'];
    baseUrl: string;
    extraHeaders: Readonly<Record<string, string>>;
    timeoutMs: number;
    credentialConfigured: boolean;
    revision: number;
  } {
    return {
      id: profile.id,
      name: profile.name,
      protocol: profile.protocol,
      baseUrl: profile.baseUrl,
      extraHeaders: profile.extraHeaders,
      timeoutMs: profile.timeoutMs,
      credentialConfigured,
      revision: profile.revision,
    };
  }

  #modelView(model: ModelConfiguration): Record<string, unknown> {
    const provider = this.#requireProvider(model.providerProfileId);
    return {
      id: model.id,
      name: model.name,
      providerProfileId: model.providerProfileId,
      providerName: provider.name,
      providerProtocol: provider.protocol,
      modelId: model.modelId,
      contextWindowTokens: model.contextWindowTokens,
      maxOutputTokens: model.maxOutputTokens,
      autoCompact: model.autoCompact,
      compactThresholdPercent: model.compactThresholdPercent,
      supportedReasoningEfforts: model.supportedReasoningEfforts,
      defaultReasoningEffort: model.defaultReasoningEffort,
      declaredCapabilities: model.declaredCapabilities,
      enabled: model.enabled,
      isDefault: model.isDefault,
      status: model.validation.status,
      validation: model.validation,
      revision: model.revision,
    };
  }

  #requireProviders(): ProviderProfileService {
    if (this.#providers === undefined)
      throw routerError('provider_unavailable', 'Provider service is not configured');
    return this.#providers;
  }

  #requireProvider(id: string): ProviderProfile {
    const provider = this.#requireProviders().get(id);
    if (provider === undefined) {
      throw routerError('provider_unavailable', `Provider Profile ${id} not found`);
    }
    return provider;
  }

  #requireModels(): ModelCatalogService {
    if (this.#models === undefined) {
      throw routerError('provider_unavailable', 'Model catalog is not configured');
    }
    return this.#models;
  }

  #requireSecrets(): CoreSecretStore {
    if (this.#secrets === undefined)
      throw routerError('secret_store_error', 'SecretStore is not configured');
    return this.#secrets;
  }

  async idle(): Promise<void> {
    await Promise.all(this.#sessions.list().map((session) => session.idle()));
  }

  async closeAll(): Promise<void> {
    await this.#agents?.closeAll?.();
    for (const session of [...this.#sessions.list()])
      await this.#sessions.close(session.snapshot.id);
    this.#onActivityChange({ sessions: this.#sessions.activeCount, agentTasks: 0 });
  }

  #listSessions(): SessionSummary[] {
    const active = new Map(this.#sessions.list().map((actor) => [actor.snapshot.id, actor]));
    const summaries = new Map<string, SessionSummary>();
    for (const state of this.#repositories.listSessions()) {
      summaries.set(
        state.id,
        this.#summary(state.id, this.#titles.get(state.id) ?? state.id, state),
      );
    }
    for (const actor of active.values()) {
      const state = actor.snapshot;
      summaries.set(
        state.id,
        this.#summary(state.id, this.#titles.get(state.id) ?? state.id, state),
      );
    }
    return [...summaries.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  async #createSession(input: SessionLaunch): Promise<SessionSummary> {
    const id = randomUUID();
    this.#titles.set(id, input.title);
    this.#terminalTypes.set(id, input.terminalType);
    let actor: SessionActor;
    try {
      actor = await this.#sessions.create({
        id,
        executionDialect: input.executionDialect,
        launch: {
          executable: input.executable,
          args: input.args,
          cwd: input.cwd,
          env: input.env,
          columns: input.columns,
          rows: input.rows,
        },
        onEvent: (session, event) => this.#handleSessionEvent(id, session, event),
      });
    } catch (error) {
      this.#titles.delete(id);
      this.#terminalTypes.delete(id);
      throw error;
    }
    this.#save(actor, {
      title: input.title,
      launch: {
        executable: input.executable,
        terminalType: input.terminalType,
        args: input.args,
        cwd: input.cwd,
        columns: input.columns,
        rows: input.rows,
        executionDialect: input.executionDialect,
        envKeys: Object.keys(input.env).sort(),
      },
    });
    this.#recordAudit({
      actor: { kind: 'user' },
      sessionId: id,
      type: 'session.created',
      payload: { title: input.title, executable: input.executable },
    });
    this.#onActivityChange({ sessions: this.#sessions.activeCount, agentTasks: 0 });
    const summary = this.#summary(id, input.title, actor.snapshot);
    this.#emitChanged(summary);
    return summary;
  }

  async #closeSession(sessionId: string): Promise<boolean> {
    const persisted = this.#repositories.getSession(sessionId);
    const closed = await this.#sessions.close(sessionId);
    if (!closed && persisted === undefined) return false;
    this.#titles.delete(sessionId);
    this.#terminalTypes.delete(sessionId);
    this.#repositories.deleteSession(sessionId);
    this.#recordAudit({
      actor: { kind: 'user' },
      sessionId,
      type: 'session.closed',
      payload: { pty: persisted?.pty ?? 'running' },
    });
    this.#onActivityChange({ sessions: this.#sessions.activeCount, agentTasks: 0 });
    return true;
  }

  async #setSessionDialect(
    sessionId: string,
    executionDialect: SessionLaunch['executionDialect'],
  ): Promise<SessionSummary> {
    const actor = this.#sessions.get(sessionId);
    if (actor === undefined) throw routerError('session_not_found', 'Session not found');
    await actor.setExecutionDialect(executionDialect);
    this.#save(actor);
    this.#recordAudit({
      actor: { kind: 'user' },
      sessionId,
      type: 'session.dialect_changed',
      payload: { executionDialect },
    });
    const summary = this.#summary(
      sessionId,
      this.#titles.get(sessionId) ?? sessionId,
      actor.snapshot,
    );
    this.#emitChanged(summary);
    return summary;
  }

  async #writeTerminal(sessionId: string, data: string): Promise<null> {
    const actor = this.#requireSession(sessionId);
    const result = await actor.writeUser(data);
    if (!result.ok) throw routerError('session_not_ready', result.error);
    this.#recordAudit({
      actor: { kind: 'user' },
      sessionId,
      type: 'session.input',
      payload: { bytes: Buffer.byteLength(data, 'utf8') },
    });
    this.#save(actor);
    this.#emitChanged(
      this.#summary(sessionId, this.#titles.get(sessionId) ?? sessionId, actor.snapshot),
    );
    return null;
  }

  async #resizeTerminal(sessionId: string, columns: number, rows: number): Promise<null> {
    const actor = this.#requireSession(sessionId);
    await actor.resize(columns, rows);
    this.#save(actor);
    return null;
  }

  #replayTerminal(sessionId: string, afterSequence: number): TerminalReplay {
    const actor = this.#sessions.get(sessionId);
    const replay = this.#journal.replay(sessionId, afterSequence);
    return {
      historyGap: replay.historyGap,
      ...(replay.historyGap && actor === undefined
        ? {}
        : replay.historyGap
          ? { snapshot: actor?.terminalSnapshot() }
          : {}),
      events: replay.events.map((event) => ({
        sequence: event.sequence,
        data: Buffer.from(event.data).toString('utf8'),
      })),
      ...(replay.oldestSequence === undefined ? {} : { oldestSequence: replay.oldestSequence }),
      nextSequence: replay.nextSequence,
    };
  }

  #handleSessionEvent(sessionId: string, actor: SessionActor, event: SessionActorEvent): void {
    if (event.type === 'pty_output' && event.data.length > 0) {
      const journalEvent = this.#journal.append(sessionId, Buffer.from(event.data, 'utf8'));
      this.#emitTerminalOutput({
        sessionId,
        sequence: journalEvent.sequence,
        data: event.data,
      });
    }
    this.#save(actor);
    this.#emitChanged(
      this.#summary(sessionId, this.#titles.get(sessionId) ?? sessionId, actor.snapshot),
    );
    if (event.type === 'pty_exit') {
      this.#onActivityChange({ sessions: this.#sessions.activeCount, agentTasks: 0 });
    }
  }

  #save(actor: SessionActor, metadata?: SessionLaunchMetadata): void {
    this.#repositories.saveSession(actor.snapshot, metadata);
  }

  #summary(id: string, title: string, state: SessionState): SessionSummary {
    return {
      id,
      title,
      terminalType: this.#terminalTypes.get(id) ?? 'Unknown terminal',
      pty: state.pty,
      shell: state.shell,
      executionDialect: state.executionDialect,
    };
  }

  #emitChanged(summary: SessionSummary): void {
    this.#emitEvent({
      type: 'session.changed',
      streamId: `session:${summary.id}`,
      payload: summary,
    });
  }

  #recordAudit(input: AuditRecordInput): void {
    this.#audit?.record?.(input);
  }

  #requireSession(sessionId: string): SessionActor {
    const actor = this.#sessions.get(sessionId);
    if (actor === undefined)
      throw routerError('session_not_found', `Session ${sessionId} not found`);
    return actor;
  }
}

function routerError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function summarizeAudit(event: AuditEvent): string {
  const payload = event.payload;
  for (const key of ['reason', 'commandHash', 'status', 'mode']) {
    const value = payload[key];
    if (typeof value === 'string') return value;
  }
  return event.type;
}
