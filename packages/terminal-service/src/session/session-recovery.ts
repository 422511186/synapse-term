import { transitionSessionPty } from '@synapse-term/domain';

import type { CoreRepositories } from '@synapse-term/infrastructure';

export class SessionRecovery {
  readonly #repositories: CoreRepositories;

  constructor(repositories: CoreRepositories) {
    this.#repositories = repositories;
  }

  recover(coreInstanceId: string): number {
    let recovered = 0;
    for (const session of this.#repositories.listSessions()) {
      if (session.pty !== 'starting' && session.pty !== 'running') continue;
      const transition = transitionSessionPty(session, 'interrupted');
      if (!transition.ok) continue;
      this.#repositories.saveSession(transition.value);
      this.#repositories.appendAuditEvent({
        id: `recovery:${coreInstanceId}:${session.id}`,
        actor: { kind: 'system' },
        sessionId: session.id,
        type: 'session.interrupted',
        occurredAt: new Date().toISOString(),
        payload: { previousPty: session.pty, coreInstanceId },
      });
      recovered += 1;
    }
    return recovered;
  }
}
