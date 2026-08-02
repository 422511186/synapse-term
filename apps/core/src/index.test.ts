import { describe, expect, it } from 'vitest';

import * as core from './index.js';

describe('core public API', () => {
  it('exports lifecycle, lock, pipe, and path primitives', () => {
    expect(core).toMatchObject({
      CoreLifecycle: expect.any(Function),
      FileStartupLock: expect.any(Function),
      NamedPipeServer: expect.any(Function),
      buildUserScopedPipeName: expect.any(Function),
      SqliteStore: expect.any(Function),
      CoreRepositories: expect.any(Function),
      FileAuthTokenStore: expect.any(Function),
      NodePtySpawner: expect.any(Function),
      TerminalModel: expect.any(Function),
      SessionActor: expect.any(Function),
      SessionManager: expect.any(Function),
      OutputJournal: expect.any(Function),
      SessionReplay: expect.any(Function),
      RetentionManager: expect.any(Function),
      SessionRecovery: expect.any(Function),
    });
  });
});
