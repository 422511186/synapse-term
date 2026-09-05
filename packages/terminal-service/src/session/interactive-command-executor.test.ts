import { describe, expect, it, vi } from 'vitest';

import { createFakeTerminalBackend } from '@synapse-term/test-kit';

import { InteractiveCommandExecutor } from './interactive-command-executor.js';
import { SessionActor } from './session-actor.js';

function frame(nonce: string, exitCode = 0): string {
  return `\x1b]777;TA;${nonce};${exitCode}\x07`;
}

function payload(text: string, keys: readonly [] = []) {
  return {
    data: text,
    normalizedText: text,
    textLength: Buffer.byteLength(text, 'utf8'),
    keys,
    payloadBytes: Buffer.byteLength(text, 'utf8'),
  } as const;
}

async function createHarness() {
  const backend = createFakeTerminalBackend();
  const actor = new SessionActor('interactive-session', backend, {
    title: 'test',
    terminalType: 'bash',
  });
  await actor.markPtyRunning();
  await actor.verifyEnvironment('posix', 'unix');
  const executor = new InteractiveCommandExecutor(actor, {
    idFactory: () => 'interactive-transaction',
    nonceFactory: (() => {
      let index = 0;
      return () => `interactive-nonce-${++index}`;
    })(),
    inputGrantIdFactory: () => 'input-grant',
    finishTimeoutMs: 100,
    completionDrainMs: 0,
    completionEchoGraceMs: 0,
    idleTimeoutMs: 1_000,
  });
  return { actor, backend, executor };
}

