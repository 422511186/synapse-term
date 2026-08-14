import type { LocalShellDescriptor } from '@synapse-term/terminal-service';

import type {
  AppStatus,
  DesktopApi,
  SessionEnvironment,
  SessionLaunchInput,
  SessionSummary,
  TerminalOutputEvent,
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
      write: async () => undefined,
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
  };
}
