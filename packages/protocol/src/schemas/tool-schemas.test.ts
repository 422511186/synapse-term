import { describe, expect, it } from 'vitest';

import {
  localEditFileInputSchema,
  localListFilesInputSchema,
  localReadFileInputSchema,
  localSearchFilesInputSchema,
  localWriteFileInputSchema,
  terminalExecuteInputSchema,
  terminalInterruptInputSchema,
  terminalObserveInputSchema,
  terminalToolCallSchema,
  terminalWaitInputSchema,
} from './tool-schemas.js';

describe('terminal tool schemas', () => {
  it('accepts the four bound-session terminal operations with protocol-safe names', () => {
    expect(
      terminalObserveInputSchema.parse({ view: 'output', afterCursor: 4, maxBytes: 100 }),
    ).toEqual({
      view: 'output',
      afterCursor: 4,
      maxBytes: 100,
    });
    expect(terminalExecuteInputSchema.parse({ command: 'df -h' })).toEqual({ command: 'df -h' });
    expect(terminalWaitInputSchema.parse({ transactionId: 'tx-1' })).toEqual({
      transactionId: 'tx-1',
    });
    expect(terminalInterruptInputSchema.parse({ transactionId: 'tx-1' })).toEqual({
      transactionId: 'tx-1',
    });
    expect(
      terminalToolCallSchema.parse({
        name: 'terminal_observe',
        arguments: { view: 'screen' },
      }),
    ).toMatchObject({ name: 'terminal_observe' });
  });

  it('accepts bounded local file discovery, read, write, and edit operations', () => {
    expect(localListFilesInputSchema.parse({ path: 'project', maxDepth: 2 })).toMatchObject({
      path: 'project',
    });
    expect(
      localSearchFilesInputSchema.parse({
        path: 'project',
        query: 'TODO',
        mode: 'content',
        maxBytes: 1_024,
      }),
    ).toMatchObject({ mode: 'content', maxBytes: 1_024 });
    expect(
      localReadFileInputSchema.parse({ path: 'project/readme.md', startLine: 1 }),
    ).toMatchObject({ path: 'project/readme.md' });
    expect(
      localWriteFileInputSchema.parse({
        path: 'project/new.txt',
        mode: 'create',
        content: 'hello',
      }),
    ).toMatchObject({ mode: 'create' });
    expect(
      localEditFileInputSchema.parse({
        path: 'project/readme.md',
        expectedSha256: 'a'.repeat(64),
        edits: [{ oldText: 'old', newText: 'new' }],
      }),
    ).toMatchObject({ edits: [{ oldText: 'old', newText: 'new' }] });
  });

  it('rejects session switching, unknown fields, and invalid bounds', () => {
    expect(() => terminalExecuteInputSchema.parse({ command: 'ls', sessionId: 'other' })).toThrow();
    expect(() =>
      terminalObserveInputSchema.parse({ view: 'screen', sessionId: 'other' }),
    ).toThrow();
    expect(() =>
      terminalWaitInputSchema.parse({ transactionId: 'tx-1', sessionId: 'other' }),
    ).toThrow();
    expect(() =>
      terminalInterruptInputSchema.parse({ transactionId: 'tx-1', sessionId: 'other' }),
    ).toThrow();
    expect(() => terminalObserveInputSchema.parse({ afterCursor: -1 })).toThrow();
    expect(() =>
      terminalToolCallSchema.parse({ name: 'terminal_send_keys', arguments: {} }),
    ).toThrow();
    expect(() => localReadFileInputSchema.parse({ path: '../secret.txt' })).toThrow();
    expect(() =>
      localSearchFilesInputSchema.parse({
        path: 'project',
        query: 'TODO',
        mode: 'content',
        maxBytes: 128 * 1024 * 1024,
      }),
    ).toThrow();
    expect(() =>
      localReadFileInputSchema.parse({ path: 'project/readme.md', root: 'C:/Users/other' }),
    ).toThrow();
    expect(() =>
      localWriteFileInputSchema.parse({
        path: 'project/readme.md',
        mode: 'replace',
        content: 'new',
      }),
    ).toThrow();
  });
});
