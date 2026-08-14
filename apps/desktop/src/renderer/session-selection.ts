import type { SessionSummary } from '../preload/preload-api.js';

export function isInteractiveSession(session: SessionSummary): boolean {
  return session.pty === 'starting' || session.pty === 'running';
}

export function chooseInitialSessionId(
  sessions: readonly SessionSummary[],
  preferredId = '',
): string {
  const preferred = sessions.find(
    (session) => session.id === preferredId && isInteractiveSession(session),
  );
  return preferred?.id ?? sessions.find(isInteractiveSession)?.id ?? sessions[0]?.id ?? '';
}
