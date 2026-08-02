import { describe, expect, it } from 'vitest';

import * as testKit from './index.js';

describe('test-kit public API', () => {
  it('exports deterministic test doubles and assertions', () => {
    expect(testKit).toMatchObject({
      FakeClock: expect.any(Function),
      FakePty: expect.any(Function),
      FakeProvider: expect.any(Function),
      EventRecorder: expect.any(Function),
      withTemporaryDirectory: expect.any(Function),
    });
  });
});
