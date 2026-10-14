import type { ExternalCaller } from '@synapse-term/domain';

/** 输入模式：事务内输入挂在交互事务上，自由输入不挂任何事务。 */
export type InputRequestMode = 'transactional' | 'free';

/**
 * 一次已登记输入请求的状态。
 *
 * 纯值对象：`promise` 供进行中的重复请求复用，`outcome` 与 `error` 供完成后的只读重放。
 * 不持有 resolve/reject 钩子——调用方在本地作用域内收敛自己的 deferred。
 */
export interface InputRequestRecord {
  readonly mode: InputRequestMode;
  /** 事务内输入所属事务；自由输入为 undefined。 */
  readonly transactionId?: string | undefined;
  /** 事务内输入消耗的授权；自由输入为 undefined。 */
  readonly grantId?: string | undefined;
  /** 规范化 payload 的摘要，用于判断同一 requestId 是否携带了不同输入。 */
  readonly payloadHash: string;
  /** 首次调用登记的进行中结果；重复 requestId 复用它，不会再次写入 PTY。 */
  promise: Promise<unknown>;
  /** 成功完成后的只读重放结果（已脱敏）；进行中时为 undefined。 */
  outcome?: unknown;
  /** 失败后的稳定错误；失败后同一 requestId 复用同一个错误。 */
  error?: unknown;
}

/** 判定「同一 requestId 是否携带了同一份输入」所需的字段。 */
export interface InputRequestFingerprint {
  readonly mode: InputRequestMode;
  readonly transactionId?: string | undefined;
  readonly grantId?: string | undefined;
  readonly payloadHash: string;
}

/**
 * 输入请求幂等账本，覆盖事务内与自由两种模式。
 *
 * 键为 `(caller identity, requestId)`；sessionId 由 per-Session 实例隐含，因此复合键与
 * `specs/mcp-access` 的规范主键一致。模式与授权不进入键——它们是被比较的字段，不是定位依据。
 *
 * 调用方身份可选：不携带身份时的请求共用一个桶，这与收敛前执行器的行为一致。
 *
 * 记录里的 `promise` / `outcome` / `error` 负载类型是 `unknown`——账本按设计不解释归属方的
 * 结果类型，每个归属方在自己的读取处收窄一次。
 */
export class InputRequestLedger {
  readonly #records = new Map<string, InputRequestRecord>();

  locate(caller: ExternalCaller | undefined, requestId: string): InputRequestRecord | undefined {
    return this.#records.get(recordKey(caller, requestId));
  }

  /** 登记一个新请求；同一 caller 与 requestId 已存在时抛错（调用方应先 locate）。 */
  register(
    caller: ExternalCaller | undefined,
    requestId: string,
    record: InputRequestRecord,
  ): void {
    const key = recordKey(caller, requestId);
    if (this.#records.has(key)) {
      throw new Error(`input request ${requestId} is already registered for this caller`);
    }
    this.#records.set(key, record);
  }

  clear(): void {
    this.#records.clear();
  }
}

/** 键含 caller 身份的两个维度与 requestId，用 NUL 分隔以避免拼接歧义。 */
function recordKey(caller: ExternalCaller | undefined, requestId: string): string {
  return `${caller?.kind ?? ''}\0${caller?.id ?? ''}\0${requestId}`;
}

/**
 * 同一 requestId 的重试只有在模式、所属事务、授权与 payload 摘要全部相同时才算同一份输入；
 * 任一不同都必须拒绝，不能当成新请求。
 */
export function matchesInputRequestFingerprint(
  record: InputRequestRecord,
  wanted: InputRequestFingerprint,
): boolean {
  return (
    record.mode === wanted.mode &&
    record.transactionId === wanted.transactionId &&
    record.grantId === wanted.grantId &&
    record.payloadHash === wanted.payloadHash
  );
}
