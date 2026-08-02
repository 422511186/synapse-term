import { describe, expect, it } from 'vitest';

import { createProviderProfile, updateProviderProfile } from './provider-profile.js';

describe('provider profile', () => {
  it('stores only reusable connection settings', () => {
    const profile = createProviderProfile({
      id: 'provider-1',
      name: 'Provider 1',
      protocol: 'openai_chat_completions',
      baseUrl: 'https://example.test/v1',
      credentialRef: 'provider:provider-1',
      extraHeaders: { 'X-Tenant': 'ops' },
      timeoutMs: 30_000,
    });

    expect(profile).toEqual({
      id: 'provider-1',
      name: 'Provider 1',
      protocol: 'openai_chat_completions',
      baseUrl: 'https://example.test/v1',
      credentialRef: 'provider:provider-1',
      extraHeaders: { 'X-Tenant': 'ops' },
      timeoutMs: 30_000,
      revision: 0,
    });
  });

  it('increments its revision when connection settings change', () => {
    const profile = createProviderProfile({
      id: 'provider-1',
      name: 'Provider 1',
      protocol: 'openai_responses',
      baseUrl: 'https://api.example.test/v1',
      credentialRef: 'provider:provider-1',
      extraHeaders: {},
      timeoutMs: 30_000,
    });

    expect(updateProviderProfile(profile, { timeoutMs: 45_000 })).toMatchObject({
      timeoutMs: 45_000,
      revision: 1,
    });
  });
});
