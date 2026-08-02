import { describe, expect, it } from 'vitest';

import * as protocol from './index.js';

describe('protocol public API', () => {
  it('exports schemas, versions, errors, and envelopes', () => {
    expect(protocol).toMatchObject({
      sessionStateSchema: expect.any(Object),
      agentTaskSchema: expect.any(Object),
      commandTransactionSchema: expect.any(Object),
      approvalGrantSchema: expect.any(Object),
      providerProfileSchema: expect.any(Object),
      modelConfigurationSchema: expect.any(Object),
      errorCodeSchema: expect.any(Object),
      protocolErrorSchema: expect.any(Object),
      protocolVersionSchema: expect.any(Object),
      CURRENT_PROTOCOL_VERSION: { major: 2, minor: 0 },
      controlEnvelopeSchema: expect.any(Object),
      FrameDecoder: expect.any(Function),
      encodeControlFrame: expect.any(Function),
      encodeTerminalOutputFrame: expect.any(Function),
      handshakeMessageSchema: expect.any(Object),
      ServerHandshake: expect.any(Function),
      CorrelationTracker: expect.any(Function),
      coreRequestSchema: expect.any(Object),
      parseCoreRequest: expect.any(Function),
    });
  });
});
