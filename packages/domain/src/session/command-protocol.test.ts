import { describe, expect, it } from 'vitest';

import {
  LITERAL_SHELL_TRANSPORT,
  type CommandAuditErrorCode,
  type CommandTransportMode,
  type ExternalTransactionKind,
  type ExternalTransactionStatus,
  type InputGrantMode,
  type InputKey,
  type InputRequestId,
} from './command-protocol.js';

describe('command protocol', () => {
  it('exposes the literal shell transport and audit error contract', () => {
    const transport: CommandTransportMode = LITERAL_SHELL_TRANSPORT;
    const error: CommandAuditErrorCode = 'COMMAND_NOT_AUDITABLE';

    expect(transport).toBe('literal_shell');
    expect(error).toBe('COMMAND_NOT_AUDITABLE');
  });

  it('exposes the interactive transaction and bounded input vocabulary', () => {
    const kind: ExternalTransactionKind = 'interactive';
    const status: ExternalTransactionStatus = 'running';
    const mode: InputGrantMode = 'bounded';
    const key: InputKey = 'f12';
    const requestId: InputRequestId = 'request-1';

    expect({ kind, status, mode, key, requestId }).toEqual({
      kind: 'interactive',
      status: 'running',
      mode: 'bounded',
      key: 'f12',
      requestId: 'request-1',
    });
  });
});
