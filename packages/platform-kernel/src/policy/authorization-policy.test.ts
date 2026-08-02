import { describe, expect, it } from 'vitest';

import { AuthorizationPolicy } from './authorization-policy.js';

describe('AuthorizationPolicy', () => {
  const policy = new AuthorizationPolicy();

  it('requires manual approval for every terminal command, including read-only commands', () => {
    expect(policy.decide({ mode: 'manual', risk: 'mutating', effect: 'mutate' })).toMatchObject({
      requiresApproval: true,
    });
    expect(policy.decide({ mode: 'manual', risk: 'privileged', effect: 'observe' })).toMatchObject({
      requiresApproval: true,
    });
    expect(
      policy.decide({
        mode: 'manual',
        risk: 'read_only',
        effect: 'observe',
        toolKind: 'terminal',
      }),
    ).toMatchObject({
      requiresApproval: true,
    });
  });

  it('auto-approves ordinary mutations but not unknown, privileged, or destructive risk', () => {
    expect(policy.decide({ mode: 'auto', risk: 'mutating', effect: 'mutate' })).toEqual({
      requiresApproval: false,
      authorization: 'automatic',
    });
    for (const risk of ['unknown', 'privileged', 'destructive'] as const) {
      expect(policy.decide({ mode: 'auto', risk, effect: 'mutate' })).toMatchObject({
        requiresApproval: true,
      });
    }
  });

  it('full access removes approval prompts without changing the classified risk', () => {
    expect(policy.decide({ mode: 'full_access', risk: 'destructive', effect: 'mutate' })).toEqual({
      requiresApproval: false,
      authorization: 'full_access',
    });
  });
});
