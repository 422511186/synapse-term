import { describe, expect, it } from 'vitest';

import { createCommandTransaction, transitionCommandTransaction } from './command-transaction.js';

describe('command transaction state', () => {
  it('starts as a draft bound to one task and session', () => {
    const transaction = createCommandTransaction({
      id: 'transaction-1',
      sessionId: 'session-1',
      taskId: 'task-1',
      command: 'df -h',
      nonce: 'nonce-1',
    });

    expect(transaction).toEqual({
      id: 'transaction-1',
      sessionId: 'session-1',
      taskId: 'task-1',
      command: 'df -h',
      nonce: 'nonce-1',
      status: 'draft',
      revision: 0,
    });
  });

  it('follows the direct read-only path to a deterministic exit code', () => {
    const draft = createCommandTransaction({
      id: 'transaction-1',
      sessionId: 'session-1',
      taskId: 'task-1',
      command: 'df -h',
      nonce: 'nonce-1',
    });

    const policyChecked = transitionCommandTransaction(draft, {
      status: 'policy_checked',
      risk: 'read_only',
    });
    if (!policyChecked.ok) throw new Error('expected policy check');
    const leaseAcquired = transitionCommandTransaction(policyChecked.value, {
      status: 'lease_acquired',
      leaseEpoch: 3,
    });
    if (!leaseAcquired.ok) throw new Error('expected lease acquisition');
    const dispatched = transitionCommandTransaction(leaseAcquired.value, {
      status: 'dispatched',
    });
    if (!dispatched.ok) throw new Error('expected dispatch');
    const running = transitionCommandTransaction(dispatched.value, { status: 'running' });
    if (!running.ok) throw new Error('expected running transaction');

    expect(
      transitionCommandTransaction(running.value, { status: 'completed', exitCode: 0 }),
    ).toEqual({
      ok: true,
      value: {
        ...running.value,
        status: 'completed',
        exitCode: 0,
        revision: 5,
      },
    });
  });

  it('records the exact approval used before acquiring the lease', () => {
    const draft = createCommandTransaction({
      id: 'transaction-1',
      sessionId: 'session-1',
      taskId: 'task-1',
      command: 'systemctl restart api',
      nonce: 'nonce-1',
    });
    const policyChecked = transitionCommandTransaction(draft, {
      status: 'policy_checked',
      risk: 'mutating',
    });
    if (!policyChecked.ok) throw new Error('expected policy check');
    const waiting = transitionCommandTransaction(policyChecked.value, {
      status: 'waiting_approval',
    });
    if (!waiting.ok) throw new Error('expected approval wait');

    expect(
      transitionCommandTransaction(waiting.value, {
        status: 'lease_acquired',
        leaseEpoch: 4,
        approvalGrantId: 'grant-1',
      }),
    ).toMatchObject({
      ok: true,
      value: {
        status: 'lease_acquired',
        risk: 'mutating',
        leaseEpoch: 4,
        approvalGrantId: 'grant-1',
      },
    });
  });

  it('cannot leave approval wait without an approval grant', () => {
    const draft = createCommandTransaction({
      id: 'transaction-1',
      sessionId: 'session-1',
      taskId: 'task-1',
      command: 'systemctl restart api',
      nonce: 'nonce-1',
    });
    const policyChecked = transitionCommandTransaction(draft, {
      status: 'policy_checked',
      risk: 'mutating',
    });
    if (!policyChecked.ok) throw new Error('expected policy check');
    const waiting = transitionCommandTransaction(policyChecked.value, {
      status: 'waiting_approval',
    });
    if (!waiting.ok) throw new Error('expected approval wait');

    expect(
      transitionCommandTransaction(waiting.value, {
        status: 'lease_acquired',
        leaseEpoch: 4,
      }),
    ).toEqual({ ok: false, error: 'approval-required' });
  });

  it('represents every uncertain outcome as an explicit terminal state', () => {
    const draft = createCommandTransaction({
      id: 'transaction-1',
      sessionId: 'session-1',
      taskId: 'task-1',
      command: 'tail -f app.log',
      nonce: 'nonce-1',
    });
    const policyChecked = transitionCommandTransaction(draft, {
      status: 'policy_checked',
      risk: 'read_only',
    });
    if (!policyChecked.ok) throw new Error('expected policy check');
    const leaseAcquired = transitionCommandTransaction(policyChecked.value, {
      status: 'lease_acquired',
      leaseEpoch: 1,
    });
    if (!leaseAcquired.ok) throw new Error('expected lease acquisition');
    const dispatched = transitionCommandTransaction(leaseAcquired.value, {
      status: 'dispatched',
    });
    if (!dispatched.ok) throw new Error('expected dispatch');
    const running = transitionCommandTransaction(dispatched.value, { status: 'running' });
    if (!running.ok) throw new Error('expected running transaction');

    for (const status of [
      'interaction_required',
      'interrupted',
      'shell_lost',
      'protocol_error',
    ] as const) {
      expect(
        transitionCommandTransaction(running.value, {
          status,
          reason: `test-${status}`,
        }),
      ).toMatchObject({
        ok: true,
        value: { status, reason: `test-${status}` },
      });
    }
  });
});
