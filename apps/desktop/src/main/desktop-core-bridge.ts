import {
  agentTextDeltaSchema,
  agentTimelineItemSchema,
  parseCoreRequest,
  sessionResourceSnapshotSchema,
  sessionSummarySchema,
} from '@synapse-term/protocol';

import type { CoreSupervisor, CoreTerminalOutput } from './core-supervisor.js';
import type { DesktopAttachmentController } from './desktop-attachment-controller.js';

export interface DesktopCoreBridge {
  invoke(channel: string, ...argumentsValue: unknown[]): Promise<unknown>;
  dispose(): void;
}

export function createDesktopCoreBridge(
  supervisor: Pick<CoreSupervisor, 'request' | 'onEvent' | 'onTerminalOutput' | 'requestExit'>,
  emitOutput: (event: CoreTerminalOutput) => void,
  emitTimeline: (event: unknown) => void,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  getSessionEnvironment?: () => unknown | Promise<unknown>,
  emitResources: (event: unknown) => void = () => undefined,
  emitSessionChanged: (event: unknown) => void = () => undefined,
  attachmentControllerOrEmitTextDelta?: DesktopAttachmentController | ((event: unknown) => void),
  emitTextDelta: (event: unknown) => void = () => undefined,
): DesktopCoreBridge {
  const attachmentController =
    typeof attachmentControllerOrEmitTextDelta === 'function'
      ? undefined
      : attachmentControllerOrEmitTextDelta;
  if (typeof attachmentControllerOrEmitTextDelta === 'function') {
    emitTextDelta = attachmentControllerOrEmitTextDelta;
  }
  const inheritedEnvironment = Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  const removeOutput = supervisor.onTerminalOutput(emitOutput);
  const removeEvent = supervisor.onEvent((event) => {
    if (event.event === 'agent.timeline') {
      const parsed = agentTimelineItemSchema.safeParse(event.payload);
      if (parsed.success) emitTimeline(parsed.data);
      return;
    }
    if (event.event === 'agent.text_delta') {
      const parsed = agentTextDeltaSchema.safeParse(event.payload);
      if (parsed.success) emitTextDelta(parsed.data);
      return;
    }
    if (event.event === 'session.resources') {
      const payload = objectValueUnknown(event.payload);
      const sessionId = payload.sessionId;
      const snapshot = sessionResourceSnapshotSchema.safeParse(payload.snapshot);
      if (typeof sessionId === 'string' && snapshot.success) {
        emitResources({ sessionId, snapshot: snapshot.data });
      }
      return;
    }
    if (event.event === 'session.changed') {
      const parsed = sessionSummarySchema.safeParse(event.payload);
      if (parsed.success) emitSessionChanged(parsed.data);
    }
  });

  return {
    invoke: async (channel, ...argumentsValue) => {
      switch (channel) {
        case 'sessions:list':
          return request(supervisor, 'session.list', {});
        case 'sessions:environment':
          if (getSessionEnvironment === undefined) {
            throw new Error('本机 Shell 发现服务不可用');
          }
          return getSessionEnvironment();
        case 'sessions:create': {
          const input = objectAt(argumentsValue, 0);
          const requestedEnvironment = objectValue(input.env);
          return request(supervisor, 'session.create', {
            ...input,
            env: {
              ...inheritedEnvironment,
              ...requestedEnvironment,
              TERM:
                typeof requestedEnvironment.TERM === 'string'
                  ? requestedEnvironment.TERM
                  : (inheritedEnvironment.TERM ?? 'xterm-256color'),
            },
            columns: input.columns ?? 80,
            rows: input.rows ?? 24,
          });
        }
        case 'sessions:set-dialect':
          return request(supervisor, 'session.setDialect', {
            sessionId: stringAt(argumentsValue, 0),
            executionDialect: stringAt(argumentsValue, 1),
          });
        case 'sessions:mark-shared':
          return request(supervisor, 'session.markShared', {
            sessionId: stringAt(argumentsValue, 0),
          });
        case 'sessions:close':
          return request(supervisor, 'session.close', { sessionId: stringAt(argumentsValue, 0) });
        case 'terminal:write':
          return request(supervisor, 'terminal.write', {
            sessionId: stringAt(argumentsValue, 0),
            data: stringAt(argumentsValue, 1),
          });
        case 'terminal:resize':
          return request(supervisor, 'terminal.resize', {
            sessionId: stringAt(argumentsValue, 0),
            columns: numberAt(argumentsValue, 1),
            rows: numberAt(argumentsValue, 2),
          });
        case 'terminal:replay':
          return request(supervisor, 'terminal.replay', {
            sessionId: stringAt(argumentsValue, 0),
            afterSequence: numberAt(argumentsValue, 1),
          });
        case 'resources:get':
          return request(supervisor, 'resources.get', {
            sessionId: stringAt(argumentsValue, 0),
          });
        case 'resources:refresh':
          return request(supervisor, 'resources.refresh', {
            sessionId: stringAt(argumentsValue, 0),
          });
        case 'attachments:pick':
          if (attachmentController === undefined) throw new Error('附件服务不可用');
          return attachmentController.pick(objectAt(argumentsValue, 0));
        case 'agent:start': {
          const options = objectAt(argumentsValue, 2, {});
          const forwarded = { ...options };
          if (forwarded.attachments !== undefined) {
            if (attachmentController === undefined) throw new Error('附件服务不可用');
            forwarded.attachments = await attachmentController.resolve(forwarded.attachments);
          }
          return request(supervisor, 'agent.start', {
            sessionId: stringAt(argumentsValue, 0),
            goal: stringAt(argumentsValue, 1),
            ...forwarded,
          });
        }
        case 'agent:cancel':
          await request(supervisor, 'agent.cancel', {
            sessionId: stringAt(argumentsValue, 0),
            ...(argumentsValue[1] === undefined ? {} : { turnId: stringAt(argumentsValue, 1) }),
          });
          return null;
        case 'agent:history':
          return request(supervisor, 'agent.history', {
            sessionId: stringAt(argumentsValue, 0),
          });
        case 'agent:reset-conversation':
          await request(supervisor, 'agent.resetConversation', {
            sessionId: stringAt(argumentsValue, 0),
            expectedConversationId: stringAt(argumentsValue, 1),
          });
          return null;
        case 'agent:interrupt':
          await request(supervisor, 'agent.interrupt', {
            sessionId: stringAt(argumentsValue, 0),
            transactionId: stringAt(argumentsValue, 1),
          });
          return null;
        case 'agent:approve':
          await request(supervisor, 'agent.approve', {
            sessionId: stringAt(argumentsValue, 0),
            approvalId: stringAt(argumentsValue, 1),
            confirmedDestructive: booleanAt(argumentsValue, 2),
          });
          return null;
        case 'agent:takeover':
          await request(supervisor, 'agent.takeover', { sessionId: stringAt(argumentsValue, 0) });
          return null;
        case 'providers:list':
          return request(supervisor, 'provider.list', {});
        case 'providers:save':
          return request(supervisor, 'provider.save', {
            profile: objectAt(argumentsValue, 0),
            ...(argumentsValue[1] === undefined ? {} : { apiKey: stringAt(argumentsValue, 1) }),
          });
        case 'providers:discover-models':
          return request(supervisor, 'provider.discoverModels', {
            providerId: stringAt(argumentsValue, 0),
          });
        case 'providers:cancel-discovery':
          return request(supervisor, 'provider.cancelDiscovery', {
            providerId: stringAt(argumentsValue, 0),
          });
        case 'providers:remove':
          return request(supervisor, 'provider.remove', {
            providerId: stringAt(argumentsValue, 0),
          });
        case 'models:list':
          return request(supervisor, 'model.list', {});
        case 'models:save':
          return request(supervisor, 'model.save', { model: objectAt(argumentsValue, 0) });
        case 'models:test':
          return request(supervisor, 'model.test', {
            modelConfigurationId: stringAt(argumentsValue, 0),
          });
        case 'models:set-enabled':
          return request(supervisor, 'model.setEnabled', {
            modelConfigurationId: stringAt(argumentsValue, 0),
            enabled: booleanAt(argumentsValue, 1),
          });
        case 'models:set-default':
          return request(supervisor, 'model.setDefault', {
            modelConfigurationId: stringAt(argumentsValue, 0),
            isDefault: booleanAt(argumentsValue, 1),
          });
        case 'models:remove':
          return request(supervisor, 'model.remove', {
            modelConfigurationId: stringAt(argumentsValue, 0),
          });
        case 'models:import-discovered':
          return request(supervisor, 'model.importDiscovered', {
            providerProfileId: stringAt(argumentsValue, 0),
            modelIds: stringArrayAt(argumentsValue, 1),
          });
        case 'audit:list':
          return request(supervisor, 'audit.list', objectAt(argumentsValue, 0, {}));
        case 'audit:cleanup':
          return request(supervisor, 'audit.cleanup', {});
        case 'core:status':
          return request(supervisor, 'core.status', {});
        case 'core:exit': {
          const mode = stringAt(argumentsValue, 0);
          return supervisor.requestExit(
            mode === 'terminate_sessions' ? 'terminate_all' : 'keep_background',
          );
        }
        default:
          throw new Error(`Renderer channel is not available: ${channel}`);
      }
    },
    dispose: () => {
      removeOutput();
      removeEvent();
    },
  };
}

