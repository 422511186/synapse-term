import { describe, expect, it } from 'vitest';

import * as domain from './index.js';

describe('domain public API', () => {
  it('exports the shared domain factories and transition functions', () => {
    expect(domain).toMatchObject({
      createSessionState: expect.any(Function),
      createAgentTask: expect.any(Function),
      createCommandTransaction: expect.any(Function),
      createApprovalGrant: expect.any(Function),
      createProviderProfile: expect.any(Function),
      createAgentConversation: expect.any(Function),
      createAgentTurn: expect.any(Function),
      createModelItem: expect.any(Function),
      createToolCallRecord: expect.any(Function),
    });
  });
});
