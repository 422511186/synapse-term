import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createSessionState } from '@terminal-agent/domain';
import { withTemporaryDirectory } from '@terminal-agent/test-kit';

import { CORE_MIGRATIONS } from './core-schema.js';
import { CoreRepositories } from './repositories.js';
import { SessionRecovery } from './session-recovery.js';
import { SqliteStore } from './sqlite-store.js';

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
