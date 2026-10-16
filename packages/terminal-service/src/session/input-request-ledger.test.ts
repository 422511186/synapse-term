import { describe, expect, it } from 'vitest';

import type { ExternalCaller } from '@synapse-term/domain';

import {
  InputRequestLedger,
  matchesInputRequestFingerprint,
  type InputRequestFingerprint,
  type InputRequestRecord,
} from './input-request-ledger.js';

const caller: ExternalCaller = { kind: 'mcp', id: 'client-1' };
const otherId: ExternalCaller = { kind: 'mcp', id: 'client-2' };

function record(overrides: Partial<InputRequestRecord> = {}): InputRequestRecord {
  return {
    mode: 'transactional',
    transactionId: 'transaction-1',
    grantId: 'grant-1',
    payloadHash: 'hash-1',
    promise: Promise.resolve('sent'),
    ...overrides,
  };
}

describe('InputRequestLedger', () => {
  it('locates a registered request by caller and request id', () => {
    const ledger = new InputRequestLedger();
    const registered = record();

    ledger.register(caller, 'request-1', registered);

    expect(ledger.locate(caller, 'request-1')).toBe(registered);
    expect(ledger.locate(caller, 'request-2')).toBeUndefined();
  });

  // 键按设计含 `caller.kind`，但 `ExternalCallerKind` 目前只有 `mcp` 一个成员，因此这里只
  // 覆盖 id 维度。kind 维度在出现第二条接入线之前不可观测，不虚构类型来假造覆盖。
  it('keeps callers apart by id', () => {
    const ledger = new InputRequestLedger();
    ledger.register(caller, 'request-1', record());

    expect(ledger.locate(otherId, 'request-1')).toBeUndefined();
    expect(ledger.locate(caller, 'request-1')).toBeDefined();
  });

  it('refuses to overwrite an occupied request id', () => {
    const ledger = new InputRequestLedger();
    ledger.register(caller, 'request-1', record());

    expect(() => ledger.register(caller, 'request-1', record({ payloadHash: 'hash-2' }))).toThrow(
      /request-1/,
    );
    expect(ledger.locate(caller, 'request-1')?.payloadHash).toBe('hash-1');
  });

  // 收敛前执行器的键在调用方身份缺省时退化成空串，因此无身份请求共用一个桶。这条语义被保留。
  it('shares one bucket among callers without an identity', () => {
    const ledger = new InputRequestLedger();
    const anonymous = record();

    ledger.register(undefined, 'request-1', anonymous);

    expect(ledger.locate(undefined, 'request-1')).toBe(anonymous);
    expect(ledger.locate(caller, 'request-1')).toBeUndefined();
  });

  it('drops every record on clear', () => {
    const ledger = new InputRequestLedger();
    ledger.register(caller, 'request-1', record());
    ledger.register(caller, 'request-2', record());

    ledger.clear();

    expect(ledger.locate(caller, 'request-1')).toBeUndefined();
    expect(ledger.locate(caller, 'request-2')).toBeUndefined();
  });
});

describe('matchesInputRequestFingerprint', () => {
  const wanted: InputRequestFingerprint = {
    mode: 'transactional',
    transactionId: 'transaction-1',
    grantId: 'grant-1',
    payloadHash: 'hash-1',
  };
  const base = record();

  it('matches when mode, transaction, grant and payload digest all agree', () => {
    expect(matchesInputRequestFingerprint(base, wanted)).toBe(true);
  });

  const differences: Array<[string, Partial<InputRequestFingerprint>]> = [
    ['mode', { mode: 'free' }],
    ['transaction', { transactionId: 'transaction-2' }],
    ['grant', { grantId: 'grant-2' }],
    ['payload digest', { payloadHash: 'hash-2' }],
  ];

  it.each(differences)('rejects a differing %s', (_label, difference) => {
    expect(matchesInputRequestFingerprint(base, { ...wanted, ...difference })).toBe(false);
  });

  it('treats the absent transaction and grant of free input as equal', () => {
    const free = record({ mode: 'free', transactionId: undefined, grantId: undefined });

    expect(
      matchesInputRequestFingerprint(free, {
        mode: 'free',
        transactionId: undefined,
        grantId: undefined,
        payloadHash: 'hash-1',
      }),
    ).toBe(true);
    expect(
      matchesInputRequestFingerprint(free, {
        mode: 'free',
        transactionId: undefined,
        grantId: 'grant-1',
        payloadHash: 'hash-1',
      }),
    ).toBe(false);
  });
});
