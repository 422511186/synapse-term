import { randomBytes } from 'node:crypto';
import { userInfo } from 'node:os';

import { createProviderAdapter } from './provider-adapters.js';
import { AgentCoordinator } from './agent-coordinator.js';
import { AgentTaskScheduler } from './agent-task-scheduler.js';
import { AuditService } from './audit-service.js';
import { CoreIpcServer } from './core-ipc-server.js';
import { CoreLifecycle, type CorePipeServer, type CoreTimer } from './core-lifecycle.js';
import { getCoreDataPaths } from './core-paths.js';
import type { PolicyEngine } from './policy-engine.js';
import { createDefaultPolicyEngine } from './policy-engine.js';
import { ProviderProfileService } from './provider-profile-service.js';
import { ModelValidator } from './provider-validator.js';
import { ModelCatalogService } from './model-catalog-service.js';
import { ProviderModelDiscoveryService } from './provider-model-discovery.js';
import { CoreRepositories } from './repositories.js';
import { RetentionManager } from './retention.js';
import { SessionManager } from './session-manager.js';
import { SessionRecovery } from './session-recovery.js';
import { CredentialSecretStore } from './secret-store.js';
import { SqliteStore } from './sqlite-store.js';
import { OutputJournal } from './output-journal.js';
import { NodePtySpawner, type PtySpawner } from './pty-adapter.js';
import { CoreRequestRouter } from './core-request-router.js';
import { CORE_MIGRATIONS } from './core-schema.js';
import { FileAuthTokenStore, ensureCoreDataLayout } from './data-security.js';
import { UpgradeStateFile } from './upgrade-state.js';
import { HomeResolver } from './home-resolver.js';
import { LocalFileService } from './local-file-service.js';
import { LocalFilePolicy } from './local-file-policy.js';
import { SessionResourceService } from './session-resource-service.js';

export interface CoreApplicationOptions {
  dataDirectory: string;
  appId?: string;
  username?: string;
  instanceId: string;
  version?: string;
  pipeServer?: CorePipeServer;
  spawner?: PtySpawner;
  policy?: PolicyEngine;
  secrets?: CredentialSecretStore;
  applyAcl?: (path: string) => Promise<void>;
  idleExitDelayMs?: number;
  timer?: CoreTimer;
  homeResolver?: Pick<HomeResolver, 'resolve'>;
}

export class CoreApplication {
  readonly #token: string;
  readonly #store: SqliteStore;
  readonly #journal: OutputJournal;
  readonly #router: CoreRequestRouter;
  readonly #ipc: CoreIpcServer;
  readonly #lifecycle: CoreLifecycle;
  readonly #upgradeState: UpgradeStateFile;
  readonly #pipeName: string;
  #closed = false;

  private constructor(resources: {
    token: string;
    store: SqliteStore;
    journal: OutputJournal;
    router: CoreRequestRouter;
    ipc: CoreIpcServer;
    lifecycle: CoreLifecycle;
    upgradeState: UpgradeStateFile;
    pipeName: string;
  }) {
    this.#token = resources.token;
    this.#store = resources.store;
    this.#journal = resources.journal;
    this.#router = resources.router;
    this.#ipc = resources.ipc;
    this.#lifecycle = resources.lifecycle;
    this.#upgradeState = resources.upgradeState;
    this.#pipeName = resources.pipeName;
  }

