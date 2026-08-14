import { describe, expect, it } from 'vitest';

import { createFakeTerminalBackend } from './index.js';

describe('test-kit', () => {
  it('creates a controllable fake terminal backend', () => {
    const backend = createFakeTerminalBackend();
    let received = '';
    backend.onData((data) => {
      received += data;
    });
    backend.emitData('hello');
    expect(received).toBe('hello');
    backend.write('x');
    expect(backend.writes).toEqual(['x']);
  });
});
