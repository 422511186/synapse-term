import { describe, expect, it } from 'vitest';

import type { ExternalCaller } from '@synapse-term/domain';
import { createFakeTerminalBackend } from '@synapse-term/test-kit';

import { CommandExecutor } from './command-executor.js';
import { InteractiveCommandExecutor } from './interactive-command-executor.js';
import { SessionActor } from './session-actor.js';

const contractCaller: ExternalCaller = { kind: 'mcp', id: 'caller' };

/**
 * 外部写入前提失败对外的稳定错误码基线。
 *
 * 结构收敛（tasks 第 1 组）不得改变这里的任何断言；结构化执行的写入抛错语义由第 2 组单独改判，
 * 因此本文件不覆盖「写入尝试已发起但交付不确定」那条路径。
 */

async function createActor() {
  const backend = createFakeTerminalBackend();
  const actor = new SessionActor('contract-session', backend, {
    title: 'contract',
    terminalType: 'bash',
  });
  await actor.markPtyRunning();
  await actor.verifyEnvironment('posix', 'unix');
  return { actor, backend };
}

function createStructuredExecutor(actor: SessionActor): CommandExecutor {
  return new CommandExecutor(actor, { observationWindowMs: 5 });
}

function createInteractiveExecutor(actor: SessionActor): InteractiveCommandExecutor {
  let nonce = 0;
  return new InteractiveCommandExecutor(actor, {
    idFactory: () => 'contract-transaction',
    nonceFactory: () => `contract-nonce-${++nonce}`,
    inputGrantIdFactory: () => 'contract-grant',
    finishTimeoutMs: 100,
    completionDrainMs: 0,
    completionEchoGraceMs: 0,
    idleTimeoutMs: 1_000,
  });
}

function payload(text: string) {
  return {
    data: text,
    normalizedText: text,
    textLength: Buffer.byteLength(text, 'utf8'),
    keys: [] as const,
    payloadBytes: Buffer.byteLength(text, 'utf8'),
  };
}

