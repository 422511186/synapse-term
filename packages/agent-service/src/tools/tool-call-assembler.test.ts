import { describe, expect, it } from 'vitest';

import { ToolCallAssembler } from './tool-call-assembler.js';

describe('ToolCallAssembler', () => {
  it('assembles incremental arguments and validates complete JSON', () => {
    const assembler = new ToolCallAssembler();
    assembler.accept({ type: 'tool_call_started', id: 'call-1', name: 'terminal_execute' });
    assembler.accept({ type: 'tool_call_delta', id: 'call-1', delta: '{"command":' });
    assembler.accept({ type: 'tool_call_delta', id: 'call-1', delta: '"df -h"}' });

    expect(
      assembler.accept({
        type: 'tool_call_completed',
        id: 'call-1',
        name: 'terminal_execute',
        argumentsJson: '{"command":"df -h"}',
      }),
    ).toEqual({ id: 'call-1', name: 'terminal_execute', arguments: { command: 'df -h' } });
  });

  it('rejects duplicate ids, mismatched names, and malformed arguments', () => {
    const assembler = new ToolCallAssembler();
    assembler.accept({ type: 'tool_call_started', id: 'call-1', name: 'terminal_execute' });
    expect(() =>
      assembler.accept({ type: 'tool_call_started', id: 'call-1', name: 'terminal_wait' }),
    ).toThrow();
    expect(() =>
      assembler.accept({
        type: 'tool_call_completed',
        id: 'call-1',
        name: 'terminal_wait',
        argumentsJson: '{}',
      }),
    ).toThrow();
  });
});
