import { describe, expect, it, vi } from 'vitest';

import type { ExternalCaller } from '@synapse-term/domain';

import {
  ExternalTransactionLedger,
  type ExternalTransactionEntry,
} from './external-transaction-ledger.js';

const caller: ExternalCaller = { kind: 'mcp', id: 'client-1' };

function entry(overrides: Partial<ExternalTransactionEntry> = {}): ExternalTransactionEntry {
  return {
    kind: 'structured',
    transactionId: 'transaction-1',
    caller,
    status: () => 'running',
    ...overrides,
  };
}

describe('ExternalTransactionLedger', () => {
  it('reports the active entry after opening one', () => {
    const ledger = new ExternalTransactionLedger();
    const opened = entry();

    ledger.open(opened);

    expect(ledger.active).toBe(opened);
  });

  it('starts with no active entry', () => {
    expect(new ExternalTransactionLedger().active).toBeUndefined();
  });

  it('refuses a second entry without disturbing the first', () => {
    const ledger = new ExternalTransactionLedger();
    const first = entry();
    ledger.open(first);

    expect(() => ledger.open(entry({ transactionId: 'transaction-2' }))).toThrow(/transaction-1/);
    expect(ledger.active).toBe(first);
  });

  it('closes only the matching transaction id', () => {
    const ledger = new ExternalTransactionLedger();
    const opened = entry();
    ledger.open(opened);

    expect(ledger.close('transaction-2')).toBe(false);
    expect(ledger.active).toBe(opened);
    expect(ledger.close('transaction-1')).toBe(true);
    expect(ledger.active).toBeUndefined();
  });

  it('treats closing an absent entry as a no-op', () => {
    const ledger = new ExternalTransactionLedger();

    expect(ledger.close('transaction-1')).toBe(false);
    expect(ledger.active).toBeUndefined();
  });

  it('reads the status through the entry instead of copying it', () => {
    const ledger = new ExternalTransactionLedger();
    const status = vi.fn<() => 'running' | 'completed'>(() => 'running');
    ledger.open(entry({ status }));

    expect(ledger.active?.status()).toBe('running');
    status.mockReturnValue('completed');
    expect(ledger.active?.status()).toBe('completed');
    expect(status).toHaveBeenCalledTimes(2);
  });
});
