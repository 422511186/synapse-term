import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createSessionState } from '@synapse-term/domain';
import { withTemporaryDirectory } from '@synapse-term/test-kit';

import { CORE_MIGRATIONS } from '@synapse-term/infrastructure';
import { CoreRepositories } from '@synapse-term/infrastructure';
import { SessionRecovery } from './session-recovery.js';
import { SqliteStore } from '@synapse-term/infrastructure';

describe('SessionRecovery', () => {
  it('marks persisted live sessions interrupted and appends an audit event', async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = new SqliteStore(join(directory, 'core.sqlite'), CORE_MIGRATIONS);
      await store.open();
      const repositories = new CoreRepositories(store);
      const session = createSessionState('session-1');
      const running = { ...session, pty: 'running' as const };
      repositories.saveSession(running);

      const recovered = new SessionRecovery(repositories).recover('core-2');

      expect(recovered).toBe(1);
      expect(repositories.getSession('session-1')?.pty).toBe('interrupted');
      expect(repositories.listAuditEvents()).toMatchObject([
        { type: 'session.interrupted', sessionId: 'session-1' },
      ]);
      await store.close();
    });
  });
});
