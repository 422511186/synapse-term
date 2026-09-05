import { describe, expect, it } from 'vitest';

import { InteractiveCommandExecutor } from './index.js';

import * as api from './index.js';

describe('terminal-service public API', () => {
  it('exports the interactive executor through the package boundary', () => {
    expect(InteractiveCommandExecutor).toBeDefined();
  });
  it('exports the terminal runtime surface', () => {
    expect(typeof api.NodePtySpawner).toBe('function');
    expect(typeof api.SessionManager).toBe('function');
    expect(typeof api.SessionActor).toBe('function');
    expect(typeof api.ShellLocator).toBe('function');
  });
});
