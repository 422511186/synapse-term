import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  buildPosixCommand,
  parseCompletionMarker,
  parseCompletionFrame,
  parseCompletionPayload,
  shellSingleQuote,
} from './command-protocol.js';

describe('command protocol', () => {
  it('quotes arbitrary POSIX text as one shell literal', () => {
    expect(shellSingleQuote("a'b\nnext line")).toBe("'a'\\''b\nnext line'");
  });

  it('builds a plaintext wrapper that preserves the original command and transaction nonce', () => {
    const wrapped = buildPosixCommand("cd '/tmp/agent test'", 'nonce-123');

    // Original command is visible in plaintext
    expect(wrapped).toContain("cd '/tmp/agent test'");
    // Uses brace group, not eval
    expect(wrapped).toContain('{');
    expect(wrapped).toContain('}');
    // No eval or variable indirection
    expect(wrapped).not.toContain('eval');
    expect(wrapped).not.toContain('__ta_command=');
    // Contains nonce and completion markers
    expect(wrapped).toContain('nonce-123');
    expect(wrapped).toContain('777;TA;');
    // START marker is split to prevent premature detection by session-actor
    expect(wrapped).toContain("'__TA_'");
    expect(wrapped).toContain("'START__'");
    expect(wrapped).toContain('__TA_DONE_');
  });

  it('builds the same wrapper for the same arbitrary command and nonce', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'binary', maxLength: 256 }).filter((value) => !value.includes('\0')),
        fc.uuid(),
        (command, nonce) => {
          expect(buildPosixCommand(command, nonce)).toBe(buildPosixCommand(command, nonce));
        },
      ),
      {
        examples: [
          ["printf '%s\\n' \"a'b\"\nprintf '你好🙂\\n'", '00000000-0000-1000-8000-000000000000'],
        ],
      },
    );
  });

  it('parses a complete OSC frame and ignores unrelated output', () => {
    expect(parseCompletionFrame('before\u001b]777;TA;nonce-123;7\u0007after')).toEqual({
      nonce: 'nonce-123',
      exitCode: 7,
    });
    expect(parseCompletionFrame('plain output')).toBeNull();
  });

  it('parses the payload delivered by an xterm OSC 777 handler', () => {
    expect(parseCompletionPayload('TA;probe-nonce;0')).toEqual({
      nonce: 'probe-nonce',
      exitCode: 0,
    });
    expect(parseCompletionPayload('other;probe-nonce;0')).toBeNull();
  });

  it('parses the printable completion marker used when ConPTY drops private OSC', () => {
    expect(parseCompletionMarker('__TA_DONE_nonce-1;9__')).toEqual({
      nonce: 'nonce-1',
      exitCode: 9,
    });
    expect(parseCompletionMarker('__TA_DONE_bad;value__')).toBeNull();
  });

  it('returns null for a malformed completion frame', () => {
    expect(parseCompletionFrame('\u001b]777;TA;nonce;not-a-number\u0007')).toBeNull();
  });

  it('preserves arbitrary protocol nonces and exit codes when parsing completion frames', () => {
    fc.assert(
      fc.property(fc.uuid(), fc.integer(), (nonce, exitCode) => {
        expect(
          parseCompletionFrame(`prefix\u001b]777;TA;${nonce};${exitCode}\u0007suffix`),
        ).toEqual({
          nonce,
          exitCode,
        });
      }),
    );
  });
});
