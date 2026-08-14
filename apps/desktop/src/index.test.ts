import { describe, expect, it } from 'vitest';

import * as desktop from './index.js';

describe('desktop public API', () => {
  it('exports the terminal host and preload contract', () => {
    expect(desktop).toMatchObject({
      TerminalHost: expect.any(Function),
      createDesktopApi: expect.any(Function),
    });
  });
});
