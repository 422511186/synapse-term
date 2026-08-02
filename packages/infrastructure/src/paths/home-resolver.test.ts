import { describe, expect, it } from 'vitest';

import { HomeResolver } from './home-resolver.js';

describe('HomeResolver', () => {
  it('canonicalizes the current operating-system user home', async () => {
    const resolver = new HomeResolver({
      homedir: () => 'Z:\\Users\\current',
      realpath: async (path) => `${path}\\canonical`,
    });

    await expect(resolver.resolve()).resolves.toBe('Z:\\Users\\current\\canonical');
  });

  it('rejects an empty operating-system home', async () => {
    const resolver = new HomeResolver({ homedir: () => '', realpath: async (path) => path });

    await expect(resolver.resolve()).rejects.toMatchObject({ code: 'home_unavailable' });
  });
});
