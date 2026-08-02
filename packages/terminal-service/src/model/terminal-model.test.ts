import { describe, expect, it } from 'vitest';

import { TerminalModel } from './terminal-model.js';

describe('TerminalModel', () => {
  it('processes output, serializes a snapshot, and dispatches OSC handlers', async () => {
    const model = new TerminalModel({ columns: 20, rows: 5, scrollback: 10 });
    const osc: string[] = [];
    model.registerOscHandler(777, (payload) => osc.push(payload));

    await model.write('hello\r\n');
    await model.write('\u001b]777;TA;nonce-1;0\u0007');

    expect(model.serialize()).toContain('hello');
    expect(osc).toEqual(['TA;nonce-1;0']);
    expect(model.bufferLength).toBeLessThanOrEqual(15);
    model.dispose();
  });
});
