import { describe, expect, it } from 'vitest';

import * as desktop from './index.js';

describe('desktop public API', () => {
  it('exports the Core supervisor boundary', () => {
    expect(desktop).toMatchObject({
      CoreSupervisor: expect.any(Function),
      NodeCoreProcessLauncher: expect.any(Function),
    });
  });
});
