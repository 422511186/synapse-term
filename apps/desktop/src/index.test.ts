import { describe, expect, it } from 'vitest';

import * as desktop from './index.js';

describe('desktop public API', () => {
  it('exports the preload contract without exposing Main runtime implementation', () => {
    expect(desktop).toMatchObject({
      createDesktopApi: expect.any(Function),
    });
    expect('TerminalHost' in desktop).toBe(false);
  });
});