  static async create(options: CoreApplicationOptions): Promise<CoreApplication> {
    const appId = options.appId ?? 'terminal-agent';
    const username = options.username ?? userInfo().username;
    const paths = getCoreDataPaths(options.dataDirectory, appId, username);
    const layout = await ensureCoreDataLayout(
      paths.dataDirectory,
      options.applyAcl === undefined ? {} : { applyAcl: options.applyAcl },
    );
    const tokenStore = new FileAuthTokenStore(
      layout.authTokenPath,
      options.applyAcl === undefined ? {} : { applyAcl: options.applyAcl },
    );
    let token = await tokenStore.load();
    if (token === undefined) {
      token = randomBytes(32).toString('base64url');
      await tokenStore.save(token);
    }

    const store = new SqliteStore(layout.databasePath, CORE_MIGRATIONS);
    await store.open();
    const version = options.version ?? '0.0.0-dev';
    const upgradeState = new UpgradeStateFile(layout.upgradeStatePath, {
      pid: process.pid,
      instanceId: options.instanceId,
      version,
    });
    const repositories = new CoreRepositories(store);
    new SessionRecovery(repositories).recover(options.instanceId);
    const journal = new OutputJournal({ directory: layout.rawLogDirectory });
    const sessions = new SessionManager(options.spawner ?? new NodePtySpawner(), {
      terminationWaitMs: 1_000,
    });
    const models = new ModelCatalogService(repositories);
    const providers = new ProviderProfileService(repositories, models);
    const audit = new AuditService(repositories);
    const retention = new RetentionManager(layout.rawLogDirectory, repositories);
    const secrets = options.secrets ?? new CredentialSecretStore();
    const policy = options.policy ?? (await createDefaultPolicyEngine());
    const scheduler = new AgentTaskScheduler();
    const modelValidator = new ModelValidator();
    const modelDiscovery = new ProviderModelDiscoveryService();
    const localFiles = await LocalFileService.create({
      root: await (options.homeResolver ?? new HomeResolver()).resolve(),
    });
    const localFilePolicy = new LocalFilePolicy();

    const runtime: { ipc?: CoreIpcServer; lifecycle?: CoreLifecycle } = {};
    let activity = { sessions: 0, agentTasks: 0 };
    const setSessionActivity = (next: { sessions: number }): void => {
      activity = { ...activity, sessions: next.sessions };
      runtime.lifecycle?.setActivity(activity);
      void upgradeState
        .update({ running: runtime.lifecycle?.state === 'running', ...activity })
        .catch((error: unknown) => console.error('[core] upgrade state write failed', error));
    };
    const setAgentActivity = (next: { agentTasks: number }): void => {
      activity = { ...activity, agentTasks: next.agentTasks };
      runtime.lifecycle?.setActivity(activity);
      void upgradeState
        .update({ running: runtime.lifecycle?.state === 'running', ...activity })
        .catch((error: unknown) => console.error('[core] upgrade state write failed', error));
    };
    const agents = new AgentCoordinator({
      sessions,
      repositories,
      providers,
      models,
      secrets,
      scheduler,
      policy,
      localFiles,
      localFilePolicy,
      journal,
      createAdapter: (profile, model, secret) => createProviderAdapter(profile, model, secret),
      audit,
      emitTimeline: (item) => {
        runtime.ipc?.broadcastEvent({
          type: 'agent.timeline',
          streamId: `agent:${item.sessionId}`,
          payload: item,
        });
      },
      onActivityChange: setAgentActivity,
    });
    const resources = new SessionResourceService({
      sessions,
      isSessionBusy: (sessionId) => agents.hasActiveTask(sessionId),
      audit: (event) => {
        const { type, sessionId, ...payload } = event;
        audit.record({
          actor: { kind: 'system' },
          sessionId,
          type,
          occurredAt: event.completedAt,
          payload,
        });
      },
    });

    const router = new CoreRequestRouter({
      sessions,
      journal,
      repositories,
      providers,
      models,
      secrets,
      modelValidator,
      modelDiscovery,
      createAdapter: (profile, model, secret) => createProviderAdapter(profile, model, secret),
      agents,
      audit,
      resources,
      cleanup: () => retention.cleanup(Date.now()),
      getStatus: () => ({
        connected: runtime.lifecycle?.state === 'running',
        version,
        instanceId: options.instanceId,
        sessions: sessions.activeCount,
        agentTasks: agents.activeTaskCount,
      }),
      shutdown: (mode) => {
        const lifecycle = runtime.lifecycle;
        if (lifecycle === undefined) return Promise.reject(new Error('Core is not ready'));
        if (mode === 'terminate_all') {
          const result = {
            ok: true as const,
            action: 'terminated' as const,
            state: 'closed' as const,
          };
          setImmediate(() => {
            void lifecycle.requestShutdown(mode).catch(() => undefined);
          });
          return Promise.resolve(result);
        }
        return lifecycle.requestShutdown(mode);
      },
      emitTerminalOutput: (event) => {
        runtime.ipc?.broadcastTerminalOutput(
          event.sessionId,
          event.sequence,
          Buffer.from(event.data, 'utf8'),
        );
      },
      emitEvent: (event) => runtime.ipc?.broadcastEvent(event),
      onActivityChange: setSessionActivity,
    });

    const ipc = new CoreIpcServer({
      coreInstanceId: options.instanceId,
      token,
      handleRequest: (method, payload, connectionId) =>
        router.handle(method, payload, connectionId),
      onConnectionCountChange: (connectionCount) =>
        runtime.lifecycle?.setClientConnections(connectionCount),
      onDisconnect: () => agents.disconnectUi(),
    });
    runtime.ipc = ipc;
    const lifecycle = new CoreLifecycle({
      appId,
      username,
      dataDirectory: paths.dataDirectory,
      instanceId: options.instanceId,
      ...(options.pipeServer === undefined ? {} : { pipeServer: options.pipeServer }),
      handleConnection: (socket) => ipc.accept(socket),
      terminateSessions: () => router.closeAll(),
      idleExitDelayMs: options.idleExitDelayMs ?? 60_000,
      ...(options.timer === undefined ? {} : { timer: options.timer }),
    });
    runtime.lifecycle = lifecycle;

    return new CoreApplication({
      token,
      store,
      journal,
      router,
      ipc,
      lifecycle,
      upgradeState,
      pipeName: paths.pipeName,
    });
  }

  get token(): string {
    return this.#token;
  }

  get pipeName(): string {
    return this.#pipeName;
  }

  async start(): Promise<{ ok: true; state: 'running'; pipeName: string }> {
    const result = await this.#lifecycle.start();
    await this.#upgradeState.update({ running: true, ...this.#lifecycle.activity });
    return result;
  }

  async waitForClose(): Promise<void> {
    await this.#lifecycle.waitForClose();
  }

  request(method: string, payload: unknown): Promise<unknown> {
    return this.#router.handle(method, payload, 'local-test');
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    try {
      await this.#router.closeAll();
      await this.#ipc.close();
      await this.#lifecycle.close();
      await this.#journal.flush();
      await this.#store.close();
    } finally {
      await this.#upgradeState.markStopped();
    }
  }
}
