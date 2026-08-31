import type { LocalShellDescriptor } from '@synapse-term/terminal-service';

import type {
  AppStatus,
  DesktopApi,
  GeneralSettings,
  McpApprovalDecision,
  McpApprovalRequest,
  McpExecutionEvent,
  McpRuntimeStatus,
  McpSettings,
  SessionEnvironment,
  SessionLaunchInput,
  SessionSummary,
  TerminalOutputEvent,
  SharedMcpSession,
} from '../preload/preload-api.js';

const mockShells: LocalShellDescriptor[] = [
  {
    kind: 'zsh',
    label: 'Zsh',
    available: true,
    source: 'system',
    args: ['-l', '-i'],
    executable: '/bin/zsh',
  },
  {
    kind: 'bash',
    label: 'Bash',
    available: true,
    source: 'system',
    args: ['-l', '-i'],
    executable: '/bin/bash',
  },
];

export function createMockDesktopApi(): DesktopApi {
  let sessionSequence = 0;
  let outputSequence = 1;
  const sessions = new Map<string, SessionSummary>();
  const sessionListeners = new Set<(session: SessionSummary) => void>();
  const outputListeners = new Set<(event: TerminalOutputEvent) => void>();
  const scenarioParams =
    typeof globalThis.location === 'undefined'
      ? undefined
      : new URLSearchParams(globalThis.location.search);
  const approvalListeners = new Set<(request: McpApprovalRequest) => void>();
  const approvalClosedListeners = new Set<(closure: { id: string }) => void>();
  const executionListeners = new Set<(event: McpExecutionEvent) => void>();
  let mcpSettings: McpSettings = {
    enabled: false,
    approvalMode: scenarioParams?.get('mcpEnabled') === 'true' ? 'managed' : 'read_only',
    port: 4_739,
  };
  let generalSettings: GeneralSettings = { hideCompletionProbeEcho: true };
  const sharedSessions = new Map<string, SharedMcpSession>();
  const inSessionGrants = new Set<string>();
  let approvalSequence = 0;
  let activeApproval: McpApprovalRequest | undefined;

  const grantKey = (sessionId: string, command: string): string => `${sessionId}\n${command}`;

  const emitApproval = (request: McpApprovalRequest): void => {
    for (const listener of approvalListeners) listener(request);
  };

  const requestedSessionCount = Number(scenarioParams?.get('sessions'));
  const requestedStaleSessionCount = Number(scenarioParams?.get('stale'));
  if (Number.isInteger(requestedSessionCount) && requestedSessionCount > 0) {
    for (let index = 1; index <= Math.min(requestedSessionCount, 20); index += 1) {
      const stale =
        Number.isInteger(requestedStaleSessionCount) && requestedStaleSessionCount >= index;
      const session: SessionSummary = {
        id: `session-${index}`,
        title: `session ${index}`,
        terminalType: 'Git Bash',
        pty: stale ? 'failed' : 'running',
      };
      sessions.set(session.id, session);
      sessionSequence = index;
    }
  }

  const emitSession = (session: SessionSummary): void => {
    for (const listener of sessionListeners) listener(session);
  };
  const emitOutput = (event: TerminalOutputEvent): void => {
    for (const listener of outputListeners) listener(event);
  };

  if (typeof globalThis.window !== 'undefined') {
    Object.assign(globalThis.window, {
      __synapseMockMcpApproval: (command = 'deploy-production.sh') => {
        const sessionId = [...sessions.keys()][0] ?? 'session-1';
        if (inSessionGrants.has(grantKey(sessionId, command))) {
          approvalSequence += 1;
          for (const listener of executionListeners) {
            listener({
              sessionId,
              transactionId: `mock-transaction-${approvalSequence}`,
              command,
              source: 'MCP 外部客户端',
              phase: 'started',
            });
          }
          return '';
        }
        approvalSequence += 1;
        activeApproval = {
          id: `approval-${approvalSequence}`,
          sessionId,
          command,
          risk: 'unknown',
          reasons: ['unknown executable'],
        };
        emitApproval(activeApproval);
        return activeApproval.id;
      },
      __synapseMockMcpTimeout: () => {
        if (activeApproval === undefined) return false;
        const closure = { id: activeApproval.id };
        activeApproval = undefined;
        for (const listener of approvalClosedListeners) listener(closure);
        return true;
      },
    });
  }

  return {
    platform: 'browser-mock',
    sessions: {
      list: async () => [...sessions.values()],
      environment: async (): Promise<SessionEnvironment> => ({
        home: '/home/mock',
        shells: mockShells,
      }),
      create: async (input: SessionLaunchInput) => {
        sessionSequence += 1;
        const session: SessionSummary = {
          id: `mock-session-${sessionSequence}`,
          title: input.title,
          terminalType: input.terminalType,
          pty: 'running',
        };
        sessions.set(session.id, session);
        const event: TerminalOutputEvent = {
          sessionId: session.id,
          sequence: outputSequence++,
          data: `\r\n[Synapse Term] ${session.title} 已就绪\r\n`,
        };
        emitOutput(event);
        emitSession(session);
        return session;
      },
      rename: async (sessionId, alias) => {
        const current = sessions.get(sessionId);
        if (current === undefined) throw new Error('Session not found');
        const next = { ...current, title: alias };
        sessions.set(sessionId, next);
        emitSession(next);
        return next;
      },
      close: async (sessionId) => {
        return sessions.delete(sessionId);
      },
      onChanged: (listener) => {
        sessionListeners.add(listener);
        return () => sessionListeners.delete(listener);
      },
    },
    terminal: {
      write: async (sessionId, data) => {
        emitOutput({ sessionId, sequence: outputSequence++, data });
      },
      resize: async () => undefined,
      onOutput: (listener) => {
        outputListeners.add(listener);
        return () => outputListeners.delete(listener);
      },
    },
    app: {
      status: async (): Promise<AppStatus> => ({
        connected: true,
        version: 'mock',
        sessions: sessions.size,
      }),
    },
    general: {
      getSettings: async () => structuredClone(generalSettings),
      updateSettings: async (patch) => {
        generalSettings = {
          hideCompletionProbeEcho:
            typeof patch.hideCompletionProbeEcho === 'boolean'
              ? patch.hideCompletionProbeEcho
              : generalSettings.hideCompletionProbeEcho,
        };
        return structuredClone(generalSettings);
      },
    },
    mcp: {
      getSettings: async () => structuredClone(mcpSettings),
      updateSettings: async (patch) => {
        const token =
          patch.token === null
            ? undefined
            : (patch.token ?? mcpSettings.token ?? (patch.enabled ? 'mock-token' : undefined));
        mcpSettings = {
          enabled: patch.enabled ?? mcpSettings.enabled,
          approvalMode: patch.approvalMode ?? mcpSettings.approvalMode,
          port: patch.port ?? mcpSettings.port,
          ...(token === undefined ? {} : { token }),
        };
        return structuredClone(mcpSettings);
      },
      regenerateToken: async () => {
        mcpSettings = { ...mcpSettings, token: `mock-${Math.random().toString(36).slice(2)}` };
        return structuredClone(mcpSettings);
      },
      revokeToken: async () => {
        const { token: _token, ...settings } = mcpSettings;
        void _token;
        mcpSettings = settings;
        return structuredClone(mcpSettings);
      },
      getStatus: async (): Promise<McpRuntimeStatus> => ({
        running: mcpSettings.enabled && mcpSettings.token !== undefined,
        ...(mcpSettings.enabled
          ? {
              port: mcpSettings.port,
              connectionString: `http://127.0.0.1:${mcpSettings.port}/mcp`,
            }
          : {}),
      }),
      listSharedSessions: async () => [...sharedSessions.values()],
      shareSession: async (sessionId) => {
        const session = sessions.get(sessionId);
        if (session !== undefined && !sharedSessions.has(sessionId)) {
          sharedSessions.set(sessionId, {
            id: sessionId,
            title: session.title,
            sharedAt: new Date().toISOString(),
          });
        }
        return [...sharedSessions.values()];
      },
      unshareSession: async (sessionId) => {
        sharedSessions.delete(sessionId);
        return [...sharedSessions.values()];
      },
      decideApproval: async (id, decision: McpApprovalDecision) => {
        if (activeApproval?.id !== id) throw new Error('Approval request not found');
        const request = activeApproval!;
        activeApproval = undefined;
        if (decision !== 'denied') {
          const event: McpExecutionEvent = {
            sessionId: request.sessionId,
            transactionId: `mock-transaction-${Date.now()}`,
            command: request.command,
            source: 'MCP 外部客户端',
            phase: 'started',
          };
          for (const listener of executionListeners) listener(event);
          if (decision === 'allow_session') {
            inSessionGrants.add(grantKey(request.sessionId, request.command));
          }
        }
        for (const listener of approvalClosedListeners) listener({ id });
      },
      onApproval: (listener) => {
        approvalListeners.add(listener);
        return () => approvalListeners.delete(listener);
      },
      onApprovalClosed: (listener) => {
        approvalClosedListeners.add(listener);
        return () => approvalClosedListeners.delete(listener);
      },
      onExecution: (listener) => {
        executionListeners.add(listener);
        return () => executionListeners.delete(listener);
      },
    },
  };
}
