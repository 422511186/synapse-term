import { describe, expect, it } from 'vitest';

import { ExternalLeaseError, ExternalLeaseRegistry } from './external-lease.js';

describe('ExternalLeaseRegistry', () => {
  it('grants a JIT lease per session and rejects another caller with SESSION_BUSY', () => {
    const registry = new ExternalLeaseRegistry();
    expect(registry.acquire('session', 'caller-a')).toEqual({ sessionId: 'session', epoch: 1 });

    expect(() => registry.acquire('session', 'caller-b')).toThrow(ExternalLeaseError);
    expect(() => registry.acquire('session', 'caller-b')).toThrow(/SESSION_BUSY/);
  });

  it('allows repeated acquisition by the same caller and release enables the next caller', () => {
    const registry = new ExternalLeaseRegistry();
    const first = registry.acquire('session', 'caller');
    const second = registry.acquire('session', 'caller');
    expect(second.epoch).toBe(first.epoch);

    registry.release('session', 'other-caller');
    expect(registry.owner('session')?.id).toBe('caller');

    registry.release('session', 'caller');
    expect(registry.owner('session')).toBeUndefined();
    expect(registry.acquire('session', 'next').epoch).toBeGreaterThan(first.epoch);
  });

  it('clears one session without touching others', () => {
    const registry = new ExternalLeaseRegistry();
    registry.acquire('one', 'caller');
    registry.acquire('two', 'caller');
    registry.clear('one');

    expect(registry.owner('one')).toBeUndefined();
    expect(registry.owner('two')).toBeDefined();
  });

  it('keeps an outer interactive lease while nested input handles are released', () => {
    const registry = new ExternalLeaseRegistry();
    const outer = registry.acquireHandle('session', 'caller');
    const nested = registry.acquireHandle('session', 'caller');

    nested.release();
    expect(registry.owner('session')?.id).toBe('caller');
    expect(outer.released).toBe(false);

    outer.release();
    expect(registry.owner('session')).toBeUndefined();
    outer.release();
    nested.release();
  });
});
