import { describe, expect, it } from 'vitest';

import {
  LITERAL_SHELL_TRANSPORT,
  type CommandAuditErrorCode,
  type CommandTransportMode,
} from './command-protocol.js';

describe('command protocol', () => {
  it('exposes the literal shell transport and audit error contract', () => {
    const transport: CommandTransportMode = LITERAL_SHELL_TRANSPORT;
    const error: CommandAuditErrorCode = 'COMMAND_NOT_AUDITABLE';

    expect(transport).toBe('literal_shell');
    expect(error).toBe('COMMAND_NOT_AUDITABLE');
  });
});
