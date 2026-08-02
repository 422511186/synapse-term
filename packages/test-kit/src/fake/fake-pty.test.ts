import { describe, expect, it } from 'vitest';

import { FakePty } from './fake-pty.js';

describe('FakePty', () => {
  it('records control operations and emits scripted data and exit events', () => {
    const pty = new FakePty(123);
    const data: string[] = [];
    const exits: Array<{ exitCode: number; signal?: number | undefined }> = [];
    pty.onData((chunk) => data.push(chunk));
    pty.onExit((event) => exits.push(event));

    pty.write('printf test\r');
    pty.resize(120, 40);
    pty.interrupt();
    pty.terminate();
    pty.emitData('test\r\n');
    pty.emitExit({ exitCode: 0 });

    expect(pty.writes).toEqual(['printf test\r']);
    expect(pty.resizes).toEqual([{ columns: 120, rows: 40 }]);
    expect(pty.interruptCount).toBe(1);
    expect(pty.terminateCount).toBe(1);
    expect(pty.pid).toBe(123);
    expect(data).toEqual(['test\r\n']);
    expect(exits).toEqual([{ exitCode: 0 }]);
  });
});