async function request(
  supervisor: Pick<CoreSupervisor, 'request'>,
  method: string,
  payload: unknown,
): Promise<unknown> {
  const parsed = parseCoreRequest(method, payload);
  return supervisor.request(method, parsed.payload);
}

function objectAt(
  values: readonly unknown[],
  index: number,
  fallback?: Record<string, unknown>,
): Record<string, unknown> {
  const value = values[index];
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (fallback !== undefined) return fallback;
  throw new TypeError('expected an object argument');
}

function stringAt(values: readonly unknown[], index: number): string {
  const value = values[index];
  if (typeof value !== 'string') throw new TypeError('expected a string argument');
  return value;
}

function numberAt(values: readonly unknown[], index: number): number {
  const value = values[index];
  if (typeof value !== 'number') throw new TypeError('expected a numeric argument');
  return value;
}

function booleanAt(values: readonly unknown[], index: number): boolean {
  const value = values[index];
  if (typeof value !== 'boolean') throw new TypeError('expected a boolean argument');
  return value;
}

function stringArrayAt(values: readonly unknown[], index: number): string[] {
  const value = values[index];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new TypeError('expected a string array argument');
  }
  return [...value] as string[];
}

function objectValue(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  return Object.fromEntries(entries);
}

function objectValueUnknown(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