/** 把拒绝收敛为值，避免未处理的拒绝被 Vitest 记为用例失败。 */
function rejectionOf<T>(promise: Promise<T>): Promise<Error> {
  return promise.then(
    () => {
      throw new Error('expected the external write to be rejected');
    },
    (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
  );
}

/** 写入会轮换 executionContextId，但不改 environment 与 capability epoch。 */
function rotateContext(actor: SessionActor): Promise<unknown> {
  const snapshot = actor.snapshot;
  return actor.writeExternal({
    data: 'printf unrelated\r',
    premise: {
      precondition: 'environment-and-context',
      environmentEpoch: snapshot.environment.capabilityEpoch,
      executionContextId: snapshot.executionContextId,
    },
  });
}

/**
 * CommandExecutor.execute 在调用时同步读取 SessionActor 快照，因此「先排队一个改变前提的 actor 操作，
 * 再调用 execute」可以稳定构造出「执行前检查通过、写入时前提已变」的窗口。
 */
async function structuredWriteAfter(
  actor: SessionActor,
  pending: Promise<unknown>,
  command = 'printf ok',
): Promise<Error> {
  const expectedContextId = actor.snapshot.executionContextId;
  const executor = createStructuredExecutor(actor);
  const rejection = rejectionOf(executor.execute({ command, expectedContextId }));
  await pending;
  return rejection;
}

/**
 * InteractiveCommandExecutor.start 是队列化的，快照读取发生在自己的队列任务里，
 * 因此必须「先调用 start，再排队改变前提的 actor 操作」，写入任务才会排在前提变化之后。
 */
async function interactiveStartAfter(
  actor: SessionActor,
  pending: () => Promise<unknown>,
): Promise<Error> {
  const executor = createInteractiveExecutor(actor);
  const expectedContextId = actor.snapshot.executionContextId;
  const rejection = rejectionOf(
    executor.start({
      command: 'vim notes.txt',
      expectedContextId,
      inputGrantMode: 'bounded',
      caller: contractCaller,
    }),
  );
  await pending();
  return rejection;
}

describe('结构化执行前提失败的外部错误码', () => {
  it('environment 在写入前失效时以 SESSION_NOT_READY 拒绝且不写入命令', async () => {
    const { actor, backend } = await createActor();

    const error = await structuredWriteAfter(actor, actor.writeUser('typed\r'));

    expect(error.message).toMatch(/^SESSION_NOT_READY:/);
    expect(backend.writes).toEqual(['typed\r']);
    actor.dispose();
  });

  it('capability epoch 在写入前变化时以 SESSION_NOT_READY 拒绝且不写入命令', async () => {
    const { actor, backend } = await createActor();

    const error = await structuredWriteAfter(
      actor,
      // 再验证保持 environment 已验证，但递增 capability epoch。
      actor.verifyEnvironment('posix', 'unix'),
    );

    expect(error.message).toMatch(/^SESSION_NOT_READY:/);
    expect(backend.writes).toEqual([]);
    actor.dispose();
  });

  it('executionContextId 在写入前轮换时以 EXECUTION_CONTEXT_STALE 拒绝且不写入命令', async () => {
    const { actor, backend } = await createActor();

    const error = await structuredWriteAfter(actor, rotateContext(actor));

    expect(error.message).toMatch(/^EXECUTION_CONTEXT_STALE:/);
    expect(backend.writes).toEqual(['printf unrelated\r']);
    actor.dispose();
  });

  it('写入前失败与写入不确定态互不混淆，且不失效 environment', async () => {
    const { actor, backend } = await createActor();
    const before = actor.snapshot;
    const executor = createStructuredExecutor(actor);

    const error = await rejectionOf(
      executor.execute({ command: 'printf ok', expectedContextId: 'stale-context' }),
    );

    expect(error.message).toMatch(/^EXECUTION_CONTEXT_STALE:/);
    expect(error.message).not.toContain('EXECUTION_WRITE_UNKNOWN');
    expect(backend.writes).toEqual([]);
    expect(actor.snapshot.environment.verificationStatus).toBe('verified');
    expect(actor.snapshot.environment.capabilityEpoch).toBe(before.environment.capabilityEpoch);
    expect(actor.snapshot.executionContextId).toBe(before.executionContextId);
    actor.dispose();
  });

  it('写入不确定态之后必须先重新观察，旧 executionContextId 会被拒绝', async () => {
    const backend = createFakeTerminalBackend();
    const actor = new SessionActor('contract-session', backend, {
      title: 'contract',
      terminalType: 'bash',
    });
    await actor.markPtyRunning();
    await actor.verifyEnvironment('posix', 'unix');
    const before = actor.snapshot;
    let writeAttempts = 0;
    backend.write = () => {
      writeAttempts += 1;
      throw new Error('pty refused the write');
    };
    const executor = createStructuredExecutor(actor);

    await expect(
      executor.execute({ command: 'printf ok', expectedContextId: before.executionContextId }),
    ).rejects.toThrow(/^EXECUTION_WRITE_UNKNOWN:/);

    await expect(
      executor.execute({ command: 'printf again', expectedContextId: before.executionContextId }),
    ).rejects.toThrow(/^EXECUTION_CONTEXT_STALE:/);
    expect(writeAttempts).toBe(1);
    actor.dispose();
  });
});

describe('交互启动前提失败的外部错误码', () => {
  it('environment 在写入前失效时以 SESSION_NOT_READY 拒绝且不写入启动命令', async () => {
    const { actor, backend } = await createActor();

    const error = await interactiveStartAfter(actor, () => actor.writeUser('typed\r'));

    expect(error.message).toMatch(/^SESSION_NOT_READY:/);
    expect(backend.writes).toEqual(['typed\r']);
    actor.dispose();
  });

  it('capability epoch 在写入前变化时以 SESSION_NOT_READY 拒绝且不写入启动命令', async () => {
    const { actor, backend } = await createActor();

    const error = await interactiveStartAfter(actor, () =>
      actor.verifyEnvironment('posix', 'unix'),
    );

    expect(error.message).toMatch(/^SESSION_NOT_READY:/);
    expect(backend.writes).toEqual([]);
    actor.dispose();
  });

  it('executionContextId 在写入前轮换时以 EXECUTION_CONTEXT_STALE 拒绝且不写入启动命令', async () => {
    const { actor, backend } = await createActor();

    const error = await interactiveStartAfter(actor, () => rotateContext(actor));

    expect(error.message).toMatch(/^EXECUTION_CONTEXT_STALE:/);
    expect(backend.writes).toEqual(['printf unrelated\r']);
    actor.dispose();
  });
});

describe('事务内输入前提失败的外部错误码', () => {
  it('environment 在写入前失效时以 INPUT_WRITE_UNKNOWN 收敛且不写入输入', async () => {
    const { actor, backend } = await createActor();
    const executor = createInteractiveExecutor(actor);
    const started = await executor.start({
      command: 'sudo su -',
      expectedContextId: actor.snapshot.executionContextId,
      inputGrantMode: 'bounded',
      caller: contractCaller,
    });

    const rejection = rejectionOf(
      executor.input({
        transactionId: started.transaction.id,
        inputGrantId: 'contract-grant',
        inputRequestId: 'contract-input-1',
        payload: payload('secret\r'),
        caller: contractCaller,
      }),
    );
    await actor.writeUser('typed\r');

    expect((await rejection).message).toMatch(/^INPUT_WRITE_UNKNOWN:/);
    expect(backend.writes).toEqual(['sudo su -\r', 'typed\r']);
    await expect(
      executor.wait({ transactionId: started.transaction.id, timeoutMs: 0 }),
    ).resolves.toMatchObject({ status: 'unknown' });
    actor.dispose();
  });
});

describe('取消事实在写入前被求值', () => {
  it('三档外部前提在已取消前提下都拒绝且不写入 PTY', async () => {
    const { actor, backend } = await createActor();
    const { environment, executionContextId } = actor.snapshot;
    const cancelled = (): boolean => true;
    const refused = { ok: false, error: 'external-write-cancelled', environmentInvalidated: false };

    await expect(
      actor.writeExternal({
        data: 'cancelled\r',
        premise: {
          precondition: 'environment-and-context',
          environmentEpoch: environment.capabilityEpoch,
          executionContextId,
        },
        cancelled,
      }),
    ).resolves.toEqual(refused);
    await expect(
      actor.writeExternal({
        data: 'cancelled\r',
        premise: { precondition: 'environment' },
        cancelled,
      }),
    ).resolves.toEqual(refused);
    await expect(
      actor.writeExternal({
        data: 'cancelled\r',
        premise: { precondition: 'context', executionContextId },
        cancelled,
      }),
    ).resolves.toEqual(refused);
    expect(backend.writes).toEqual([]);
    actor.dispose();
  });
});
