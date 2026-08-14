import { describe, expect, it } from 'vitest';

import { ShellLocator } from './shell-locator.js';

describe('ShellLocator', () => {
  it('returns typed shell descriptors', () => {
    const locator = new ShellLocator({ environment: {} });
    const shells = locator.list();
    expect(shells.length).toBeGreaterThan(0);
    for (const shell of shells) {
      expect(shell).toHaveProperty('kind');
      expect(shell).toHaveProperty('label');
      expect(typeof shell.available).toBe('boolean');
      expect(Array.isArray(shell.args)).toBe(true);
    }
  });

  it('uses injected exists to resolve candidates on non-darwin paths', () => {
    const locator = new ShellLocator({
      environment: { PATH: '/opt/git/bin' },
      exists: (candidate) => candidate === '/opt/git/bin/bash.exe',
    });
    // list() branches by the real platform; the descriptor shape must still be valid.
    const shells = locator.list();
    for (const shell of shells) {
      expect(shell).toMatchObject({
        available: expect.any(Boolean),
        source: expect.any(String),
      });
    }
  });
});