describe('InteractiveCommandExecutor', () => {
  it('writes a known interactive command without a startup completion Probe', async () => {
    const { actor, backend, executor } = await createHarness();
    const context = actor.snapshot.executionContextId;

    const started = await executor.start({
      command: 'vim notes.txt',
      expectedContextId: context,
      inputGrantMode: 'bounded',
      callerId: 'caller',
    });

    expect(started).toMatchObject({
      status: 'running',
      transaction: { kind: 'interactive', command: 'vim notes.txt' },
      inputGrantId: 'input-grant',
    });
    expect(backend.writes).toEqual(['vim notes.txt\r']);
    expect(backend.writes.join('')).not.toContain('777;TA;');
    expect(started.executionContextId).not.toBe(context);

    await executor.clear();
    actor.dispose();
  });

  it('deduplicates transactional input and enforces one-shot quota', async () => {
    const { actor, backend, executor } = await createHarness();
    const started = await executor.start({
      command: 'sudo su -',
      expectedContextId: actor.snapshot.executionContextId,
      inputGrantMode: 'one_shot',
      callerId: 'caller',
    });

    const request = {
      transactionId: started.transaction.id,
      inputGrantId: 'input-grant',
      inputRequestId: 'request-1',
      payload: payload('password\r'),
      callerId: 'caller',
    } as const;
    const first = await executor.input(request);
    const retry = await executor.input(request);

    expect(backend.writes).toEqual(['sudo su -\r', 'password\r']);
    expect(first.sent).toEqual({ textLength: 9, keys: [], payloadBytes: 9 });
    expect(retry.sent).toEqual(first.sent);
    await expect(executor.input({ ...request, inputRequestId: 'request-2' })).rejects.toThrow(
      /^INPUT_GRANT_EXHAUSTED:/,
    );

    await executor.clear();
    actor.dispose();
  });

  it('sends the completion Probe only when finish is requested', async () => {
    const { actor, backend, executor } = await createHarness();
    const started = await executor.start({
      command: 'vim notes.txt',
      expectedContextId: actor.snapshot.executionContextId,
      inputGrantMode: 'bounded',
      callerId: 'caller',
    });
    const wait = executor.wait({ transactionId: started.transaction.id, timeoutMs: 0 });
    await expect(wait).resolves.toMatchObject({ status: 'running' });
    expect(backend.writes).toEqual(['vim notes.txt\r']);

    const finishing = executor.finish({
      transactionId: started.transaction.id,
      observedCursor: started.nextCursor,
      callerId: 'caller',
    });
    await vi.waitFor(() => expect(backend.writes.join('')).toContain('777;TA;'), {
      timeout: 1_000,
    });
    const finishProbe = backend.writes[1]!;
    expect(finishProbe).toContain('interactive-nonce-2');
    backend.emitData(frame('interactive-nonce-2', 0));

    await expect(finishing).resolves.toMatchObject({
      status: 'completed',
      transaction: { kind: 'interactive', exitCode: 0 },
    });
    expect(backend.writes).toHaveLength(2);

    await executor.clear();
    actor.dispose();
  });

  it('marks a premature finish unknown when its Probe is consumed or times out', async () => {
    const { actor, backend, executor } = await createHarness();
    const started = await executor.start({
      command: 'vim notes.txt',
      expectedContextId: actor.snapshot.executionContextId,
      inputGrantMode: 'bounded',
      callerId: 'caller',
    });
    const finishing = executor.finish({
      transactionId: started.transaction.id,
      observedCursor: started.nextCursor,
      callerId: 'caller',
    });

    await expect(finishing).resolves.toMatchObject({
      status: 'unknown',
      retryable: false,
      safeToResubmit: false,
    });
    expect(backend.writes).toHaveLength(2);
    actor.dispose();
  });

  it('makes local user input settle an interactive transaction as unknown', async () => {
    const { actor, backend, executor } = await createHarness();
    const started = await executor.start({
      command: 'bash -i',
      expectedContextId: actor.snapshot.executionContextId,
      inputGrantMode: 'bounded',
      callerId: 'caller',
    });

    await actor.writeUser('local input\r');
    await vi.waitFor(() => expect(executor.get(started.transaction.id)?.status).toBe('unknown'));
    await expect(
      executor.input({
        transactionId: started.transaction.id,
        inputGrantId: 'input-grant',
        inputRequestId: 'after-user-input',
        payload: payload('must-not-write\r'),
        callerId: 'caller',
      }),
    ).rejects.toThrow(/TRANSACTION_NOT_FOUND|SESSION_BUSY|INPUT_GRANT_EXHAUSTED/);
    expect(backend.writes).toEqual(['bash -i\r', 'local input\r']);
    actor.dispose();
  });

  it('does not expose a transaction when startup write delivery is unknown', async () => {
    const { actor, backend, executor } = await createHarness();
    backend.write = () => {
      throw new Error('write failed after dispatch began');
    };
    const context = actor.snapshot.executionContextId;

    await expect(
      executor.start({
        command: 'sudo su -',
        expectedContextId: context,
        inputGrantMode: 'bounded',
        callerId: 'caller',
      }),
    ).rejects.toThrow(/^INTERACTIVE_START_WRITE_UNKNOWN:/);
    expect(executor.activeTransactionId).toBeUndefined();
    expect(actor.snapshot.executionContextId).not.toBe(context);
    expect(actor.snapshot.environment.verificationStatus).toBe('unverified');
    expect(backend.writes).toEqual([]);
    actor.dispose();
  });

  it('rejects input and interrupt while finish owns the PTY write boundary', async () => {
    const { actor, backend, executor } = await createHarness();
    const started = await executor.start({
      command: 'vim notes.txt',
      expectedContextId: actor.snapshot.executionContextId,
      inputGrantMode: 'bounded',
      callerId: 'caller',
    });
    const finishing = executor.finish({
      transactionId: started.transaction.id,
      observedCursor: started.nextCursor,
      callerId: 'caller',
    });

    await expect(
      executor.input({
        transactionId: started.transaction.id,
        inputGrantId: 'input-grant',
        inputRequestId: 'during-finish',
        payload: payload('must-not-land\r'),
        callerId: 'caller',
      }),
    ).rejects.toThrow(/^SESSION_BUSY:/);
    await expect(executor.interrupt(started.transaction.id, 'caller')).rejects.toThrow(
      /^SESSION_BUSY:/,
    );
    expect(backend.writes).toHaveLength(2);

    const finishProbe = backend.writes[1]!;
    const nonce = /'([A-Za-z0-9-]+)'/.exec(finishProbe)?.[1];
    expect(nonce).toBeDefined();
    backend.emitData(frame(nonce!));
    await expect(finishing).resolves.toMatchObject({ status: 'completed' });
    actor.dispose();
  });

  it('marks the transaction unknown when the PTY exits before finish evidence', async () => {
    const { actor, backend, executor } = await createHarness();
    const started = await executor.start({
      command: 'bash -i',
      expectedContextId: actor.snapshot.executionContextId,
      inputGrantMode: 'bounded',
      callerId: 'caller',
    });

    backend.emitExit(1);
    await vi.waitFor(() => expect(executor.get(started.transaction.id)?.status).toBe('unknown'));
    await expect(executor.wait({ transactionId: started.transaction.id })).resolves.toMatchObject({
      status: 'unknown',
      retryable: false,
      safeToResubmit: false,
    });
    expect(backend.writes).toEqual(['bash -i\r']);
    actor.dispose();
  });

  it('does not send an interrupt after queued local input invalidates the environment', async () => {
    const { actor, backend, executor } = await createHarness();
    const started = await executor.start({
      command: 'bash -i',
      expectedContextId: actor.snapshot.executionContextId,
      inputGrantMode: 'bounded',
      callerId: 'caller',
    });

    const localInput = actor.writeUser('local input\r');
    const interrupt = executor.interrupt(started.transaction.id, 'caller');
    await localInput;

    await expect(interrupt).resolves.toBe(true);
    await expect(executor.wait({ transactionId: started.transaction.id })).resolves.toMatchObject({
      status: 'unknown',
    });
    expect(backend.interrupted).toBe(0);
    expect(backend.writes).toEqual(['bash -i\r', 'local input\r']);
    actor.dispose();
  });

  it('marks transactional input unknown on an uncertain backend write and never retries it', async () => {
    const { actor, backend, executor } = await createHarness();
    const started = await executor.start({
      command: 'sudo su -',
      expectedContextId: actor.snapshot.executionContextId,
      inputGrantMode: 'bounded',
      callerId: 'caller',
    });
    let inputAttempts = 0;
    backend.write = (data: string) => {
      backend.writes.push(data);
      if (data === 'secret\r') {
        inputAttempts += 1;
        throw new Error('write failed after a possible partial delivery');
      }
    };

    const request = {
      transactionId: started.transaction.id,
      inputGrantId: 'input-grant',
      inputRequestId: 'uncertain-input',
      payload: payload('secret\r'),
      callerId: 'caller',
    } as const;
    await expect(executor.input(request)).rejects.toThrow(/^INPUT_WRITE_UNKNOWN:/);
    await expect(executor.input(request)).rejects.toThrow(/^INPUT_WRITE_UNKNOWN:/);
    await expect(executor.input({ ...request, inputRequestId: 'new-request' })).rejects.toThrow(
      /TRANSACTION_NOT_FOUND|INPUT_GRANT_EXHAUSTED/,
    );
    expect(inputAttempts).toBe(1);
    expect(backend.writes).toEqual(['sudo su -\r', 'secret\r']);
    actor.dispose();
  });

  it('replays a completed request after the grant and transaction have been revoked', async () => {
    const { actor, backend, executor } = await createHarness();
    const started = await executor.start({
      command: 'vim notes.txt',
      expectedContextId: actor.snapshot.executionContextId,
      inputGrantMode: 'one_shot',
      callerId: 'caller',
    });
    const request = {
      transactionId: started.transaction.id,
      inputGrantId: 'input-grant',
      inputRequestId: 'replay-after-finish',
      payload: payload(':wq\r'),
      callerId: 'caller',
    } as const;
    const first = await executor.input(request);
    const finishing = executor.finish({
      transactionId: started.transaction.id,
      observedCursor: first.nextCursor,
      callerId: 'caller',
    });
    const finishProbe = await vi.waitFor(() => {
      const write = backend.writes.at(-1);
      if (write === undefined || !write.includes('777;TA;')) throw new Error('finish not written');
      return write;
    });
    const nonce = /'([A-Za-z0-9-]+)'/.exec(finishProbe)?.[1];
    backend.emitData(frame(nonce!));
    await expect(finishing).resolves.toMatchObject({ status: 'completed' });

    const replay = await executor.input(request);
    expect(replay.sent).toEqual(first.sent);
    expect(replay.output.text).toBe('');
    expect(backend.writes).toHaveLength(3);
    actor.dispose();
  });

  it('expires a bounded grant after its idle timeout', async () => {
    vi.useFakeTimers();
    try {
      const { actor, backend, executor } = await createHarness();
      const started = await executor.start({
        command: 'bash -i',
        expectedContextId: actor.snapshot.executionContextId,
        inputGrantMode: 'bounded',
        callerId: 'caller',
      });

      await vi.advanceTimersByTimeAsync(1_000);
      await expect(
        executor.wait({ transactionId: started.transaction.id, timeoutMs: 0 }),
      ).resolves.toMatchObject({
        status: 'unknown',
        retryable: false,
      });
      await expect(
        executor.input({
          transactionId: started.transaction.id,
          inputGrantId: 'input-grant',
          inputRequestId: 'after-idle',
          payload: payload('late\r'),
          callerId: 'caller',
        }),
      ).rejects.toThrow(/TRANSACTION_NOT_FOUND|INPUT_GRANT_EXHAUSTED/);
      expect(backend.writes).toEqual(['bash -i\r']);
      actor.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('enforces bounded call and byte quotas before writing a new payload', async () => {
    const { actor, backend, executor } = await createHarness();
    const started = await executor.start({
      command: 'bash -i',
      expectedContextId: actor.snapshot.executionContextId,
      inputGrantMode: 'bounded',
      callerId: 'caller',
    });
    const small = payload('x\r');
    for (let index = 0; index < 256; index += 1) {
      await executor.input({
        transactionId: started.transaction.id,
        inputGrantId: 'input-grant',
        inputRequestId: `quota-${index}`,
        payload: small,
        callerId: 'caller',
      });
    }
    await expect(
      executor.input({
        transactionId: started.transaction.id,
        inputGrantId: 'input-grant',
        inputRequestId: 'quota-overflow',
        payload: small,
        callerId: 'caller',
      }),
    ).rejects.toThrow(/^INPUT_GRANT_EXHAUSTED:/);
    expect(backend.writes).toHaveLength(257);
    actor.dispose();
  });
});
