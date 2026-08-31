import { describe, expect, it } from 'vitest';

import {
  createExternalCaller,
  createSessionState,
  higherRisk,
  hashCommand,
  isSessionShared,
  markSessionShared,
  normalizeMcpApprovalMode,
  parseCompletionPayload,
  shellSingleQuote,
} from '../index.js';
import { clearSessionShared } from '../session/shared-session.js';

describe('external caller', () => {
  it('creates mcp caller identity', () => {
    const caller = createExternalCaller('mcp', 'mcp-client', 'MCP 外部客户端');
    expect(caller).toEqual({
      kind: 'mcp',
      id: 'mcp-client',
      displayName: 'MCP 外部客户端',
    });
  });
});

describe('shared session marker', () => {
  it('marks and detects sharing without mutating original state', () => {
    const state = createSessionState({ id: 's1', title: 't', terminalType: 'bash' });
    expect(isSessionShared(state)).toBe(false);
    const shared = markSessionShared(state, '2026-08-24T00:00:00Z');
    expect(isSessionShared(shared)).toBe(true);
    expect(state.sharedAt).toBeUndefined();
  });

  it('unshared state reports not shared', () => {
    const shared = markSessionShared(
      createSessionState({ id: 's1', title: 't', terminalType: 'bash' }),
      'x',
    );
    const unshared = clearSessionShared(shared);
    expect(isSessionShared(unshared)).toBe(false);
  });
});

describe('command risk ordering', () => {
  it('ranks destructive above unknown and read_only lowest', () => {
    expect(higherRisk('read_only', 'destructive')).toBe('destructive');
    expect(higherRisk('unknown', 'mutating')).toBe('mutating');
    expect(higherRisk('privileged', 'unknown')).toBe('privileged');
    expect(higherRisk('read_only', 'read_only')).toBe('read_only');
  });
});

describe('completion frame protocol', () => {
  it('round-trips nonce and exit code through single quoting', () => {
    const nonce = 'abc-123';
    const quoted = shellSingleQuote(nonce);
    expect(quoted).toBe(`'${nonce}'`);
    const payload = `TA;${nonce};0`;
    expect(parseCompletionPayload(payload)).toEqual({ nonce, exitCode: 0 });
  });

  it('rejects malformed payloads', () => {
    expect(parseCompletionPayload('XX;abc;0')).toBeNull();
    expect(parseCompletionPayload('TA;nonsense')).toBeNull();
    expect(parseCompletionPayload('TA;abc;notanumber')).toBeNull();
  });
});

describe('command hashing and approval modes', () => {
  it('hashes command with sha256 prefix', () => {
    expect(hashCommand('npm test')).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('normalizes approval mode whitelist', () => {
    expect(normalizeMcpApprovalMode('managed')).toBe('managed');
    expect(normalizeMcpApprovalMode('full')).toBe('full');
    expect(normalizeMcpApprovalMode('read_only')).toBe('read_only');
    expect(normalizeMcpApprovalMode('bogus')).toBe('read_only');
    expect(normalizeMcpApprovalMode(undefined)).toBe('read_only');
  });
});
