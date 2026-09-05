import { describe, expect, it } from 'vitest';

import * as api from './index.js';

describe('session-runtime public API', () => {
  it('exposes the runtime composition root and contracts', () => {
    expect(typeof api.SessionRuntime).toBe('function');
  });

  it('does not expose terminal-service implementation objects', () => {
    expect('SessionActor' in api).toBe(false);
    expect('SessionManager' in api).toBe(false);
    expect('NodePtySpawner' in api).toBe(false);
  });
});
